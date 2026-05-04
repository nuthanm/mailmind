// scripts/migrate_gmail.js
// Run: node scripts/migrate_gmail.js
// Adds Gmail OAuth token storage to sessions + gmail_accounts table

import { neon } from '@neondatabase/serverless'
import * as dotenv from 'dotenv'
dotenv.config()

const sql = neon(process.env.DATABASE_URL)

async function migrate() {
  console.log('Running Gmail OAuth migrations...')

  // Gmail accounts linked to a session
  // Tokens are encrypted the same way as API keys (AES-256-GCM)
  await sql`
    CREATE TABLE IF NOT EXISTS gmail_accounts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

      -- Google account info
      google_user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT,
      picture_url TEXT,

      -- OAuth tokens — encrypted at rest
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT,
      token_expiry TIMESTAMPTZ,

      -- Sync state
      last_synced_at TIMESTAMPTZ,
      last_history_id TEXT,         -- Gmail history ID for incremental sync
      total_fetched INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),

      UNIQUE(session_id, google_user_id)
    );
  `

  // OAuth state table — prevents CSRF in OAuth flow
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      used BOOLEAN DEFAULT FALSE
    );
  `

  // Add list_unsubscribe_header column to emails if not exists
  await sql`
    ALTER TABLE emails
    ADD COLUMN IF NOT EXISTS list_unsubscribe_header TEXT,
    ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
    ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
    ADD COLUMN IF NOT EXISTS size_estimate INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES gmail_accounts(id) ON DELETE SET NULL
  `

  await sql`CREATE INDEX IF NOT EXISTS idx_gmail_session ON gmail_accounts(session_id);`
  await sql`CREATE INDEX IF NOT EXISTS idx_oauth_state ON oauth_states(state);`
  await sql`CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id);`

  // Auto-clean expired OAuth states after 10 minutes
  await sql`
    CREATE INDEX IF NOT EXISTS idx_oauth_state_created ON oauth_states(created_at);
  `

  console.log('✅ Gmail OAuth migrations complete')
  console.log('')
  console.log('Next steps:')
  console.log('1. Go to console.cloud.google.com')
  console.log('2. Create a project → Enable Gmail API')
  console.log('3. OAuth consent screen → Add scope: gmail.readonly, gmail.modify')
  console.log('4. Create OAuth 2.0 credentials → Web Application')
  console.log('5. Add redirect URI: https://your-app.vercel.app/api/gmail/callback')
  console.log('6. Copy Client ID + Client Secret to .env')
  process.exit(0)
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
