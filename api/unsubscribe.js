// api/unsubscribe.js
// POST /api/unsubscribe/scan      → scan all emails, detect newsletters
// GET  /api/unsubscribe           → list all detected senders + stats
// POST /api/unsubscribe/queue     → add sender(s) to queue
// POST /api/unsubscribe/fire      → fire unsubscribe for one sender
// POST /api/unsubscribe/fire-all  → fire all queued unsubscribes
// POST /api/unsubscribe/block     → block a sender (mark as ignored)
// DELETE /api/unsubscribe/:id     → remove from list

import { getDb, withCors, validateSession, ok, err, newId } from './_utils.js'
import { requireAuth } from './auth.js'
import {
  detectNewsletter, extractUnsubscribeLinks, parseListUnsubscribeHeader,
  estimateSizeKb, totalSizeMb, fireHttpUnsubscribe, extractDomain
} from './_unsubscribe_utils.js'

function stripHtmlBody(html) {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 5000)
}

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

  const sql = getDb()
  const user = await requireAuth(req, res, sql)
  if (!user) return
  const sessionId = await ensureUserSession(sql, user.userId)

  const action = req.url.split('/unsubscribe/')[1]?.split('?')[0]
  const accountId = req.query?.accountId

  // ── GET: list all senders + stats ──
  if (req.method === 'GET') {
    const senders = accountId && accountId !== 'all'
      ? await sql`
          SELECT us.* FROM unsubscribe_senders us
          WHERE us.session_id = ${sessionId}
            AND us.from_email IN (
              SELECT DISTINCT COALESCE(from_email, '')
              FROM emails
              WHERE user_id = ${user.userId} AND account_id = ${accountId}
            )
          ORDER BY
            CASE us.status
              WHEN 'queued' THEN 1
              WHEN 'detected' THEN 2
              WHEN 'processing' THEN 3
              WHEN 'done' THEN 4
              WHEN 'failed' THEN 5
              WHEN 'blocked' THEN 6
            END,
            us.confidence DESC, us.email_count DESC
        `
      : await sql`
          SELECT * FROM unsubscribe_senders
          WHERE session_id = ${sessionId}
          ORDER BY
            CASE status
              WHEN 'queued' THEN 1
              WHEN 'detected' THEN 2
              WHEN 'processing' THEN 3
              WHEN 'done' THEN 4
              WHEN 'failed' THEN 5
              WHEN 'blocked' THEN 6
            END,
            confidence DESC, email_count DESC
        `

    const stats = {
      total: senders.length,
      detected: senders.filter(s => s.status === 'detected').length,
      queued: senders.filter(s => s.status === 'queued').length,
      done: senders.filter(s => s.status === 'done').length,
      failed: senders.filter(s => s.status === 'failed').length,
      totalSizeMb: parseFloat(totalSizeMb(senders.filter(s => s.status !== 'blocked'))),
      freedSizeMb: parseFloat(totalSizeMb(senders.filter(s => s.status === 'done'))),
    }

    return ok(res, { senders, stats })
  }

  // ── SCAN: analyse all emails in session ──
  if (action === 'scan') {
    const emails = accountId && accountId !== 'all'
      ? await sql`
          SELECT * FROM emails
          WHERE user_id = ${user.userId} AND account_id = ${accountId}
        `
      : await sql`
          SELECT * FROM emails WHERE user_id = ${user.userId}
        `
    if (emails.length === 0) return ok(res, { scanned: 0, detected: 0 })

    let detected = 0
    for (const email of emails) {
      // Normalise body: strip raw HTML if it was stored unparsed
      const rawBody = email.body || ''
      const isRawHtml = rawBody.trimStart().startsWith('<')
      const cleanBody = isRawHtml ? stripHtmlBody(rawBody) : rawBody
      const emailForDetect = isRawHtml ? { ...email, body: cleanBody } : email

      const result = detectNewsletter(emailForDetect)
      if (!result.isNewsletter) continue

      // Extract unsubscribe links (use original body for link extraction — URLs survive stripping)
      const links = extractUnsubscribeLinks(rawBody)
      const headerParsed = parseListUnsubscribeHeader(email.list_unsubscribe_header)
      const domain = extractDomain(email.from_email || '')

      // Best unsubscribe method
      let unsubMethod = 'none'
      let unsubUrl = null
      let unsubMailto = null

      if (headerParsed?.url) {
        unsubMethod = 'header'
        unsubUrl = headerParsed.url
      } else if (headerParsed?.mailto) {
        unsubMethod = 'mailto'
        unsubMailto = headerParsed.mailto
      } else if (links.length > 0) {
        unsubMethod = links[0].method
        if (links[0].method === 'link') unsubUrl = links[0].url
        else unsubMailto = links[0].url
      }

      const sizeKb = estimateSizeKb(email, result.senderType)

      // Upsert — if same email address seen again, update count + size
      await sql`
        INSERT INTO unsubscribe_senders (
          id, session_id, from_name, from_email, domain,
          sender_type, confidence, email_count, total_size_kb,
          unsub_method, unsub_url, unsub_mailto, list_unsub_header,
          sample_subject, last_seen_at
        ) VALUES (
          ${newId('us_')}, ${sessionId},
          ${email.from_name}, ${email.from_email || ''}, ${domain},
          ${result.senderType}, ${result.confidence}, 1, ${sizeKb},
          ${unsubMethod}, ${unsubUrl}, ${unsubMailto},
          ${email.list_unsubscribe_header || null},
          ${email.subject}, NOW()
        )
        ON CONFLICT (session_id, from_email) DO UPDATE SET
          email_count = unsubscribe_senders.email_count + 1,
          total_size_kb = unsubscribe_senders.total_size_kb + ${sizeKb},
          confidence = GREATEST(unsubscribe_senders.confidence, ${result.confidence}),
          last_seen_at = NOW(),
          -- Update unsubscribe method if we found a better one
          unsub_method = CASE
            WHEN ${unsubMethod} = 'header' THEN ${unsubMethod}
            WHEN ${unsubMethod} = 'link' AND unsubscribe_senders.unsub_method = 'none' THEN ${unsubMethod}
            ELSE unsubscribe_senders.unsub_method
          END,
          unsub_url = COALESCE(${unsubUrl}, unsubscribe_senders.unsub_url)
        WHERE unsubscribe_senders.status NOT IN ('done', 'blocked')
      `
      detected++
    }

    return ok(res, { scanned: emails.length, detected })
  }

  // ── QUEUE: mark sender(s) as queued ──
  if (action === 'queue') {
    const { ids, all } = req.body
    if (all) {
      if (accountId && accountId !== 'all') {
        await sql`
          UPDATE unsubscribe_senders
          SET status = 'queued'
          WHERE session_id = ${sessionId}
          AND status = 'detected'
          AND unsub_method != 'none'
          AND from_email IN (
            SELECT DISTINCT COALESCE(from_email, '')
            FROM emails
            WHERE user_id = ${user.userId} AND account_id = ${accountId}
          )
        `
      } else {
        await sql`
          UPDATE unsubscribe_senders
          SET status = 'queued'
          WHERE session_id = ${sessionId}
          AND status = 'detected'
          AND unsub_method != 'none'
        `
      }
    } else if (Array.isArray(ids)) {
      for (const id of ids) {
        await sql`
          UPDATE unsubscribe_senders
          SET status = 'queued'
          WHERE id = ${id} AND session_id = ${sessionId}
        `
      }
    }
    return ok(res, { message: 'Queued' })
  }

  // ── FIRE ONE: execute unsubscribe for one sender ──
  if (action === 'fire') {
    const { id } = req.body
    if (!id) return err(res, 400, 'id required')

    const [sender] = await sql`
      SELECT * FROM unsubscribe_senders
      WHERE id = ${id} AND session_id = ${sessionId}
    `
    if (!sender) return err(res, 404, 'Sender not found')
    if (sender.unsub_method === 'none' || !sender.unsub_url) {
      return err(res, 400, 'No unsubscribe URL available for this sender')
    }

    // Mark as processing
    await sql`
      UPDATE unsubscribe_senders SET status = 'processing'
      WHERE id = ${id}
    `

    const result = await fireHttpUnsubscribe(sender.unsub_url)

    const newStatus = result.success ? 'done' : 'failed'
    await sql`
      UPDATE unsubscribe_senders SET
        status = ${newStatus},
        unsubscribed_at = ${result.success ? new Date() : null},
        error_msg = ${result.error || null}
      WHERE id = ${id}
    `

    // Log attempt
    await sql`
      INSERT INTO unsubscribe_log
        (session_id, sender_id, from_email, method, url, status, http_status, response_snippet)
      VALUES
        (${sessionId}, ${id}, ${sender.from_email}, ${sender.unsub_method},
         ${sender.unsub_url}, ${newStatus}, ${result.httpStatus || null},
         ${result.snippet || null})
    `

    // If success, add to blocked list so future scans ignore this sender
    if (result.success) {
      await sql`
        INSERT INTO blocked_senders (session_id, domain, from_email, reason)
        VALUES (${sessionId}, ${sender.domain}, ${sender.from_email}, 'unsubscribed')
        ON CONFLICT (session_id, from_email) DO NOTHING
      `
    }

    return ok(res, {
      status: newStatus,
      httpStatus: result.httpStatus,
      confirmedByPage: result.confirmedByPage,
      needsManualConfirm: result.needsManualConfirm,
      error: result.error,
    })
  }

  // ── FIRE ALL: batch unsubscribe all queued ──
  if (action === 'fire-all') {
    const queued = await sql`
      SELECT * FROM unsubscribe_senders
      WHERE session_id = ${sessionId}
      AND status = 'queued'
      AND unsub_method != 'none'
      AND unsub_url IS NOT NULL
      LIMIT 30
    `
    if (queued.length === 0) return ok(res, { fired: 0, message: 'No queued senders' })

    const results = []
    for (const sender of queued) {
      await sql`UPDATE unsubscribe_senders SET status = 'processing' WHERE id = ${sender.id}`

      const result = await fireHttpUnsubscribe(sender.unsub_url)
      const newStatus = result.success ? 'done' : 'failed'

      await sql`
        UPDATE unsubscribe_senders SET
          status = ${newStatus},
          unsubscribed_at = ${result.success ? new Date() : null},
          error_msg = ${result.error || null}
        WHERE id = ${sender.id}
      `

      await sql`
        INSERT INTO unsubscribe_log
          (session_id, sender_id, from_email, method, url, status, http_status)
        VALUES
          (${sessionId}, ${sender.id}, ${sender.from_email},
           ${sender.unsub_method}, ${sender.unsub_url},
           ${newStatus}, ${result.httpStatus || null})
      `

      if (result.success) {
        await sql`
          INSERT INTO blocked_senders (session_id, domain, from_email, reason)
          VALUES (${sessionId}, ${sender.domain}, ${sender.from_email}, 'unsubscribed')
          ON CONFLICT (session_id, from_email) DO NOTHING
        `
      }

      results.push({ id: sender.id, from_email: sender.from_email, status: newStatus })

      // Small delay between requests to be respectful
      await new Promise(r => setTimeout(r, 500))
    }

    const succeeded = results.filter(r => r.status === 'done').length
    return ok(res, { fired: results.length, succeeded, failed: results.length - succeeded, results })
  }

  // ── BLOCK: ignore a sender permanently ──
  if (action === 'block') {
    const { id } = req.body
    await sql`
      UPDATE unsubscribe_senders SET status = 'blocked'
      WHERE id = ${id} AND session_id = ${sessionId}
    `
    return ok(res, { message: 'Blocked' })
  }

  // ── DELETE: remove from list ──
  if (req.method === 'DELETE') {
    const id = req.url.split('/unsubscribe/')[1]
    if (id) {
      await sql`DELETE FROM unsubscribe_senders WHERE id = ${id} AND session_id = ${sessionId}`
    }
    return ok(res, { message: 'Removed' })
  }

  return err(res, 405, 'Method not allowed')
}
