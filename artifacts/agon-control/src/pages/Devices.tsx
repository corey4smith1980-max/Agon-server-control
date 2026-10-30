import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownUp, Download, Edit3, Filter, Grid2X2, List, MoreHorizontal, PackagePlus, Play, RefreshCw, Search, ShieldCheck, Trash2, Wifi, WifiOff, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Device, Platform } from '../lib/types'
import { cn, downloadText, openSessionLauncher, timeAgo, toCsv } from '../lib/utils'
import { useAppStore } from '../store/AppStore'
import { Badge, Button, DetailRow, Drawer, EmptyState, IconButton, Modal, PageHeader, Panel, PlatformIcon, Progress, StatusBadge } from '../components/UI'

const groups = ['Infrastructure', 'Engineering', 'People', 'Sales', 'Marketing', 'Executive', 'Retail', 'Field Ops', 'Finance', 'Unassigned']

type SortKey = 'name' | 'status' | 'group' | 'lastSeen'

function DeviceDrawer({ device, onClose }: { device: Device; onClose: () => void }) {
  const { updateDevice, runJob, toast } = useAppStore()
  const [editing, setEditing] = useState(false)
  const [group, setGroup] = useState(device.group)
  const [access, setAccess] = useState(device.access)
  const save = () => {
    updateDevice(device.id, { group, access })
    setEditing(false)
    toast('Device policy updated', `${device.name} · ${group} · ${access} access`)
  }
  return <Drawer open onClose={onClose} title={device.name}>
    <div className="border-b border-white/[0.07] p-6">
      <div className="flex items-start gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.035] text-slate-300"><PlatformIcon platform={device.platform} size={26} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={device.status} /><Badge tone={device.sample ? 'violet' : 'cyan'}>{device.sample ? 'Simulated lab' : 'Live relay'}</Badge></div><p className="mt-3 text-sm text-slate-300">{device.os}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{device.hostname} · {device.arch}</p></div></div>
      <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="primary" icon={Play} onClick={() => openSessionLauncher(device.id)} disabled={device.status === 'offline'}>Request policy review</Button><Button icon={RefreshCw} onClick={() => runJob('inventory.refresh', [device.id])}>Refresh inventory</Button></div>
      {device.status === 'offline' && <p className="mt-3 flex items-center gap-2 text-[10px] text-amber-300/80"><WifiOff size={13} />This device is offline. New jobs wait for its next agent connection.</p>}
    </div>
    <div className="border-b border-white/[0.07] p-6">
      <div className="mb-5 flex items-center justify-between"><h3 className="font-display text-sm font-semibold text-white">Endpoint telemetry</h3><span className="font-mono text-[9px] text-slate-600">LAST SEEN {timeAgo(device.lastSeen).toUpperCase()}</span></div>
      <div className="space-y-4">{[{ label: 'CPU load', value: device.cpu }, { label: 'Memory', value: device.memory }, { label: 'Disk used', value: device.disk }].map((metric) => <div key={metric.label}><div className="mb-2 flex justify-between text-[11px]"><span className="text-slate-500">{metric.label}</span><span className="font-mono text-slate-300">{metric.value}%</span></div><Progress value={metric.value} tone={metric.value > 85 ? 'red' : metric.value > 70 ? 'amber' : 'lime'} /></div>)}</div>
      <div className="mt-5 grid grid-cols-3 gap-2">{[{ label: 'Relay', value: device.relay }, { label: 'Agent', value: `v${device.agentVersion}` }, { label: 'Access', value: device.access }].map((item) => <div key={item.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><p className="font-mono text-[8px] uppercase tracking-wider text-slate-600">{item.label}</p><p className="mt-1.5 truncate text-[11px] text-slate-300">{item.value}</p></div>)}</div>
    </div>
    <div className="border-b border-white/[0.07] p-6">
      <div className="mb-2 flex items-center justify-between"><h3 className="font-display text-sm font-semibold text-white">Device record</h3><Button size="sm" variant="ghost" icon={Edit3} onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel' : 'Edit'}</Button></div>
      {editing ? <div className="space-y-4 rounded-xl border border-lime-300/15 bg-lime-300/[0.025] p-4"><div><label className="label">Device group</label><select className="input" value={group} onChange={(event) => setGroup(event.target.value)}>{groups.map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="label">Access policy</label><select className="input" value={access} onChange={(event) => setAccess(event.target.value as Device['access'])}><option value="interactive">Interactive consent</option><option value="unattended">Authorized unattended</option></select><p className="mt-2 text-[10px] leading-4 text-slate-500">Changing this console record does not rewrite the installed endpoint config. Generate a new package for live agents.</p></div><Button variant="primary" size="sm" onClick={save}>Save device record</Button></div> : <div><DetailRow label="Group" value={device.group} /><DetailRow label="Signed-in user" value={device.user} /><DetailRow label="IP address" value={<span className="font-mono text-[11px]">{device.ip}</span>} /><DetailRow label="Location" value={device.location} /><DetailRow label="Device ID" value={<span className="font-mono text-[10px]">{device.id}</span>} /></div>}
    </div>
    <div className="p-6"><h3 className="font-display text-sm font-semibold text-white">Diagnostic actions</h3><p className="mt-1 text-[11px] leading-5 text-slate-500">Actions use the agent allowlist. Lab targets return emulated results; live enrolled targets use your configured relay.</p><div className="mt-4 grid gap-2"><Button icon={Wifi} onClick={() => runJob('agent.ping', [device.id])}>Ping agent</Button><Button icon={ShieldCheck} onClick={() => runJob('diagnostics.network', [device.id])}>Network diagnostics</Button></div><div className="mt-4 flex flex-wrap gap-2">{device.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div></div>
  </Drawer>
}

export default function Devices() {
  const { devices, removeDevices, runJob } = useAppStore()
  const navigate = useNavigate()
  const { deviceId } = useParams()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [platform, setPlatform] = useState<'all' | Platform>('all')
  const [group, setGroup] = useState('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [view, setView] = useState<'table' | 'grid'>('table')
  const [selected, setSelected] = useState<string[]>([])
  const [confirmRemove, setConfirmRemove] = useState(false)

  const filtered = useMemo(() => devices.filter((device) => {
    const search = `${device.name} ${device.hostname} ${device.user} ${device.ip} ${device.tags.join(' ')}`.toLowerCase()
    return search.includes(query.toLowerCase()) && (status === 'all' || device.status === status) && (platform === 'all' || device.platform === platform) && (group === 'all' || device.group === group)
  }).sort((a, b) => {
    if (sort === 'lastSeen') return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    return String(a[sort]).localeCompare(String(b[sort]))
  }), [devices, query, status, platform, group, sort])
  const activeDevice = devices.find((device) => device.id === deviceId)
  const allSelected = filtered.length > 0 && filtered.every((device) => selected.includes(device.id))
  const toggleAll = () => setSelected(allSelected ? selected.filter((id) => !filtered.some((device) => device.id === id)) : Array.from(new Set([...selected, ...filtered.map((device) => device.id)])))
  const clearFilters = () => { setQuery(''); setStatus('all'); setPlatform('all'); setGroup('all') }
  const exportDevices = (onlySelected = false) => {
    const list = onlySelected ? devices.filter((device) => selected.includes(device.id)) : filtered
    downloadText(toCsv(list.map((device) => ({ name: device.name, hostname: device.hostname, os: device.os, architecture: device.arch, group: device.group, status: device.status, ip: device.ip, agent: device.agentVersion, access: device.access, relay: device.relay, last_seen: device.lastSeen, source: device.sample ? 'simulated lab' : 'live relay' }))), 'agon-devices.csv', 'text/csv')
  }

  return <div>
    <PageHeader eyebrow="Endpoint estate" title="Devices" description="Search, govern and troubleshoot every enrolled endpoint from one policy-aware inventory." actions={<><Button icon={Download} onClick={() => exportDevices()}>Export CSV</Button><Button variant="primary" icon={PackagePlus} onClick={() => navigate('/deployment')}>Deploy agent</Button></>} />
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1 xl:max-w-sm"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" /><input className="input pl-9" placeholder="Search name, user, IP or tag…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white"><X size={14} /></button>}</div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto min-w-28" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option value="online">Online</option><option value="idle">Idle</option><option value="attention">Attention</option><option value="offline">Offline</option></select>
          <select className="input w-auto min-w-28" value={platform} onChange={(event) => setPlatform(event.target.value as 'all' | Platform)} aria-label="Filter by platform"><option value="all">All platforms</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option><option value="android">Android</option></select>
          <select className="input w-auto min-w-32" value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Filter by group"><option value="all">All groups</option>{groups.map((item) => <option key={item}>{item}</option>)}</select>
          <div className="hidden rounded-lg border border-white/[0.07] p-0.5 sm:flex"><button onClick={() => setView('table')} className={cn('rounded-md p-2', view === 'table' ? 'bg-white/[0.07] text-white' : 'text-slate-600')} aria-label="Table view"><List size={14} /></button><button onClick={() => setView('grid')} className={cn('rounded-md p-2', view === 'grid' ? 'bg-white/[0.07] text-white' : 'text-slate-600')} aria-label="Grid view"><Grid2X2 size={14} /></button></div>
        </div>
      </div>
      <AnimatePresence>{selected.length > 0 && <motion.div className="flex flex-wrap items-center gap-2 border-b border-lime-300/10 bg-lime-300/[0.035] px-4 py-3" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}><span className="mr-2 text-[11px] font-medium text-lime-200">{selected.length} selected</span><Button size="sm" icon={RefreshCw} onClick={() => runJob('inventory.refresh', selected)}>Refresh inventory</Button><Button size="sm" icon={Wifi} onClick={() => runJob('agent.ping', selected)}>Ping agents</Button><Button size="sm" icon={Download} onClick={() => exportDevices(true)}>Export</Button><Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmRemove(true)}>Remove</Button><button className="ml-auto text-[10px] text-slate-500 hover:text-white" onClick={() => setSelected([])}>Clear selection</button></motion.div>}</AnimatePresence>
       {filtered.length === 0 ? <EmptyState icon={Filter} title="No devices match" description="Try a broader search or clear the status, platform and group filters." action={<Button onClick={clearFilters}>Clear all filters</Button>} /> : view === 'table' ? <div className="overflow-x-auto scroll-area"><table className="data-table min-w-[1020px]"><thead><tr><th className="w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all filtered devices" className="accent-lime-300" /></th><th><button onClick={() => setSort('name')} className="flex items-center gap-1.5">Device<ArrowDownUp size={10} /></button></th><th><button onClick={() => setSort('status')} className="flex items-center gap-1.5">Status<ArrowDownUp size={10} /></button></th><th><button onClick={() => setSort('group')} className="flex items-center gap-1.5">Group<ArrowDownUp size={10} /></button></th><th>Agent</th><th>Relay</th><th><button onClick={() => setSort('lastSeen')} className="flex items-center gap-1.5">Last seen<ArrowDownUp size={10} /></button></th><th className="text-right">Actions</th></tr></thead><tbody>{filtered.map((device) => <tr key={device.id} className="cursor-pointer" onClick={() => navigate(`/devices/${device.id}`)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.includes(device.id)} onChange={() => setSelected((items) => items.includes(device.id) ? items.filter((id) => id !== device.id) : [...items, device.id])} aria-label={`Select ${device.name}`} className="accent-lime-300" /></td><td><div className="flex items-center gap-3"><div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-2 text-slate-400"><PlatformIcon platform={device.platform} /></div><div><div className="flex items-center gap-2"><p className="font-medium text-slate-200">{device.name}</p><Badge tone={device.sample ? 'violet' : 'cyan'}>{device.sample ? 'Simulated lab' : 'Live relay'}</Badge></div><p className="mt-1 text-[10px] text-slate-600">{device.os} · {device.arch}</p></div></div></td><td><StatusBadge status={device.status} /></td><td><p className="text-slate-300">{device.group}</p><p className="mt-1 text-[10px] text-slate-600">{device.user}</p></td><td><span className={cn('font-mono text-[10px]', device.agentVersion === '1.0.0' ? 'text-slate-400' : 'text-amber-300')}>v{device.agentVersion}</span></td><td><span className="font-mono text-[10px] text-slate-500">{device.relay}</span></td><td><span className="text-[11px] text-slate-500">{timeAgo(device.lastSeen)}</span></td><td onClick={(event) => event.stopPropagation()}><div className="flex justify-end gap-1"><IconButton label={`Create support request for ${device.name}`} disabled={device.status === 'offline'} onClick={() => openSessionLauncher(device.id)}><Play size={14} /></IconButton><IconButton label={`Open ${device.name}`} onClick={() => navigate(`/devices/${device.id}`)}><MoreHorizontal size={16} /></IconButton></div></td></tr>)}</tbody></table></div> : <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{filtered.map((device, index) => <motion.button key={device.id} onClick={() => navigate(`/devices/${device.id}`)} className="rounded-2xl border border-white/[0.065] bg-white/[0.018] p-4 text-left transition hover:border-white/[0.13] hover:bg-white/[0.035]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .025 }}><div className="flex items-start justify-between"><div className="rounded-xl bg-white/[0.04] p-2.5 text-slate-400"><PlatformIcon platform={device.platform} size={20} /></div><StatusBadge status={device.status} /></div><div className="mt-4 flex items-center justify-between gap-2"><p className="truncate text-sm font-medium text-slate-200">{device.name}</p><Badge tone={device.sample ? 'violet' : 'cyan'}>{device.sample ? 'Simulated lab' : 'Live relay'}</Badge></div><p className="mt-1 truncate text-[10px] text-slate-600">{device.os}</p><div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-3 text-[9px] text-slate-600"><span>{device.group}</span><span>{timeAgo(device.lastSeen)}</span></div></motion.button>)}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-3 text-[10px] text-slate-600"><span>{filtered.length} of {devices.length} devices · {devices.filter((device) => !device.sample).length} live</span><span>Inventory retained locally in this browser</span></div>
    </Panel>
    <AnimatePresence>{activeDevice && <DeviceDrawer key={activeDevice.id} device={activeDevice} onClose={() => navigate('/devices')} />}</AnimatePresence>
    <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove device records?" description="This action only changes the local console inventory." size="sm"><div className="p-6"><p className="text-sm leading-6 text-slate-400">You are removing <strong className="font-medium text-white">{selected.length} device record{selected.length === 1 ? '' : 's'}</strong>. Installed agents and relay enrollment records are not deleted.</p><div className="mt-6 flex justify-end gap-2"><Button onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="danger" icon={Trash2} onClick={() => { removeDevices(selected); setSelected([]); setConfirmRemove(false) }}>Remove records</Button></div></div></Modal>
  </div>
}
