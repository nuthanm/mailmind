// api/gmail.js
// All Gmail OAuth and email fetching routes
//
// GET  /api/gmail/accounts         → list connected Gmail accounts for session
// GET  /api/gmail/connect          → start OAuth flow (redirects to Google)
// GET  /api/gmail/callback         → OAuth callback (exchange code, save tokens)
// POST /api/gmail/fetch            → fetch emails from Gmail into DB
// GET  /api/gmail/quota            → get storage quota info
// DELETE /api/gmail/disconnect/:id → disconnect a Gmail account

import { getDb, withCors, encryptApiKey, ok, err, newId } from './_utils.js'
import {
  buildAuthUrl, exchangeCode, getValidToken, getGoogleUserInfo,
  listMessages, batchGetMessages, parseGmailMessage,
  getGmailProfile, getStorageQuota
} from './_gmail_utils.js'
import { requireAuth } from './auth.js'
import crypto from 'crypto'

async function ensureUserSession(sql, userId) {
  const sessionId = `usr_${userId}`
  try {
    await sql`
      INSERT INTO sessions (id, user_id)
      VALUES (${sessionId}, ${userId})
      ON CONFLICT (id) DO NOTHING
    `
  } catch {
    // Fallback for older schema without user_id column
    try {
      await sql`
        INSERT INTO sessions (id)
        VALUES (${sessionId})
        ON CONFLICT (id) DO NOTHING
      `
    } catch {
      // Sessions table may have a different schema; proceed with the derived ID
    }
  }
  return sessionId
}

function normalizeAppUrl(url) {
  if (!url) return null
  const trimmed = String(url).trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed
}

function resolveFallbackAppUrl() {
  const envUrl = normalizeAppUrl(process.env.APP_URL)
  if (envUrl && !envUrl.includes('your-app.vercel.app')) return envUrl
  return 'http://localhost:5173'
}

