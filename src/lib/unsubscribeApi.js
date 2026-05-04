// src/lib/unsubscribeApi.js
async function req(method, path, body = null) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'Request failed')
  return data
}

function withAccount(path, accountId) {
  if (!accountId || accountId === 'all') return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}accountId=${encodeURIComponent(accountId)}`
}

export const unsubApi = {
  list: (accountId = 'all') => req('GET', withAccount('/unsubscribe', accountId)),
  scan: (accountId = 'all') => req('POST', withAccount('/unsubscribe/scan', accountId)),
  queueAll: (accountId = 'all') => req('POST', withAccount('/unsubscribe/queue', accountId), { all: true }),
  queueIds: (ids) => req('POST', '/unsubscribe/queue', { ids }),
  fireOne: (id) => req('POST', '/unsubscribe/fire', { id }),
  fireAll: () => req('POST', '/unsubscribe/fire-all'),
  block: (id) => req('POST', '/unsubscribe/block', { id }),
  remove: (id) => req('DELETE', `/unsubscribe/${id}`),
}
