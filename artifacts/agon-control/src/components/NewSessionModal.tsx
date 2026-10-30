import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, Headset, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../store/AppStore'
import { copyText } from '../lib/utils'
import { Badge, Button, LoadingLabel, Modal } from './UI'

export function NewSessionModal() {
  const { devices, createSession, toast, canRequestUnattended, canStartSupportSessions } = useAppStore()
  const [open, setOpen] = useState(false)
  const [deviceId, setDeviceId] = useState('')
  const [customer, setCustomer] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [issue, setIssue] = useState('')
  const [access, setAccess] = useState<'interactive' | 'unattended'>('interactive')
  const [submitting, setSubmitting] = useState(false)
  const [createdCode, setCreatedCode] = useState('')
  const selected = devices.find((device) => device.id === deviceId)
  const unattendedAllowed = canRequestUnattended(selected?.id)

  useEffect(() => {
    if (access === 'unattended' && !unattendedAllowed) setAccess('interactive')
  }, [access, unattendedAllowed])

  useEffect(() => {
    const listener = (event: Event) => {
      const id = (event as CustomEvent<{ deviceId?: string }>).detail?.deviceId || ''
      setDeviceId(id)
      const device = devices.find((item) => item.id === id)
      setAccess('interactive')
      if (device) setCustomer(device.group)
      setCreatedCode('')
      setOpen(true)
    }
    window.addEventListener('agon:new-session', listener)
    return () => window.removeEventListener('agon:new-session', listener)
  }, [devices])

  const close = () => {
    setOpen(false)
    window.setTimeout(() => { setCreatedCode(''); setIssue(''); setCustomerEmail('') }, 250)
  }

  const chooseDevice = (id: string) => {
    setDeviceId(id)
    const device = devices.find((item) => item.id === id)
    if (device) { setAccess('interactive'); if (!customer) setCustomer(device.group) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const session = await createSession({ customer, customerEmail, deviceId: deviceId || undefined, issue, access, technician: 'Operator' })
      setCreatedCode(session.code)
    } catch (error) {
      toast('Could not create session', error instanceof Error ? error.message : 'Please try again', 'error')
    } finally { setSubmitting(false) }
  }

  const copyCode = async () => { await copyText(createdCode); toast('Session code copied', createdCode) }
  const copyInvite = async () => {
    const accessNotice = access === 'unattended'
      ? 'Unattended access requires organization policy and the opted-in endpoint package; the visible companion stays open.'
      : 'Interactive requests require endpoint user consent.'
    await copyText(`Agon support request\nRequest code: ${createdCode}\nTechnician: Operator\nUse your approved support channel to review this request. ${accessNotice}`)
    toast('Invitation copied', 'Share it with the customer through your trusted support channel.')
  }

  return <Modal open={open} onClose={close} title={createdCode ? 'Support request created' : 'Create support request'} description={createdCode ? 'Share the request code through a trusted channel.' : 'Interactive sessions require local approval. Unattended sessions require organization policy and explicit endpoint installer opt-in.'}>
    {createdCode ? <div className="p-6">
      <div className="subtle-grid relative overflow-hidden rounded-2xl border border-lime-300/15 bg-lime-300/[0.035] px-6 py-8 text-center">
        <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-lime-300 text-[#15200c]"><Check size={22} /></div>
        <p className="eyebrow mb-2">Request code</p>
        <button onClick={copyCode} className="font-mono text-2xl font-medium tracking-[0.08em] text-lime-200 transition hover:text-lime-100 sm:text-3xl">{createdCode}</button>
        <p className="mt-3 text-xs text-slate-500">Use your trusted support channel to coordinate customer consent.</p>
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-cyan-300" /><p className="text-xs leading-5 text-slate-400">{access === 'unattended' ? 'Organization policy and this endpoint’s installer opt-in authorized the unattended session. The visible desktop companion stays open and the session expires at its policy limit.' : 'The Windows companion presents a separate local approval prompt. Screen and input sharing begin only after the endpoint user approves. Secure sign-in and UAC desktops are not shared.'}</p></div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button onClick={close}>Done</Button><Button variant="primary" icon={Copy} onClick={copyInvite}>Copy invitation</Button></div>
    </div> : <form onSubmit={submit} className="space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="session-customer">Customer or organization</label><input id="session-customer" className="input" value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="e.g. Acme Corporation" required /></div>
        <div><label className="label" htmlFor="session-email">Customer email</label><input id="session-email" className="input" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="support@company.com" required /></div>
      </div>
      <div><label className="label" htmlFor="session-device">Target device</label><select id="session-device" className="input" value={deviceId} onChange={(event) => chooseDevice(event.target.value)}><option value="">Customer will join with a code</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.group}{device.sample ? ' · Lab' : ''}</option>)}</select></div>
      <div><label className="label" htmlFor="session-issue">Issue and intended work</label><textarea id="session-issue" className="input min-h-24" value={issue} onChange={(event) => setIssue(event.target.value)} placeholder="Describe what the customer needs help with…" required /></div>
      <div>
        <span className="label">Access mode</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setAccess('interactive')} className={`rounded-xl border p-4 text-left transition ${access === 'interactive' ? 'border-lime-300/40 bg-lime-300/[0.055]' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]'}`}><div className="flex items-center justify-between"><Headset size={18} className={access === 'interactive' ? 'text-lime-300' : 'text-slate-500'} />{access === 'interactive' && <Badge tone="green">Selected</Badge>}</div><p className="mt-3 text-sm font-medium text-white">Interactive</p><p className="mt-1 text-xs leading-5 text-slate-500">Endpoint user approves each session.</p></button>
           <button type="button" disabled={!unattendedAllowed} onClick={() => setAccess('unattended')} className={`rounded-xl border p-4 text-left transition ${access === 'unattended' ? 'border-amber-300/40 bg-amber-300/[0.055]' : 'border-white/[0.07] bg-white/[0.02]'} ${unattendedAllowed ? 'hover:bg-white/[0.04]' : 'cursor-not-allowed opacity-60'}`}><div className="flex items-center justify-between"><ShieldCheck size={18} className={access === 'unattended' ? 'text-amber-300' : 'text-slate-500'} />{access === 'unattended' ? <Badge tone="amber">Selected</Badge> : <Badge tone={unattendedAllowed ? 'green' : 'neutral'}>{unattendedAllowed ? 'Policy ready' : 'Not authorized'}</Badge>}</div><p className="mt-3 text-sm font-medium text-white">Unattended</p><p className="mt-1 text-xs leading-5 text-slate-500">{unattendedAllowed ? 'Organization role, device group, and installer opt-in are allowed.' : 'Requires an opted-in endpoint and an organization policy for your role and device group.'}</p></button>
        </div>
      </div>
       {!canStartSupportSessions && <p className="text-xs text-amber-300">Your auditor role is read-only and cannot create support sessions.</p>}
       <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] pt-5"><Button type="button" onClick={close}>Cancel</Button><Button type="submit" variant="primary" disabled={submitting || !canStartSupportSessions}>{submitting ? <LoadingLabel>Creating</LoadingLabel> : 'Create request'}</Button></div>
    </form>}
  </Modal>
}
