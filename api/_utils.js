// api/_utils.js - shared utilities for all API routes

import { neon } from '@neondatabase/serverless'
import crypto from 'crypto'

// ── DB ──
export const getDb = () => neon(process.env.DATABASE_URL)

// ── CORS HEADERS ──
export const CORS = {
  'Access-Control-Allow-Origin': process.env.APP_URL || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Id',
  'Access-Control-Allow-Credentials': 'true',
}

export function withCors(res, handler) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
}

// ── SESSION ──
export function getSessionId(req) {
  return req.headers['x-session-id'] || null
}

export async function validateSession(req, sql) {
  const sid = getSessionId(req)
  if (!sid) return null
  const [session] = await sql`
    UPDATE sessions SET last_active = NOW()
    WHERE id = ${sid}
    RETURNING id, ai_provider, api_key_hint, style_prompt,
              generate_drafts, strip_pii, selected_model
  `
  return session || null
}

// ── ENCRYPTION ──
// API keys are encrypted with AES-256-GCM using SESSION_SECRET
// They are NEVER stored in plaintext or sent back to the browser in full

const ALGORITHM = 'aes-256-gcm'
const KEY = crypto.scryptSync(
  process.env.SESSION_SECRET || 'fallback-dev-secret-change-in-prod',
  'mailmind-salt',
  32
)

export function encryptApiKey(plaintext) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptApiKey(ciphertext) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}

// ── PII STRIPPING ──
export function stripPII(text) {
  return text
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD-REDACTED]')
    .replace(/account\s*(number|no|#)?[:\s]*\d+/gi, 'account [REDACTED]')
    .replace(/\b\d{10,12}\b/g, '[NUM-REDACTED]')
    .replace(/(\+91|0)[6-9]\d{9}\b/g, '[PHONE-REDACTED]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN-REDACTED]')
    .replace(/\b\d{4}\s\d{4}\s\d{4}\b/g, '[AADHAAR-REDACTED]')
    .replace(/password[:\s]+\S+/gi, 'password [REDACTED]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL-REDACTED]')
}

// ── JSON RESPONSE HELPERS ──
export function ok(res, data) {
  res.status(200).json({ ok: true, ...data })
}

export function err(res, status, message) {
  res.status(status).json({ ok: false, error: message })
}

// ── ID GENERATION ──
export function newId(prefix = '') {
  return prefix + crypto.randomBytes(12).toString('hex')
}
