import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, ChevronRight, CircleAlert, Download, FileJson, Filter, Fingerprint, KeyRound, ScrollText, Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AuditEvent } from '../lib/types'
import { cn, downloadText, formatDateTime, timeAgo, toCsv } from '../lib/utils'
import { useAppStore } from '../store/AppStore'
import { Badge, Button, DetailRow, Drawer, EmptyState, PageHeader, Panel } from '../components/UI'

const severityTone = (severity: AuditEvent['severity']) => severity === 'critical' ? 'red' : severity === 'warning' ? 'amber' : severity === 'success' ? 'green' : 'cyan'

async function digest(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default function AuditLog() {
  const { audit, toast } = useAppStore()
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState('all')
  const [category, setCategory] = useState('all')
  const [range, setRange] = useState('all')
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const [now] = useState(() => Date.now())
  const filtered = useMemo(() => audit.filter((event) => {
    const age = now - new Date(event.at).getTime()
    return `${event.action} ${event.actor} ${event.target} ${event.detail} ${event.ip}`.toLowerCase().includes(query.toLowerCase()) && (severity === 'all' || event.severity === severity) && (category === 'all' || event.category === category) && (range === 'all' || age <= Number(range) * 86400000)
  }), [audit, query, severity, category, range, now])
  const exportCsv = () => downloadText(toCsv(filtered.map((event) => ({ id: event.id, timestamp: event.at, action: event.action, actor: event.actor, target: event.target, category: event.category, severity: event.severity, source: event.id.startsWith('relay-') ? 'relay' : 'console', detail: event.detail }))), 'agon-audit.csv', 'text/csv')
  const exportChain = async () => {
    const ordered = [...filtered].reverse()
    let previousHash = '0'.repeat(64)
    const records = []
    for (const event of ordered) {
      const canonical = JSON.stringify(event)
      const hash = await digest(previousHash + canonical)
      records.push({ event, previousHash, hash })
      previousHash = hash
    }
    downloadText(JSON.stringify({ format: 'agon-audit-chain-v1', algorithm: 'SHA-256(previousHash + canonicalEventJSON)', exportedAt: new Date().toISOString(), count: records.length, headHash: previousHash, records }, null, 2), 'agon-audit-chain.json', 'application/json')
    toast('Hash-linked export ready', `${records.length} events · head ${previousHash.slice(0, 12)}…`)
  }
  const categories = ['access', 'device', 'deployment', 'security', 'relay', 'automation']
  return <div>
    <PageHeader eyebrow="Accountability" title="Audit log" description="Review console events and relay events loaded during control-plane synchronization. Hash-linked exports do not replace server-side retention or signing." actions={<><Button icon={Download} onClick={exportCsv}>Export CSV</Button><Button variant="primary" icon={Fingerprint} onClick={exportChain}>Export hash-linked records</Button></>} />
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[{ label: 'Recorded events', value: audit.length, note: 'Current local retention', icon: ScrollText, tone: 'text-slate-300' }, { label: 'Access events', value: audit.filter((e) => e.category === 'access').length, note: 'Support and recording activity', icon: KeyRound, tone: 'text-cyan-300' }, { label: 'Warnings', value: audit.filter((e) => e.severity === 'warning' || e.severity === 'critical').length, note: 'Require operator review', icon: ShieldAlert, tone: 'text-amber-300' }, { label: 'Successful controls', value: audit.filter((e) => e.severity === 'success').length, note: 'Policy enforced as expected', icon: ShieldCheck, tone: 'text-lime-300' }].map((metric) => <Panel key={metric.label} className="flex items-center gap-4 p-4"><metric.icon size={20} className={metric.tone}/><div><p className="font-display text-2xl font-semibold text-white">{metric.value}</p><p className="text-[10px] text-slate-500">{metric.label}</p><p className="mt-0.5 text-[8px] text-slate-600">{metric.note}</p></div></Panel>)}</div>
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 xl:flex-row xl:items-center"><div className="relative flex-1 xl:max-w-md"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/><input className="input pl-9" placeholder="Search actor, action, target or IP…" value={query} onChange={(event) => setQuery(event.target.value)}/></div><div className="flex flex-wrap gap-2"><select className="input w-auto" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select><select className="input w-auto" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option><option value="critical">Critical</option></select><select className="input w-auto" value={range} onChange={(event) => setRange(event.target.value)}><option value="all">All time</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></div></div>
      {filtered.length === 0 ? <EmptyState icon={Filter} title="No audit events match" description="Broaden your search or change the category, severity and time filters." action={<Button onClick={() => { setQuery(''); setSeverity('all'); setCategory('all'); setRange('all') }}>Clear filters</Button>}/> : <div className="divide-y divide-white/[0.05]">{filtered.map((event, index) => <motion.button key={event.id} onClick={() => setSelected(event)} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-white/[0.02] lg:grid-cols-[170px_minmax(200px,.85fr)_minmax(300px,1.4fr)_130px_20px] lg:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(index * .025, .3) }}><div><p className="font-mono text-[9px] text-slate-500">{formatDateTime(event.at)}</p><p className="mt-1 text-[9px] text-slate-700">{timeAgo(event.at)}</p></div><div><div className="flex flex-wrap items-center gap-2"><Badge tone={severityTone(event.severity)}>{event.severity}</Badge><Badge>{event.category}</Badge></div><p className="mt-2 font-mono text-[10px] text-slate-300">{event.action}</p></div><div><p className="text-[11px] leading-5 text-slate-400">{event.detail}</p><p className="mt-1 text-[9px] text-slate-600">{event.actor} → {event.target}</p></div><div><p className="font-mono text-[9px] text-slate-600">{event.ip}</p></div><ChevronRight size={14} className="hidden text-slate-700 lg:block"/></motion.button>)}</div>}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-[10px] text-slate-600"><span>{filtered.length} of {audit.length} events</span><span className="flex items-center gap-1.5"><Fingerprint size={12}/>Hash-chain export available</span></div>
    </Panel>
    <AnimatePresence>{selected && <Drawer open onClose={() => setSelected(null)} title="Audit event"><div className="border-b border-white/[0.07] p-6"><div className="flex items-center gap-3"><div className={cn('rounded-2xl p-3', selected.severity === 'critical' ? 'bg-rose-300/[0.07] text-rose-300' : selected.severity === 'warning' ? 'bg-amber-300/[0.07] text-amber-300' : 'bg-lime-300/[0.07] text-lime-300')}>{selected.severity === 'critical' || selected.severity === 'warning' ? <CircleAlert size={23}/> : <CheckCircle2 size={23}/>}</div><div><div className="flex gap-2"><Badge tone={severityTone(selected.severity)}>{selected.severity}</Badge><Badge>{selected.category}</Badge></div><p className="mt-3 font-mono text-[11px] text-slate-200">{selected.action}</p></div></div><p className="mt-5 text-[12px] leading-6 text-slate-400">{selected.detail}</p></div><div className="border-b border-white/[0.07] p-6"><h3 className="font-display text-sm font-semibold text-white">Event metadata</h3><div className="mt-2"><DetailRow label="Event ID" value={<span className="font-mono text-[9px]">{selected.id}</span>}/><DetailRow label="Timestamp" value={new Date(selected.at).toISOString()}/><DetailRow label="Actor" value={selected.actor}/><DetailRow label="Target" value={selected.target}/><DetailRow label="Source IP" value={<span className="font-mono text-[10px]">{selected.ip}</span>}/></div><Button className="mt-4" icon={FileJson} onClick={() => downloadText(JSON.stringify(selected, null, 2), `${selected.id}.json`, 'application/json')}>Export event</Button></div><div className="p-6"><h3 className="font-display text-sm font-semibold text-white">Related activity</h3><div className="mt-3 space-y-2">{audit.filter((event) => event.target === selected.target && event.id !== selected.id).slice(0, 5).map((event) => <button key={event.id} onClick={() => setSelected(event)} className="w-full rounded-xl border border-white/[0.06] p-3 text-left hover:bg-white/[0.025]"><p className="font-mono text-[9px] text-slate-300">{event.action}</p><p className="mt-1 text-[9px] text-slate-600">{formatDateTime(event.at)} · {event.actor}</p></button>)}{audit.filter((event) => event.target === selected.target && event.id !== selected.id).length === 0 && <p className="text-[10px] text-slate-600">No other events target this record.</p>}</div></div></Drawer>}</AnimatePresence>
  </div>
}
