// api/session.js - Create and manage sessions
// POST /api/session        → create new session
// GET  /api/session        → get current session info
// PUT  /api/session        → update settings (api key, model, style, etc.)
// DELETE /api/session      → clear session data

import { getDb, withCors, getSessionId, validateSession,
         encryptApiKey, decryptApiKey, ok, err, newId } from './_utils.js'

export default async function handler(req, res) {
  withCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = getDb()

  // ── CREATE SESSION ──
  if (req.method === 'POST') {
    const id = newId('sess_')
    await sql`INSERT INTO sessions (id) VALUES (${id})`
    return ok(res, {
      sessionId: id,
      message: 'Session created. Add your API key in settings.'
    })
  }

  // ── GET SESSION INFO ──
  if (req.method === 'GET') {
    const session = await validateSession(req, sql)
    if (!session) return err(res, 401, 'Invalid or expired session')
    // Never return api_key_enc — only the hint
    return ok(res, { session })
  }

  // ── UPDATE SETTINGS ──
  if (req.method === 'PUT') {
    const session = await validateSession(req, sql)
    if (!session) return err(res, 401, 'Invalid or expired session')

    const {
      apiKey, aiProvider, selectedModel,
      stylePrompt, generateDrafts, stripPii
    } = req.body

    let encKey = undefined
    let keyHint = undefined

    if (apiKey) {
      if (apiKey.length < 20) return err(res, 400, 'API key too short')
      encKey = encryptApiKey(apiKey)
      // Store only last 4 chars as hint
      keyHint = '•••' + apiKey.slice(-4)
    }

    await sql`
      UPDATE sessions SET
        ${encKey !== undefined ? sql`api_key_enc = ${encKey},` : sql``}
        ${keyHint !== undefined ? sql`api_key_hint = ${keyHint},` : sql``}
        ${aiProvider ? sql`ai_provider = ${aiProvider},` : sql``}
        ${selectedModel ? sql`selected_model = ${selectedModel},` : sql``}
        ${stylePrompt !== undefined ? sql`style_prompt = ${stylePrompt},` : sql``}
        ${generateDrafts !== undefined ? sql`generate_drafts = ${generateDrafts},` : sql``}
        ${stripPii !== undefined ? sql`strip_pii = ${stripPii},` : sql``}
        last_active = NOW()
      WHERE id = ${session.id}
    `

    return ok(res, { message: 'Settings saved', keyHint })
  }

  // ── DELETE / CLEAR SESSION ──
  if (req.method === 'DELETE') {
    const sid = getSessionId(req)
    if (!sid) return err(res, 401, 'No session')
    // CASCADE deletes all emails and processed data for this session
    await sql`DELETE FROM sessions WHERE id = ${sid}`
    return ok(res, { message: 'Session and all data deleted' })
  }

  return err(res, 405, 'Method not allowed')
}
