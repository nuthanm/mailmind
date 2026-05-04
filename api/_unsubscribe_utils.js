// api/_unsubscribe_utils.js
// All detection and unsubscribe firing logic

function stripHtmlForDetect(html) {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 5000)
}

// ── NEWSLETTER DETECTION ──

// Keywords that strongly indicate promotional/newsletter email
const PROMO_SUBJECT_KEYWORDS = [
  'unsubscribe', 'newsletter', 'weekly digest', 'daily digest',
  'offer', 'deal', 'sale', '% off', 'discount', 'promo', 'coupon',
  'limited time', 'flash sale', 'special offer', 'exclusive',
  'this week in', 'round-up', 'roundup', 'recap', 'digest',
  'new arrivals', 'back in stock', 'just launched', 'now available',
  'marketing', 'update from', 'news from', 'monthly update',
  'product update', 'release notes', 'what\'s new',
  'tips & tricks', 'sponsored', 'advertisement',
]

const PROMO_FROM_KEYWORDS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'newsletter', 'news', 'updates', 'notifications', 'alerts',
  'marketing', 'promotions', 'offers', 'deals', 'sales',
  'hello@', 'hi@', 'info@', 'support@', 'team@',
  'digest', 'weekly', 'daily', 'monthly',
]

const PROMO_BODY_KEYWORDS = [
  'unsubscribe', 'manage preferences', 'manage subscription',
  'opt out', 'opt-out', 'email preferences', 'update preferences',
  'you are receiving this', 'you received this', 'sent to you because',
  'remove yourself', 'click here to unsubscribe', 'subscription',
  'mailing list', 'marketing email', 'promotional email',
  'view in browser', 'view this email in your browser',
  'add us to your address book', 'trouble viewing',
]

// Known newsletter/promo domains
const KNOWN_PROMO_DOMAINS = [
  'substack.com', 'mailchimp.com', 'sendgrid.net', 'constantcontact.com',
  'klaviyo.com', 'convertkit.com', 'aweber.com', 'getresponse.com',
  'campaignmonitor.com', 'brevo.com', 'sendinblue.com', 'hubspot.com',
  'marketo.com', 'salesforce.com', 'pardot.com', 'eloqua.com',
  'activehosted.com', 'drip.com', 'mailerlite.com', 'moosend.com',
  'beehiiv.com', 'buttondown.email', 'ghost.io',
  'morningbrew.com', 'thehustle.co', 'axios.com',
  'medium.com', 'linkedin.com', 'twitter.com', 'facebook.com',
]

/**
 * Analyse an email and return detection result
 */
