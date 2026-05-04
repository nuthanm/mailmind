// api/realtime.js
// GET /api/realtime/fetch?accountId=xxx  → SSE stream for Gmail fetch progress
// GET /api/realtime/process              → SSE stream for AI processing progress

import { getDb, withCors, ok, err } from './_utils.js'
import { requireAuth } from './auth.js'
import { getValidToken, listMessages, batchGetMessages, parseGmailMessage } from './_gmail_utils.js'
import { newId, encryptApiKey, decryptApiKey, stripPII } from './_utils.js'

export default async function handler(req, res) {
  // SSE requires specific CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = getDb()
  const user = await requireAuth(req, res, sql)
  if (!user) return  // requireAuth already sent 401

  const path = req.url.replace(/\?.*$/, '')
  const subpath = path.split('/realtime/')[1] || ''

  // ── SSE SETUP ──
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // Disable Nginx buffering
  res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    if (res.flush) res.flush()
  }

  const done = (data = {}) => {
    send('done', data)
    res.end()
  }

  const error = (msg) => {
    send('error', { message: msg })
    res.end()
  }

  // Keepalive ping every 15s
  const keepAlive = setInterval(() => {
    res.write(': ping\n\n')
    if (res.flush) res.flush()
  }, 15000)

  req.on('close', () => clearInterval(keepAlive))

  // ── REALTIME GMAIL FETCH ──
  if (subpath === 'fetch') {
    const { accountId, query = 'in:inbox', maxEmails = '50' } = req.query
    if (!accountId) return error('accountId required')

    const [account] = await sql`
      SELECT * FROM gmail_accounts
      WHERE id = ${accountId} AND user_id = ${user.userId} AND is_active = true
    `
    if (!account) return error('Gmail account not found')

    try {
      send('status', { message: `Connecting to Gmail for ${account.email}…`, step: 1, total: 4 })

      // Derive session id for this user (required by emails.session_id NOT NULL)
      const sessionId = `usr_${user.userId}`
      try {
        await sql`
          INSERT INTO sessions (id, user_id)
          VALUES (${sessionId}, ${user.userId})
          ON CONFLICT (id) DO NOTHING
        `
      } catch {
        try {
          await sql`INSERT INTO sessions (id) VALUES (${sessionId}) ON CONFLICT (id) DO NOTHING`
        } catch { /* proceed */ }
      }

      let accessToken
      try {
        accessToken = await getValidToken(account, sql)
      } catch (e) {
        await sql`UPDATE gmail_accounts SET is_active = false WHERE id = ${accountId}`
        return error('Gmail session expired. Please reconnect your account.')
      }

      send('status', { message: 'Fetching email list from Gmail…', step: 2, total: 4 })

      const limit = Math.min(Math.max(parseInt(maxEmails) || 50, 1), 2000)
      const messageIds = []
      let pageToken = null
      let pageCount = 0
      do {
        pageCount++
        const remaining = limit - messageIds.length
        const pageSize = Math.min(500, remaining)
        send('status', {
          message: `Fetching email list from Gmail… (page ${pageCount})`,
          step: 2,
          total: 4,
          fetchedSoFar: messageIds.length,
        })
        const page = await listMessages(accessToken, {
          maxResults: pageSize,
          query: query + ' -in:spam -in:trash',
          pageToken,
        })
        messageIds.push(...((page.messages || []).map(m => m.id)))
        pageToken = page.nextPageToken || null
      } while (pageToken && messageIds.length < limit)

      if (messageIds.length === 0) {
        return done({ fetched: 0, message: 'No emails found matching your criteria' })
      }

      send('status', {
        message: `Found ${messageIds.length} emails. Downloading…`,
        step: 3,
        total: 4,
        count: messageIds.length,
      })

      // Batch fetch with progress updates
      const BATCH = 10
      let inserted = 0
      let skipped = 0
      let processed = 0

      for (let i = 0; i < messageIds.length; i += BATCH) {
        const chunk = messageIds.slice(i, i + BATCH)
        const rawMessages = await batchGetMessages(accessToken, chunk)

        for (const raw of rawMessages) {
          processed++
          if (!raw.data) { skipped++; continue }

          const parsed = parseGmailMessage(raw.data)
          if (!parsed) { skipped++; continue }

          // Skip duplicates
          const [existing] = await sql`
            SELECT id FROM emails WHERE gmail_message_id = ${parsed.gmail_message_id} AND user_id = ${user.userId}
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

        // Send progress update after each batch
        send('progress', {
          processed,
          total: messageIds.length,
          inserted,
          skipped,
          percent: Math.round((processed / messageIds.length) * 100),
        })
      }

      // Update sync metadata
      await sql`
        UPDATE gmail_accounts SET
          last_synced_at = NOW(),
          total_fetched = total_fetched + ${inserted},
          updated_at = NOW()
        WHERE id = ${accountId}
      `

      done({ fetched: inserted, skipped, total: messageIds.length })

    } catch (e) {
      error(e.message)
    }
    return
  }

  // ── REALTIME AI PROCESSING ──
  if (subpath === 'process') {
    const { accountId } = req.query

    const [settings] = await sql`SELECT * FROM user_settings WHERE user_id = ${user.userId}`
    if (!settings?.api_key_enc) return error('No API key saved. Go to Settings first.')

    let apiKey
    try {
      apiKey = decryptApiKey(settings.api_key_enc)
    } catch {
      return error('Failed to decrypt API key. Please re-enter it in Settings.')
    }

    const unprocessed = accountId && accountId !== 'all'
      ? await sql`
          SELECT e.* FROM emails e
          LEFT JOIN processed_emails pe ON pe.email_id = e.id
          WHERE e.user_id = ${user.userId}
            AND e.account_id = ${accountId}
            AND pe.email_id IS NULL
          ORDER BY e.received_at DESC
          LIMIT 25
        `
      : await sql`
          SELECT e.* FROM emails e
          LEFT JOIN processed_emails pe ON pe.email_id = e.id
          WHERE e.user_id = ${user.userId} AND pe.email_id IS NULL
          ORDER BY e.received_at DESC
          LIMIT 25
        `

    if (unprocessed.length === 0) {
      return done({ processed: 0, message: 'All emails already processed' })
    }

    send('status', {
      message: `Processing ${unprocessed.length} emails with AI…`,
      total: unprocessed.length,
    })

    let done_count = 0

    for (const email of unprocessed) {
      send('processing', {
        emailId: email.id,
        subject: email.subject,
        from: email.from_name,
        index: done_count + 1,
        total: unprocessed.length,
      })

      const log = []
      const now = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

      log.push({ icon: '📥', msg: `<strong>${email.subject}</strong>`, type: 'success', time: now() })

      let bodyToSend = email.body
      if (settings.strip_pii) {
        bodyToSend = stripPII(email.body)
        if (bodyToSend !== email.body) {
          log.push({ icon: '🔒', msg: 'PII anonymized', type: 'success', time: now() })
        }
      }

      let fields = null
      let draft = null

      try {
        const raw = await callAI(settings.ai_provider, apiKey, settings.selected_model, buildExtractPrompt(email, bodyToSend))
        try { fields = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
        catch { fields = { intent: 'Parse error', priority: 'Normal', action_required: 'No', needs_reply: 'No', category: 'Other', summary: raw.slice(0, 100), sender_type: 'Unknown' } }

        log.push({ icon: '✓', msg: `Extracted: <strong>${fields.category}</strong> · ${fields.priority} priority`, type: 'success', time: now() })

        if (settings.generate_drafts && (fields.needs_reply === 'Yes' || fields.action_required === 'Yes')) {
          draft = await callAI(settings.ai_provider, apiKey, settings.selected_model, buildDraftPrompt(email, fields, settings.style_prompt))
          log.push({ icon: '✍', msg: 'Draft reply generated', type: 'success', time: now() })
        }

      } catch (e) {
        log.push({ icon: '✕', msg: `Error: ${e.message}`, type: 'error', time: now() })
      }

      await sql`
        INSERT INTO processed_emails (email_id, session_id, fields, draft, agent_log)
        VALUES (${email.id}, ${'realtime'}, ${JSON.stringify(fields)}, ${draft}, ${JSON.stringify(log)})
        ON CONFLICT (email_id) DO UPDATE SET
          fields = EXCLUDED.fields, draft = EXCLUDED.draft,
          agent_log = EXCLUDED.agent_log, processed_at = NOW()
      `

      done_count++
      send('result', { emailId: email.id, fields, hasDraft: !!draft, done: done_count, total: unprocessed.length })
      await new Promise(r => setTimeout(r, 200))
    }

    done({ processed: done_count })
    return
  }

  error('Unknown realtime endpoint')
}

async function callAI(provider, apiKey, model, prompt) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `Anthropic ${res.status}`) }
    const d = await res.json(); return d.content?.[0]?.text || ''
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || 'gpt-4o-mini', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `OpenAI ${res.status}`) }
  const d = await res.json(); return d.choices?.[0]?.message?.content || ''
}

function buildExtractPrompt(email, body) {
  return `Analyze this email and return ONLY valid JSON, no markdown.

FROM: ${email.from_name} <${email.from_email || ''}>
SUBJECT: ${email.subject}
BODY: ${body.substring(0, 1500)}

Return exactly:
{"sender_type":"Client/Vendor/Colleague/HR/Bank/Newsletter/Automated","intent":"one sentence","priority":"High/Normal/Low","action_required":"Yes/No","needs_reply":"Yes/No","key_date":null,"amount":null,"category":"Finance/Partnership/Project/HR/Newsletter/Other","summary":"2-3 sentences"}`
}

function buildDraftPrompt(email, fields, stylePrompt) {
  return `Draft a professional email reply. Return ONLY the body text, no subject, no markdown.

Original from: ${email.from_name}
Subject: ${email.subject}
Body: ${email.body.substring(0, 600)}
Intent: ${fields.intent}

${stylePrompt || 'Write professionally and concisely. End with a clear next step.'}

Sign off as "Rob". Reply body only:`
}
