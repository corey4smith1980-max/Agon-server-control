import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Check, Clipboard, Clock3, Copy, Download, Headset, Plus, Search, ShieldCheck, UserCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupportSession } from '../lib/types'
import { cn, copyText, downloadText, openSessionLauncher, timeAgo } from '../lib/utils'
import { useAppStore } from '../store/AppStore'
import { Badge, Button, DetailRow, EmptyState, IconButton, Modal, PageHeader, Panel } from '../components/UI'
import { RemoteAccessGuide } from '../components/RemoteAccessGuide'

function RequestStatus({ status }: { status: SupportSession['status'] }) {
  const tone = status === 'active' || status === 'ended' ? 'green' : status === 'waiting' || status === 'consent_required' ? 'amber' : 'red'
  const label = status === 'active' ? 'Policy accepted' : status === 'waiting' ? 'Awaiting review' : status === 'consent_required' ? 'Consent required' : status === 'ended' ? 'Closed' : 'Declined'
  return <Badge tone={tone} dot>{label}</Badge>
}

function RequestDetails({ session, onClose }: { session: SupportSession; onClose: () => void }) {
  return <Modal open onClose={onClose} title="Support request" description="Consent and endpoint-policy request status only." size="md">
    <div className="p-6">
      <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4">
        <div className="flex flex-wrap items-center gap-2"><RequestStatus status={session.status} />{session.sample ? <Badge tone="violet">Simulated lab record</Badge> : <Badge tone="cyan">Relay record</Badge>}</div>
        <p className="mt-3 text-sm font-medium text-white">{session.deviceName}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">This request records whether endpoint policy or user consent permits support. It does not start a remote desktop connection.</p>
      </div>
      <div className="mt-5">
        <DetailRow label="Request code" value={<span className="font-mono">{session.code}</span>} />
        <DetailRow label="Customer" value={session.customer} />
        <DetailRow label="Endpoint" value={session.deviceName} />
        <DetailRow label="Access policy" value={session.access === 'interactive' ? 'Interactive consent required' : 'Unattended policy request'} />
        <DetailRow label="Request status" value={<RequestStatus status={session.status} />} />
        <DetailRow label="Relay" value={session.relay} />
        <DetailRow label="Requested" value={new Date(session.startedAt).toLocaleString()} />
      </div>
      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Request context</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">{session.issue}</p>
      </div>
      <p className="mt-5 rounded-lg bg-white/[0.025] p-3 text-[10px] leading-5 text-slate-500">Agon does not provide screen capture, keyboard or mouse control, or live chat transport.</p>
    </div>
  </Modal>
}

