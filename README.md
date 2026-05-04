# MailMind

AI-powered inbox assistant with Gmail multi-account sync, inbox cleanup, unsubscribe automation, and bulk delete tooling.

## What is included

- Gmail OAuth connect/disconnect for multiple accounts
- Gmail sync with newest-first fetch and duplicate-safe insert
- Dashboard with account scoping (single account or all accounts)
- Email processing pipeline for extraction and draft workflows
- Inbox Cleaner with scan, queue, unsubscribe, ignore, and remove flows
- Bulk delete UX:
  - Select visible
  - Select by sender group
  - Multi-sender group delete
  - Delete filtered set
  - Biggest emails filter (Top 10/25/50/100)
  - Space-to-free indicators
  - Delete progress lock (actions disabled while running)

## Tech stack

- Frontend: React + Vite
- API: Node + Vercel serverless functions under api/
- Database: Neon PostgreSQL
- Auth: Cookie-based session/JWT helpers

## Local development

### 1) Install

```bash
npm install
```

### 2) Configure environment

Copy .env.example to .env and fill real values.

Required values:

- DATABASE_URL
- SESSION_SECRET
- JWT_SECRET
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI

Local redirect URI must be:

```text
http://localhost:3001/api/gmail/callback
```

### 3) Run migrations

```bash
node scripts/migrate.js
node scripts/migrate_unsubscribe.js
```

### 4) Start app

```bash
npm run dev
```

- UI: http://localhost:5173 (or next free port)
- API: http://localhost:3001

## User guide

### Gmail sync behavior

- Sync fetches inbox-first and newest-first from Gmail.
- Duplicates are skipped by gmail_message_id.
- If result says fewer inserted than found, that is usually because some emails are already stored.

### Biggest emails cleanup

1. Open size filter and choose Biggest emails (Top 10/25/50/100).
2. Check Filtered size in status strip.
3. Click Delete Filtered to remove only the current largest set.
4. Confirm in modal to execute delete.

### Multi-sender delete

1. Open Sender group dropdown (checkbox menu).
2. Check one or more senders.
3. Click Select Sender to select all emails from checked senders.
4. Click Delete Sender Group to delete selected sender group.

### Delete safety/lock

- During delete or top-view expansion, controls are locked.
- Progress/status banner is shown.
- No other actions can run until the operation finishes.

## GitHub push guide

Run these commands from project root.

```bash
git status
git add -A
git commit -m "feat: mailmind inbox cleaner, multi-sender delete, biggest-email filters, deployment docs"
git push origin main
```

If your branch is not main:

```bash
git push -u origin <your-branch>
```

## Vercel deployment guide

### 1) Install/login CLI

```bash
npm i -g vercel
vercel login
```

### 2) Link project

```bash
vercel
```

### 3) Set production env vars

```bash
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production
vercel env add JWT_SECRET production
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add GOOGLE_REDIRECT_URI production
vercel env add APP_URL production
```

Production GOOGLE_REDIRECT_URI must be your deployed callback URL:

```text
https://<your-vercel-domain>/api/gmail/callback
```

Production APP_URL must be your deployed frontend URL:

```text
https://<your-vercel-domain>
```

### 4) Deploy

```bash
vercel --prod
```

### 5) Verify after deploy

- Connect Gmail account in deployed app
- Run sync and confirm new emails appear
- Run scan in Inbox Cleaner and verify detected senders
- Test delete flow and confirm progress lock appears

## Environment variables reference

| Variable | Required | Notes |
|---|---|---|
| DATABASE_URL | Yes | Neon PostgreSQL connection string |
| SESSION_SECRET | Yes | Generate with openssl rand -hex 32 |
| JWT_SECRET | Yes | Generate with openssl rand -hex 32 |
| GOOGLE_CLIENT_ID | Yes | Google OAuth client id |
| GOOGLE_CLIENT_SECRET | Yes | Google OAuth client secret |
| GOOGLE_REDIRECT_URI | Yes | Must match Google console exactly |
| DEFAULT_AI_PROVIDER | Optional | openai or anthropic |
| APP_URL | Yes in prod | Used for CORS and callback fallback |

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run db:migrate
```