export function detectNewsletter(email) {
  const subject = (email.subject || '').toLowerCase()
  const fromEmail = (email.from_email || '').toLowerCase()
  const fromName = (email.from_name || '').toLowerCase()
  // Strip raw HTML if body was stored unparsed
  const rawBody = email.body || ''
  const bodyText = rawBody.trimStart().startsWith('<') ? stripHtmlForDetect(rawBody) : rawBody
  const body = bodyText.toLowerCase()
  const domain = extractDomain(email.from_email || '')

  let score = 0
  const signals = []

  // Check List-Unsubscribe header (strongest signal — real newsletters have this)
  if (email.list_unsubscribe_header) {
    score += 40
    signals.push('Has List-Unsubscribe header')
  }

  // Known promo domain
  if (KNOWN_PROMO_DOMAINS.some(d => domain.endsWith(d))) {
    score += 25
    signals.push('Known newsletter platform domain')
  }

  // Promo from address
  if (PROMO_FROM_KEYWORDS.some(kw => fromEmail.includes(kw) || fromName.includes(kw))) {
    score += 20
    signals.push('Promo-style sender address')
  }

  // Promo subject
  if (PROMO_SUBJECT_KEYWORDS.some(kw => subject.includes(kw))) {
    score += 20
    signals.push('Promo/newsletter subject keywords')
  }

  // Body contains unsubscribe link text
  const bodySignals = PROMO_BODY_KEYWORDS.filter(kw => body.includes(kw))
  if (bodySignals.length > 0) {
    score += Math.min(bodySignals.length * 8, 30)
    signals.push(`Body contains: ${bodySignals.slice(0, 2).join(', ')}`)
  }

  // No-reply address
  if (fromEmail.includes('noreply') || fromEmail.includes('no-reply')) {
    score += 15
    signals.push('No-reply sender')
  }

  // HTML email with tracking links (simple heuristic: lots of URLs)
  const urlCount = (body.match(/https?:\/\//g) || []).length
  if (urlCount > 5) {
    score += 10
    signals.push(`${urlCount} links in body`)
  }

  const confidence = Math.min(score, 100)
  const isNewsletter = confidence >= 35

  return {
    isNewsletter,
    confidence,
    signals,
    domain,
    senderType: categorizeSender(fromEmail, fromName, body),
  }
}

function categorizeSender(fromEmail, fromName, body) {
  if (body.includes('unsubscribe') && body.includes('newsletter')) return 'newsletter'
  if (fromEmail.includes('notification') || fromEmail.includes('alert')) return 'notification'
  if (fromEmail.includes('noreply') || fromEmail.includes('no-reply')) return 'promotional'
  return 'newsletter'
}

export function extractDomain(email) {
  const match = email.match(/@([^>]+)/)
  return match ? match[1].toLowerCase().trim() : ''
}

// ── UNSUBSCRIBE LINK EXTRACTION ──

/**
 * Extract unsubscribe URL from email body HTML/text
 */
export function extractUnsubscribeLinks(body) {
  const links = []

  // Pattern 1: HTML anchor tags with "unsubscribe" nearby
  const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*(?:unsubscribe|opt.out|remove|manage)[^<]*<\/a>/gi
  let m
  while ((m = anchorRegex.exec(body)) !== null) {
    if (m[1] && !m[1].startsWith('mailto:')) links.push({ url: m[1], method: 'link', confidence: 90 })
  }

  // Pattern 2: "Unsubscribe" text followed by a URL
  const textLinkRegex = /unsubscribe[^<\n]*(?:here|now|>|:)?\s*(?:<[^>]+>)?\s*(https?:\/\/[^\s<"']+)/gi
  while ((m = textLinkRegex.exec(body)) !== null) {
    if (m[1]) links.push({ url: m[1].replace(/[).,>]+$/, ''), method: 'link', confidence: 80 })
  }

  // Pattern 3: Any URL containing "unsubscribe" in the path
  const urlRegex = /https?:\/\/[^\s<"']*unsubscri[^\s<"']*/gi
  while ((m = urlRegex.exec(body)) !== null) {
    links.push({ url: m[0].replace(/[).,>]+$/, ''), method: 'link', confidence: 85 })
  }

  // Pattern 4: mailto: unsubscribe
  const mailtoRegex = /mailto:([^\s"'<>?]+\?[^\s"'<>]*(?:subject=unsubscribe|unsubscribe)[^\s"'<>]*)/gi
  while ((m = mailtoRegex.exec(body)) !== null) {
    links.push({ url: m[0], method: 'mailto', confidence: 75 })
  }

  // Deduplicate by URL
  const seen = new Set()
  return links.filter(l => {
    if (seen.has(l.url)) return false
    seen.add(l.url)
    return true
  }).sort((a, b) => b.confidence - a.confidence)
}

/**
 * Parse List-Unsubscribe header
 * Format: <https://...>, <mailto:...>
 */
export function parseListUnsubscribeHeader(header) {
  if (!header) return null
  const result = { url: null, mailto: null }

  const httpMatch = header.match(/<(https?:\/\/[^>]+)>/)
  if (httpMatch) result.url = httpMatch[1]

  const mailtoMatch = header.match(/<(mailto:[^>]+)>/)
  if (mailtoMatch) result.mailto = mailtoMatch[1]

  return result.url || result.mailto ? result : null
}

// ── SIZE ESTIMATION ──

const AVG_EMAIL_SIZE_KB = {
  newsletter: 85,
  promotional: 60,
  notification: 25,
  default: 50,
}

export function estimateSizeKb(email, senderType) {
  const base = AVG_EMAIL_SIZE_KB[senderType] || AVG_EMAIL_SIZE_KB.default
  // Rough estimate based on body length
  const bodyKb = Math.ceil((email.body?.length || 0) / 1024)
  return Math.max(base, bodyKb)
}

export function formatSize(kb) {
  if (kb < 1024) return `${kb} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function totalSizeMb(senders) {
  const totalKb = senders.reduce((sum, s) => sum + (s.total_size_kb || 0), 0)
  return (totalKb / 1024).toFixed(1)
}

// ── SAFE UNSUBSCRIBE FIRING ──

/**
 * Fire an HTTP unsubscribe request
 * Uses a GET request to the unsubscribe URL (most common)
 * Returns status info
 */
export async function fireHttpUnsubscribe(url) {
  try {
    // Validate URL safety
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: 'Invalid protocol' }
    }

    // Some unsubscribe links need a GET, some need POST
    // We try GET first (most common), then POST if it redirects to a form
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MailMind-Unsubscribe/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    const text = await res.text().catch(() => '')
    const snippet = text.substring(0, 300).toLowerCase()

    // Check if the response indicates success
    const successSignals = [
      'unsubscribed', 'removed', 'opt-out', 'opt out',
      'you have been', 'successfully', 'confirmed',
      'no longer receive', 'preferences updated',
    ]
    const isSuccess = res.ok && successSignals.some(s => snippet.includes(s))
    const needsConfirm = snippet.includes('confirm') || snippet.includes('click here to confirm')

    return {
      success: res.ok,
      httpStatus: res.status,
      confirmedByPage: isSuccess,
      needsManualConfirm: needsConfirm,
      snippet: text.substring(0, 200),
    }
  } catch (e) {
    if (e.name === 'AbortError') return { success: false, error: 'Timeout after 10s' }
    return { success: false, error: e.message }
  }
}
