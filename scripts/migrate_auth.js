// scripts/migrate_auth.js
// Run: node scripts/migrate_auth.js

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config()

const sql = neon(process.env.DATABASE_URL)

async function migrate() {
  console.log('Running auth migrations...')

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      mobile TEXT NOT NULL UNIQUE,
      mobile_display TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT TRUE
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ai_provider TEXT DEFAULT 'openai',
      selected_model TEXT DEFAULT 'gpt-4o-mini',
      api_key_enc TEXT,
      api_key_hint TEXT,
      style_prompt TEXT DEFAULT '',
      generate_drafts BOOLEAN DEFAULT TRUE,
      strip_pii BOOLEAN DEFAULT TRUE,
      api_key_saved_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_used_at TIMESTAMPTZ DEFAULT NOW(),
      user_agent TEXT,
      ip_addr TEXT,
      revoked BOOLEAN DEFAULT FALSE
    )
  `

  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE`
  await sql`ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE`
  await sql`ALTER TABLE emails ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE`

  await sql`CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile)`
  await sql`CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_tokens_expiry ON auth_tokens(expires_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_gmail_user ON gmail_accounts(user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_emails_user ON emails(user_id)`

  console.log('✅ Auth migrations complete')
  process.exit(0)
}

migrate().catch(err => { console.error(err); process.exit(1) })
