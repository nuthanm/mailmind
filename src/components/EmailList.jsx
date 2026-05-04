// src/components/EmailList.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/AppContext'
import { avatarColors, avatarInitials, fmtTime } from '../lib/samples'

export default function EmailList() {
  const {
    emails,
    filteredEmails,
    selectedId,
    setSelectedId,
    loading,
    running,
    deleteEmail,
    deleteEmails,
    activeAccountId,
    gmailAccounts,
    fetchEmailsSSE,
    fetchProgress,
    showAlert,
  } = useApp()
  const [senderGroups, setSenderGroups] = useState(new Set())
  const [senderMenuOpen, setSenderMenuOpen] = useState(false)
  const [sizeSort, setSizeSort] = useState('time_desc')
  const [minSizeKb, setMinSizeKb] = useState('0')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [deleteModal, setDeleteModal] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [expandingTop, setExpandingTop] = useState(false)
  const [expandedKey, setExpandedKey] = useState('')
  const uiLocked = deleting || expandingTop
  const senderMenuRef = useRef(null)

  const withTimeout = (promise, ms, label) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), ms)),
    ])
  }

  const scopedEmails = useMemo(() => {
    if (activeAccountId === 'all') return emails
    return emails.filter(e => e.account_id === activeAccountId)
  }, [emails, activeAccountId])

  const topMode = String(minSizeKb).startsWith('top_')
  const requestedTopCount = topMode ? (parseInt(String(minSizeKb).replace('top_', ''), 10) || 0) : 0

  const senderOptions = useMemo(() => {
    const unique = [...new Set(filteredEmails.map(e => e.from_email || e.from_name || 'Unknown'))]
    return unique.sort((a, b) => a.localeCompare(b))
  }, [filteredEmails])

  useEffect(() => {
    const onDocClick = (e) => {
      if (!senderMenuRef.current) return
      if (!senderMenuRef.current.contains(e.target)) setSenderMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const viewEmails = useMemo(() => {
    const topCount = topMode ? requestedTopCount : 0
    const threshold = topMode ? 0 : (Number(minSizeKb) || 0)
    // In Top mode, evaluate against all loaded emails in the active account, not only current quick filter.
    const source = topMode ? scopedEmails : filteredEmails
    const list = source
      .filter(e => estimateSizeKb(e) >= threshold)
      .slice()

    list.sort((a, b) => {
      if (topMode) return estimateSizeKb(b) - estimateSizeKb(a)
      if (sizeSort === 'size_desc') return estimateSizeKb(b) - estimateSizeKb(a)
      if (sizeSort === 'size_asc') return estimateSizeKb(a) - estimateSizeKb(b)
      return new Date(b.received_at || b.created_at || 0) - new Date(a.received_at || a.created_at || 0)
    })

    return topMode && topCount > 0 ? list.slice(0, topCount) : list
  }, [filteredEmails, scopedEmails, minSizeKb, sizeSort, topMode, requestedTopCount])

  const filteredSizeKb = useMemo(() => {
    return viewEmails.reduce((sum, e) => sum + estimateSizeKb(e), 0)
  }, [viewEmails])

  const topFilterInfo = useMemo(() => {
    if (!topMode) return { active: false, requested: 0 }
    return {
      active: true,
      requested: requestedTopCount,
    }
  }, [topMode, requestedTopCount])

  useEffect(() => {
    const needsMore = topMode && requestedTopCount > 0 && scopedEmails.length < requestedTopCount
    if (!needsMore || expandingTop || deleting) return
    const expansionId = `${activeAccountId}:${requestedTopCount}`
    if (expandedKey === expansionId) return

    const run = async () => {
      setExpandingTop(true)
      try {
        if (activeAccountId !== 'all') {
          // Pull more than requested so top-N by size has better coverage.
          const target = Math.min(2000, Math.max(requestedTopCount * 5, 500))
          await withTimeout(fetchEmailsSSE(activeAccountId, { query: 'in:inbox', maxEmails: target }), 120000, 'Top view fetch')
        } else {
          // For all-accounts view, expand each connected account once.
          const perAccount = Math.min(1000, Math.max(Math.ceil(requestedTopCount / Math.max(gmailAccounts.length, 1)) * 4, 250))
          for (const acc of gmailAccounts) {
            await withTimeout(fetchEmailsSSE(acc.id, { query: 'in:inbox', maxEmails: perAccount }), 120000, `Top view fetch for ${acc.email}`)
          }
        }
      } catch (e) {
        showAlert('error', e.message)
      } finally {
        setExpandedKey(expansionId)
        setExpandingTop(false)
      }
    }

    run()
  }, [
    activeAccountId,
    deleting,
    expandedKey,
    expandingTop,
    fetchEmailsSSE,
    gmailAccounts,
    requestedTopCount,
    scopedEmails.length,
    showAlert,
    topMode,
  ])

  const selectableBySender = useMemo(() => {
    if (senderGroups.size > 0) {
      return viewEmails.filter(e => senderGroups.has(e.from_email || e.from_name || 'Unknown'))
    }
    return viewEmails
  }, [viewEmails, senderGroups])

  const selectedSizeKb = useMemo(() => {
    return viewEmails
      .filter(e => selectedIds.has(e.id))
      .reduce((sum, e) => sum + estimateSizeKb(e), 0)
  }, [viewEmails, selectedIds])

  const selectSenderGroup = () => {
    if (uiLocked) return
    const ids = selectableBySender.map(e => e.id)
    setSelectedIds(new Set(ids))
  }

  const toggleSenderGroup = (sender) => {
    if (uiLocked) return
    setSenderGroups(prev => {
      const next = new Set(prev)
      if (next.has(sender)) next.delete(sender)
      else next.add(sender)
      return next
    })
  }

  const removeSenderGroup = (sender) => {
    if (uiLocked) return
    setSenderGroups(prev => {
      const next = new Set(prev)
      next.delete(sender)
      return next
    })
  }

  const clearSenderGroups = () => {
    if (uiLocked) return
    setSenderGroups(new Set())
  }

  const selectVisible = () => {
    if (uiLocked) return
    setSelectedIds(new Set(viewEmails.map(e => e.id)))
  }

  const deleteAllFromSender = () => {
    if (uiLocked) return
    if (senderGroups.size === 0 || selectableBySender.length === 0) return
    const ids = selectableBySender.map(e => e.id)
    const totalKb = selectableBySender.reduce((sum, e) => sum + estimateSizeKb(e), 0)
    const senderCount = senderGroups.size
    const senderLabel = senderCount === 1 ? [...senderGroups][0] : `${senderCount} senders`
    setSelectedIds(new Set(ids))
    setDeleteModal({
      ids,
      emails: selectableBySender,
      title: `Delete ${ids.length} Email${ids.length !== 1 ? 's' : ''} from ${senderLabel}?`,
      message: `All ${ids.length} email${ids.length !== 1 ? 's' : ''} from selected sender group${senderCount > 1 ? 's' : ''} will be removed. Gmail-linked emails will be moved to Gmail Trash.`,
      spaceKb: totalKb,
    })
  }

  const toggleSelected = (id) => {
    if (uiLocked) return
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => {
    if (uiLocked) return
    setSelectedIds(new Set())
  }

  const deleteOne = async (email) => {
    if (uiLocked) return
    setDeleteModal({
      ids: [email.id],
      emails: [email],
      title: 'Delete Email?',
      message: `Delete this email from ${email.from_name || email.from_email || 'sender'}? Gmail-linked emails will be moved to Gmail Trash.`,
      spaceKb: estimateSizeKb(email),
    })
  }

  const deleteSelected = () => {
    if (uiLocked) return
    const ids = [...selectedIds]
    if (ids.length === 0) return
    const emails = viewEmails.filter(e => selectedIds.has(e.id))
    setDeleteModal({
      ids,
      emails,
      title: `Delete ${ids.length} Selected Email${ids.length !== 1 ? 's' : ''}?`,
      message: 'All selected emails will be removed from MailMind. Gmail-linked emails will be moved to Gmail Trash.',
      spaceKb: selectedSizeKb,
    })
  }

  const deleteFiltered = () => {
    if (uiLocked || viewEmails.length === 0) return
    const ids = viewEmails.map(e => e.id)
    setSelectedIds(new Set(ids))
    setDeleteModal({
      ids,
      emails: viewEmails,
      title: `Delete ${ids.length} Filtered Email${ids.length !== 1 ? 's' : ''}?`,
      message: 'All emails in the current filter will be removed from MailMind. Gmail-linked emails will be moved to Gmail Trash.',
      spaceKb: filteredSizeKb,
    })
  }

  const confirmDelete = async () => {
    if (deleting || !deleteModal?.ids?.length) return
    const ids = deleteModal.ids
    setDeleteModal(null)

    setDeleting(true)
    try {
      if (ids.length === 1) {
        await deleteEmail(ids[0])
      } else {
        await deleteEmails(ids)
      }

      setSelectedIds(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return (
    <div className="email-list">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="email-card skeleton-card" style={{ animationDelay: `${i * 0.08}s` }}>
          <div className="skel" style={{ width: 34, height: 34, borderRadius: 8 }}></div>
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ width: '40%', height: 12, marginBottom: 6 }}></div>
            <div className="skel" style={{ width: '70%', height: 12, marginBottom: 6 }}></div>
            <div className="skel" style={{ width: '55%', height: 10 }}></div>
          </div>
        </div>
      ))}
    </div>
  )

  if (viewEmails.length === 0) return (
    <div className="email-list">
      <div className="email-controls">
        <div className="email-controls-left">
          <div className="sender-multi" ref={senderMenuRef}>
            <button className="sender-multi-btn" onClick={() => !uiLocked && setSenderMenuOpen(v => !v)} disabled={uiLocked}>
              {senderGroups.size === 0 ? 'Sender group: All senders' : `Senders selected: ${senderGroups.size}`}
            </button>
            {senderMenuOpen && (
              <div className="sender-multi-menu">
                <label className="sender-opt">
                  <input type="checkbox" checked={senderGroups.size === 0} onChange={clearSenderGroups} disabled={uiLocked} />
                  <span>All senders</span>
                </label>
                {senderOptions.map(s => (
                  <label key={s} className="sender-opt">
                    <input type="checkbox" checked={senderGroups.has(s)} onChange={() => toggleSenderGroup(s)} disabled={uiLocked} />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <select className="email-select" value={sizeSort} onChange={e => setSizeSort(e.target.value)}>
            <option value="time_desc">Sort: Newest first</option>
            <option value="size_desc">Sort: Size high to low</option>
            <option value="size_asc">Sort: Size low to high</option>
          </select>
          <select className="email-select" value={minSizeKb} onChange={e => setMinSizeKb(e.target.value)}>
            <option value="0">Min size: Any</option>
            <option value="10">Min size: 10 KB</option>
            <option value="25">Min size: 25 KB</option>
            <option value="50">Min size: 50 KB</option>
            <option value="top_10">Biggest emails: Top 10</option>
            <option value="top_25">Biggest emails: Top 25</option>
            <option value="top_50">Biggest emails: Top 50</option>
            <option value="top_100">Biggest emails: Top 100</option>
          </select>
        </div>
      </div>
      <div className="empty-state">
        <div className="empty-icon">✉</div>
        <div className="empty-title">No emails yet</div>
        <div className="empty-sub">No emails match the current filters. Try lowering the minimum size filter or load emails first.</div>
      </div>
    </div>
  )

  return (
    <div className={`email-list${deleting ? ' deleting' : ''}`}>
      {uiLocked && (
        <div className="delete-progress-top">
          <div className="spin-sm"></div>
          <span>
            {deleting
              ? 'Deleting emails. Actions are temporarily locked…'
              : `Loading more emails for Biggest view… ${fetchProgress?.status || ''}`}
          </span>
        </div>
      )}
      <div className="email-controls">
        <div className="email-controls-left">
          <div className="sender-multi" ref={senderMenuRef}>
            <button className="sender-multi-btn" onClick={() => !uiLocked && setSenderMenuOpen(v => !v)} disabled={uiLocked}>
              {senderGroups.size === 0 ? 'Sender group: All senders' : `Senders selected: ${senderGroups.size}`}
            </button>
            {senderMenuOpen && (
              <div className="sender-multi-menu">
                <label className="sender-opt">
                  <input type="checkbox" checked={senderGroups.size === 0} onChange={clearSenderGroups} disabled={uiLocked} />
                  <span>All senders</span>
                </label>
                {senderOptions.map(s => (
                  <label key={s} className="sender-opt">
                    <input type="checkbox" checked={senderGroups.has(s)} onChange={() => toggleSenderGroup(s)} disabled={uiLocked} />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn-ghost" onClick={selectSenderGroup} disabled={uiLocked || selectableBySender.length === 0}>Select Sender</button>
          {senderGroups.size > 0 && (
            <button className="btn-danger" onClick={deleteAllFromSender} disabled={uiLocked || selectableBySender.length === 0}>
              Delete Sender Group ({selectableBySender.length})
            </button>
          )}
          <button className="btn-ghost" onClick={selectVisible} disabled={uiLocked || viewEmails.length === 0}>Select Visible</button>
          <button className="btn-ghost" onClick={clearSelection} disabled={uiLocked || selectedIds.size === 0}>Clear</button>
          <select className="email-select" value={sizeSort} onChange={e => setSizeSort(e.target.value)} disabled={uiLocked}>
            <option value="time_desc">Sort: Newest first</option>
            <option value="size_desc">Sort: Size high to low</option>
            <option value="size_asc">Sort: Size low to high</option>
          </select>
          <select className="email-select" value={minSizeKb} onChange={e => setMinSizeKb(e.target.value)} disabled={uiLocked}>
            <option value="0">Min size: Any</option>
            <option value="10">Min size: 10 KB</option>
            <option value="25">Min size: 25 KB</option>
            <option value="50">Min size: 50 KB</option>
            <option value="top_10">Biggest emails: Top 10</option>
            <option value="top_25">Biggest emails: Top 25</option>
            <option value="top_50">Biggest emails: Top 50</option>
            <option value="top_100">Biggest emails: Top 100</option>
          </select>
        </div>
        <div className="email-controls-right">
          <span className="email-selected-count">Selected: {selectedIds.size}</span>
          <button className="btn-danger" onClick={deleteFiltered} disabled={uiLocked || viewEmails.length === 0}>
            Delete Filtered ({viewEmails.length})
          </button>
          <button className="btn-danger" onClick={deleteSelected} disabled={uiLocked || selectedIds.size === 0}>Delete Selected</button>
        </div>
      </div>

      <div className="email-status-strip">
        <span className="email-filter-size">Filtered size: {formatKb(filteredSizeKb)}</span>
        {senderGroups.size > 0 && (
          <div className="sender-chip-row">
            {[...senderGroups].map(s => (
              <span key={s} className="sender-chip">
                {s}
                <button className="sender-chip-x" onClick={() => removeSenderGroup(s)} disabled={uiLocked}>x</button>
              </span>
            ))}
          </div>
        )}
        {topFilterInfo.active && (
          <span className="email-filter-note">Biggest view: {viewEmails.length}/{topFilterInfo.requested}</span>
        )}
      </div>

      <div className={`email-list-content${uiLocked ? ' is-deleting' : ''}`}>
        {selectedIds.size > 0 && (
          <div className="email-selection-bar">
            <span>✓ <strong>{selectedIds.size}</strong> email{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <span className="sel-bar-sep">·</span>
            <span>Estimated space freed: <strong>{formatKb(selectedSizeKb)}</strong></span>
            <span className="sel-bar-sep">·</span>
            <button className="sel-bar-clear" onClick={clearSelection} disabled={uiLocked}>Clear selection</button>
          </div>
        )}
        {selectedIds.size === 0 && (
          <div className="email-controls-note">Tip: Pick a sender group, click Select Sender, uncheck any to keep, then Delete Selected.</div>
        )}

        {viewEmails.map((email, i) => (
          <EmailCard
            key={email.id}
            email={email}
            selected={selectedId === email.id}
            checked={selectedIds.has(email.id)}
            processing={running && !email.fields}
            disabled={uiLocked}
            index={i}
            onToggle={() => toggleSelected(email.id)}
            onDelete={() => deleteOne(email)}
            onClick={() => !uiLocked && setSelectedId(email.id)}
          />
        ))}
      </div>

      {deleteModal && (
        <div className="confirm-overlay">
          <div className="confirm-card">
            <div className="confirm-title">{deleteModal.title}</div>
            <div className="confirm-msg">{deleteModal.message}</div>
            {deleteModal.spaceKb > 0 && (
              <div className="confirm-space-badge">
                🗑 Estimated space freed: <strong>{formatKb(deleteModal.spaceKb)}</strong>
              </div>
            )}
            {deleteModal.emails && deleteModal.emails.length > 0 && (
              <div className="confirm-email-list">
                {deleteModal.emails.slice(0, 8).map(e => (
                  <div key={e.id} className="confirm-email-row">
                    <span className="confirm-email-sender">{e.from_name || e.from_email || 'Unknown'}</span>
                    <span className="confirm-email-subject">{e.subject || '(no subject)'}</span>
                    <span className="confirm-email-size">{formatKb(estimateSizeKb(e))}</span>
                  </div>
                ))}
                {deleteModal.emails.length > 8 && (
                  <div className="confirm-email-more">+{deleteModal.emails.length - 8} more email{deleteModal.emails.length - 8 !== 1 ? 's' : ''}</div>
                )}
              </div>
            )}
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setDeleteModal(null)} disabled={uiLocked}>Cancel</button>
              <button className="btn-danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EmailCard({ email, selected, checked, processing, disabled, index, onToggle, onDelete, onClick }) {
  const [bg, fg] = avatarColors(email.from_name)
  const initials = avatarInitials(email.from_name)
  const sizeKb = estimateSizeKb(email)

  const tags = []
  if (email.fields) {
    tags.push(<span key="ex" className="tag tag-success">✓ Extracted</span>)
    if (email.fields.priority === 'High') tags.push(<span key="hi" className="tag tag-danger">High priority</span>)
    else if (email.fields.action_required === 'Yes') tags.push(<span key="act" className="tag tag-warning">Action needed</span>)
    if (email.draft && !email.draft_sent) tags.push(<span key="dr" className="tag tag-info">Draft ready</span>)
    if (email.draft_sent) tags.push(<span key="sent" className="tag tag-muted">Sent ✓</span>)
  } else {
    tags.push(<span key="un" className="tag tag-muted">Pending</span>)
  }

  return (
    <div
      className={`email-card${selected ? ' selected' : ''}${processing ? ' processing' : ''}`}
      style={{ animationDelay: `${index * 0.04}s` }}
      onClick={onClick}
    >
      <div className="email-check-wrap" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled} />
      </div>
      <div className="em-avatar" style={{ background: bg, color: fg }}>{initials}</div>
      <div className="em-body">
        <div className="sender-name">{email.from_name}</div>
        <div className="em-subject">{email.subject}</div>
        <div className="em-preview">{email.body.substring(0, 90).replace(/\n/g, ' ')}…</div>
      </div>
      <div className="em-right">
        <div className="em-time">{fmtTime(email.received_at)}</div>
        <div className="em-size">{formatKb(sizeKb)}</div>
        <div className="em-tags">{tags}</div>
        <button className="email-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete() }} disabled={disabled}>Delete</button>
      </div>
    </div>
  )
}

function estimateSizeKb(email) {
  const text = `${email.subject || ''}\n${email.body || ''}`
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 1024))
}

function formatKb(kb) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}
