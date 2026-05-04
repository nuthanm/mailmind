// src/lib/samples.js
export const SAMPLE_EMAILS = [
  {
    from_name: 'Sarah K. — Acme Corp',
    from_email: 'sarah.k@acmecorp.com',
    subject: 'Re: Q2 Partnership Proposal',
    received_at: new Date().toISOString(),
    body: `Hi Rob,\n\nThanks for sending over the partnership proposal. Our team reviewed it and we're quite interested in moving forward. We do have a few follow-up questions:\n\n1. What's the implementation timeline you're envisioning for Phase 1?\n2. The pricing mentioned ($48,000/year) — is that all-inclusive or are there add-on costs?\n3. Can we schedule a call before May 10 to align on expectations?\n\nLooking forward to your thoughts.\n\nBest regards,\nSarah`
  },
  {
    from_name: 'First National Bank',
    from_email: 'noreply@fnbank.com',
    subject: 'Invoice #4821 — Payment Due May 15',
    received_at: new Date(Date.now() - 3600000).toISOString(),
    body: `Dear Customer,\n\nYour invoice #4821 for $3,250.00 is due on May 15, 2026.\n\nPlease log into your account portal to make a payment. Account ending: 7842. Amount due: $3,250.00. Due date: May 15, 2026.\n\nIf payment is not received by the due date, a late fee of $75 may be applied.\n\nThank you,\nFirst National Bank`
  },
  {
    from_name: 'Tom Martinez',
    from_email: 'tom@devteam.io',
    subject: 'Sprint 14 review — notes attached',
    received_at: new Date(Date.now() - 7200000).toISOString(),
    body: `Hey Rob,\n\nAttaching the Sprint 14 review notes. Key highlights:\n- Completed 18 out of 22 story points\n- Auth module fully tested and deployed to staging\n- 2 tickets moved to Sprint 15 (API rate limiting, mobile responsiveness)\n\nLet me know if you want to sync before EOD to discuss Sprint 15 planning. Free 3–5 PM.\n\nCheers,\nTom`
  },
  {
    from_name: 'HR Department',
    from_email: 'hr@company.com',
    subject: 'Action required: Benefits renewal by May 5',
    received_at: new Date(Date.now() - 86400000).toISOString(),
    body: `Hi Rob,\n\nThis is a reminder that your annual benefits enrollment window closes on May 5, 2026. You must complete enrollment to continue your current coverage.\n\nTo complete enrollment:\n1. Log into the HR portal at hr.company.com\n2. Navigate to "Benefits Enrollment 2026"\n3. Confirm your selections\n\nIf you miss this deadline, you will be auto-enrolled in the default plan.\n\nHR Team`
  },
  {
    from_name: 'Jane Doe',
    from_email: 'jane.doe@client.com',
    subject: 'Following up on our website proposal',
    received_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    body: `Hi Rob,\n\nJust following up on the email I sent last week regarding our website redesign proposal. I haven't heard back and wanted to make sure it didn't get lost!\n\nOur budget is around $15,000 and we'd love to kick off by June 1. The project involves a full redesign of our 8-page site with a new brand identity.\n\nAre you available for a 30-minute call this week or next?\n\nThanks,\nJane Doe\nMarketing Director`
  },
  {
    from_name: 'Morning Brew Newsletter',
    from_email: 'hello@morningbrew.com',
    subject: 'The AI week in review ☕',
    received_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    body: `Good morning!\n\nThis week in AI:\n• OpenAI launched real-time voice mode\n• Google announced Gemini Workspace integration\n• Meta open-sourced their vision model\n\nSPONSORED: Try Notion AI for your team.\n\nIn other news...\n\nUnsubscribe | Manage preferences`
  }
]

// Avatar colors by initial
const AVATAR_COLORS = {
  S: ['#fff0ee', '#c53030'], F: ['#fef9e8', '#92510a'],
  T: ['#f0faf4', '#15803d'], H: ['#fef2f2', '#991b1b'],
  J: ['#f5f5f5', '#52525b'], M: ['#eef4ff', '#1e40af'],
  A: ['#f0f4ff', '#3730a3'], R: ['#fdf4ff', '#7e22ce'],
  D: ['#fff7ed', '#c2410c'], N: ['#f0fdf4', '#166534'],
}

export function avatarColors(name) {
  const ch = (name || 'U').toUpperCase().charAt(0)
  return AVATAR_COLORS[ch] || ['#f5f5f5', '#52525b']
}

export function avatarInitials(name) {
  const parts = (name || 'U').split(/[\s—\-]+/)
  return parts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('')
}

export function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffH = (now - d) / 3600000
  if (diffH < 24) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffH < 48) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
