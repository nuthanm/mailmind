// api/export.js
// GET /api/export?format=csv → download all processed emails as CSV

import { getDb, withCors, err } from './_utils.js'
import { requireAuth } from './auth.js'

export default async function handler(req, res) {
  withCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return err(res, 405, 'Method not allowed')

  const sql = getDb()
  const user = await requireAuth(req, res, sql)
  if (!user) return

  const rows = await sql`
    SELECT
      e.from_name, e.from_email, e.subject, e.received_at,
      pe.fields, pe.draft, pe.draft_sent, pe.processed_at
    FROM emails e
    INNER JOIN processed_emails pe ON pe.email_id = e.id
    WHERE e.user_id = ${user.userId}
    ORDER BY e.created_at DESC
  `

  const headers = [
    'From Name', 'From Email', 'Subject', 'Received At',
    'Sender Type', 'Intent', 'Priority', 'Action Required',
    'Needs Reply', 'Key Date', 'Amount', 'Category', 'Summary',
    'Has Draft', 'Draft Sent', 'Processed At'
  ]

  const csvRows = [headers, ...rows.map(r => {
    const f = r.fields || {}
    return [
      r.from_name, r.from_email, r.subject, r.received_at,
      f.sender_type, f.intent, f.priority, f.action_required,
      f.needs_reply, f.key_date, f.amount, f.category, f.summary,
      r.draft ? 'Yes' : 'No',
      r.draft_sent ? 'Yes' : 'No',
      r.processed_at
    ]
  })]

  const csv = csvRows
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const date = new Date().toISOString().split('T')[0]
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="mailmind_export_${date}.csv"`)
  res.status(200).send(csv)
}
