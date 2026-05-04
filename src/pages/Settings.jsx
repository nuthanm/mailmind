// src/pages/Settings.jsx
import { useState } from 'react'
import { useApp } from '../lib/AppContext'

const OPENAI_MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', sub: 'Fast & affordable — great for extraction' },
  { id: 'gpt-4o', label: 'GPT-4o', sub: 'Flagship multimodal — strong reasoning' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', sub: 'Latest efficient model — fast & cheap' },
  { id: 'gpt-4.1', label: 'GPT-4.1', sub: 'Latest flagship — most capable OpenAI' },
]

const ANTHROPIC_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', sub: 'Fastest & most affordable' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', sub: 'Balanced — great performance/cost' },
  { id: 'claude-opus-4-5-20251001', label: 'Claude Opus 4.5', sub: 'Most powerful Anthropic model' },
]

export default function Settings() {
  const { settings, saveSettings: saveSettingsCtx, clearAll, logout, showToast, showAlert } = useApp()

  const [provider, setProvider] = useState(settings?.ai_provider || 'openai')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings?.selected_model || 'gpt-4o-mini')
  const [stylePrompt, setStylePrompt] = useState(settings?.style_prompt || '')
  const [generateDrafts, setGenerateDrafts] = useState(settings?.generate_drafts !== false)
  const [stripPii, setStripPii] = useState(settings?.strip_pii !== false)
  const [saving, setSaving] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)

  const models = provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS

  const saveSettings = async () => {
    setSaving(true)
    try {
      const body = {
        aiProvider: provider,
        selectedModel: model,
        stylePrompt,
        generateDrafts,
        stripPii,
      }
      if (apiKey.trim()) body.apiKey = apiKey.trim()

      await saveSettingsCtx(body)
      setApiKey('')
      showToast('Settings saved')
    } catch (e) {
      showAlert('error', e.message)
    } finally {
      setSaving(false)
    }
  }

  const clearData = async () => {
    if (!window.confirm('Delete all emails and extracted data for this session?')) return
    await clearAll()
    showToast('All data cleared')
  }

  const deleteSession = async () => {
    if (!window.confirm('Log out from this device?')) return
    await logout()
    window.location.reload()
  }

  return (
    <div className="settings-view">
      <div className="settings-inner">
        <div className="settings-title">Settings</div>
        <div className="settings-sub">Configure your AI Email Agent</div>

        {/* AI PROVIDER */}
        <div className="settings-section">
          <div className="settings-sec-head">AI Provider</div>
          <div className="provider-select">
            <div
              className={`provider-card${provider === 'openai' ? ' selected' : ''}`}
              onClick={() => { setProvider('openai'); setModel('gpt-4o-mini') }}
            >
              <div className="provider-logo openai">OAI</div>
              <div>
                <div className="provider-name">OpenAI</div>
                <div className="provider-sub">GPT-4o, GPT-4o Mini</div>
              </div>
              {provider === 'openai' && <div className="provider-check">✓</div>}
            </div>
            <div
              className={`provider-card${provider === 'anthropic' ? ' selected' : ''}`}
              onClick={() => { setProvider('anthropic'); setModel('claude-haiku-4-5-20251001') }}
            >
              <div className="provider-logo anthropic">ANT</div>
              <div>
                <div className="provider-name">Anthropic</div>
                <div className="provider-sub">Claude Haiku, Sonnet</div>
              </div>
              {provider === 'anthropic' && <div className="provider-check">✓</div>}
            </div>
          </div>
        </div>

        {/* API KEY */}
        <div className="settings-section">
          <div className="settings-sec-head">API Key — {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}</div>
          <div style={{ padding: '14px 16px' }}>
            {settings?.api_key_hint && provider === settings?.ai_provider && (
              <div className="key-hint">
                Current key: <strong>{settings.api_key_hint}</strong>
                <span style={{ color: 'var(--ink3)', marginLeft: 8, fontSize: 11 }}>Enter a new key below to replace</span>
              </div>
            )}
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input
                type={keyVisible ? 'text' : 'password'}
                className="form-input"
                placeholder={provider === 'anthropic' ? 'sk-ant-api03-…' : 'sk-proj-…'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                style={{ width: '100%', paddingRight: 40 }}
              />
              <button
                onClick={() => setKeyVisible(!keyVisible)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--ink3)' }}
              >
                {keyVisible ? '🙈' : '👁'}
              </button>
            </div>
            <div className="privacy-note">
              🔒 Your API key is encrypted with AES-256-GCM and stored in Neon DB. It is never returned to the browser in full — only the last 4 characters are shown. All AI calls happen server-side.
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8 }}>
              {provider === 'anthropic'
                ? 'Get your key at console.anthropic.com → API Keys'
                : 'Get your key at platform.openai.com → API Keys'}
            </div>
          </div>
        </div>

        {/* MODEL */}
        <div className="settings-section">
          <div className="settings-sec-head">Model</div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map(m => (
              <label key={m.id} className={`model-row${model === m.id ? ' selected' : ''}`} onClick={() => setModel(m.id)}>
                <div className="model-radio">{model === m.id ? '●' : '○'}</div>
                <div>
                  <div className="model-name">{m.label}</div>
                  <div className="model-sub">{m.sub}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* BEHAVIOUR */}
        <div className="settings-section">
          <div className="settings-sec-head">Agent Behaviour</div>
          <ToggleRow
            label="Generate draft replies"
            sub="AI drafts a reply for emails that need a response. You always approve before sending."
            value={generateDrafts}
            onChange={setGenerateDrafts}
          />
          <ToggleRow
            label="Strip PII before sending to AI"
            sub="Account numbers, phone numbers, PAN, Aadhaar are redacted before the email reaches the AI."
            value={stripPii}
            onChange={setStripPii}
          />
        </div>

        {/* WRITING STYLE */}
        <div className="settings-section">
          <div className="settings-sec-head">Your Writing Style</div>
          <div style={{ padding: '14px 16px' }}>
            <textarea
              className="form-input form-textarea"
              placeholder="e.g. I write in a friendly but professional tone. I keep replies concise. I always end with a clear next step."
              value={stylePrompt}
              onChange={e => setStylePrompt(e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
              Added to every draft prompt to match your voice.
            </div>
          </div>
        </div>

        {/* SAVE */}
        <button className="btn-primary save-btn" onClick={saveSettings} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>

        {/* DANGER */}
        <div className="settings-section" style={{ marginTop: 24, borderColor: '#fee2e2' }}>
          <div className="settings-sec-head" style={{ color: 'var(--red)' }}>Danger Zone</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Clear all email data</div>
              <div className="settings-row-sub">Removes all emails and processed results from this session</div>
            </div>
            <button className="btn-ghost" onClick={clearData} style={{ fontSize: 12, borderColor: '#fecaca', color: 'var(--red)' }}>Clear</button>
          </div>
          <div className="settings-row" style={{ borderBottom: 'none' }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Delete session</div>
              <div className="settings-row-sub">Permanently deletes this session, API key, and all data from Neon DB</div>
            </div>
            <button className="btn-ghost" onClick={deleteSession} style={{ fontSize: 12, borderColor: '#fecaca', color: 'var(--red)' }}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, sub, value, onChange }) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-sub">{sub}</div>
      </div>
      <button className={`toggle${value ? ' on' : ''}`} onClick={() => onChange(!value)}></button>
    </div>
  )
}
