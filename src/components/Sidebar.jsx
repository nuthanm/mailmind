// src/components/Sidebar.jsx
import { useApp } from '../lib/AppContext'

export function Sidebar() {
  const { stats, settings, clearAll, setFilter, showToast, exportCSV, gmailAccounts, activeAccountId, setActiveAccountId } = useApp()

  const onExportCSV = async () => {
    await exportCSV()
    showToast('CSV download started')
  }

  return (
    <aside className="left-sidebar">
      <div className="sidebar-block">
        <div className="sidebar-heading">Account</div>
        <div className={`acct-row ${activeAccountId === 'all' ? 'active' : ''}`} onClick={() => setActiveAccountId('all')}>
          <div className="acct-logo" style={{ background: '#fff0ee', color: '#ea4335', borderColor: '#fad0cc' }}>G</div>
          <div className="acct-text">
            <div className="acct-name">All Gmail Accounts</div>
            <div className="acct-sub">
              {settings?.ai_provider === 'anthropic' ? '🔵 Claude' : '🟢 OpenAI'} · {settings?.selected_model || 'No model'}
            </div>
          </div>
          <div className={`dot-status ${settings?.api_key_hint ? 'on' : 'off'}`}></div>
        </div>
        {gmailAccounts.map(acc => (
          <div
            key={acc.id}
            className={`acct-row ${activeAccountId === acc.id ? 'active' : ''}`}
            onClick={() => setActiveAccountId(acc.id)}
          >
            <div className="acct-logo" style={{ background: '#fff0ee', color: '#ea4335', borderColor: '#fad0cc' }}>G</div>
            <div className="acct-text">
              <div className="acct-name">{acc.email}</div>
              <div className="acct-sub">{acc.display_name || 'Gmail account'}</div>
            </div>
            <div className={`dot-status ${acc.is_active ? 'on' : 'off'}`}></div>
          </div>
        ))}
      </div>

      <div className="sidebar-block">
        <div className="sidebar-heading">Stats</div>
        <div className="stats-grid">
          <div className="stat-tile"><div className="stat-val">{stats.total}</div><div className="stat-lbl">Total</div></div>
          <div className="stat-tile"><div className="stat-val c-green">{stats.processed}</div><div className="stat-lbl">Processed</div></div>
          <div className="stat-tile"><div className="stat-val c-blue">{stats.drafts}</div><div className="stat-lbl">Drafts</div></div>
          <div className="stat-tile"><div className="stat-val c-amber">{stats.actions}</div><div className="stat-lbl">Actions</div></div>
        </div>
      </div>

      <div className="sidebar-block flex-grow">
        <div className="sidebar-heading">Quick Actions</div>
        <button className="nav-item" onClick={onExportCSV}>
          <span>⬇</span> Export to CSV
        </button>
        <button className="nav-item" onClick={() => setFilter('draft')}>
          <span>✍</span> Review Drafts
          {stats.drafts > 0 && <span className="nav-badge">{stats.drafts}</span>}
        </button>
        <button className="nav-item" onClick={() => setFilter('action')}>
          <span>⚠</span> Action Items
          {stats.actions > 0 && <span className="nav-badge alert">{stats.actions}</span>}
        </button>
        <button className="nav-item" onClick={clearAll}>
          <span>✕</span> Clear All
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
