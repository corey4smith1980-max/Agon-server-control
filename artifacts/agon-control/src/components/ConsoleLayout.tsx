import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, Bell, ChevronRight, Command, Download, Headset, LayoutDashboard, LogOut, Menu, MonitorSmartphone, Network, PackagePlus, Plus, Radio, ScrollText, Search, Settings2, ShieldCheck, Workflow, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useClerk, useUser } from '@clerk/react'
import { useAppStore } from '../store/AppStore'
import { cn, formatDateTime, openSessionLauncher } from '../lib/utils'
import { Badge, IconButton, ToastStack } from './UI'
import { NewSessionModal } from './NewSessionModal'

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/devices', label: 'Devices', icon: MonitorSmartphone },
  { to: '/sessions', label: 'Support requests', icon: Headset },
  { to: '/deployment', label: 'Agent deployment', icon: PackagePlus },
  { to: '/automation', label: 'Automation', icon: Workflow },
  { to: '/relay', label: 'Relay network', icon: Network },
  { to: '/audit', label: 'Audit log', icon: ScrollText },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
]

const routeTitles: Record<string, string> = {
  '/': 'Overview', '/devices': 'Devices', '/sessions': 'Support requests', '/deployment': 'Agent deployment',
  '/automation': 'Automation', '/relay': 'Relay network', '/audit': 'Audit log', '/reports': 'Reports', '/settings': 'Settings',
}