export default function Sessions() {
  const { sessions, updateSession, toast } = useAppStore()
  const [tab, setTab] = useState<'active' | 'waiting' | 'ended'>('active')
  const [query, setQuery] = useState('')
  const [consoleSession, setConsoleSession] = useState<SupportSession | null>(null)
  const filtered = useMemo(() => sessions.filter((session) => (tab === 'ended' ? session.status === 'ended' || session.status === 'declined' : session.status === tab) && `${session.customer} ${session.deviceName} ${session.code} ${session.issue}`.toLowerCase().includes(query.toLowerCase())), [sessions, tab, query])
  const copyCode = async (code: string) => { await copyText(code); toast('Session code copied', code) }
  const report = (session: SupportSession) => downloadText(JSON.stringify({ ...session, exportedAt: new Date().toISOString(), source: session.sample ? 'lab-workspace' : 'control-plane' }, null, 2), `${session.code}-session.json`, 'application/json')
  const counts = { active: sessions.filter((s) => s.status === 'active').length, waiting: sessions.filter((s) => s.status === 'waiting' || s.status === 'consent_required').length, ended: sessions.filter((s) => s.status === 'ended' || s.status === 'declined').length }

  return <div>
    <PageHeader eyebrow="Consent and policy requests" title="Support requests" description="Use the Windows connection options below for actual remote support. Agon requests only record endpoint policy or user approval." actions={<Button variant="primary" icon={Plus} onClick={() => openSessionLauncher()}>New support request</Button>} />
    <RemoteAccessGuide />
    <div className="mb-4 grid gap-3 sm:grid-cols-3">{[{ label: 'Accepted requests', value: counts.active, note: 'Request status only', icon: Activity, tone: 'text-lime-300' }, { label: 'Awaiting review', value: counts.waiting, note: 'Consent or policy pending', icon: Clock3, tone: 'text-amber-300' }, { label: 'Closed requests', value: counts.ended, note: 'Retained request records', icon: Check, tone: 'text-cyan-300' }].map((metric) => <Panel key={metric.label} className="flex items-center gap-4 p-4"><div className="rounded-xl bg-white/[0.035] p-3"><metric.icon size={19} className={metric.tone}/></div><div><p className="font-display text-2xl font-semibold text-white">{metric.value}</p><p className="text-[10px] text-slate-500">{metric.label} · {metric.note}</p></div></Panel>)}</div>
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex rounded-xl border border-white/[0.07] bg-black/10 p-1">{(['active', 'waiting', 'ended'] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={cn('rounded-lg px-4 py-2 text-[11px] font-medium capitalize transition', tab === value ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300')}>{value}<span className="ml-2 font-mono text-[9px] text-slate-600">{counts[value]}</span></button>)}</div><div className="relative sm:w-72"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/><input className="input pl-9" placeholder="Search sessions…" value={query} onChange={(event) => setQuery(event.target.value)}/></div></div>
      {filtered.length === 0 ? <EmptyState icon={Headset} title={`No ${tab} requests`} description={query ? 'No request matches your current search.' : tab === 'waiting' ? 'New support requests will appear here while consent or policy review is pending.' : 'Create a request to check whether endpoint policy allows support.'} action={<Button icon={Plus} onClick={() => openSessionLauncher()}>Create support request</Button>}/> : <div className="divide-y divide-white/[0.055]">{filtered.map((session, index) => <motion.article key={session.id} className="grid gap-4 p-5 transition hover:bg-white/[0.018] lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.4fr)_170px_auto] lg:items-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .04 }}>
        <div><div className="flex flex-wrap items-center gap-2"><button onClick={() => copyCode(session.code)} className="font-mono text-[10px] text-lime-300 hover:text-lime-200">{session.code}</button><RequestStatus status={session.status}/><Badge tone={session.sample ? 'violet' : 'cyan'}>{session.sample ? 'Simulated lab' : 'Relay'}</Badge></div><p className="mt-2 text-sm font-medium text-slate-200">{session.customer}</p><p className="mt-1 text-[10px] text-slate-600">{session.deviceName} · {session.access === 'interactive' ? 'Consent required' : 'Unattended policy'}</p></div>
        <div><p className="text-[11px] leading-5 text-slate-400">{session.issue}</p><p className="mt-1.5 text-[9px] text-slate-600">{session.technician} · started {timeAgo(session.startedAt)}</p></div>
        <div className="flex gap-6 lg:gap-4"><div><p className="font-mono text-[8px] uppercase tracking-wider text-slate-600">Requested</p><p className="mt-1.5 text-[11px] text-slate-300">{timeAgo(session.startedAt)}</p></div><div><p className="font-mono text-[8px] uppercase tracking-wider text-slate-600">Mode</p><p className="mt-1.5 text-[11px] capitalize text-slate-300">{session.access}</p></div></div>
        <div className="flex flex-wrap gap-2 lg:justify-end">{session.status === 'waiting' && <>{session.technician === 'Unassigned' && <Button size="sm" icon={UserCheck} onClick={() => { updateSession(session.id, { technician: 'Operator' }); toast('Request assigned', 'You are now the responsible technician.') }}>Assign to me</Button>}</>}{(session.status === 'ended' || session.status === 'declined') && <Button size="sm" icon={Download} onClick={() => report(session)}>Request report</Button>}<Button size="sm" onClick={() => setConsoleSession(session)}>Review request</Button><IconButton label="Copy request code" onClick={() => copyCode(session.code)}><Clipboard size={14}/></IconButton></div>
      </motion.article>)}</div>}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600"><span>{filtered.length} session{filtered.length === 1 ? '' : 's'}</span><span className="flex items-center gap-1.5"><ShieldCheck size={12}/>Consent events retained in audit log</span></div>
    </Panel>
    <AnimatePresence>{consoleSession && <RequestDetails session={sessions.find((item) => item.id === consoleSession.id) || consoleSession} onClose={() => setConsoleSession(null)}/>}</AnimatePresence>
  </div>
}
