// src/components/Topbar.jsx
import { useApp } from '../lib/AppContext'

export default function Topbar({ view, setView }) {
  const { user, settings, running, runAgentSSE, logout } = useApp()

  const status = running ? 'running' : settings?.api_key_hint ? 'ready' : 'idle'

  return (
    <header className="topbar">
      <div className="brand" onClick={() => setView('dashboard')} style={{ cursor: 'pointer' }}>
        <div className="brand-mark">✉</div>
        <div className="brand-name">Mail<span>Mind</span></div>
      </div>

      <nav className="top-nav">
        {[
          { id: 'gmail',       label: '📬 Gmail' },
          { id: 'dashboard',   label: 'Dashboard' },
          { id: 'unsubscribe', label: '🚫 Inbox Cleaner' },
          { id: 'hiw',         label: 'How It Works' },
          { id: 'settings',    label: 'Settings' },
        ].map(tab => (
          <button
            key={tab.id}
            className={'top-link' + (view === tab.id ? ' active' : '')}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="top-right">
        <div className="status-pill">
          <div className={'status-dot ' + status}></div>
          <span>{status === 'running' ? 'Running…' : status === 'idle' ? 'No API key' : (settings?.api_key_hint ? `Key ${settings.api_key_hint}` : 'Ready')}</span>
        </div>

        {settings?.ai_provider && (
          <div className="provider-badge">
            {settings.ai_provider === 'anthropic' ? '🔵 Claude' : '🟢 OpenAI'}
          </div>
        )}

        <button className="btn-primary" onClick={runAgentSSE} disabled={running}>
          {running
            ? <><div className="spin-sm"></div> Running…</>
            : <>▶ Run Agent</>}
        </button>

        {/* User pill */}
        <div className="user-pill" title={`Logged in as ${user?.mobile}`}>
          <div className="avatar-sm">{user?.name?.charAt(0)?.toUpperCase() || user?.mobile?.slice(-2)}</div>
          <button className="logout-btn" onClick={logout} title="Logout">↩</button>
        </div>
      </div>
    </header>
  )
}
