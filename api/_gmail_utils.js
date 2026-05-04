// api/_gmail_utils.js
// Gmail OAuth helpers and email fetching logic

import { encryptApiKey, decryptApiKey } from './_utils.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'

// ── OAUTH URL BUILDER ──
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',   // needed to mark read / unsubscribe
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' '),
    access_type: 'offline',      // gets refresh token
    prompt: 'consent',           // always ask, ensures refresh_token is returned
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// ── EXCHANGE CODE FOR TOKENS ──
export async function exchangeCode(code) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error_description || `Token exchange failed: ${res.status}`)
  }
  return res.json()
  // Returns: { access_token, refresh_token, expires_in, token_type }
}

// ── REFRESH ACCESS TOKEN ──
export async function refreshAccessToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error_description || 'Token refresh failed')
  }
  return res.json()
  // Returns: { access_token, expires_in }
}

// ── GET VALID ACCESS TOKEN (auto-refresh if expired) ──
export async function getValidToken(account, sql) {
  const now = new Date()
  const expiry = account.token_expiry ? new Date(account.token_expiry) : null
  const isExpired = !expiry || (expiry - now) < 60000  // refresh if <1 min left

  if (!isExpired && account.access_token_enc) {
    return decryptApiKey(account.access_token_enc)
  }

  // Need to refresh
  if (!account.refresh_token_enc) {
    throw new Error('No refresh token — user must reconnect Gmail')
  }

  const refreshToken = decryptApiKey(account.refresh_token_enc)
  const tokens = await refreshAccessToken(refreshToken)

  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000)
  const newEncToken = encryptApiKey(tokens.access_token)

  await sql`
    UPDATE gmail_accounts SET
      access_token_enc = ${newEncToken},
      token_expiry = ${newExpiry},
      updated_at = NOW()
    WHERE id = ${account.id}
  `

  return tokens.access_token
}

// ── GET GOOGLE USER INFO ──
export async function getGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) throw new Error('Failed to get user info')
  return res.json()
  // Returns: { id, email, name, picture }
}

// ── GMAIL API CALL ──
async function gmailCall(path, accessToken, options = {}) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message || `Gmail API error ${res.status}`)
  }
  return res.json()
}

// ── LIST MESSAGES ──
export async function listMessages(accessToken, options = {}) {
  const {
    maxResults = 100,
    query = '',           // Gmail search query
    pageToken = null,
    labelIds = ['INBOX'],
  } = options

  const params = new URLSearchParams({ maxResults })
  if (query) params.set('q', query)
  if (pageToken) params.set('pageToken', pageToken)
  labelIds.forEach(id => params.append('labelIds', id))

  const data = await gmailCall(`/users/me/messages?${params}`, accessToken)
  return data  // { messages: [{id, threadId}], nextPageToken, resultSizeEstimate }
}

// ── GET SINGLE MESSAGE WITH FULL DETAILS ──
export async function getMessage(accessToken, messageId) {
  return gmailCall(`/users/me/messages/${messageId}?format=full`, accessToken)
}

// ── BATCH GET MESSAGES (more efficient) ──
export async function batchGetMessages(accessToken, messageIds) {
  // Gmail batch endpoint processes up to 100 at once
  // We'll process them individually but with Promise.allSettled for speed
  const BATCH_SIZE = 10
  const results = []

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const chunk = messageIds.slice(i, i + BATCH_SIZE)
    const settled = await Promise.allSettled(
      chunk.map(id => getMessage(accessToken, id))
    )
    results.push(...settled.map((r, idx) => ({
      id: chunk[idx],
      data: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? r.reason.message : null,
    })))

    // Small delay to respect rate limits
    if (i + BATCH_SIZE < messageIds.length) {
      await new Promise(r => setTimeout(r, 100))
    }
  }

  return results
}

// ── PARSE A GMAIL MESSAGE INTO OUR EMAIL FORMAT ──
export function parseGmailMessage(msg) {
  if (!msg || !msg.payload) return null

  const headers = msg.payload.headers || []
  const get = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''

  const fromRaw = get('From')
  const { name: fromName, email: fromEmail } = parseEmailAddress(fromRaw)

  // Get body text — walk through parts
  const body = extractBody(msg.payload)

  // Size estimate from Gmail
  const sizeEstimate = msg.sizeEstimate || 0

  return {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    from_name: fromName || fromEmail,
    from_email: fromEmail,
    subject: get('Subject') || '(no subject)',
    body: body || '',
    received_at: new Date(parseInt(msg.internalDate)).toISOString(),
    list_unsubscribe_header: get('List-Unsubscribe') || get('list-unsubscribe') || null,
    size_estimate: sizeEstimate,
  }
}

// ── PARSE "Name <email>" format ──
function parseEmailAddress(raw) {
  if (!raw) return { name: '', email: '' }
  const match = raw.match(/^(.*?)\s*<([^>]+)>/)
  if (match) {
    return {
      name: match[1].replace(/^["']|["']$/g, '').trim(),
      email: match[2].trim().toLowerCase(),
    }
  }
  // Plain email address
  return { name: '', email: raw.trim().toLowerCase() }
}

// ── EXTRACT PLAIN TEXT BODY from Gmail payload ──
function extractBody(payload) {
  // Try to find text/plain first, then text/html
  if (!payload) return ''

  if (payload.body?.data) {
    const decoded = decodeBase64(payload.body.data)
    // Strip HTML if this part is HTML (top-level non-multipart email)
    if (payload.mimeType === 'text/html') return stripHtml(decoded)
    return decoded
  }

  const parts = payload.parts || []

  // First pass: find text/plain
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64(part.body.data)
    }
  }

  // Second pass: find text/html and strip tags
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return stripHtml(decodeBase64(part.body.data))
    }
  }

  // Recurse into nested multipart
  for (const part of parts) {
    if (part.mimeType?.startsWith('multipart/')) {
      const nested = extractBody(part)
      if (nested) return nested
    }
  }

  return ''
}

function decodeBase64(data) {
  if (!data) return ''
  // Gmail uses URL-safe base64
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return Buffer.from(base64, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 3000)  // cap at 3000 chars for AI processing
}

// ── GET GMAIL PROFILE (storage quota) ──
export async function getGmailProfile(accessToken) {
  return gmailCall('/users/me/profile', accessToken)
  // Returns: { emailAddress, messagesTotal, threadsTotal, historyId }
}

// ── GET STORAGE QUOTA ──
export async function getStorageQuota(accessToken) {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.storageQuota
  // Returns: { limit, usage, usageInDrive, usageInDriveTrash }
}
