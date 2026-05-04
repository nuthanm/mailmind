// api/process.js
// POST /api/process        → process one or all emails with AI
// POST /api/process/draft  → regenerate draft for one email

import { getDb, withCors, decryptApiKey,
         stripPII, ok, err, newId } from './_utils.js'
import { requireAuth } from './auth.js'

async function ensureUserSession(sql, userId) {
  const sessionId = `usr_${userId}`
  await sql`
    INSERT INTO sessions (id, user_id)
    VALUES (${sessionId}, ${userId})
    ON CONFLICT (id) DO NOTHING
  `
  return sessionId
}

export default async function handler(req, res) {
  withCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return err(res, 405, 'Method not allowed')

  const sql = getDb()
  const user = await requireAuth(req, res, sql)
  if (!user) return
  const sessionId = await ensureUserSession(sql, user.userId)

  // Get user settings with encrypted key
  const [fullSession] = await sql`
    SELECT * FROM user_settings WHERE user_id = ${user.userId}
  `
  if (!fullSession?.api_key_enc)
    return err(res, 400, 'No API key configured. Go to Settings to add your key.')

  let apiKey
  try {
    apiKey = decryptApiKey(fullSession.api_key_enc)
  } catch {
    return err(res, 500, 'Failed to decrypt API key. Please re-enter your key in Settings.')
  }

  const { emailId, action } = req.body

  // ── REGENERATE DRAFT ──
  if (action === 'regen_draft') {
    if (!emailId) return err(res, 400, 'emailId required')
    const [email] = await sql`SELECT * FROM emails WHERE id = ${emailId} AND user_id = ${user.userId}`
    if (!email) return err(res, 404, 'Email not found')
    const [processed] = await sql`SELECT * FROM processed_emails WHERE email_id = ${emailId}`
    if (!processed?.fields) return err(res, 400, 'Email not yet extracted. Process it first.')

    const draft = await generateDraft(email, processed.fields, fullSession, apiKey)
    const newLog = [...(processed.agent_log || []), logEntry('✍', `Draft regenerated`, 'success')]
    await sql`
      UPDATE processed_emails
      SET draft = ${draft}, draft_sent = false, agent_log = ${JSON.stringify(newLog)}
      WHERE email_id = ${emailId}
    `
    return ok(res, { draft })
  }

  // ── MARK DRAFT SENT ──
  if (action === 'mark_sent') {
    if (!emailId) return err(res, 400, 'emailId required')
    await sql`
      UPDATE processed_emails SET draft_sent = true
      WHERE email_id = ${emailId}
    `
    return ok(res, { message: 'Marked as sent' })
  }

  // ── PROCESS EMAILS ──
  // If emailId provided → process just that one
  // Otherwise → process all unprocessed in session

  let emailsToProcess = []
  if (emailId) {
    const [e] = await sql`SELECT * FROM emails WHERE id = ${emailId} AND user_id = ${user.userId}`
    if (!e) return err(res, 404, 'Email not found')
    emailsToProcess = [e]
  } else {
    emailsToProcess = await sql`
      SELECT e.* FROM emails e
      LEFT JOIN processed_emails pe ON pe.email_id = e.id
      WHERE e.user_id = ${user.userId} AND pe.email_id IS NULL
      ORDER BY e.created_at ASC
      LIMIT 20
    `
  }

  if (emailsToProcess.length === 0)
    return ok(res, { processed: 0, message: 'All emails already processed' })

  const results = []
  for (const email of emailsToProcess) {
    const result = await processOne(email, fullSession, apiKey, sql, sessionId)
    results.push({ emailId: email.id, ...result })
  }

  return ok(res, {
    processed: results.length,
    results
  })
}

