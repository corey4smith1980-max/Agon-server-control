import { ArrowRight, Activity, Fingerprint, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

const assurances = [
  {
    icon: ShieldCheck,
    title: "Account-isolated devices",
    description: "Only your signed-in account can see or manage its endpoints.",
  },
  {
    icon: Activity,
    title: "Visible diagnostics",
    description: "Agents report inventory and allowlisted health checks only.",
  },
  {
    icon: Fingerprint,
    title: "Operator-approved pairing",
    description: "Each agent creates its own device identity and waits for operator approval.",
  },
];

export default function AuthLanding() {
  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#0d110e] text-slate-100">
      <div className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-6 py-7 sm:px-10">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-300 text-slate-950 shadow-[0_10px_35px_rgba(193,244,81,.16)]">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-6 w-6" />
          </div>
          <div>
            <p className="font-display text-lg font-semibold tracking-tight">Agon</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
              Server control
            </p>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.05fr_.95fr]">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-lime-300/15 bg-lime-300/[0.06] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-lime-200">
              <span className="h-1.5 w-1.5 rounded-full bg-lime-300" />
              Hosted control plane
            </div>
            <h1 className="mt-7 max-w-xl font-display text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
              Manage your devices from one secure console.
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">
              Sign in to create an account-isolated fleet. Agon hosts the relay;
              installers connect back here and request approval with a device-generated pairing code.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to="/sign-in"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-lime-300 px-5 text-sm font-semibold text-slate-950 transition hover:bg-lime-200"
              >
                Sign in <ArrowRight size={16} />
              </Link>
              <Link
                to="/sign-up"
                className="inline-flex h-12 items-center rounded-xl border border-white/10 px-5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.04]"
              >
                Create account
              </Link>
            </div>
            <p className="mt-4 text-[10px] leading-5 text-slate-600">
              Your account controls only devices paired and approved from its own console.
              No relay URL or site token needs to be configured manually.
            </p>
          </div>

          <div className="space-y-3">
            {assurances.map(({ icon: Icon, title, description }, index) => (
              <div
                key={title}
                className="flex gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 sm:p-6"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime-300/[0.08] text-lime-200">
                  <Icon size={18} />
                </div>
                <div>
                  <p className="font-display text-sm font-semibold text-slate-100">
                    <span className="mr-2 font-mono text-[9px] text-slate-600">
                      0{index + 1}
                    </span>
                    {title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <footer className="border-t border-white/[0.06] pt-5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
          Authorized endpoints only · administrator consent required
        </footer>
      </div>
    </main>
  );
}
