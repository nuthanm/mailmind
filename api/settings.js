// api/settings.js
// GET  /api/settings → get user settings
// PUT  /api/settings → update settings (API key saved to user permanently)

import { getDb, withCors, encryptApiKey, decryptApiKey, ok, err } from './_utils.js'
import { requireAuth } from './auth.js'

export default async function handler(req, res) {
  withCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = getDb()
  const user = await requireAuth(req, res, sql)
  if (!user) return

  // ── GET SETTINGS ──
  if (req.method === 'GET') {
    const [settings] = await sql`SELECT * FROM user_settings WHERE user_id = ${user.userId}`
    if (!settings) return ok(res, { settings: null })

    return ok(res, {
      settings: {
        ai_provider: settings.ai_provider,
        selected_model: settings.selected_model,
        api_key_hint: settings.api_key_hint,
        style_prompt: settings.style_prompt,
        generate_drafts: settings.generate_drafts,
        strip_pii: settings.strip_pii,
        api_key_saved_at: settings.api_key_saved_at,
      }
    })
  }

  // ── UPDATE SETTINGS ──
  if (req.method === 'PUT') {
    const { apiKey, aiProvider, selectedModel, stylePrompt, generateDrafts, stripPii } = req.body

    let encKey = null
    let keyHint = null

    if (apiKey && apiKey.trim().length > 10) {
      const trimmed = apiKey.trim()
      encKey = encryptApiKey(trimmed)
      keyHint = '•••' + trimmed.slice(-4)
    }

    // Ensure the row exists (created at signup, but guard anyway)
    await sql`
      INSERT INTO user_settings (user_id)
      VALUES (${user.userId})
      ON CONFLICT (user_id) DO NOTHING
    `

    // Update general settings
    await sql`
      UPDATE user_settings
      SET ai_provider     = ${aiProvider || 'openai'},
          selected_model  = ${selectedModel || 'gpt-4o-mini'},
          style_prompt    = ${stylePrompt ?? ''},
          generate_drafts = ${generateDrafts !== undefined ? generateDrafts : true},
          strip_pii       = ${stripPii !== undefined ? stripPii : true},
          updated_at      = NOW()
      WHERE user_id = ${user.userId}
    `

    // Update API key separately (only when a new key is supplied)
    if (encKey) {
      await sql`
        UPDATE user_settings
        SET api_key_enc    = ${encKey},
            api_key_hint   = ${keyHint},
            api_key_saved_at = NOW()
        WHERE user_id = ${user.userId}
      `
    }

    return ok(res, {
      message: 'Settings saved',
      api_key_hint: keyHint,
      api_key_saved: !!encKey,
    })
  }

  return err(res, 405, 'Method not allowed')
}
