import { motion } from 'framer-motion'
import { Activity, ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Download, MonitorSmartphone, Network, Plus, ShieldCheck, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { activitySeries } from '../lib/data'
import { cn, downloadText, openSessionLauncher, timeAgo, toCsv } from '../lib/utils'
import { useAppStore } from '../store/AppStore'
import { Badge, Button, PageHeader, Panel, PlatformIcon, SectionLink } from '../components/UI'

const container = { hidden: {}, show: { transition: { staggerChildren: 0.065 } } }
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } } }

function Metric({ label, value, note, icon: Icon, tone = 'lime' }: { label: string; value: string | number; note: string; icon: typeof Activity; tone?: 'lime' | 'cyan' | 'amber' | 'violet' }) {
  const colors = { lime: 'text-lime-300 bg-lime-300/[0.07]', cyan: 'text-cyan-300 bg-cyan-300/[0.07]', amber: 'text-amber-300 bg-amber-300/[0.07]', violet: 'text-violet-300 bg-violet-300/[0.07]' }
  return <motion.div variants={item}><Panel className="metric-glow p-5">
    <div className="relative z-10 flex items-start justify-between"><div><p className="text-[11px] font-medium text-slate-500">{label}</p><p className="mt-3 font-display text-[30px] font-semibold leading-none tracking-[-0.05em] text-white">{value}</p><p className="mt-3 text-[10px] text-slate-600">{note}</p></div><div className={cn('rounded-xl p-2.5', colors[tone])}><Icon size={18} strokeWidth={1.6} /></div></div>
  </Panel></motion.div>
}

