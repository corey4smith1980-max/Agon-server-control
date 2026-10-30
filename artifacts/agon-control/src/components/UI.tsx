import { AnimatePresence, motion } from 'framer-motion'
import { Apple, Check, ChevronRight, CircleAlert, Info, Laptop, LoaderCircle, Smartphone, Terminal, X, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'
import type { Platform } from '../lib/types'

export function Button({ className, variant = 'secondary', size = 'md', icon: Icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon }) {
  return <button className={cn('button', `button-${variant}`, `button-${size}`, className)} {...props}>
    {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.8} />}{children}
  </button>
}

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button aria-label={label} title={label} className={cn('icon-button', className)} {...props}>{children}</button>
}

export function Panel({ children, className, interactive = false }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return <section className={cn('panel', interactive && 'panel-interactive', className)}>{children}</section>
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div>
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h1 className="font-display text-[26px] font-semibold tracking-[-0.035em] text-white sm:text-[30px]">{title}</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
}

export function Badge({ children, tone = 'neutral', dot = false, className }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'cyan' | 'violet'; dot?: boolean; className?: string }) {
  return <span className={cn('badge', `badge-${tone}`, className)}>{dot && <span className="badge-dot" />}{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'online' || status === 'active' || status === 'healthy' || status === 'completed' ? 'green'
    : status === 'attention' || status === 'waiting' || status === 'degraded' || status === 'running' || status === 'queued' || status === 'awaiting relay' ? 'amber'
      : status === 'offline' || status === 'failed' || status === 'declined' ? 'red' : 'neutral'
  return <Badge tone={tone} dot>{status}</Badge>
}

export function PlatformIcon({ platform, size = 18 }: { platform: Platform; size?: number }) {
  const Icon = platform === 'macos' ? Apple : platform === 'android' ? Smartphone : platform === 'linux' ? Terminal : Laptop
  return <Icon size={size} strokeWidth={1.7} />
}

export function Progress({ value, tone = 'lime', className }: { value: number; tone?: 'lime' | 'cyan' | 'amber' | 'red'; className?: string }) {
  const color = tone === 'red' ? 'bg-rose-400' : tone === 'amber' ? 'bg-amber-400' : tone === 'cyan' ? 'bg-cyan-400' : 'bg-lime-300'
  return <div className={cn('h-1.5 overflow-hidden rounded-full bg-white/[0.07]', className)}><motion.div className={cn('h-full rounded-full', color)} initial={{ width: 0 }} animate={{ width: `${Math.min(100, Math.max(0, value))}%` }} transition={{ duration: 0.55, ease: 'easeOut' }} /></div>
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cn('relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200', checked ? 'border-lime-300/40 bg-lime-300' : 'border-white/10 bg-white/[0.08]')}>
    <motion.span className="absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm" animate={{ x: checked ? 20 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
  </button>
}

export function Modal({ open, onClose, title, description, children, size = 'md' }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.button aria-label="Close dialog" className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
    <motion.div role="dialog" aria-modal="true" aria-label={title} className={cn('relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#11171b] shadow-2xl sm:rounded-3xl', size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : size === 'xl' ? 'max-w-6xl' : 'max-w-xl')} initial={{ opacity: 0, y: 40, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.98 }} transition={{ type: 'spring', stiffness: 360, damping: 32 }}>
      <div className="flex items-start justify-between border-b border-white/[0.07] px-6 py-5">
        <div><h2 className="font-display text-lg font-semibold tracking-tight text-white">{title}</h2>{description && <p className="mt-1 text-sm text-slate-400">{description}</p>}</div>
        <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className="scroll-area overflow-y-auto">{children}</div>
    </motion.div>
  </motion.div>}</AnimatePresence>
}

export function Drawer({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return <AnimatePresence>{open && <div className="fixed inset-0 z-[70]">
    <motion.button aria-label="Close details" className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
    <motion.aside className={cn('absolute inset-y-0 right-0 flex w-full flex-col border-l border-white/10 bg-[#0e1418] shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
      <div className="flex h-[72px] items-center justify-between border-b border-white/[0.07] px-6"><h2 className="font-display text-lg font-semibold text-white">{title}</h2><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div>
      <div className="scroll-area flex-1 overflow-y-auto">{children}</div>
    </motion.aside>
  </div>}</AnimatePresence>
}

export function EmptyState({ icon: Icon = Info, title, description, action }: { icon?: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center px-6 py-16 text-center"><div className="mb-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 text-slate-400"><Icon size={22} /></div><h3 className="font-medium text-white">{title}</h3><p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{description}</p>{action && <div className="mt-5">{action}</div>}</div>
}

export function ToastStack({ toasts, onDismiss }: { toasts: Array<{ id: string; title: string; description?: string; tone: string }>; onDismiss: (id: string) => void }) {
  return <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
    <AnimatePresence>{toasts.map((toast) => {
      const Icon = toast.tone === 'success' ? Check : toast.tone === 'error' || toast.tone === 'warning' ? CircleAlert : Info
      return <motion.div key={toast.id} layout className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/10 bg-[#182025]/95 p-4 shadow-2xl backdrop-blur-xl" initial={{ opacity: 0, x: 60, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 40, scale: 0.96 }}>
        <div className={cn('mt-0.5 rounded-lg p-1.5', toast.tone === 'success' ? 'bg-lime-300/10 text-lime-300' : toast.tone === 'error' ? 'bg-rose-400/10 text-rose-300' : toast.tone === 'warning' ? 'bg-amber-400/10 text-amber-300' : 'bg-cyan-400/10 text-cyan-300')}><Icon size={16} /></div>
        <div className="min-w-0 flex-1"><p className="text-sm font-medium text-white">{toast.title}</p>{toast.description && <p className="mt-0.5 text-xs leading-5 text-slate-400">{toast.description}</p>}</div>
        <button onClick={() => onDismiss(toast.id)} className="text-slate-500 transition hover:text-white"><X size={15} /></button>
      </motion.div>
    })}</AnimatePresence>
  </div>
}

export function LoadingLabel({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-2"><LoaderCircle size={15} className="animate-spin" />{children}</span>
}

export function DetailRow({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-white/[0.055] py-3 text-sm last:border-0"><span className="text-slate-500">{label}</span><span className="flex items-center gap-2 text-right font-medium text-slate-200">{value}{action}</span></div>
}

export function SectionLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="inline-flex items-center gap-1 text-xs font-medium text-lime-300 transition hover:text-lime-200">{children}<ChevronRight size={13} /></button>
}
