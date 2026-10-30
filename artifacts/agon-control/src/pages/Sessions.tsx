import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Check, Clipboard, Clock3, Download, Headset, LoaderCircle, Plus, Search, ShieldCheck, Wifi } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupportSession } from '../lib/types'
import { artifactPath, cn, copyText, downloadText, openSessionLauncher, timeAgo } from '../lib/utils'
import { useAppStore } from '../store/AppStore'
import { Badge, Button, EmptyState, IconButton, Modal, PageHeader, Panel } from '../components/UI'
import DesktopConsole from '../components/DesktopConsole'

function RequestStatus({ status }: { status: SupportSession['status'] }) {
  const tone = status === 'active' || status === 'ended' ? 'green' : status === 'waiting' || status === 'consent_required' ? 'amber' : status === 'disconnected' ? 'red' : 'neutral'
  const label = status === 'active' ? 'Live desktop' : status === 'waiting' ? 'Awaiting consent' : status === 'consent_required' ? 'Consent required' : status === 'disconnected' ? 'Endpoint disconnected' : status === 'ended' ? 'Closed' : 'Declined'
  return <Badge tone={tone} dot>{label}</Badge>
}

export default function Sessions() {
  const { sessions, connectSession, endSession, syncControlPlane, toast } = useAppStore()
  const [tab, setTab] = useState<'active' | 'waiting' | 'ended'>('active')
  const [query, setQuery] = useState('')
  const [consoleSession, setConsoleSession] = useState<{ session: SupportSession; websocketUrl: string } | null>(null)
  const [connectingId, setConnectingId] = useState('')
  const filtered = useMemo(() => sessions.filter((session) => {
    const matchesTab = tab === 'ended'
      ? session.status === 'ended' || session.status === 'declined'
      : tab === 'waiting'
        ? session.status === 'waiting' || session.status === 'consent_required' || session.status === 'disconnected'
        : session.status === 'active'
    return matchesTab && `${session.customer} ${session.deviceName} ${session.code} ${session.issue}`.toLowerCase().includes(query.toLowerCase())
  }), [sessions, tab, query])
  const copyCode = async (code: string) => { await copyText(code); toast('Session code copied', code) }
  const report = (session: SupportSession) => downloadText(JSON.stringify({ ...session, exportedAt: new Date().toISOString(), source: session.sample ? 'lab-workspace' : 'control-plane' }, null, 2), `${session.code}-session.json`, 'application/json')
  const counts = {
    active: sessions.filter((s) => s.status === 'active').length,
    waiting: sessions.filter((s) => s.status === 'waiting' || s.status === 'consent_required' || s.status === 'disconnected').length,
    ended: sessions.filter((s) => s.status === 'ended' || s.status === 'declined').length,
  }
  const startConnection = async (session: SupportSession) => {
    if (!session.deviceId || session.sample) return
    setConnectingId(session.id)
    try {
      const { viewerToken } = await connectSession(session.id)
      const url = new URL(artifactPath('api/agon/viewer'), window.location.href)
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('sessionId', session.id)
      url.searchParams.set('token', viewerToken)
      setConsoleSession({ session, websocketUrl: url.toString() })
    } catch (error) {
      toast('Could not start desktop session', error instanceof Error ? error.message : 'Check the agent and relay connection.', 'error')
    } finally {
      setConnectingId('')
    }
  }
  const endConsoleSession = async () => {
    if (!consoleSession) return
    await endSession(consoleSession.session.id)
    setConsoleSession(null)
    await syncControlPlane(true)
    toast('Desktop session ended', 'The endpoint companion has been told to stop sharing.')
  }
  const closeConsoleSession = () => {
    void endConsoleSession().catch((error) => toast('Could not end desktop session', error instanceof Error ? error.message : 'Retry ending the session.', 'error'))
  }

  return <div>
    <PageHeader eyebrow="Live support" title="Remote sessions" description="Start a consent-gated live desktop session through the Agon relay. The Windows companion shows a local approval prompt before any screen or input is shared." actions={<Button variant="primary" icon={Plus} onClick={() => openSessionLauncher()}>New support request</Button>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-3">{[{ label: 'Live sessions', value: counts.active, note: 'Approved at the endpoint', icon: Wifi, tone: 'text-lime-300' }, { label: 'Awaiting consent', value: counts.waiting, note: 'Pending or disconnected', icon: Clock3, tone: 'text-amber-300' }, { label: 'Closed sessions', value: counts.ended, note: 'Retained in audit history', icon: Check, tone: 'text-cyan-300' }].map((metric) => <Panel key={metric.label} className="flex items-center gap-4 p-4"><div className="rounded-xl bg-white/[0.035] p-3"><metric.icon size={19} className={metric.tone}/></div><div><p className="font-display text-2xl font-semibold text-white">{metric.value}</p><p className="text-[10px] text-slate-500">{metric.label} · {metric.note}</p></div></Panel>)}</div>
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex rounded-xl border border-white/[0.07] bg-black/10 p-1">{(['active', 'waiting', 'ended'] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={cn('rounded-lg px-4 py-2 text-[11px] font-medium capitalize transition', tab === value ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300')} data-testid={`tab-sessions-${value}`}>{value}<span className="ml-2 font-mono text-[9px] text-slate-600">{counts[value]}</span></button>)}</div><div className="relative sm:w-72"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/><input className="input pl-9" placeholder="Search sessions…" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-search-sessions"/></div></div>
      {filtered.length === 0 ? <EmptyState icon={Headset} title={`No ${tab} sessions`} description={query ? 'No session matches your current search.' : tab === 'waiting' ? 'New requests will appear here while the endpoint user reviews consent.' : 'Create a support request for a managed endpoint.'} action={<Button icon={Plus} onClick={() => openSessionLauncher()}>Create support request</Button>}/> : <div className="divide-y divide-white/[0.055]">{filtered.map((session, index) => <motion.article key={session.id} className="grid gap-4 p-5 transition hover:bg-white/[0.018] lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.4fr)_170px_auto] lg:items-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .04 }} data-testid={`row-session-${session.id}`}>
        <div><div className="flex flex-wrap items-center gap-2"><button onClick={() => copyCode(session.code)} className="font-mono text-[10px] text-lime-300 hover:text-lime-200" data-testid={`button-copy-session-code-${session.id}`}>{session.code}</button><RequestStatus status={session.status}/><Badge tone={session.sample ? 'violet' : 'cyan'}>{session.sample ? 'Simulated lab' : 'Managed endpoint'}</Badge></div><p className="mt-2 text-sm font-medium text-slate-200">{session.customer}</p><p className="mt-1 text-[10px] text-slate-600">{session.deviceName} · {session.access === 'interactive' ? 'Local consent required' : 'Organization policy + installer opt-in'}</p></div>
        <div><p className="text-[11px] leading-5 text-slate-400">{session.issue}</p><p className="mt-1.5 text-[9px] text-slate-600">{session.technician} · requested {timeAgo(session.startedAt)}</p></div>
        <div className="flex gap-6 lg:gap-4"><div><p className="font-mono text-[8px] uppercase tracking-wider text-slate-600">Requested</p><p className="mt-1.5 text-[11px] text-slate-300">{timeAgo(session.startedAt)}</p></div><div><p className="font-mono text-[8px] uppercase tracking-wider text-slate-600">Relay</p><p className="mt-1.5 text-[11px] text-slate-300">{session.relay}</p></div></div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {(session.status === 'waiting' || session.status === 'consent_required' || session.status === 'disconnected') && session.deviceId && !session.sample && <Button size="sm" variant="primary" icon={connectingId === session.id ? LoaderCircle : Wifi} disabled={Boolean(connectingId)} onClick={() => void startConnection(session)} data-testid={`button-connect-session-${session.id}`}>{connectingId === session.id ? 'Requesting consent…' : 'Connect to desktop'}</Button>}
          {(session.status === 'ended' || session.status === 'declined') && <Button size="sm" icon={Download} onClick={() => report(session)} data-testid={`button-export-session-${session.id}`}>Export record</Button>}
          {session.status === 'active' && session.deviceId && !session.sample && <Button size="sm" icon={Wifi} onClick={() => void startConnection(session)} disabled={Boolean(connectingId)} data-testid={`button-reconnect-session-${session.id}`}>Reconnect with consent</Button>}
          <IconButton label="Copy request code" onClick={() => copyCode(session.code)} data-testid={`button-copy-session-${session.id}`}><Clipboard size={14}/></IconButton>
        </div>
      </motion.article>)}</div>}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600"><span>{filtered.length} session{filtered.length === 1 ? '' : 's'}</span><span className="flex items-center gap-1.5"><ShieldCheck size={12}/>Consent decisions retained in audit history</span></div>
    </Panel>
    <AnimatePresence>{consoleSession && <Modal open onClose={closeConsoleSession} title="Live desktop support" description="The endpoint shows a separate local consent prompt before screen sharing or input is enabled." size="xl">
      <div className="p-4 sm:p-6"><DesktopConsole
        sessionId={consoleSession.session.id}
        deviceName={consoleSession.session.deviceName}
        sessionCode={consoleSession.session.code}
        websocketUrl={consoleSession.websocketUrl}
        onEnd={endConsoleSession}
      /></div>
    </Modal>}</AnimatePresence>
  </div>
}