function RelayMap() {
  const { relays, devices } = useAppStore()
  const navigate = useNavigate()
  const positions = [{ x: 140, y: 82 }, { x: 400, y: 48 }, { x: 662, y: 88 }, { x: 170, y: 255 }, { x: 634, y: 250 }]
  return <Panel className="subtle-grid relative min-h-[360px] overflow-hidden">
    <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between bg-gradient-to-b from-[#11171b] via-[#11171b]/80 to-transparent p-5 pb-10">
      <div><div className="flex items-center gap-2"><h2 className="font-display text-sm font-semibold text-white">Global relay fabric</h2><Badge tone="violet">Simulated topology</Badge></div><p className="mt-1 text-[11px] text-slate-500">Illustrative paths across {relays.length} configured or sample regions</p></div>
      <button onClick={() => navigate('/relay')} className="flex items-center gap-1 text-[10px] font-medium text-slate-400 transition hover:text-lime-300">Manage fabric<ArrowUpRight size={13} /></button>
    </div>
    <svg viewBox="0 0 800 330" className="h-[330px] w-full min-w-[580px]" role="img" aria-label="Relay topology connecting five regional nodes">
      <defs><radialGradient id="coreGlow"><stop offset="0" stopColor="#c3f36b" stopOpacity=".2"/><stop offset="1" stopColor="#c3f36b" stopOpacity="0"/></radialGradient><filter id="softGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <circle cx="400" cy="170" r="108" fill="url(#coreGlow)" />
      <circle cx="400" cy="170" r="72" fill="none" stroke="#c3f36b" strokeOpacity=".06" />
      <circle cx="400" cy="170" r="100" fill="none" stroke="#c3f36b" strokeOpacity=".035" />
      {relays.slice(0, 5).map((relay, index) => {
        const point = positions[index]
        return <g key={`line-${relay.id}`}><line x1="400" y1="170" x2={point.x} y2={point.y} stroke={relay.status === 'degraded' ? '#f2b84b' : '#86a95b'} strokeOpacity=".22" strokeWidth="1" className="route-line" /><circle r="2.3" fill={relay.status === 'degraded' ? '#f2b84b' : '#c3f36b'} filter="url(#softGlow)"><animateMotion dur={`${4.5 + index * 0.7}s`} repeatCount="indefinite" path={`M 400 170 L ${point.x} ${point.y}`} /></circle></g>
      })}
      <g transform="translate(400 170)"><circle r="43" fill="#111a18" stroke="#c3f36b" strokeOpacity=".28"/><circle r="34" fill="#c3f36b" fillOpacity=".06" stroke="#c3f36b" strokeOpacity=".12"/><path d="m-11-7 11-7 11 7v13L0 15-11 6V-7Z" fill="none" stroke="#c3f36b" strokeWidth="1.4"/><path d="m-11-7 11 7 11-7M0 0v15" fill="none" stroke="#c3f36b" strokeWidth="1.4"/><text y="62" textAnchor="middle" fill="#e7edf2" fontSize="11" fontFamily="Manrope" fontWeight="600">Control core</text><text y="78" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="IBM Plex Mono">POLICY · ROUTING · AUDIT</text></g>
      {relays.slice(0, 5).map((relay, index) => {
        const point = positions[index]
        const count = devices.filter((device) => device.relay === relay.id).length
        return <g key={relay.id} transform={`translate(${point.x} ${point.y})`} className="cursor-pointer" onClick={() => navigate('/relay')}>
          {relay.status === 'healthy' && <circle r="22" fill="none" stroke="#c3f36b" strokeOpacity=".2" className="pulse-ring"/>}
          <circle r="18" fill="#131c20" stroke={relay.status === 'degraded' ? '#f2b84b' : '#78955b'} strokeOpacity=".6"/>
          <circle r="4" fill={relay.status === 'degraded' ? '#f2b84b' : '#c3f36b'} />
          <text y="34" textAnchor="middle" fill="#cbd5e1" fontSize="10" fontFamily="IBM Plex Mono">{relay.id}</text>
          <text y="48" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="Inter">{count} devices · {relay.latency} ms</text>
        </g>
      })}
    </svg>
    <div className="pointer-events-none absolute bottom-4 left-5 flex items-center gap-4 font-mono text-[8px] uppercase tracking-wider text-slate-600"><span className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-lime-300"/>Encrypted WSS</span><span className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-amber-300"/>Degraded path</span></div>
  </Panel>
}

function ActivityChart() {
  const { sessions } = useAppStore()
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d')
  const [hovered, setHovered] = useState<number | null>(null)
  const data = useMemo(() => {
    if (range === '7d') return { labels: activitySeries.labels, support: activitySeries.support, access: activitySeries.access }
    const count = range === '24h' ? 12 : 15
    return {
      labels: Array.from({ length: count }, (_, index) => range === '24h' ? `${String(index * 2).padStart(2, '0')}:00` : `${index * 2 + 1} Oct`),
      support: Array.from({ length: count }, (_, index) => 8 + ((index * 7 + 13) % 25) + (range === '24h' ? sessions.filter((s) => s.status === 'active').length : 0)),
      access: Array.from({ length: count }, (_, index) => 5 + ((index * 5 + 8) % 19)),
    }
  }, [range, sessions])
  const width = 720, height = 240, left = 36, right = 16, top = 18, bottom = 32
  const max = Math.ceil(Math.max(...data.support, ...data.access) / 10) * 10 + 10
  const points = (values: number[]) => values.map((value, index) => ({ x: left + index * ((width - left - right) / (values.length - 1)), y: top + (height - top - bottom) * (1 - value / max), value }))
  const supportPoints = points(data.support), accessPoints = points(data.access)
  const path = (items: Array<{ x: number; y: number }>) => items.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  const active = hovered === null ? null : { support: supportPoints[hovered], access: accessPoints[hovered], label: data.labels[hovered] }
  return <Panel className="p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-sm font-semibold text-white">Request volume</h2><Badge tone="violet">Simulated trend</Badge></div><p className="mt-1 text-[11px] text-slate-500">Illustrative support-request and access-policy activity</p></div><div className="flex rounded-lg border border-white/[0.07] bg-black/10 p-0.5">{(['24h', '7d', '30d'] as const).map((value) => <button key={value} onClick={() => { setRange(value); setHovered(null) }} className={cn('rounded-md px-2.5 py-1.5 font-mono text-[9px] transition', range === value ? 'bg-white/[0.08] text-white' : 'text-slate-600 hover:text-slate-300')}>{value}</button>)}</div></div>
    <div className="mt-4 flex items-center gap-5 text-[10px] text-slate-500"><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-lime-300"/>Interactive support</span><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300"/>Unattended access</span></div>
    <div className="relative mt-2 overflow-x-auto scroll-area"><svg viewBox={`0 0 ${width} ${height}`} className="min-w-[560px]" onMouseLeave={() => setHovered(null)}>
      <defs><linearGradient id="supportArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c3f36b" stopOpacity=".13"/><stop offset="1" stopColor="#c3f36b" stopOpacity="0"/></linearGradient></defs>
      {[0, 1, 2, 3, 4].map((step) => { const y = top + step * ((height - top - bottom) / 4); return <g key={step}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#fff" strokeOpacity=".05"/><text x={left - 10} y={y + 3} textAnchor="end" fill="#53616c" fontSize="9" fontFamily="IBM Plex Mono">{Math.round(max * (1 - step / 4))}</text></g> })}
      <path d={`${path(supportPoints)} L ${supportPoints.at(-1)!.x} ${height - bottom} L ${left} ${height - bottom} Z`} fill="url(#supportArea)" />
      <motion.path d={path(supportPoints)} fill="none" stroke="#c3f36b" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: 'easeOut' }} />
      <motion.path d={path(accessPoints)} fill="none" stroke="#67e8f9" strokeOpacity=".8" strokeWidth="1.6" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
      {data.labels.map((label, index) => <text key={`${label}-${index}`} x={supportPoints[index].x} y={height - 10} textAnchor="middle" fill="#53616c" fontSize="8" fontFamily="IBM Plex Mono">{label}</text>)}
      {supportPoints.map((point, index) => <g key={index}><rect x={point.x - 16} y={top} width="32" height={height - top - bottom} fill="transparent" onMouseEnter={() => setHovered(index)} />{hovered === index && <><line x1={point.x} x2={point.x} y1={top} y2={height - bottom} stroke="#fff" strokeOpacity=".12" strokeDasharray="3 4"/><circle cx={point.x} cy={point.y} r="4" fill="#11171b" stroke="#c3f36b" strokeWidth="2"/><circle cx={accessPoints[index].x} cy={accessPoints[index].y} r="4" fill="#11171b" stroke="#67e8f9" strokeWidth="2"/></>}</g>)}
    </svg>{active && <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-xl border border-white/10 bg-[#1b2429] px-3 py-2 shadow-xl"><p className="font-mono text-[9px] text-slate-500">{active.label}</p><p className="mt-1 text-[10px] text-lime-300">{active.support.value} support · <span className="text-cyan-300">{active.access.value} access</span></p></div>}</div>
  </Panel>
}

export default function Overview() {
  const { devices, sessions, jobs, audit, relays, settings } = useAppStore()
  const navigate = useNavigate()
  const online = devices.filter((device) => device.status === 'online' || device.status === 'idle').length
  const active = sessions.filter((session) => session.status === 'active').length
  const attention = devices.filter((device) => device.status === 'attention' || device.agentVersion !== '1.0.0')
  const exportSnapshot = () => {
    downloadText(toCsv(devices.map((device) => ({ device: device.name, platform: device.os, group: device.group, status: device.status, relay: device.relay, agent: device.agentVersion, last_seen: device.lastSeen, source: device.sample ? 'simulated lab' : 'live relay' }))), `agon-fleet-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv')
  }
  return <motion.div variants={container} initial="hidden" animate="show">
    <PageHeader eyebrow="Operations overview · local snapshot" title="Fleet at a glance" description={`${settings.organization} operations. Seeded lab records are simulated; live devices appear only after synchronization with your relay.`} actions={<><Button icon={Download} onClick={exportSnapshot}>Export fleet</Button><Button variant="primary" icon={Plus} onClick={() => openSessionLauncher()}>New support request</Button></>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Reachable devices" value={`${online}/${devices.length}`} note={`${devices.filter((d) => d.status === 'offline').length} offline · ${devices.filter((d) => !d.sample).length} paired`} icon={MonitorSmartphone} />
      <Metric label="Accepted requests" value={active} note={`${sessions.filter((s) => s.status === 'waiting' || s.status === 'consent_required').length} requests awaiting consent or policy`} icon={Activity} tone="cyan" />
      <Metric label="Automation runs" value={jobs.length} note={`${jobs.filter((j) => j.status === 'completed').length} completed · ${jobs.filter((j) => j.status === 'failed').length} needs review`} icon={Workflow} tone="violet" />
      <Metric label="Relay regions" value={relays.length} note={`${relays.filter((r) => r.status === 'degraded').length} degraded · median ${Math.round(relays.reduce((sum, r) => sum + r.latency, 0) / Math.max(relays.length, 1))} ms`} icon={Network} tone="amber" />
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,.8fr)]">
      <motion.div variants={item}><RelayMap /></motion.div>
      <motion.div variants={item}><Panel className="flex h-full min-h-[360px] flex-col p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-display text-sm font-semibold text-white">Operations stream</h2><p className="mt-1 text-[11px] text-slate-500">Local console activity · seeded events are simulated</p></div><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-300 opacity-30"/><span className="relative h-2 w-2 rounded-full bg-lime-300"/></span></div>
        <div className="mt-5 flex-1 space-y-1">{audit.slice(0, 5).map((event, index) => <motion.button key={event.id} onClick={() => navigate('/audit')} className="group relative flex w-full gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-white/[0.025]" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .35 + index * .08 }}>
          <div className="relative flex w-5 justify-center"><span className={cn('relative z-10 mt-1.5 h-2 w-2 rounded-full border-2 border-[#11171b]', event.severity === 'critical' ? 'bg-rose-400' : event.severity === 'warning' ? 'bg-amber-300' : 'bg-lime-300')} />{index < 4 && <span className="absolute left-1/2 top-5 h-[calc(100%+4px)] w-px bg-white/[0.06]" />}</div>
          <div className="min-w-0 flex-1"><p className="truncate font-mono text-[10px] text-slate-300 transition group-hover:text-white">{event.action}</p><p className="mt-1 truncate text-[10px] text-slate-600">{event.target}</p><p className="mt-1.5 text-[9px] text-slate-700">{timeAgo(event.at)} · {event.actor}</p></div><ArrowUpRight size={12} className="mt-1 text-slate-700 transition group-hover:text-lime-300" />
        </motion.button>)}</div>
        <div className="mt-3 border-t border-white/[0.06] pt-3"><SectionLink onClick={() => navigate('/audit')}>Open detailed audit view</SectionLink></div>
      </Panel></motion.div>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.85fr)]">
      <motion.div variants={item}><ActivityChart /></motion.div>
      <motion.div variants={item}><Panel className="h-full p-5">
        <div className="flex items-center justify-between"><div><h2 className="font-display text-sm font-semibold text-white">Needs attention</h2><p className="mt-1 text-[11px] text-slate-500">Health and agent version exceptions</p></div><Badge tone="amber">{attention.length} open</Badge></div>
        <div className="mt-4 space-y-2">{attention.slice(0, 4).map((device) => <button key={device.id} onClick={() => navigate(`/devices/${device.id}`)} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.055] bg-white/[0.018] p-3 text-left transition hover:border-white/[0.11] hover:bg-white/[0.035]"><div className="rounded-lg bg-white/[0.04] p-2 text-slate-400"><PlatformIcon platform={device.platform} size={16} /></div><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-200">{device.name}</p><p className="mt-1 truncate text-[9px] text-slate-600">{device.agentVersion !== '1.0.0' ? `Agent ${device.agentVersion} · update available` : `${device.cpu}% CPU · ${device.memory}% memory`}</p></div><CircleAlert size={14} className={device.status === 'attention' ? 'text-amber-300' : 'text-slate-600'} /></button>)}</div>
        <div className="mt-4 grid grid-cols-2 gap-2"><Button size="sm" onClick={() => navigate('/devices')}>Review fleet</Button><Button size="sm" icon={ShieldCheck} onClick={() => navigate('/automation')}>Run diagnostics</Button></div>
      </Panel></motion.div>
    </div>
    <motion.div variants={item} className="mt-4 grid gap-4 md:grid-cols-3">
      {[{ icon: CheckCircle2, title: 'Consent by default', copy: `${devices.filter((d) => d.access === 'interactive').length} endpoints require local approval before every support session.` }, { icon: Clock3, title: 'Median support response', copy: '4m 12s across the current sample reporting window, within the 10 minute target.' }, { icon: ShieldCheck, title: 'Policy coverage', copy: `${Math.round(devices.filter((d) => d.agentVersion === '1.0.0').length / devices.length * 100)}% of the fleet is on the current signed agent protocol.` }].map((card) => <Panel key={card.title} className="flex gap-3 p-4"><card.icon size={17} className="mt-0.5 shrink-0 text-lime-300"/><div><p className="text-[11px] font-medium text-slate-200">{card.title}</p><p className="mt-1 text-[10px] leading-5 text-slate-500">{card.copy}</p></div></Panel>)}
    </motion.div>
  </motion.div>
}