// ── PROCESS ONE EMAIL ──
async function processOne(email, session, apiKey, sql, sessionId) {
  const log = []
  log.push(logEntry('📥', `Email received: <strong>${escHtml(email.subject)}</strong>`, 'success'))

  // PII stripping
  let bodyToSend = email.body
  if (session.strip_pii) {
    bodyToSend = stripPII(email.body)
    if (bodyToSend !== email.body) {
      log.push(logEntry('🔒', 'PII anonymized before sending to AI', 'success'))
    }
  }

  log.push(logEntry('🤖', `Sending to <strong>${session.ai_provider === 'anthropic' ? 'Claude' : 'OpenAI'}</strong> (${session.selected_model}) for extraction…`, 'pending'))

  let fields = null
  let draft = null

  try {
    // EXTRACTION
    const extractPrompt = buildExtractionPrompt(email, bodyToSend)
    const rawJson = await callAI(session.ai_provider, apiKey, session.selected_model, extractPrompt)

    try {
      const clean = rawJson.replace(/```json|```/g, '').trim()
      fields = JSON.parse(clean)
    } catch {
      fields = {
        sender_type: 'Unknown', intent: 'Could not parse',
        priority: 'Normal', action_required: 'No',
        needs_reply: 'No', key_date: null,
        amount: null, category: 'Other',
        summary: rawJson.substring(0, 200)
      }
    }

    log.push(logEntry('✓', 'Extracted: intent, priority, dates, amounts, category', 'success'))
    log.push(logEntry('📊', 'Data saved to Neon database', 'success'))

    // DRAFT
    if (session.generate_drafts && (fields.needs_reply === 'Yes' || fields.action_required === 'Yes')) {
      log.push(logEntry('✍', 'Generating draft reply in your writing style…', 'pending'))
      draft = await generateDraft(email, fields, session, apiKey)
      log.push(logEntry('✓', 'Draft ready — awaiting your approval', 'success'))
    } else {
      log.push(logEntry('⏭', `No reply needed — ${fields.category || 'automated email'}`, 'success'))
    }

  } catch (e) {
    log.push(logEntry('✕', `AI error: ${e.message}`, 'error'))
  }

  // Upsert to DB
  await sql`
    INSERT INTO processed_emails (email_id, session_id, fields, draft, agent_log)
    VALUES (${email.id}, ${sessionId}, ${JSON.stringify(fields)}, ${draft}, ${JSON.stringify(log)})
    ON CONFLICT (email_id) DO UPDATE SET
      fields = EXCLUDED.fields,
      draft = EXCLUDED.draft,
      agent_log = EXCLUDED.agent_log,
      processed_at = NOW()
  `

  return { fields, hasDraft: !!draft, logEntries: log.length }
}

// ── AI CALL (OpenAI or Anthropic) ──
async function callAI(provider, apiKey, model, prompt) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      throw new Error(e?.error?.message || `Anthropic API error ${res.status}`)
    }
    const data = await res.json()
    return data.content?.[0]?.text || ''
  }

  // OpenAI (default)
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e?.error?.message || `OpenAI API error ${res.status}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ── GENERATE DRAFT ──
async function generateDraft(email, fields, session, apiKey) {
  const styleNote = session.style_prompt?.trim()
  const styleInstructions = styleNote
    ? `My writing style: ${styleNote}`
    : 'Write in a professional, friendly, and concise tone. Keep it direct. End with a clear next step.'

  const prompt = `Draft a professional email reply. Return ONLY the email body, no subject line, no markdown.

Original email from: ${email.from_name}
Subject: ${email.subject}
Body: ${email.body.substring(0, 600)}

Context from AI analysis:
- Intent: ${fields.intent}
- Priority: ${fields.priority}

${styleInstructions}

Write the reply body only. Start with a greeting. Sign off as "Rob".`

  return callAI(session.ai_provider, apiKey, session.selected_model, prompt)
}

// ── HELPERS ──
function logEntry(icon, msg, type) {
  return {
    icon, msg, type,
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function buildExtractionPrompt(email, body) {
  return `You are an email analysis AI. Extract key information from this email and return ONLY valid JSON, no explanation, no markdown.

Email:
FROM: ${email.from_name} <${email.from_email || ''}>
SUBJECT: ${email.subject}
BODY:
${body}

Return exactly this JSON structure:
{
  "sender_type": "Client/Vendor/Colleague/HR/Bank/Newsletter/Automated",
  "intent": "One sentence describing what this email is about",
  "priority": "High/Normal/Low",
  "action_required": "Yes/No",
  "needs_reply": "Yes/No",
  "key_date": "Any deadline or important date mentioned, or null",
  "amount": "Any monetary amount mentioned with currency symbol, or null",
  "category": "Finance/Partnership/Project/HR/Newsletter/Other",
  "summary": "2-3 sentence plain English summary"
}`
}
