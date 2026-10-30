import { ExternalLink, Headset, LockKeyhole, Network, ShieldCheck } from 'lucide-react'
import { Panel } from './UI'

export function RemoteAccessGuide() {
  return <section aria-labelledby="remote-access-heading" className="mb-6" data-testid="remote-access-guide">
    <div className="mb-3">
      <p className="eyebrow mb-1">Working remote-control options</p>
      <h2 id="remote-access-heading" className="font-display text-lg font-semibold text-white">Connect with Windows tools</h2>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400" data-testid="text-remote-access-disclaimer">These approved Windows tools provide the actual desktop connection. Agon keeps support request records separate and does not carry screen or input data.</p>
    </div>
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel className="flex flex-col p-5" testId="card-quick-assist">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-lime-300/15 bg-lime-300/[0.06] p-2.5 text-lime-300"><Headset size={18} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Quick Assist</h3>
              <span className="rounded-full border border-lime-300/20 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-lime-200">Interactive · immediate</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">Best for a person who can approve the support session at the laptop.</p>
          </div>
        </div>
        <ol className="mt-4 space-y-2.5 text-xs leading-5 text-slate-300">
          <li className="flex gap-2"><span className="font-mono text-lime-300">01</span><span>On your support PC, open Quick Assist and choose <strong className="font-medium text-white">Help someone</strong>.</span></li>
          <li className="flex gap-2"><span className="font-mono text-lime-300">02</span><span>Share the one-time security code with the person at the target PC through a trusted channel.</span></li>
          <li className="flex gap-2"><span className="font-mono text-lime-300">03</span><span>They enter the code and approve screen sharing and full control. They can end access at any time.</span></li>
        </ol>
        <a
          data-testid="link-open-quick-assist"
          href="https://aka.ms/quickassist"
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl bg-lime-300 px-4 py-2 text-xs font-semibold text-[#15200c] transition hover:bg-lime-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
        >
          Open Microsoft Quick Assist <ExternalLink size={14} />
        </a>
        <p className="mt-3 text-[10px] leading-4 text-slate-500">The Quick Assist app handles the live session; Agon does not receive the screen or control events.</p>
      </Panel>

      <Panel className="flex flex-col p-5" testId="card-rdp-vpn">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] p-2.5 text-cyan-300"><Network size={18} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Remote Desktop over VPN</h3>
              <span className="rounded-full border border-cyan-300/20 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-cyan-200">Unattended · authorized</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">For managed Windows Pro or Enterprise PCs that already have an approved private VPN.</p>
          </div>
        </div>
        <ol className="mt-4 space-y-2.5 text-xs leading-5 text-slate-300">
          <li className="flex gap-2"><span className="font-mono text-cyan-300">01</span><span>On the target PC, enable <strong className="font-medium text-white">Settings → System → Remote Desktop</strong> and authorize the intended account.</span></li>
          <li className="flex gap-2"><span className="font-mono text-cyan-300">02</span><span>Connect both PCs to the organization’s private VPN, then connect using the target’s VPN name or address.</span></li>
          <li className="flex gap-2"><span className="font-mono text-cyan-300">03</span><span>Use a dedicated, authorized Windows account. Keep network access restricted to the VPN.</span></li>
        </ol>
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-3 text-[10px] leading-4 text-amber-100/80" data-testid="text-rdp-safety">
          <LockKeyhole size={14} className="mt-0.5 shrink-0 text-amber-300" />
          <span>Never expose Remote Desktop port 3389 directly to the public internet. Windows Home cannot host incoming Microsoft Remote Desktop sessions.</span>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[10px] leading-4 text-slate-500"><ShieldCheck size={12} />Use only on devices you own or are authorized to support.</p>
      </Panel>
    </div>
  </section>
}