function Brand() {
  return <div className="flex items-center gap-3">
    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-lime-300 text-[#15200c] shadow-[0_0_28px_rgba(195,243,107,.12)]">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 8.5 12 5l5 3.5v6L12 19l-5-4.5v-6Z" stroke="currentColor" strokeWidth="1.7"/><path d="m7 8.5 5 3.5 5-3.5M12 12v7" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="5" r="1.5" fill="currentColor"/></svg>
    </div>
    <div><p className="font-display text-[15px] font-bold tracking-[-0.025em] text-white">Agon</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.22em] text-slate-500">Server control</p></div>
  </div>
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { devices, sessions, relays, organizations, activeOrganizationId, organizationRole } = useAppStore()
  const { user } = useUser()
  const { signOut } = useClerk()
  const operatorName = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Agon operator'
  const activeOrganizationName = organizations.find((item) => item.id === activeOrganizationId)?.name || 'My workspace'
  const operatorInitials = operatorName.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AG'
  const online = devices.filter((device) => device.status === 'online' || device.status === 'idle').length
  const waiting = sessions.filter((session) => session.status === 'waiting' || session.status === 'consent_required').length
  return <>
    <AnimatePresence>{open && <motion.button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>
    <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-[244px] flex-col border-r border-white/[0.065] bg-[#0c1115]/95 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex h-[72px] items-center justify-between border-b border-white/[0.06] px-5"><Brand /><IconButton label="Close navigation" onClick={onClose} className="lg:hidden"><X size={18} /></IconButton></div>
      <div className="scroll-area flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-3 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-600">Workspace</p>
        <nav className="space-y-1">{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onClose} className={({ isActive }) => cn('group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-medium transition-all', isActive ? 'bg-lime-300/[0.09] text-lime-200' : 'text-slate-500 hover:bg-white/[0.035] hover:text-slate-200')}>
          {({ isActive }) => <><item.icon size={17} strokeWidth={1.7} className={isActive ? 'text-lime-300' : 'text-slate-600 transition group-hover:text-slate-300'} /><span className="flex-1">{item.label}</span>{item.to === '/sessions' && waiting > 0 && <span className="rounded-md bg-amber-300/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">{waiting}</span>}</>}
        </NavLink>)}</nav>
        <p className="mb-2 mt-7 px-3 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-600">System</p>
        <NavLink to="/settings" onClick={onClose} className={({ isActive }) => cn('group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-medium transition-all', isActive ? 'bg-lime-300/[0.09] text-lime-200' : 'text-slate-500 hover:bg-white/[0.035] hover:text-slate-200')}><Settings2 size={17} strokeWidth={1.7} /><span>Settings</span></NavLink>
        <div className="mx-2 mt-7 rounded-2xl border border-white/[0.065] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] font-medium text-slate-300"><Radio size={14} className="text-lime-300" />Fleet reachability</span><span className="h-1.5 w-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_#bef264]" /></div>
          <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-white">{Math.round(online / Math.max(devices.length, 1) * 100)}<span className="text-base text-slate-600">%</span></p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-lime-300" style={{ width: `${online / Math.max(devices.length, 1) * 100}%` }} /></div>
          <p className="mt-2.5 text-[10px] leading-4 text-slate-600">{online} reachable · {relays.length} relay regions</p>
        </div>
      </div>
      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2 rounded-xl p-2">
          {user?.imageUrl
            ? <img src={user.imageUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
            : <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#33443a] to-[#1c2922] text-[10px] font-semibold text-lime-200">{operatorInitials}</div>}
          <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-200">{operatorName}</p><p className="truncate text-[9px] capitalize text-slate-600">{activeOrganizationName} · {organizationRole}</p></div>
          <button aria-label="Sign out" title="Sign out" onClick={() => void signOut({ redirectUrl: '/sign-in' })} className="rounded-lg p-2 text-slate-600 transition hover:bg-white/[0.05] hover:text-rose-200"><LogOut size={14}/></button>
        </div>
      </div>
    </aside>
  </>
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { devices } = useAppStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const q = query.toLowerCase()
    const pages = navigation.concat({ to: '/settings', label: 'Settings', icon: Settings2 }).filter((item) => item.label.toLowerCase().includes(q))
    const machineResults = devices.filter((device) => `${device.name} ${device.group} ${device.os}`.toLowerCase().includes(q)).slice(0, 6)
    return { pages, machines: query ? machineResults : machineResults.slice(0, 4) }
  }, [query, devices])
  const go = (path: string) => { navigate(path); onClose() }
  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <button className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} aria-label="Close command menu" />
    <motion.div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#11171b] shadow-2xl" initial={{ y: -18, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: -10, scale: 0.98 }}>
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-4"><Search size={18} className="text-slate-500" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices or jump to a page…" className="h-14 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" /><kbd className="rounded-md border border-white/10 px-1.5 py-1 font-mono text-[9px] text-slate-500">ESC</kbd></div>
      <div className="scroll-area max-h-[55vh] overflow-y-auto p-2">
        {results.pages.length > 0 && <><p className="px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-wider text-slate-600">Navigate</p>{results.pages.map((item) => <button key={item.to} onClick={() => go(item.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-slate-300 transition hover:bg-white/[0.05]"><item.icon size={16} className="text-slate-500" /><span className="flex-1">{item.label}</span><ChevronRight size={13} className="text-slate-600" /></button>)}</>}
        {results.machines.length > 0 && <><p className="px-3 pb-1 pt-3 font-mono text-[9px] uppercase tracking-wider text-slate-600">Devices</p>{results.machines.map((device) => <button key={device.id} onClick={() => go(`/devices/${device.id}`)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]"><MonitorSmartphone size={16} className="text-slate-500" /><span className="flex-1"><span className="block text-xs text-slate-200">{device.name}</span><span className="mt-0.5 block text-[10px] text-slate-600">{device.group} · {device.os}</span></span><span className={cn('h-1.5 w-1.5 rounded-full', device.status === 'offline' ? 'bg-slate-600' : 'bg-lime-300')} /></button>)}</>}
        {!results.pages.length && !results.machines.length && <p className="px-4 py-10 text-center text-sm text-slate-500">No results for “{query}”</p>}
      </div>
      <div className="flex items-center gap-4 border-t border-white/[0.07] px-4 py-2.5 font-mono text-[9px] text-slate-600"><span>Type to filter</span><span>ESC close</span><span className="ml-auto">Agon console</span></div>
    </motion.div>
  </motion.div>}</AnimatePresence>
}

function Notifications({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { audit } = useAppStore()
  const navigate = useNavigate()
  return <AnimatePresence>{open && <>
    <button className="fixed inset-0 z-40 cursor-default" onClick={onClose} aria-label="Close notifications" />
    <motion.div className="fixed right-4 top-[66px] z-50 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#12191d] shadow-2xl" initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}>
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3.5"><div><p className="text-sm font-medium text-white">Operational activity</p><p className="mt-0.5 text-[10px] text-slate-500">Latest events across this workspace</p></div><Badge tone="cyan">{audit.length} events</Badge></div>
      <div className="max-h-[420px] overflow-y-auto scroll-area">{audit.slice(0, 6).map((event) => <button key={event.id} onClick={() => { navigate('/audit'); onClose() }} className="flex w-full gap-3 border-b border-white/[0.05] px-4 py-3.5 text-left transition last:border-0 hover:bg-white/[0.025]"><span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', event.severity === 'critical' ? 'bg-rose-400' : event.severity === 'warning' ? 'bg-amber-300' : 'bg-lime-300')} /><span><span className="block font-mono text-[10px] text-slate-300">{event.action}</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">{event.target} · {event.actor}</span><span className="mt-1.5 block text-[9px] text-slate-600">{formatDateTime(event.at)}</span></span></button>)}</div>
      <button onClick={() => { navigate('/audit'); onClose() }} className="flex w-full items-center justify-center gap-2 border-t border-white/[0.07] py-3 text-[11px] font-medium text-lime-300 transition hover:bg-lime-300/[0.03]">Open full audit log<ChevronRight size={13} /></button>
    </motion.div>
  </>}</AnimatePresence>
}

export function ConsoleLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const { toasts, dismissToast, settings, devices } = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()
  const title = routeTitles[location.pathname] || (location.pathname.startsWith('/devices/') ? 'Device details' : 'Console')

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen((value) => !value) }
      if (event.key === 'Escape') { setCommandOpen(false); setNotificationsOpen(false) }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return <div className="min-h-screen">
    <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    <div className="lg:pl-[244px]">
      <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-white/[0.065] bg-[#090d10]/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <IconButton label="Open navigation" onClick={() => setSidebarOpen(true)} className="lg:hidden"><Menu size={20} /></IconButton>
        <div className="hidden items-center gap-2 text-[11px] sm:flex"><span className="text-slate-600">{settings.consoleName}</span><ChevronRight size={12} className="text-slate-700" /><span className="font-medium text-slate-300">{title}</span></div>
        <button onClick={() => setCommandOpen(true)} className="ml-auto flex h-9 min-w-0 items-center gap-2 rounded-xl border border-white/[0.075] bg-white/[0.025] px-3 text-left text-[11px] text-slate-600 transition hover:border-white/[0.13] hover:text-slate-400 sm:w-56"><Search size={14} /><span className="hidden flex-1 sm:inline">Search console</span><span className="hidden items-center gap-0.5 rounded border border-white/[0.08] px-1.5 py-0.5 font-mono text-[9px] md:flex"><Command size={9} />K</span></button>
        <div className="hidden items-center gap-2 xl:flex"><Badge tone={devices.some((device) => !device.sample) ? 'cyan' : 'violet'}>{devices.some((device) => !device.sample) ? 'Live + simulated' : 'Simulated lab'}</Badge></div>
        <div className="relative"><IconButton label="Notifications" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={17} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-amber-300" /></IconButton></div>
        <button onClick={() => navigate('/deployment')} className="hidden h-9 items-center gap-2 rounded-xl border border-white/[0.08] px-3 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.04] md:flex"><Download size={14} />Deploy agent</button>
        <button onClick={() => openSessionLauncher()} className="flex h-9 items-center gap-2 rounded-xl bg-lime-300 px-3 text-[11px] font-semibold text-[#15200c] transition hover:bg-lime-200"><Plus size={15} /><span className="hidden sm:inline">New request</span></button>
      </header>
      <main className="mx-auto max-w-[1680px] p-4 sm:p-6 lg:p-8">
        <AnimatePresence mode="wait" initial={false}><motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.22, ease: 'easeOut' }}><Outlet /></motion.div></AnimatePresence>
      </main>
    </div>
    <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    <Notifications open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    <NewSessionModal />
    <ToastStack toasts={toasts} onDismiss={dismissToast} />
  </div>
}
