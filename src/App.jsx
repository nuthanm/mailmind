// src/App.jsx
import { useState, useEffect } from 'react'
import { AppProvider, useApp } from './lib/AppContext'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import HowItWorks from './pages/HowItWorks'
import Settings from './pages/Settings'
import Unsubscribe from './pages/Unsubscribe'
import Gmail from './pages/Gmail'
import Topbar from './components/Topbar'
import Toast from './components/Toast'
import './styles.css'
import './unsubscribe.css'
import './gmail.css'
import './auth.css'

function AppInner() {
  const [view, setView] = useState('gmail')
  const [showAiBanner, setShowAiBanner] = useState(() => !localStorage.getItem('ai_banner_dismissed'))
  const { user, authLoading, login, toast, settings, gmailAccounts } = useApp()

  // Once auth resolves, jump straight to Dashboard if Gmail already connected
  useEffect(() => {
    if (!authLoading && user && gmailAccounts.length > 0) {
      setView('dashboard')
    }
  }, [authLoading, user, gmailAccounts.length])

  if (authLoading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--off)' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, color:'var(--ink)', marginBottom:12 }}>MailMind</div>
        <div className="spin" style={{ margin:'0 auto', borderTopColor:'var(--ink)', borderColor:'var(--border)' }}></div>
      </div>
    </div>
  )

  if (!user) return <Auth onLogin={login} />

  const dismissBanner = () => {
    setShowAiBanner(false)
    localStorage.setItem('ai_banner_dismissed', '1')
  }

  return (
    <div className="shell">
      <Topbar view={view} setView={setView} />
      {showAiBanner && (
        <div className="ai-banner">
          <div className="ai-banner-msg">
            <span>⚠️</span>
            <span>
              MailMind uses <strong>{settings?.ai_provider === 'anthropic' ? 'Anthropic Claude' : 'OpenAI'}</strong> to read and analyse your emails.
              Email content is sent to the AI provider's servers for processing.
              Enable <strong>Strip PII</strong> in Settings to redact sensitive data before it leaves your account.
            </span>
          </div>
          <button className="ai-banner-close" onClick={dismissBanner} title="Dismiss">✕</button>
        </div>
      )}
      <div className="body-wrap">
        {view === 'gmail'       && <Gmail />}
        {view === 'dashboard'   && <Dashboard />}
        {view === 'unsubscribe' && <Unsubscribe />}
        {view === 'hiw'         && <HowItWorks />}
        {view === 'settings'    && <Settings />}
      </div>
      {toast && <Toast msg={toast} />}
    </div>
  )
}

export default function App() {
  return <AppProvider><AppInner /></AppProvider>
}
