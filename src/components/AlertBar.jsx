// src/components/AlertBar.jsx
import { useApp } from '../lib/AppContext'

export default function AlertBar() {
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
