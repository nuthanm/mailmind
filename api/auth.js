// api/auth.js
// POST /api/auth/signup  → register with mobile + secret code
// POST /api/auth/login   → login, returns auth token in cookie
// POST /api/auth/logout  → revoke token
// GET  /api/auth/me      → get current user + settings

import { getDb, withCors, encryptApiKey, decryptApiKey, ok, err, newId } from './_utils.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod'
const TOKEN_EXPIRY_DAYS = 30
const COOKIE_NAME = 'mm_auth'

// ── COOKIE HELPERS ──
function setCookie(res, token) {
  const expires = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86400 * 1000)
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
  ])
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', [`${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`])
}

function getCookieToken(req) {
  const cookieHeader = req.headers.cookie || ''
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  return match ? match[1] : null
}

// ── VALIDATE AUTH TOKEN ──
export async function requireAuth(req, res, sql) {
  const token = getCookieToken(req)
  if (!token) {
    err(res, 401, 'Not authenticated')
    return null
  }

  // Check DB token
  const [row] = await sql`
    SELECT t.*, u.id as uid, u.mobile, u.name, u.is_active
    FROM auth_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token = ${token}
      AND t.revoked = false
      AND t.expires_at > NOW()
      AND u.is_active = true
  `
  if (!row) {
    clearCookie(res)
    err(res, 401, 'Session expired. Please log in again.')
    return null
  }

  // Touch last_used
  await sql`UPDATE auth_tokens SET last_used_at = NOW() WHERE token = ${token}`

  return { userId: row.user_id, mobile: row.mobile, name: row.name }
}

// ── FORMAT MOBILE ──
function normalizeMobile(raw) {
  // Strip spaces, dashes
  let num = raw.replace(/[\s\-\(\)]/g, '')
  // Add +91 if 10 digits (Indian number without country code)
  if (/^[6-9]\d{9}$/.test(num)) num = '+91' + num
  // Already has +
  if (!/^\+/.test(num)) num = '+' + num
  return num
}

function displayMobile(normalized) {
  // +919876543210 → +91 98765 43210
  if (normalized.startsWith('+91') && normalized.length === 13) {
    const n = normalized.slice(3)
    return `+91 ${n.slice(0, 5)} ${n.slice(5)}`
  }
  return normalized
}

function validateMobile(mobile) {
  return /^\+[1-9]\d{6,14}$/.test(mobile)
}

function validateCode(code) {
  return /^\d{6}$/.test(code)
}

export default async function handler(req, res) {
  withCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const sql = getDb()
  const subpath = req.url.replace(/\?.*$/, '').split('/auth/')[1] || ''

  // ── SIGNUP ──
  if (subpath === 'signup' && req.method === 'POST') {
    const { mobile: rawMobile, code, name } = req.body

    if (!rawMobile || !code) return err(res, 400, 'Mobile number and secret code are required')
    if (!validateCode(code)) return err(res, 400, 'Secret code must be exactly 6 digits')

    const mobile = normalizeMobile(rawMobile)
    if (!validateMobile(mobile)) return err(res, 400, 'Invalid mobile number')

    // Check if already exists
    const [existing] = await sql`SELECT id FROM users WHERE mobile = ${mobile}`
    if (existing) return err(res, 409, 'This mobile number is already registered. Please log in.')

    const secretHash = await bcrypt.hash(code, 12)
    const userId = newId('usr_')

    await sql`
      INSERT INTO users (id, mobile, mobile_display, secret_hash, name)
      VALUES (${userId}, ${mobile}, ${displayMobile(mobile)}, ${secretHash}, ${name || null})
    `

    // Create default settings
    await sql`
      INSERT INTO user_settings (user_id) VALUES (${userId})
      ON CONFLICT (user_id) DO NOTHING
    `

    // Issue auth token
    const token = await issueToken(userId, req, sql)
    setCookie(res, token)

    return ok(res, {
      user: { id: userId, mobile: displayMobile(mobile), name: name || null },
      message: 'Account created successfully'
    })
  }

  // ── LOGIN ──
  if (subpath === 'login' && req.method === 'POST') {
    const { mobile: rawMobile, code } = req.body

    if (!rawMobile || !code) return err(res, 400, 'Mobile number and secret code are required')

    const mobile = normalizeMobile(rawMobile)

    const [user] = await sql`
      SELECT * FROM users WHERE mobile = ${mobile} AND is_active = true
    `
    if (!user) return err(res, 401, 'Mobile number not found. Please sign up first.')

    const valid = await bcrypt.compare(code, user.secret_hash)
    if (!valid) return err(res, 401, 'Incorrect secret code. Please try again.')

    // Update last login
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`

    // Get settings
    const [settings] = await sql`SELECT * FROM user_settings WHERE user_id = ${user.id}`

    const token = await issueToken(user.id, req, sql)
    setCookie(res, token)

    return ok(res, {
      user: {
        id: user.id,
        mobile: user.mobile_display,
        name: user.name,
      },
      settings: settings ? {
        ai_provider: settings.ai_provider,
        selected_model: settings.selected_model,
        api_key_hint: settings.api_key_hint,
        style_prompt: settings.style_prompt,
        generate_drafts: settings.generate_drafts,
        strip_pii: settings.strip_pii,
        api_key_saved_at: settings.api_key_saved_at,
      } : null
    })
  }

  // ── LOGOUT ──
  if (subpath === 'logout' && req.method === 'POST') {
    const token = getCookieToken(req)
    if (token) {
      await sql`UPDATE auth_tokens SET revoked = true WHERE token = ${token}`
    }
    clearCookie(res)
    return ok(res, { message: 'Logged out' })
  }

  // ── ME: get current user + settings ──
  if (subpath === 'me' && req.method === 'GET') {
    const user = await requireAuth(req, res, sql)
    if (!user) return

    const [settings] = await sql`SELECT * FROM user_settings WHERE user_id = ${user.userId}`
    const gmailAccounts = await sql`
      SELECT id, email, display_name, picture_url,
             last_synced_at, total_fetched, is_active,
             (refresh_token_enc IS NOT NULL) as has_refresh_token
      FROM gmail_accounts
      WHERE user_id = ${user.userId} AND is_active = true
      ORDER BY created_at ASC
    `

    return ok(res, {
      user: { id: user.userId, mobile: user.mobile, name: user.name },
      settings: settings ? {
        ai_provider: settings.ai_provider,
        selected_model: settings.selected_model,
        api_key_hint: settings.api_key_hint,
        style_prompt: settings.style_prompt,
        generate_drafts: settings.generate_drafts,
        strip_pii: settings.strip_pii,
        api_key_saved_at: settings.api_key_saved_at,
      } : null,
      gmailAccounts,
    })
  }

  return err(res, 404, 'Not found')
}

async function issueToken(userId, req, sql) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86400 * 1000)

  await sql`
    INSERT INTO auth_tokens (token, user_id, expires_at, user_agent, ip_addr)
    VALUES (
      ${token}, ${userId}, ${expiresAt},
      ${req.headers['user-agent'] || null},
      ${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null}
    )
  `

  // Clean up old expired tokens
  await sql`
    DELETE FROM auth_tokens
    WHERE user_id = ${userId} AND (expires_at < NOW() OR revoked = true)
  `

  return token
}
