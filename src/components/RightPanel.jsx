// src/components/RightPanel.jsx
import { useState } from 'react'
import { useApp } from '../lib/AppContext'
import { fmtTime } from '../lib/samples'

export default function RightPanel() {
  const { selectedEmail } = useApp()
  const [tab, setTab] = useState('extract')

  if (!selectedEmail) return (
    <aside className="right-panel">
      <div className="rp-empty">
        <div style={{ fontSize: 32, opacity: .2, marginBottom: 12 }}>←</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4 }}>Select an email</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Click any email to see AI-extracted data, draft reply, and agent log.</div>
      </div>
    </aside>
  )

  return (
    <aside className="right-panel">
      <div className="rp-header">
        <div className="rp-email-from">{selectedEmail.from_name}</div>
        <div className="rp-email-sub">{selectedEmail.subject} · {fmtTime(selectedEmail.received_at)}</div>
        <div className="rp-tabs">
          {['extract', 'draft', 'log'].map(t => (
            <button key={t} className={`rp-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="rp-body">
        {tab === 'extract' && <ExtractTab email={selectedEmail} />}
        {tab === 'draft' && <DraftTab email={selectedEmail} />}
        {tab === 'log' && <LogTab email={selectedEmail} />}
      </div>
    </aside>
  )
}

function ExtractTab({ email }) {
  const { exportCSV } = useApp()

  if (!email.fields) return (
    <div className="rp-empty-inner">
      <div style={{ fontSize: 28, opacity: .3, marginBottom: 12 }}>🤖</div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Not yet processed</div>
      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Click "Run Agent" to extract data from this email.</div>
    </div>
  )

  const f = email.fields
  const rows = [
    ['Sender type', f.sender_type],
    ['Intent', f.intent],
    ['Priority', f.priority, f.priority === 'High' ? 'urgent' : ''],
    ['Action needed', f.action_required],
    ['Key date', f.key_date || '—'],
    ['Amount', f.amount || '—', 'mono'],
    ['Category', f.category],
    ['Summary', f.summary, 'muted'],
  ]

  return (
    <>
      <div className="field-group">
        <div className="field-group-label">AI Extracted Fields</div>
        {rows.map(([label, val, cls]) => (
          <div key={label} className="field-row">
            <div className="field-key">{label}</div>
            <div className={`field-val ${cls || ''}`}>{val || '—'}</div>
          </div>
        ))}
      </div>
      <div className="field-group-label" style={{ marginBottom: 8 }}>Neon DB Preview</div>
      <div className="sheet-card">
        <div className="sheet-head"><div className="sheet-icon">N</div>processed_emails</div>
        <table className="sheet-table">
          <thead><tr><th>From</th><th>Intent</th><th>Priority</th></tr></thead>
          <tbody>
            <tr className="sheet-new">
              <td style={{ fontWeight: 600 }}>{email.from_name.split(/[\s—]+/)[0]}</td>
              <td style={{ fontSize: 11, color: 'var(--ink2)' }}>{(f.intent || '').substring(0, 28)}…</td>
              <td><span className={`tag ${f.priority === 'High' ? 'tag-danger' : 'tag-muted'}`} style={{ fontSize: 10 }}>{f.priority}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button className="btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
        onClick={exportCSV}>
        Export all to CSV →
      </button>
    </>
  )
}

function DraftTab({ email }) {
  const { regenDraft, markSent, showToast } = useApp()
  const [editMode, setEditMode] = useState(false)
  const [editText, setEditText] = useState('')

  if (!email.draft) return (
    <div className="rp-empty-inner">
      <div style={{ fontSize: 28, opacity: .3, marginBottom: 12 }}>✍️</div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {email.fields ? 'No draft needed' : 'Not yet processed'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
        {email.fields
          ? 'AI determined this email doesn\'t require a reply.'
          : 'Run the agent first to generate a draft.'}
      </div>
    </div>
  )

  const copy = () => {
    navigator.clipboard.writeText(editMode ? editText : email.draft)
    showToast('Copied to clipboard')
  }

  return (
    <>
      <div className="draft-card">
        <div className="draft-head">
          <div className="draft-head-left">✍ AI Draft Reply</div>
          <div className="draft-head-right">Review before sending</div>
        </div>
        {editMode
          ? <textarea className="draft-edit-area" value={editText} onChange={e => setEditText(e.target.value)} />
          : <div className="draft-body">{email.draft}</div>
        }
        <div className="draft-footer">
          <button className="draft-action" onClick={copy}>Copy</button>
          {editMode
            ? <button className="draft-action" onClick={() => setEditMode(false)}>Done</button>
            : <button className="draft-action" onClick={() => { setEditMode(true); setEditText(email.draft) }}>Edit</button>
          }
          <button className="draft-action" onClick={() => regenDraft(email.id)}>Regen</button>
          <button className="draft-action send" onClick={() => markSent(email.id)}>Mark Sent ✓</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink3)', textAlign: 'center', padding: 4 }}>
        Always review AI drafts before sending
      </div>
    </>
  )
}

function LogTab({ email }) {
  const log = email.agent_log || []
  if (!log.length) return (
    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink3)', fontSize: 12 }}>
      No log entries yet. Run the agent to see processing steps.
    </div>
  )
  return (
    <div className="log-list">
      {log.map((entry, i) => (
        <div key={i} className={`log-row log-${entry.type}`}>
          <span className="log-t">{entry.time}</span>
          <div className="log-icon-wrap">{entry.icon}</div>
          <div className="log-msg" dangerouslySetInnerHTML={{ __html: entry.msg }} />
        </div>
      ))}
    </div>
  )
}

// AlertBar
export function AlertBar() {
  const { alert, clearAlert } = useApp()
  if (!alert) return null
  return (
    <div className={`alert-bar show ${alert.type}`}>
      {alert.type === 'processing' && <div className="spin"></div>}
      <span>{alert.msg}</span>
      <span className="alert-dismiss" onClick={clearAlert}>✕</span>
    </div>
  )
}

// Toast
export function Toast({ msg }) {
  return <div className="toast show">{msg}</div>
}
