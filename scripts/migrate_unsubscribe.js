// scripts/migrate_unsubscribe.js
// Run: node scripts/migrate_unsubscribe.js
// Adds unsubscribe-related tables to existing Neon DB

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config()

const sql = neon(process.env.DATABASE_URL)

async function migrate() {
  console.log('Running unsubscribe migrations...')

  // Detected senders that look like newsletters/promotions
  await sql`
    CREATE TABLE IF NOT EXISTS unsubscribe_senders (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

      -- Sender info
      from_name TEXT NOT NULL,
      from_email TEXT NOT NULL,
      domain TEXT NOT NULL,

      -- Detection
      sender_type TEXT DEFAULT 'newsletter',  -- newsletter | promotional | notification
      confidence INTEGER DEFAULT 0,           -- 0-100 how confident we are it's junk
      email_count INTEGER DEFAULT 1,          -- how many emails from this sender
      total_size_kb INTEGER DEFAULT 0,        -- estimated storage used

      -- Unsubscribe method detected
      unsub_method TEXT,         -- link | mailto | header | none
      unsub_url TEXT,            -- the actual unsubscribe URL
      unsub_mailto TEXT,         -- mailto: unsubscribe address
      list_unsub_header TEXT,    -- raw List-Unsubscribe header value

      -- Status
      status TEXT DEFAULT 'detected',   -- detected | queued | processing | done | failed | blocked
      unsubscribed_at TIMESTAMPTZ,
      error_msg TEXT,

      -- Metadata
      sample_subject TEXT,
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),

      UNIQUE(session_id, from_email)
    );
  `

  // Log of unsubscribe attempts
  await sql`
    CREATE TABLE IF NOT EXISTS unsubscribe_log (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_id TEXT REFERENCES unsubscribe_senders(id) ON DELETE CASCADE,
      from_email TEXT NOT NULL,
      method TEXT,              -- link | mailto | header
      url TEXT,
      status TEXT,              -- success | failed | pending
      http_status INTEGER,
      response_snippet TEXT,
      attempted_at TIMESTAMPTZ DEFAULT NOW()
    );
  `

  // Blocked senders — never show again
  await sql`
    CREATE TABLE IF NOT EXISTS blocked_senders (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      from_email TEXT,
      reason TEXT DEFAULT 'unsubscribed',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(session_id, from_email)
    );
  `

  await sql`CREATE INDEX IF NOT EXISTS idx_unsub_session ON unsubscribe_senders(session_id);`
  await sql`CREATE INDEX IF NOT EXISTS idx_unsub_status ON unsubscribe_senders(status);`
  await sql`CREATE INDEX IF NOT EXISTS idx_unsub_domain ON unsubscribe_senders(domain);`
  await sql`CREATE INDEX IF NOT EXISTS idx_blocked_session ON blocked_senders(session_id);`

  console.log('✅ Unsubscribe migrations complete')
  process.exit(0)
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
