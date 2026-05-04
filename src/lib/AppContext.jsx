// src/lib/AppContext.jsx
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

async function apiFetch(method, path, body = null) {
  const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Request failed')
  return data
}

export function AppProvider({ children }) {
  const [user, setUser]                   = useState(null)
  const [settings, setSettings]           = useState(null)
  const [gmailAccounts, setGmailAccounts] = useState([])
  const [authLoading, setAuthLoading]     = useState(true)
  const [emails, setEmails]               = useState([])
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [activeAccountId, setActiveAccountId] = useState('all')
  const [filter, setFilter]               = useState('all')
  const [selectedId, setSelectedId]       = useState(null)
  const [alert, setAlert]                 = useState(null)
  const [toast, setToast]                 = useState(null)
  const [fetchProgress, setFetchProgress] = useState(null)
  const [processingId, setProcessingId]   = useState(null)
  const [running, setRunning]             = useState(false)
  const sseRef = useRef(null)

  const showAlert = (type, msg) => setAlert({ type, msg })
  const clearAlert = () => setAlert(null)
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    apiFetch('GET', '/auth/me')
      .then(data => { setUser(data.user); setSettings(data.settings); setGmailAccounts(data.gmailAccounts || []) })
      .catch(() => {})
      .finally(() => setAuthLoading(false))
  }, [])

  const loadEmails = useCallback(async () => {
    if (!user) return
    setEmailsLoading(true)
    try {
      const data = await apiFetch('GET', '/emails')
      setEmails(data.emails || [])
    } catch (e) { showAlert('error', e.message) }
    finally { setEmailsLoading(false) }
  }, [user])

  useEffect(() => { if (user) loadEmails() }, [user])

  useEffect(() => {
    if (activeAccountId === 'all') return
    const exists = gmailAccounts.some(a => a.id === activeAccountId)
    if (!exists) setActiveAccountId('all')
  }, [gmailAccounts, activeAccountId])

  useEffect(() => {
    setSelectedId(null)
  }, [activeAccountId])

  const login = (userData, settingsData) => {
    setUser(userData); setSettings(settingsData)
    apiFetch('GET', '/auth/me').then(d => setGmailAccounts(d.gmailAccounts || [])).catch(() => {})
  }

  const logout = async () => {
    await apiFetch('POST', '/auth/logout').catch(() => {})
    setUser(null); setSettings(null); setGmailAccounts([]); setEmails([])
  }

  const refreshMe = useCallback(async () => {
    const data = await apiFetch('GET', '/auth/me')
    setUser(data.user); setSettings(data.settings); setGmailAccounts(data.gmailAccounts || [])
    return data
  }, [])

  const saveSettings = async (payload) => {
    const data = await apiFetch('PUT', '/settings', payload)
    await refreshMe()
    return data
  }

  const fetchEmailsSSE = useCallback((accountId, options = {}) => {
    return new Promise((resolve, reject) => {
      if (sseRef.current) sseRef.current.close()
      const params = new URLSearchParams({ accountId, query: options.query || 'in:inbox', maxEmails: String(options.maxEmails || 50) })
      const sse = new EventSource(`/api/realtime/fetch?${params}`, { withCredentials: true })
      sseRef.current = sse
      setFetchProgress({ percent: 0, inserted: 0, total: 0, status: 'Connecting…' })

      sse.addEventListener('status', e => {
        const d = JSON.parse(e.data)
        setFetchProgress(p => ({ ...p, status: d.message, total: d.count || p?.total || 0 }))
      })
      sse.addEventListener('progress', e => {
        const d = JSON.parse(e.data)
        setFetchProgress({ percent: d.percent, inserted: d.inserted, skipped: d.skipped, total: d.total, status: `Downloading… ${d.processed}/${d.total}` })
      })
      sse.addEventListener('done', e => {
        const d = JSON.parse(e.data)
        setFetchProgress({ percent: 100, ...d, status: 'Complete' })
        sse.close(); sseRef.current = null
        loadEmails(); refreshMe(); resolve(d)
      })
      sse.addEventListener('error', e => {
        const d = e.data ? JSON.parse(e.data) : { message: 'Connection error' }
        setFetchProgress(null); sse.close(); sseRef.current = null; reject(new Error(d.message))
      })
      sse.onerror = () => { setFetchProgress(null); sse.close(); sseRef.current = null; reject(new Error('SSE error')) }
    })
  }, [loadEmails, refreshMe])

  const runAgentSSE = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (sseRef.current) sseRef.current.close()
      if (!settings?.api_key_hint) { showAlert('error', 'No API key saved. Go to Settings first.'); return reject(new Error('No API key')) }
      const qs = activeAccountId && activeAccountId !== 'all'
        ? `?accountId=${encodeURIComponent(activeAccountId)}`
        : ''
      const sse = new EventSource(`/api/realtime/process${qs}`, { withCredentials: true })
      sseRef.current = sse
      setRunning(true)
      showAlert('processing', 'AI agent running…')

      sse.addEventListener('status', e => { const d = JSON.parse(e.data); showAlert('processing', d.message) })
      sse.addEventListener('processing', e => {
        const d = JSON.parse(e.data)
        setProcessingId(d.emailId)
        showAlert('processing', `Processing ${d.index}/${d.total}: "${d.subject}"`)
      })
      sse.addEventListener('result', e => {
        const d = JSON.parse(e.data)
        setEmails(prev => prev.map(em => em.id !== d.emailId ? em : { ...em, fields: d.fields, draft: d.hasDraft ? em.draft || '…' : null }))
        setProcessingId(null)
      })
      sse.addEventListener('done', e => {
        const d = JSON.parse(e.data)
        setRunning(false); setProcessingId(null); sse.close(); sseRef.current = null
        loadEmails()
        showAlert('success', `✓ Done! Processed ${d.processed} email${d.processed !== 1 ? 's' : ''}.`)
        resolve(d)
      })
      sse.addEventListener('error', e => {
        const d = e.data ? JSON.parse(e.data) : { message: 'Error' }
        setRunning(false); setProcessingId(null); sse.close(); sseRef.current = null
        showAlert('error', d.message); reject(new Error(d.message))
      })
      sse.onerror = () => { setRunning(false); sse.close(); sseRef.current = null; showAlert('error', 'Connection lost'); reject(new Error('SSE error')) }
    })
  }, [settings, loadEmails, activeAccountId])

  const scopedEmails = emails.filter(e => {
    if (activeAccountId === 'all') return true
    return e.account_id === activeAccountId
  })

  const filteredEmails = scopedEmails.filter(e => {
    if (filter === 'all') return true
    if (!e.fields) return filter === 'unprocessed'
    if (filter === 'extracted') return !!e.fields
    if (filter === 'action') return e.fields?.action_required === 'Yes' || e.fields?.priority === 'High'
    if (filter === 'draft') return !!e.draft && !e.draft_sent
    return true
  })

  const stats = {
    processed: scopedEmails.filter(e => !!e.fields).length,
    drafts: scopedEmails.filter(e => !!e.draft && !e.draft_sent).length,
    actions: scopedEmails.filter(e => e.fields?.action_required === 'Yes' || e.fields?.priority === 'High').length,
    logged: scopedEmails.filter(e => !!e.fields).length,
    total: scopedEmails.length,
  }

  const selectedEmail = filteredEmails.find(e => e.id === selectedId) || null

  const regenDraft = async (emailId) => {
    showToast('Regenerating…')
    await apiFetch('POST', '/process', { emailId, action: 'regen_draft' })
    await loadEmails(); showToast('New draft generated')
  }

  const markSent = async (emailId) => {
    await apiFetch('POST', '/process', { emailId, action: 'mark_sent' })
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, draft_sent: true } : e))
    showToast('Marked as sent')
  }

  const clearAll = async () => {
    await apiFetch('DELETE', '/emails')
    setEmails([]); setSelectedId(null); showToast('All emails cleared')
  }

  const deleteEmail = async (emailId) => {
    if (!emailId) return
    const data = await apiFetch('DELETE', `/emails?id=${encodeURIComponent(emailId)}&remote=trash`)
    setEmails(prev => prev.filter(e => e.id !== emailId))
    if (selectedId === emailId) setSelectedId(null)
    if (data.trashedRemote > 0) showToast('Email deleted and moved to Gmail Trash')
    else showToast('Email deleted from MailMind')
  }

  const deleteEmails = async (ids = []) => {
    const uniqIds = [...new Set((ids || []).filter(Boolean))]
    if (uniqIds.length === 0) return

    const data = await apiFetch('DELETE', `/emails?ids=${encodeURIComponent(uniqIds.join(','))}&remote=trash`)
    setEmails(prev => prev.filter(e => !uniqIds.includes(e.id)))
    if (selectedId && uniqIds.includes(selectedId)) setSelectedId(null)
    if (data.trashedRemote > 0) {
      showToast(`${uniqIds.length} email${uniqIds.length !== 1 ? 's' : ''} deleted, ${data.trashedRemote} moved to Gmail Trash`)
    } else {
      showToast(`${uniqIds.length} email${uniqIds.length !== 1 ? 's' : ''} deleted from MailMind`)
    }
  }

  const addEmails = async (items = []) => {
    if (!Array.isArray(items) || items.length === 0) return
    await apiFetch('POST', '/emails', { emails: items })
    await loadEmails()
    showToast(`Loaded ${items.length} sample email${items.length !== 1 ? 's' : ''}`)
  }

  const runAgent = async () => runAgentSSE()

  const exportCSV = async () => {
    try {
      const res = await fetch('/api/export', { method: 'GET', credentials: 'include' })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mailmind-export.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      showAlert('error', e.message || 'Export failed')
      throw e
    }
  }

  return (
    <AppContext.Provider value={{
      user, settings, gmailAccounts, setGmailAccounts, authLoading,
      login, logout, refreshMe, saveSettings,
      emails, filteredEmails, emailsLoading, loadEmails,
      loading: emailsLoading,
      regenDraft, markSent, clearAll, deleteEmail, deleteEmails,
      addEmails, runAgent, exportCSV,
      activeAccountId, setActiveAccountId,
      filter, setFilter,
      selectedId, setSelectedId, selectedEmail,
      stats,
      alert, showAlert, clearAlert,
      toast, showToast,
      running, processingId, fetchProgress, setFetchProgress,
      fetchEmailsSSE, runAgentSSE,
    }}>
      {children}
    </AppContext.Provider>
  )
}
