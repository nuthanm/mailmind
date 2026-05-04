// src/lib/api.js - All API calls go through here

const getSessionId = () => sessionStorage.getItem('mm_session_id')

async function request(method, path, body = null) {
  const sid = getSessionId()
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sid ? { 'X-Session-Id': sid } : {})
    }
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const api = {
  // Session
  createSession: () => request('POST', '/session'),
  getSession: () => request('GET', '/session'),
  updateSettings: (body) => request('PUT', '/session', body),
  deleteSession: () => request('DELETE', '/session'),

  // Emails
  listEmails: () => request('GET', '/emails'),
  addEmails: (emails) => request('POST', '/emails', { emails }),
  deleteEmail: (id) => request('DELETE', `/emails?id=${id}`),
  clearEmails: () => request('DELETE', '/emails'),

  // Processing
  processAll: () => request('POST', '/process', {}),
  processOne: (emailId) => request('POST', '/process', { emailId }),
  regenDraft: (emailId) => request('POST', '/process', { emailId, action: 'regen_draft' }),
  markSent: (emailId) => request('POST', '/process', { emailId, action: 'mark_sent' }),

  // Export
  exportCSV: () => {
    const sid = getSessionId()
    window.open(`/api/export?sid=${sid}`, '_blank')
  }
}

// Session bootstrap - runs on app load
export async function bootstrapSession() {
  let sid = sessionStorage.getItem('mm_session_id')
  if (!sid) {
    const data = await api.createSession()
    sid = data.sessionId
    sessionStorage.setItem('mm_session_id', sid)
    return { session: null, isNew: true }
  }
  try {
    const data = await api.getSession()
    return { session: data.session, isNew: false }
  } catch {
    // Session expired, create new
    sessionStorage.removeItem('mm_session_id')
    const data = await api.createSession()
    sessionStorage.setItem('mm_session_id', data.sessionId)
    return { session: null, isNew: true }
  }
}