function appUrlFromState(state) {
  if (!state || !state.includes('.')) return null
  const encoded = state.slice(state.indexOf('.') + 1)
  if (!encoded) return null
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
    return normalizeAppUrl(decoded)
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  withCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = getDb()
  const path = req.url.replace(/\?.*$/, '')
  const subpath = path.split('/gmail/')[1] || ''

  // ── LIST CONNECTED ACCOUNTS ──
  if (subpath === 'accounts' && req.method === 'GET') {
    const user = await requireAuth(req, res, sql)
    if (!user) return

    const accounts = await sql`
      SELECT id, email, display_name, picture_url,
             last_synced_at, total_fetched, is_active,
             (refresh_token_enc IS NOT NULL) AS has_refresh_token,
             token_expiry
      FROM gmail_accounts
      WHERE user_id = ${user.userId} AND is_active = true
      ORDER BY created_at ASC
    `
    return ok(res, { accounts })
  }

  // ── START OAUTH FLOW ──
  if (subpath === 'connect' && req.method === 'GET') {
    const user = await requireAuth(req, res, sql)
    if (!user) return

    // Check Google credentials configured
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return err(res, 500, 'Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment variables.')
    }

    const sessionId = await ensureUserSession(sql, user.userId)
    const appUrl = normalizeAppUrl(req.query?.app)

    // Create state token (CSRF protection)
    const baseState = crypto.randomBytes(24).toString('hex')
    const state = appUrl
      ? `${baseState}.${Buffer.from(appUrl).toString('base64url')}`
      : baseState
    await sql`
      INSERT INTO oauth_states (state, session_id)
      VALUES (${state}, ${sessionId})
    `

    // Clean up old unused states (>10 mins)
    await sql`
      DELETE FROM oauth_states
      WHERE created_at < NOW() - INTERVAL '10 minutes' AND used = false
    `

    const authUrl = buildAuthUrl(state)

    // Redirect directly to Google
    res.writeHead(302, { Location: authUrl })
    return res.end()
  }

  // ── OAUTH CALLBACK ──
  if (subpath === 'callback' && req.method === 'GET') {
    const { code, state, error } = req.query
    const callbackAppUrl = appUrlFromState(state) || resolveFallbackAppUrl()

    if (error) {
      // User denied access — redirect back with error
      res.writeHead(302, { Location: `${callbackAppUrl}?gmail_error=${encodeURIComponent(error)}` })
      return res.end()
    }

    if (!code || !state) {
      return err(res, 400, 'Missing code or state')
    }

    // Validate state (CSRF check)
    const [stateRow] = await sql`
      SELECT * FROM oauth_states
      WHERE state = ${state} AND used = false
      AND created_at > NOW() - INTERVAL '10 minutes'
    `
    if (!stateRow) {
      return err(res, 400, 'Invalid or expired OAuth state. Please try connecting again.')
    }

    // Mark state as used
    await sql`UPDATE oauth_states SET used = true WHERE state = ${state}`

    try {
      // Exchange code for tokens
      const tokens = await exchangeCode(code)

      // Get Google user info
      const userInfo = await getGoogleUserInfo(tokens.access_token)

      // Encrypt tokens before storing
      const encAccessToken = encryptApiKey(tokens.access_token)
      const encRefreshToken = tokens.refresh_token
        ? encryptApiKey(tokens.refresh_token)
        : null

      const tokenExpiry = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null

      const accountId = newId('gm_')
      const userId = stateRow.session_id.replace(/^usr_/, '')

      // Upsert gmail account
      await sql`
        INSERT INTO gmail_accounts (
          id, session_id, user_id, google_user_id, email, display_name, picture_url,
          access_token_enc, refresh_token_enc, token_expiry
        ) VALUES (
          ${accountId}, ${stateRow.session_id}, ${userId},
          ${userInfo.id}, ${userInfo.email},
          ${userInfo.name || userInfo.email},
          ${userInfo.picture || null},
          ${encAccessToken},
          ${encRefreshToken},
          ${tokenExpiry}
        )
        ON CONFLICT (session_id, google_user_id) DO UPDATE SET
          access_token_enc = EXCLUDED.access_token_enc,
          refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, gmail_accounts.refresh_token_enc),
          token_expiry = EXCLUDED.token_expiry,
          display_name = EXCLUDED.display_name,
          picture_url = EXCLUDED.picture_url,
          is_active = true,
          updated_at = NOW()
      `

      // Redirect back to app with success
      res.writeHead(302, {
        Location: `${callbackAppUrl}?gmail_connected=${encodeURIComponent(userInfo.email)}`
      })
      return res.end()

    } catch (e) {
      console.error('OAuth callback error:', e)
      res.writeHead(302, {
        Location: `${callbackAppUrl}?gmail_error=${encodeURIComponent(e.message)}`
      })
      return res.end()
    }
  }

  // All routes below require auth
  const user = await requireAuth(req, res, sql)
  if (!user) return

  // ── FETCH EMAILS FROM GMAIL ──
  if (subpath === 'fetch' && req.method === 'POST') {
    const {
      accountId,
      maxEmails = 50,           // default 50, max 2000
      query = '',               // Gmail search query e.g. "is:unread", "in:inbox"
      includeSpam = false,
      onlyUnread = false,
    } = req.body

    if (!accountId) return err(res, 400, 'accountId required')

    const [account] = await sql`
      SELECT * FROM gmail_accounts
      WHERE id = ${accountId} AND user_id = ${user.userId} AND is_active = true
    `
    if (!account) return err(res, 404, 'Gmail account not found')

    // Get valid access token (refreshes if needed)
    let accessToken
    try {
      accessToken = await getValidToken(account, sql)
    } catch (e) {
      if (e.message.includes('UNAUTHORIZED') || e.message.includes('reconnect')) {
        // Mark account as needing reconnection
        await sql`UPDATE gmail_accounts SET is_active = false WHERE id = ${accountId}`
        return err(res, 401, 'Gmail session expired. Please reconnect your Gmail account.')
      }
      return err(res, 500, e.message)
    }

    const limit = Math.min(Math.max(parseInt(maxEmails) || 50, 1), 2000)

    // Build Gmail search query
    let gmailQuery = query || 'in:inbox'
    if (onlyUnread) gmailQuery += ' is:unread'
    if (!includeSpam) gmailQuery += ' -in:spam -in:trash'

    try {
      // Fetch message list from Gmail (paged)
      const messageIds = []
      let pageToken = null
      do {
        const remaining = limit - messageIds.length
        const pageSize = Math.min(500, remaining)
        const page = await listMessages(accessToken, {
          maxResults: pageSize,
          query: gmailQuery,
          pageToken,
        })
        messageIds.push(...((page.messages || []).map(m => m.id)))
        pageToken = page.nextPageToken || null
      } while (pageToken && messageIds.length < limit)

      if (messageIds.length === 0) {
        return ok(res, { fetched: 0, message: 'No new emails found' })
      }

      // Batch fetch full message data
      const rawMessages = await batchGetMessages(accessToken, messageIds)
      const sessionId = await ensureUserSession(sql, user.userId)

      let inserted = 0
      let skipped = 0

      for (const raw of rawMessages) {
        if (!raw.data) { skipped++; continue }

        const parsed = parseGmailMessage(raw.data)
        if (!parsed) { skipped++; continue }

        // Skip if already in DB (by Gmail message ID)
        const [existing] = await sql`
          SELECT id FROM emails
          WHERE gmail_message_id = ${parsed.gmail_message_id}
          AND user_id = ${user.userId}
          LIMIT 1
        `
        if (existing) { skipped++; continue }

        const emailId = newId('em_')
        await sql`
          INSERT INTO emails (
            id, session_id, user_id, account_id,
            from_name, from_email, subject, body,
            received_at, list_unsubscribe_header,
            gmail_message_id, gmail_thread_id, size_estimate
          ) VALUES (
            ${emailId}, ${sessionId}, ${user.userId}, ${accountId},
            ${parsed.from_name}, ${parsed.from_email},
            ${parsed.subject}, ${parsed.body},
            ${parsed.received_at}, ${parsed.list_unsubscribe_header},
            ${parsed.gmail_message_id}, ${parsed.gmail_thread_id},
            ${parsed.size_estimate}
          )
        `
        inserted++
      }

      // Update sync metadata
      await sql`
        UPDATE gmail_accounts SET
          last_synced_at = NOW(),
          total_fetched = total_fetched + ${inserted},
          updated_at = NOW()
        WHERE id = ${accountId}
      `

      return ok(res, {
        fetched: inserted,
        skipped,
        total: messageIds.length,
        message: `Fetched ${inserted} new emails from Gmail`
      })

    } catch (e) {
      if (e.message === 'UNAUTHORIZED') {
        await sql`UPDATE gmail_accounts SET is_active = false WHERE id = ${accountId}`
        return err(res, 401, 'Gmail access revoked. Please reconnect your account.')
      }
      return err(res, 500, e.message)
    }
  }

  // ── GET STORAGE QUOTA ──
  if (subpath === 'quota' && req.method === 'GET') {
    const { accountId } = req.query
    if (!accountId) return err(res, 400, 'accountId required')

    const [account] = await sql`
      SELECT * FROM gmail_accounts
      WHERE id = ${accountId} AND user_id = ${user.userId}
    `
    if (!account) return err(res, 404, 'Account not found')

    try {
      const accessToken = await getValidToken(account, sql)
      const [profile, quota] = await Promise.all([
        getGmailProfile(accessToken),
        getStorageQuota(accessToken),
      ])
      return ok(res, { profile, quota })
    } catch (e) {
      return err(res, 500, e.message)
    }
  }

  // ── DISCONNECT ACCOUNT ──
  if (subpath.startsWith('disconnect/') && req.method === 'DELETE') {
    const accountId = subpath.replace('disconnect/', '')
    await sql`
      UPDATE gmail_accounts
      SET is_active = false, access_token_enc = null, refresh_token_enc = null
      WHERE id = ${accountId} AND user_id = ${user.userId}
    `
    return ok(res, { message: 'Gmail account disconnected' })
  }

  return err(res, 404, 'Route not found')
}
