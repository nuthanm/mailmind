// src/pages/Unsubscribe.jsx
import { useState, useEffect, useCallback } from 'react'
import { unsubApi } from '../lib/unsubscribeApi'
import { useApp } from '../lib/AppContext'

const STATUS_META = {
  detected:   { label: 'Detected',   color: 'var(--amber)',  bg: 'var(--amber-light)',  dot: '#d97706' },
  queued:     { label: 'Queued',     color: 'var(--blue)',   bg: 'var(--blue-light)',   dot: '#1a4fa0' },
  processing: { label: 'Processing', color: 'var(--ink2)',   bg: 'var(--off2)',         dot: '#9a9890' },
  done:       { label: 'Unsubscribed', color: 'var(--accent)', bg: 'var(--accent-light)', dot: '#16a34a' },
  failed:     { label: 'Failed',     color: 'var(--red)',    bg: 'var(--red-light)',    dot: '#991b1b' },
  blocked:    { label: 'Ignored',    color: 'var(--ink3)',   bg: 'var(--off2)',         dot: '#c4c2ba' },
}

const TYPE_ICON = { newsletter: '📰', promotional: '🏷️', notification: '🔔' }

export default function Unsubscribe() {
  const { gmailAccounts, activeAccountId, setActiveAccountId } = useApp()
  const [senders, setSenders] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [firingAll, setFiringAll] = useState(false)
  const [removingAll, setRemovingAll] = useState(false)
  const [firingId, setFiringId] = useState(null)
  const [toast, setToast] = useState(null)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [sortBy, setSortBy] = useState('confidence')

  const showToast = (msg, type = 'default') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    try {
      const data = await unsubApi.list(activeAccountId)
      setSenders(data.senders || [])
      setStats(data.stats || null)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [activeAccountId])

  useEffect(() => { load() }, [load])

  const scan = async () => {
    setScanning(true)
    showToast('Scanning emails for newsletters and promotions…')
    try {
      const data = await unsubApi.scan(activeAccountId)
      await load()
      showToast(`✓ Scan complete — found ${data.detected} newsletter sender${data.detected !== 1 ? 's' : ''}`)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setScanning(false)
    }
  }

  const queueSelected = async () => {
    if (selected.size === 0) return
    await unsubApi.queueIds([...selected])
    setSelected(new Set())
    await load()
    showToast(`${selected.size} sender${selected.size !== 1 ? 's' : ''} queued`)
  }

  const removeSelected = async () => {
    if (selected.size === 0) return
    const ids = [...selected]
    await Promise.all(ids.map(id => unsubApi.remove(id)))
    setSelected(new Set())
    await load()
    showToast(`${ids.length} sender${ids.length !== 1 ? 's' : ''} removed from list`)
  }

  const removeAllInFilter = async () => {
    if (filtered.length === 0) return
    setRemovingAll(true)
    try {
      await Promise.all(filtered.map(s => unsubApi.remove(s.id)))
      setSelected(new Set())
      await load()
      showToast(`${filtered.length} sender${filtered.length !== 1 ? 's' : ''} removed from current filter`)
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setRemovingAll(false)
    }
  }

  const queueAll = async () => {
    await unsubApi.queueAll(activeAccountId)
    await load()
    showToast('All detected senders queued')
  }

  const fireOne = async (id) => {
    setFiringId(id)
    try {
      const data = await unsubApi.fireOne(id)
      await load()
      if (data.status === 'done') {
        showToast('✓ Unsubscribed successfully', 'success')
      } else if (data.needsManualConfirm) {
        showToast('⚠ Please check your email to confirm unsubscribe', 'warning')
      } else {
        showToast(`Failed: ${data.error || 'unknown error'}`, 'error')
      }
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setFiringId(null)
    }
  }

  const fireAll = async () => {
    setFiringAll(true)
    showToast('Firing all queued unsubscribes…')
    try {
      const data = await unsubApi.fireAll()
      await load()
      showToast(`✓ ${data.succeeded} unsubscribed, ${data.failed} failed`, 'success')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setFiringAll(false)
    }
  }

  const block = async (id) => {
    await unsubApi.block(id)
    await load()
    showToast('Sender ignored')
  }

  const remove = async (id) => {
    await unsubApi.remove(id)
    setSenders(s => s.filter(x => x.id !== id))
    showToast('Removed from list')
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    const ids = filtered
      .filter(s => ['detected', 'queued', 'blocked'].includes(s.status) && s.unsub_method !== 'none')
      .map(s => s.id)
    setSelected(prev => prev.size === ids.length ? new Set() : new Set(ids))
  }

  const getFilterCount = (id) => {
    if (!stats) return 0
    if (id === 'blocked') return senders.filter(s => s.status === 'blocked').length
    return stats[id] || 0
  }

  // Filter + sort
  const filtered = senders
    .filter(s => {
      if (filter === 'all') return true
      return s.status === filter
    })
    .sort((a, b) => {
      if (sortBy === 'confidence') return b.confidence - a.confidence
      if (sortBy === 'size') return (b.total_size_kb || 0) - (a.total_size_kb || 0)
      if (sortBy === 'count') return (b.email_count || 0) - (a.email_count || 0)
      return 0
    })

  const queuedCount = senders.filter(s => s.status === 'queued').length
  const canFireAll = queuedCount > 0 && !firingAll

  return (
    <div className="unsub-view">
      {/* HEADER */}
      <div className="unsub-header">
        <div className="unsub-header-left">
          <div className="unsub-title-row">
            <div className="unsub-title">Inbox Cleaner</div>
            {stats && (
              <div className="unsub-subtitle">
                {stats.done > 0 && (
                  <span className="freed-badge">
                    🗑 {stats.freedSizeMb} MB freed
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="unsub-desc">
            Detect newsletters and promotional emails, then unsubscribe in one click. Estimated storage saved is shown per sender.
          </div>
        </div>
        <div className="unsub-header-actions">
          <select className="account-select" value={activeAccountId} onChange={e => setActiveAccountId(e.target.value)}>
            <option value="all">All Gmail accounts</option>
            {gmailAccounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.email}</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={scan} disabled={scanning}>
            {scanning ? <><div className="spin-inline"></div> Scanning…</> : '🔍 Scan Inbox'}
          </button>
          {queuedCount > 0 && (
            <button className="run-btn" onClick={fireAll} disabled={!canFireAll}>
              {firingAll
                ? <><div className="spin-inline spin-white"></div> Unsubscribing…</>
                : `🚫 Unsubscribe All (${queuedCount})`}
            </button>
          )}
        </div>
      </div>

      {/* STATS STRIP */}
      {stats && (
        <div className="unsub-stats">
          <StatBadge icon="📊" label="Detected" value={stats.detected} color="var(--amber)" />
          <StatBadge icon="📋" label="Queued" value={stats.queued} color="var(--blue)" />
          <StatBadge icon="✓" label="Unsubscribed" value={stats.done} color="var(--accent)" />
          <StatBadge icon="✕" label="Failed" value={stats.failed} color="var(--red)" />
          <div className="stat-divider"></div>
          <StatBadge icon="💾" label="Est. inbox size" value={`${stats.totalSizeMb} MB`} color="var(--ink2)" />
          <StatBadge icon="🗑" label="Space freed" value={`${stats.freedSizeMb} MB`} color="var(--accent)" />
        </div>
      )}

      {/* TOOLBAR */}
      <div className="unsub-toolbar">
        <div className="filter-bar">
          {[
            { id: 'all', label: 'All' },
            { id: 'detected', label: 'Detected' },
            { id: 'queued', label: 'Queued' },
            { id: 'done', label: 'Done' },
            { id: 'failed', label: 'Failed' },
            { id: 'blocked', label: 'Ignored' },
          ].map(f => (
            <button key={f.id} className={`filter-btn${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}>
              {f.label}
              {stats && f.id !== 'all' && getFilterCount(f.id) > 0 && (
                <span className="filter-count">{getFilterCount(f.id)}</span>
              )}
            </button>
          ))}
        </div>

        <div className="toolbar-right" style={{ gap: 8, display: 'flex', alignItems: 'center' }}>
          <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="confidence">Sort: Confidence</option>
            <option value="size">Sort: Est. Size</option>
            <option value="count">Sort: Email Count</option>
          </select>
          {selected.size > 0 && (
            <button className="btn-ghost" onClick={queueSelected}>
              Queue {selected.size} selected →
            </button>
          )}
          {selected.size > 0 && (
            <button className="btn-ghost" onClick={removeSelected}>
              Remove {selected.size} selected ✕
            </button>
          )}
          {filtered.length > 0 && (
            <button className="btn-ghost" onClick={removeAllInFilter} disabled={removingAll}>
              {removingAll ? 'Removing…' : `Remove All In Filter (${filtered.length})`}
            </button>
          )}
          {filtered.some(s => s.status === 'detected' && s.unsub_method !== 'none') && (
            <button className="btn-ghost" onClick={queueAll}>Queue All →</button>
          )}
        </div>
      </div>

      {/* LIST */}
      <div className="unsub-list">
        {loading ? (
          <div className="unsub-empty">
            <div className="unsub-empty-icon">⏳</div>
            <div className="unsub-empty-title">Loading…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="unsub-empty">
            <div className="unsub-empty-icon">✉</div>
            <div className="unsub-empty-title">
              {senders.length === 0 ? 'No newsletters detected yet' : 'Nothing in this filter'}
            </div>
            <div className="unsub-empty-sub">
              {senders.length === 0
                ? 'Load some emails first, then click "Scan Inbox" to detect newsletters and promotional emails.'
                : 'Try switching the filter above.'}
            </div>
            {senders.length === 0 && (
              <button className="run-btn" onClick={scan} disabled={scanning} style={{ marginTop: 16 }}>
                {scanning ? 'Scanning…' : '🔍 Scan Inbox Now'}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Select-all header */}
            {filtered.some(s => ['detected', 'queued', 'blocked'].includes(s.status) && s.unsub_method !== 'none') && (
              <div className="unsub-select-row">
                <label className="checkbox-label" onClick={selectAll}>
                  <div className={`checkbox ${selected.size === filtered.filter(s => ['detected', 'queued', 'blocked'].includes(s.status) && s.unsub_method !== 'none').length ? 'checked' : ''}`}>
                    {selected.size > 0 && '✓'}
                  </div>
                  <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
                </label>
              </div>
            )}

            {filtered.map((sender, i) => (
              <SenderRow
                key={sender.id}
                sender={sender}
                selected={selected.has(sender.id)}
                firing={firingId === sender.id}
                index={i}
                onSelect={() => toggleSelect(sender.id)}
                onQueue={() => unsubApi.queueIds([sender.id]).then(load)}
                onFire={() => fireOne(sender.id)}
                onBlock={() => block(sender.id)}
                onRemove={() => remove(sender.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* TOAST */}
      {toast && (
        <div className={`unsub-toast ${toast.type || ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── SENDER ROW ──
function SenderRow({ sender, selected, firing, index, onSelect, onQueue, onFire, onBlock, onRemove }) {
  const [expanded, setExpanded] = useState(false)
  const meta = STATUS_META[sender.status] || STATUS_META.detected
  const canQueue = (sender.status === 'detected' || sender.status === 'blocked') && sender.unsub_method !== 'none'
  const canFire = (sender.status === 'queued' || sender.status === 'failed' || sender.status === 'blocked') && sender.unsub_url

  return (
    <div
      className={`sender-row${selected ? ' selected' : ''}${sender.status === 'done' ? ' done' : ''}`}
      style={{ animationDelay: `${index * 0.03}s` }}
    >
      <div className="sender-row-main" onClick={() => setExpanded(!expanded)}>
        {/* Checkbox */}
        {(sender.status === 'detected' || sender.status === 'queued' || sender.status === 'blocked') && (
          <div
            className={`checkbox ${selected ? 'checked' : ''}`}
            onClick={e => { e.stopPropagation(); onSelect() }}
          >
            {selected && '✓'}
          </div>
        )}
        {sender.status === 'done' && <div className="checkbox checked done-check">✓</div>}
        {['failed','blocked','processing'].includes(sender.status) && <div style={{ width: 22 }}></div>}

        {/* Avatar */}
        <div className="sender-avatar">
          {sender.domain.charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div className="sender-info">
          <div className="sender-name-row">
            <span className="sender-name">{sender.from_name}</span>
            <span className="sender-type-badge">{TYPE_ICON[sender.sender_type]} {sender.sender_type}</span>
          </div>
          <div className="sender-email">{sender.from_email}</div>
          <div className="sender-subject">{sender.sample_subject}</div>
        </div>

        {/* Stats */}
        <div className="sender-stats">
          <div className="sender-stat">
            <span className="sender-stat-val">{sender.email_count}</span>
            <span className="sender-stat-lbl">emails</span>
          </div>
          <div className="sender-stat">
            <span className="sender-stat-val">{formatKb(sender.total_size_kb)}</span>
            <span className="sender-stat-lbl">est. size</span>
          </div>
          <div className="sender-stat">
            <ConfidenceBar value={sender.confidence} />
            <span className="sender-stat-lbl">confidence</span>
          </div>
        </div>

        {/* Method badge */}
        <div className="sender-method">
          {sender.unsub_method !== 'none'
            ? <span className="method-badge found">🔗 {sender.unsub_method}</span>
            : <span className="method-badge missing">No link found</span>
          }
        </div>

        {/* Status */}
        <div className="sender-status">
          <span className="status-tag" style={{ color: meta.color, background: meta.bg }}>
            <span className="status-dot-sm" style={{ background: meta.dot }}></span>
            {firing ? 'Firing…' : meta.label}
          </span>
        </div>

        {/* Actions */}
        <div className="sender-actions" onClick={e => e.stopPropagation()}>
          {canQueue && (
            <button className="act-btn queue" onClick={onQueue} title="Add to queue">
              {sender.status === 'blocked' ? 'Unignore + Queue' : '+ Queue'}
            </button>
          )}
          {canFire && (
            <button className="act-btn fire" onClick={onFire} disabled={firing} title="Unsubscribe now">
              {firing ? <span className="spin-inline"></span> : '🚫 Unsub'}
            </button>
          )}
          {sender.status === 'done' && (
            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Done ✓</span>
          )}
          {sender.status === 'failed' && (
            <button className="act-btn retry" onClick={onFire} title="Retry">↺ Retry</button>
          )}
          <button className="act-btn ignore" onClick={onBlock} title="Ignore this sender">Ignore</button>
          <button className="act-btn remove" onClick={onRemove} title="Remove from list">✕</button>
        </div>

        <div className="expand-arrow">{expanded ? '▲' : '▼'}</div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="sender-detail">
          <div className="detail-grid">
            <div>
              <div className="detail-label">Domain</div>
              <div className="detail-val">{sender.domain}</div>
            </div>
            <div>
              <div className="detail-label">Last seen</div>
              <div className="detail-val">{new Date(sender.last_seen_at).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="detail-label">Unsub method</div>
              <div className="detail-val">{sender.unsub_method || 'none'}</div>
            </div>
            {sender.unsub_url && (
              <div style={{ gridColumn: '1/-1' }}>
                <div className="detail-label">Unsubscribe URL</div>
                <div className="detail-val url">{sender.unsub_url}</div>
              </div>
            )}
            {sender.error_msg && (
              <div style={{ gridColumn: '1/-1' }}>
                <div className="detail-label" style={{ color: 'var(--red)' }}>Last error</div>
                <div className="detail-val" style={{ color: 'var(--red)' }}>{sender.error_msg}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── HELPERS ──
function StatBadge({ icon, label, value, color }) {
  return (
    <div className="unsub-stat-badge">
      <div className="unsub-stat-val" style={{ color }}>{value}</div>
      <div className="unsub-stat-lbl">{icon} {label}</div>
    </div>
  )
}

function ConfidenceBar({ value }) {
  const color = value >= 70 ? 'var(--accent)' : value >= 40 ? 'var(--amber)' : 'var(--ink4)'
  return (
    <div className="conf-bar-wrap">
      <div className="conf-bar" style={{ width: `${value}%`, background: color }}></div>
      <span className="conf-val" style={{ color }}>{value}%</span>
    </div>
  )
}

function formatKb(kb) {
  if (!kb) return '—'
  if (kb < 1024) return `${kb} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
