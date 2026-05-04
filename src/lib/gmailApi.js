// src/lib/gmailApi.js
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

function openConnectPopup() {
  const width = 540
  const height = 720
  const left = Math.max(0, Math.floor((window.screen.width - width) / 2))
  const top = Math.max(0, Math.floor((window.screen.height - height) / 2))
  return window.open(
    `/api/gmail/connect?app=${encodeURIComponent(window.location.origin)}`,
    'mailmind_gmail_connect',
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`
  )
}

export const gmailApi = {
  listAccounts: () => req('GET', '/gmail/accounts'),

  // Returns a URL to redirect to for OAuth
  getConnectUrl: () => {
    return `/api/gmail/connect?app=${encodeURIComponent(window.location.origin)}`
  },

  startConnect: () => {
    // The connect endpoint redirects to Google — just navigate there
    window.location.href = `/api/gmail/connect?app=${encodeURIComponent(window.location.origin)}`
  },

  startConnectPopup: () => new Promise((resolve, reject) => {
    const popup = openConnectPopup()
    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups and try again.'))
      return
    }

    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer)
        resolve({ connected: null, error: null, closed: true })
        return
      }

      try {
        const sameOrigin = popup.location.origin === window.location.origin
        if (!sameOrigin) return
        const params = new URLSearchParams(popup.location.search)
        const connected = params.get('gmail_connected')
        const error = params.get('gmail_error')
        if (!connected && !error) return

        window.clearInterval(timer)
        popup.close()
        resolve({ connected, error, closed: false })
      } catch {
        // Ignore cross-origin access until popup returns to app origin.
      }
    }, 400)
  }),

  fetchEmails: (accountId, options = {}) =>
    req('POST', '/gmail/fetch', { accountId, ...options }),

  getQuota: (accountId) =>
    req('GET', `/gmail/quota?accountId=${accountId}`),

  disconnect: (accountId) =>
    req('DELETE', `/gmail/disconnect/${accountId}`),
}

// Parse URL params after OAuth redirect
export function parseOAuthResult() {
  const params = new URLSearchParams(window.location.search)
  const connected = params.get('gmail_connected')
  const error = params.get('gmail_error')

  if (connected || error) {
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname)
    return { connected, error }
  }
  return null
}
