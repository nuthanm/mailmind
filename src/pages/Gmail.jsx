// src/pages/Gmail.jsx
import { useState, useEffect, useCallback } from 'react'
import { gmailApi, parseOAuthResult } from '../lib/gmailApi'

const FETCH_PRESETS = [
  {
    id: 'inbox_recent',
    label: 'Recent Inbox',
    desc: 'Last 50 emails from your inbox',
    icon: '📬',
    options: { query: 'in:inbox', maxEmails: 50 }
  },
  {
    id: 'unread',
    label: 'Unread Only',
    desc: 'All unread emails in inbox',
    icon: '🔵',
    options: { query: 'in:inbox is:unread', maxEmails: 100 }
  },
  {
    id: 'newsletters',
    label: 'Newsletters & Promos',
    desc: 'Emails likely to be newsletters or promotional',
    icon: '📰',
    options: { query: 'in:inbox (unsubscribe OR newsletter OR promotional OR "list-unsubscribe")', maxEmails: 100 }
  },
  {
    id: 'week',
    label: 'This Week',
    desc: 'All emails from the past 7 days',
    icon: '📅',
    options: { query: 'in:inbox newer_than:7d', maxEmails: 100 }
  },
  {
    id: 'all_inbox',
    label: 'Full Inbox Scan',
    desc: 'Up to 2000 emails — best for deep cleaning',
    icon: '🔍',
    options: { query: 'in:inbox', maxEmails: 2000 }
  },
]

