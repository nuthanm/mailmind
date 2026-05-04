// src/pages/HowItWorks.jsx
export default function HowItWorks() {
  const steps = [
    { num: 1, done: true, name: 'Session created in Neon DB', desc: 'When you open the app, a session is created in Neon PostgreSQL. No login needed. Your session ID is stored only in sessionStorage (cleared when you close the tab), not localStorage.', pills: ['Neon PostgreSQL', 'sessionStorage only', 'No login required'] },
    { num: 2, done: true, name: 'API key encrypted & stored server-side', desc: 'Your OpenAI or Anthropic API key is encrypted with AES-256-GCM using a server-side secret before being stored in Neon. The plaintext key never touches your browser after submission. Only the last 4 characters are shown in the UI.', pills: ['AES-256-GCM', 'Server-side only', 'Never in browser'], green: true },
    { num: 3, done: true, name: 'PII stripped before AI call', desc: 'If enabled, account numbers, phone numbers, PAN, Aadhaar numbers, and email addresses are redacted from the email body using regex before anything is sent to the AI API. Only the cleaned text is transmitted.', pills: ['Regex PII stripping', 'Optional toggle', 'Privacy-first'], green: true },
    { num: 4, done: true, name: 'AI runs server-side (Vercel function)', desc: 'All AI calls happen inside a Vercel serverless function. The API key is decrypted and used server-side. The browser never sees the key or makes direct calls to OpenAI/Anthropic. Supports both providers — you pick in Settings.', pills: ['Vercel Functions', 'OpenAI or Anthropic', 'Zero browser exposure'], blue: true },
    { num: 5, done: false, name: 'Results stored in Neon, exported as CSV', desc: 'Extracted fields, draft replies, and agent logs are stored in Neon PostgreSQL per session. Export all results to CSV with one click — ready to open in Google Sheets.', pills: ['Neon DB storage', 'CSV export', 'Google Sheets ready'] },
  ]

  return (
    <div className="hiw-view">
      <div className="hiw-inner">
        <div className="hiw-kicker">Architecture</div>
        <div className="hiw-title">How this app works,<br /><em>under the hood</em></div>
        <div className="hiw-sub">A production full-stack app. React frontend + Vercel serverless API + Neon PostgreSQL. Here's exactly what happens at each step.</div>
        <div className="flow-steps">
          {steps.map(step => (
            <div key={step.num} className="flow-step">
              <div className="step-left">
                <div className={`step-num${step.done ? ' done' : ''}`}>{step.num}</div>
                {step.num < steps.length && <div className="step-line"></div>}
              </div>
              <div className="step-content">
                <div className="step-name">{step.name}</div>
                <div className="step-desc">{step.desc}</div>
                <div className="step-pills">
                  {step.pills.map(p => (
                    <span key={p} className={`step-pill${step.green ? ' sp-green' : step.blue ? ' sp-blue' : ''}`}>{p}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="session-card" style={{ marginTop: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
            🚀 Deployment Checklist (Vercel + Neon Free Tier)
          </div>
          {[
            ['1', 'Create Neon project', 'neon.tech → New Project → copy DATABASE_URL'],
            ['2', 'Run migration', 'node scripts/migrate.js → creates all tables'],
            ['3', 'Deploy to Vercel', 'vercel deploy → set DATABASE_URL + SESSION_SECRET env vars'],
            ['4', 'Add API key in Settings', 'OpenAI or Anthropic — encrypted server-side immediately'],
            ['5', 'Load emails & Run Agent', 'Use sample emails or paste your own'],
          ].map(([h, title, sub]) => (
            <div key={h} className="session-row">
              <span className="session-hour">Step {h}</span>
              <span className="session-task"><strong>{title}</strong> — {sub}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
