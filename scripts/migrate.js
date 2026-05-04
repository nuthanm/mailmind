// scripts/migrate.js
// Run once: node scripts/migrate.js
// This creates all required tables in your Neon database

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config()

const sql = neon(process.env.DATABASE_URL)

async function migrate() {
  console.log('Running migrations...')

  // Sessions table - stores encrypted API keys server-side, never in browser
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_active TIMESTAMPTZ DEFAULT NOW(),
      ai_provider TEXT NOT NULL DEFAULT 'openai',
      -- API keys stored encrypted, never sent back to client in full
      api_key_enc TEXT,
      api_key_hint TEXT,  -- last 4 chars only, shown in UI
      style_prompt TEXT DEFAULT '',
      generate_drafts BOOLEAN DEFAULT TRUE,
      strip_pii BOOLEAN DEFAULT TRUE,
      selected_model TEXT DEFAULT 'gpt-4o-mini'
    );
  `

  // Emails table - stores email data per session
  await sql`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      from_name TEXT NOT NULL,
      from_email TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      received_at TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `

  // Processed results - extracted fields, drafts, logs
  await sql`
    CREATE TABLE IF NOT EXISTS processed_emails (
      id SERIAL PRIMARY KEY,
      email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      -- Extracted fields stored as JSONB
      fields JSONB,
      draft TEXT,
      draft_sent BOOLEAN DEFAULT FALSE,
      agent_log JSONB DEFAULT '[]',
      processed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(email_id)
    );
  `

  // Index for fast lookups
  await sql`CREATE INDEX IF NOT EXISTS idx_emails_session ON emails(session_id);`
  await sql`CREATE INDEX IF NOT EXISTS idx_processed_session ON processed_emails(session_id);`
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(last_active);`

  console.log('✅ Migrations complete')
  process.exit(0)
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