export default function Gmail() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(null)  // accountId being fetched
  const [toast, setToast] = useState(null)
  const [quotas, setQuotas] = useState({})
  const [selectedPreset, setSelectedPreset] = useState('inbox_recent')
  const [customQuery, setCustomQuery] = useState('')
  const [customMax, setCustomMax] = useState(50)
  const [showCustom, setShowCustom] = useState(false)
  const [fetchResult, setFetchResult] = useState(null)
  const [disconnectModal, setDisconnectModal] = useState(null)  // { accountId, email }

  const showToast = (msg, type = 'default') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const loadAccounts = useCallback(async () => {
    try {
      const data = await gmailApi.listAccounts()
      setAccounts(data.accounts || [])
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Check if coming back from OAuth
    const result = parseOAuthResult()
    if (result?.connected) {
      showToast(`✓ Gmail connected: ${result.connected}`, 'success')
    } else if (result?.error) {
      showToast(`Connection failed: ${result.error}`, 'error')
    }
    loadAccounts()
  }, [loadAccounts])

  const loadQuota = async (accountId) => {
    try {
      const data = await gmailApi.getQuota(accountId)
      setQuotas(q => ({ ...q, [accountId]: data }))
    } catch {}
  }

  useEffect(() => {
    accounts.forEach(a => {
      if (!quotas[a.id]) loadQuota(a.id)
    })
  }, [accounts])

  const fetchEmails = async (accountId, options) => {
    setFetching(accountId)
    setFetchResult(null)
    try {
      const data = await gmailApi.fetchEmails(accountId, options)
      setFetchResult({ accountId, ...data })
      showToast(`✓ ${data.message}`, 'success')
      await loadAccounts()
    } catch (e) {
      showToast(e.message, 'error')
      if (e.message.includes('reconnect') || e.message.includes('expired')) {
        await loadAccounts()
      }
    } finally {
      setFetching(null)
    }
  }

  const handleFetch = (accountId) => {
    const preset = FETCH_PRESETS.find(p => p.id === selectedPreset)
    const options = showCustom
      ? { query: customQuery || 'in:inbox', maxEmails: customMax }
      : preset?.options || {}
    fetchEmails(accountId, options)
  }

  const disconnect = (accountId, email) => {
    setDisconnectModal({ accountId, email })
  }

  const confirmDisconnect = async () => {
    if (!disconnectModal) return
    const { accountId } = disconnectModal
    setDisconnectModal(null)
    try {
      await gmailApi.disconnect(accountId)
      showToast('Account disconnected', 'success')
      setAccounts(a => a.filter(x => x.id !== accountId))
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const connect = async () => {
    try {
      const result = await gmailApi.startConnectPopup()
      if (result.connected) {
        showToast(`✓ Gmail connected: ${result.connected}`, 'success')
        await loadAccounts()
      } else if (result.error) {
        showToast(`Connection failed: ${result.error}`, 'error')
      }
    } catch (e) {
      showToast(e.message || 'Failed to open Gmail connection', 'error')
    }
  }

  const googleSetupDone = true // In production check if GOOGLE_CLIENT_ID is set

  return (
    <div className="gmail-view">
      {/* HEADER */}
      <div className="gmail-header">
        <div>
          <div className="gmail-title">
            <span className="gmail-logo">G</span>
            Connect Gmail
          </div>
          <div className="gmail-desc">
            Connect your Gmail account to fetch real emails. OAuth 2.0 — MailMind never stores your password. Tokens are encrypted at rest in Neon DB.
          </div>
        </div>
        {(!loading && accounts.length === 0) && (
          <button className="gmail-connect-btn" onClick={connect}>
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Connect Gmail Account
          </button>
        )}
      </div>

      {/* SETUP GUIDE (shown when no accounts) */}
      {!loading && accounts.length === 0 && (
        <div className="gmail-setup-guide">
          <div className="gmail-setup-steps-title">
            <span style={{fontSize:18}}>🚀</span> Before connecting — set up Google OAuth
          </div>
          <div className="gmail-setup-steps">
            {[
              {
                num: '1',
                title: 'Create a Google Cloud Project',
                body: 'Go to console.cloud.google.com → New Project → name it "MailMind"',
                link: 'https://console.cloud.google.com/projectcreate',
                linkLabel: 'Open Google Console →',
              },
              {
                num: '2',
                title: 'Enable Gmail API',
                body: 'APIs & Services → Library → search "Gmail API" → Enable',
                link: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
                linkLabel: 'Enable Gmail API →',
              },
              {
                num: '3',
                title: 'Configure OAuth Consent Screen',
                body: 'APIs & Services → OAuth consent screen → External → Add scopes: gmail.readonly, gmail.modify, userinfo.email, userinfo.profile',
              },
              {
                num: '4',
                title: 'Create OAuth 2.0 Credentials',
                body: 'Credentials → Create Credentials → OAuth Client ID → Web Application → Add Authorized Redirect URIs:',
                code: `# Local development (API server port)\nhttp://localhost:3001/api/gmail/callback\n\n# Production — replace with your Vercel URL\nhttps://YOUR-APP.vercel.app/api/gmail/callback`,
              },
              {
                num: '5',
                title: 'Add to your environment variables',
                body: 'Copy Client ID and Client Secret to your .env file (local) or Vercel dashboard (production):',
                code: 'GOOGLE_CLIENT_ID=your-client-id\nGOOGLE_CLIENT_SECRET=your-client-secret\nGOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback',
              },
              {
                num: '6',
                title: 'Deploy to Vercel',
                body: 'Add environment variables in Vercel dashboard → Settings → Environment Variables (or use CLI):',
                code: 'vercel env add GOOGLE_CLIENT_ID\nvercel env add GOOGLE_CLIENT_SECRET\nvercel env add GOOGLE_REDIRECT_URI\n# Set GOOGLE_REDIRECT_URI to: https://YOUR-APP.vercel.app/api/gmail/callback',
              },
              {
                num: '7',
                title: 'Redeploy and connect',
                body: 'After setting env vars, redeploy (vercel --prod) then click "Connect Gmail Account" above.',
              },
            ].map(step => (
              <div key={step.num} className="gmail-setup-step">
                <div className="gmail-setup-step-num">{step.num}</div>
                <div className="gmail-setup-step-body">
                  <div className="gmail-setup-step-title">{step.title}</div>
                  <div className="gmail-setup-step-desc">{step.body}</div>
                  {step.code && (
                    <div className="gmail-setup-code">
                      {step.code}
                      <button className="gmail-copy-btn" onClick={() => { navigator.clipboard.writeText(step.code); showToast('Copied') }}>
                        Copy
                      </button>
                    </div>
                  )}
                  {step.link && (
                    <a href={step.link} target="_blank" rel="noopener noreferrer" className="gmail-setup-link">
                      {step.linkLabel}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONNECTED ACCOUNTS */}
      {accounts.length > 0 && (
        <div className="gmail-accounts">
          <div className="gmail-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 28 }}>
            <span>Connected Accounts</span>
            <button
              className="btn-ghost"
              onClick={connect}
              style={{ fontSize: 11, padding: '3px 10px' }}
            >
              + Add account
            </button>
          </div>
          {accounts.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              quota={quotas[account.id]}
              fetching={fetching === account.id}
              onFetch={() => handleFetch(account.id)}
              onDisconnect={() => disconnect(account.id, account.email)}
              fetchResult={fetchResult?.accountId === account.id ? fetchResult : null}
            />
          ))}
        </div>
      )}

      {/* FETCH OPTIONS */}
      {accounts.length > 0 && (
        <div className="gmail-fetch-options">
          <div className="gmail-section-label">Fetch Options</div>
          <div className="preset-grid">
            {FETCH_PRESETS.map(preset => (
              <div
                key={preset.id}
                className={`preset-card${selectedPreset === preset.id && !showCustom ? ' selected' : ''}`}
                onClick={() => { setSelectedPreset(preset.id); setShowCustom(false) }}
              >
                <div className="preset-icon">{preset.icon}</div>
                <div className="preset-label">{preset.label}</div>
                <div className="preset-desc">{preset.desc}</div>
              </div>
            ))}
            <div
              className={`preset-card${showCustom ? ' selected' : ''}`}
              onClick={() => setShowCustom(true)}
            >
              <div className="preset-icon">⚙️</div>
              <div className="preset-label">Custom Query</div>
              <div className="preset-desc">Advanced Gmail search</div>
            </div>
          </div>

          {showCustom && (
            <div className="custom-query-box">
              <div className="form-group">
                <label className="form-label">Gmail Search Query</label>
                <input
                  className="form-input"
                  value={customQuery}
                  onChange={e => setCustomQuery(e.target.value)}
                  placeholder='e.g. in:inbox from:newsletter@example.com newer_than:30d'
                  style={{ width: '100%' }}
                />
                <div className="form-hint">
                  Uses Gmail search syntax.
                  <a href="https://support.google.com/mail/answer/7190" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', marginLeft: 4 }}>
                    Gmail search operators →
                  </a>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Max emails to fetch</label>
                <input
                  type="number"
                  className="form-input"
                  value={customMax}
                  onChange={e => setCustomMax(Math.min(2000, Math.max(1, parseInt(e.target.value) || 50)))}
                  min={1}
                  max={2000}
                  style={{ width: 120 }}
                />
                <span className="form-hint" style={{ marginLeft: 8 }}>Max 2000 per fetch</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PRIVACY NOTE */}
      <div className="gmail-privacy">
        <div className="privacy-icon">🔒</div>
        <div>
          <div className="privacy-title">How your Gmail data is handled</div>
          <div className="privacy-body">
            OAuth tokens are encrypted with AES-256-GCM and stored in Neon DB — never in your browser.
            Email bodies are fetched server-side and stored in your private session.
            If PII stripping is enabled in Settings, account numbers and phone numbers are removed before any AI processing.
            You can disconnect your account and delete all data at any time from the Settings page.
            MailMind only requests <strong>gmail.readonly</strong> and <strong>gmail.modify</strong> scopes
            — it never sends emails on your behalf without explicit approval.
          </div>
        </div>
      </div>

      {toast && (
        <div className={`unsub-toast ${toast.type || ''}`}>{toast.msg}</div>
      )}

      {disconnectModal && (
        <div className="confirm-overlay">
          <div className="confirm-card">
            <div className="confirm-title">Disconnect Gmail Account?</div>
            <div className="confirm-msg">
              Disconnect <strong>{disconnectModal.email}</strong>? This will remove the connection but not delete fetched emails.
            </div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setDisconnectModal(null)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmDisconnect}>
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ACCOUNT CARD ──
function AccountCard({ account, quota, fetching, onFetch, onDisconnect, fetchResult }) {
  const usagePercent = quota?.quota
    ? Math.round((parseInt(quota.quota.usage) / parseInt(quota.quota.limit)) * 100)
    : null

  const usageGB = quota?.quota
    ? (parseInt(quota.quota.usage) / 1e9).toFixed(2)
    : null

  const limitGB = quota?.quota
    ? (parseInt(quota.quota.limit) / 1e9).toFixed(0)
    : null

  return (
    <div className="gmail-account-card">
      <div className="gmail-account-main">
        <div className="gmail-account-avatar">
          {account.picture_url
            ? <img src={account.picture_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%' }} />
            : <div className="gmail-avatar-placeholder">{account.email.charAt(0).toUpperCase()}</div>
          }
          <div className="gmail-status-dot"></div>
        </div>

        <div className="gmail-account-info">
          <div className="gmail-account-email">{account.email}</div>
          <div className="gmail-account-name">{account.display_name}</div>
          <div className="gmail-account-meta">
            {account.last_synced_at
              ? `Last synced: ${new Date(account.last_synced_at).toLocaleString()}`
              : 'Never synced'}
            {account.total_fetched > 0 && ` · ${account.total_fetched} emails fetched total`}
          </div>
        </div>

        {/* Storage quota */}
        {usagePercent !== null && (
          <div className="gmail-quota">
            <div className="quota-bar-wrap">
              <div
                className="quota-bar"
                style={{
                  width: `${usagePercent}%`,
                  background: usagePercent > 80 ? 'var(--red)' : usagePercent > 60 ? 'var(--amber)' : 'var(--accent)'
                }}
              ></div>
            </div>
            <div className="quota-text">
              {usageGB} GB / {limitGB} GB used ({usagePercent}%)
            </div>
          </div>
        )}

        <div className="gmail-account-actions">
          <button
            className="run-btn"
            onClick={onFetch}
            disabled={fetching}
            style={{ fontSize: 12 }}
          >
            {fetching
              ? <><div className="spin-inline spin-white"></div> Fetching…</>
              : '↓ Fetch Emails'}
          </button>
          <button className="btn-ghost" onClick={onDisconnect} style={{ fontSize: 12 }}>
            Disconnect
          </button>
        </div>
      </div>

      {/* Fetch result */}
      {fetchResult && (
        <div className="fetch-result">
          <span className="fetch-result-icon">✓</span>
          <span>
            <strong>{fetchResult.fetched}</strong> new emails fetched
            {fetchResult.skipped > 0 && `, ${fetchResult.skipped} already in DB`}
            {' · '}
            <span style={{ color: 'var(--ink3)' }}>
              Go to Dashboard → click "Run Agent" to process them
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
