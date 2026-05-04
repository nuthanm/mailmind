// api/emails.js
// GET    /api/emails         → list all emails for session
// POST   /api/emails         → add emails (batch)
// DELETE /api/emails/:id     → delete one email
// DELETE /api/emails         → delete all for session

import { getDb, withCors, ok, err, newId } from './_utils.js'
import { requireAuth } from './auth.js'
import { getValidToken } from './_gmail_utils.js'

async function ensureUserSession(sql, userId) {
  const sessionId = `usr_${userId}`
  await sql`
    INSERT INTO sessions (id, user_id)
    VALUES (${sessionId}, ${userId})
    ON CONFLICT (id) DO NOTHING
  `
  return sessionId
}

async function trashMessagesInGmail(sql, userId, rows) {
  const grouped = new Map()
  for (const row of rows) {
    if (!row?.account_id || !row?.gmail_message_id) continue
    if (!grouped.has(row.account_id)) grouped.set(row.account_id, new Set())
    grouped.get(row.account_id).add(row.gmail_message_id)
  }

  let trashedRemote = 0
  let remoteFailed = 0

  for (const [accountId, messageIdsSet] of grouped.entries()) {
    const messageIds = [...messageIdsSet]
    const [account] = await sql`
      SELECT * FROM gmail_accounts
      WHERE id = ${accountId} AND user_id = ${userId} AND is_active = true
      LIMIT 1
    `

    if (!account) {
      remoteFailed += messageIds.length
      continue
    }

    let accessToken
    try {
      accessToken = await getValidToken(account, sql)
    } catch {
      remoteFailed += messageIds.length
      continue
    }

    for (const gmailMessageId of messageIds) {
      try {
        const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/trash`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        if (r.ok) trashedRemote++
        else remoteFailed++
      } catch {
        remoteFailed++
      }
    }
  }

  return { trashedRemote, remoteFailed }
}

export default async function handler(req, res) {
  withCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = getDb()
  const user = await requireAuth(req, res, sql)
  if (!user) return

  // ── LIST EMAILS ──
  if (req.method === 'GET') {
    const emails = await sql`
      SELECT
        e.id, e.account_id, e.from_name, e.from_email, e.subject,
        e.body, e.received_at, e.created_at,
        pe.fields, pe.draft, pe.draft_sent,
        pe.agent_log, pe.processed_at
      FROM emails e
      LEFT JOIN processed_emails pe ON pe.email_id = e.id
      WHERE e.user_id = ${user.userId}
      ORDER BY e.created_at DESC
    `
    return ok(res, { emails })
  }

  // ── ADD EMAILS (batch) ──
  if (req.method === 'POST') {
    const { emails } = req.body
    if (!Array.isArray(emails) || emails.length === 0)
      return err(res, 400, 'emails must be a non-empty array')
    if (emails.length > 50)
      return err(res, 400, 'Max 50 emails per batch')

    const sessionId = await ensureUserSession(sql, user.userId)
    const inserted = []
    for (const e of emails) {
      if (!e.subject || !e.body) continue
      const id = newId('em_')
      await sql`
        INSERT INTO emails (id, session_id, user_id, from_name, from_email, subject, body, received_at)
        VALUES (
          ${id}, ${sessionId}, ${user.userId},
          ${e.from_name || 'Unknown'},
          ${e.from_email || null},
          ${e.subject},
          ${e.body},
          ${e.received_at || new Date().toISOString()}
        )
      `
      inserted.push(id)
    }

    return ok(res, { inserted: inserted.length, ids: inserted })
  }

  // ── DELETE ALL ──
  if (req.method === 'DELETE') {
    const { id, ids, remote } = req.query
    const shouldTrashRemote = remote === 'trash'
    let remoteStats = { trashedRemote: 0, remoteFailed: 0 }

    if (ids) {
      const idList = String(ids)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)

      if (idList.length === 0) return err(res, 400, 'ids is empty')

      if (shouldTrashRemote) {
        const rows = await sql`
          SELECT id, account_id, gmail_message_id
          FROM emails
          WHERE user_id = ${user.userId}
          AND id = ANY(${idList})
        `
        remoteStats = await trashMessagesInGmail(sql, user.userId, rows)
      }

      await sql`
        DELETE FROM emails
        WHERE user_id = ${user.userId}
        AND id = ANY(${idList})
      `
    } else if (id) {
      if (shouldTrashRemote) {
        const rows = await sql`
          SELECT id, account_id, gmail_message_id
          FROM emails
          WHERE id = ${id} AND user_id = ${user.userId}
        `
        remoteStats = await trashMessagesInGmail(sql, user.userId, rows)
      }

      await sql`DELETE FROM emails WHERE id = ${id} AND user_id = ${user.userId}`
    } else {
      await sql`DELETE FROM emails WHERE user_id = ${user.userId}`
    }
    return ok(res, { message: 'Deleted', ...remoteStats })
  }

  return err(res, 405, 'Method not allowed')
}
