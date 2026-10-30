import { Activity, Globe2, LockKeyhole, RefreshCw, Server, ShieldCheck, Wifi } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../store/AppStore";
import { HOSTED_CONTROL_PLANE_URL } from "../lib/utils";
import { Badge, Button, DetailRow, PageHeader, Panel } from "../components/UI";

export default function RelayNetwork() {
  const { relays, devices, testRelay } = useAppStore();
  const hostedRelay = relays.find((relay) => relay.id === "agon-hosted");
  const [checking, setChecking] = useState(false);
  const onlineDevices = devices.filter(
    (device) => device.status === "online" || device.status === "idle",
  );

  const checkHealth = async () => {
    if (!hostedRelay) return;
    setChecking(true);
    await testRelay(hostedRelay.id);
    setChecking(false);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Hosted transport"
        title="Relay network"
        description="Agon hosts the relay alongside this console. Installers connect to it automatically; no separate relay server or shared site token is needed."
        actions={
          <Button
            variant="primary"
            icon={RefreshCw}
            disabled={checking || !hostedRelay}
            onClick={() => void checkHealth()}
          >
            {checking ? "Checking…" : "Check relay health"}
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Panel className="overflow-hidden">
          <div className="border-b border-white/[0.07] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="eyebrow">Hosted control plane</span>
                <h2 className="mt-2 font-display text-lg font-semibold text-white">
                  {hostedRelay?.name ?? "Agon Hosted Relay"}
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  Shared service, isolated device data for each signed-in account.
                </p>
              </div>
              <div className="rounded-xl border border-lime-300/15 bg-lime-300/[0.06] p-3 text-lime-300">
                <Server size={20} />
              </div>
            </div>
          </div>
          <div className="subtle-grid p-5 sm:p-6">
            <div className="rounded-2xl border border-lime-300/15 bg-[#111a18] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-lime-300/[0.08] p-2.5 text-lime-300">
                    <Globe2 size={18} />
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-slate-100">
                      Console and relay share one hosted origin
                    </p>
                    <p className="mt-1 text-[9px] text-slate-500">
                      Persistent records · owner-scoped API · outbound WebSocket agents
                    </p>
                  </div>
                </div>
                <Badge tone={hostedRelay?.status === "healthy" ? "green" : "neutral"} dot>
                  {hostedRelay?.status === "healthy" ? "Healthy" : "Ready"}
                </Badge>
              </div>
              <p className="mt-5 break-all rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2.5 font-mono text-[10px] text-slate-400">
                {hostedRelay?.url ?? HOSTED_CONTROL_PLANE_URL}
              </p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                {
                  icon: Wifi,
                  label: "Live endpoints",
                  value: `${onlineDevices.length} / ${devices.length}`,
                },
                {
                  icon: Activity,
                  label: "Transport",
                  value: "WSS · TLS 1.2+",
                },
                {
                  icon: LockKeyhole,
                  label: "Pairing",
                  value: "One-use credential",
                },
              ].map(({ icon: Icon, label, value }) => (
                <div
                  key={label}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                >
                  <Icon size={15} className="text-lime-300" />
                  <p className="mt-3 font-display text-sm font-semibold text-white">
                    {value}
                  </p>
                  <p className="mt-1 text-[9px] text-slate-600">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-300/[0.07] p-2.5 text-cyan-300">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Endpoint command policy
              </h2>
              <p className="mt-1 text-[10px] text-slate-500">
                Commands are limited on both server and agent.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {[
              ["Agent ping", "Connectivity and agent version"],
              ["Inventory refresh", "Reported device metadata"],
              ["Network diagnostics", "Interface status and addresses"],
              ["Support request", "Requires endpoint policy or local consent"],
            ].map(([title, detail]) => (
              <div
                key={title}
                className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5"
              >
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-lime-300" />
                <div>
                  <p className="text-[10px] font-medium text-slate-200">{title}</p>
                  <p className="mt-1 text-[9px] leading-4 text-slate-600">{detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-4">
            <p className="text-[10px] leading-5 text-slate-500">
              No arbitrary shell, screen capture, remote input or hidden persistence is available. Removing a device revokes its relay credential.
            </p>
          </div>
        </Panel>
      </div>

      <Panel className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-white">
              Account devices
            </h2>
            <p className="mt-1 text-[10px] text-slate-500">
              Devices paired by operators in this account.
            </p>
          </div>
          <Badge>{devices.length} devices</Badge>
        </div>
        {devices.length ? (
          <div className="divide-y divide-white/[0.05]">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div>
                  <p className="text-[11px] font-medium text-slate-200">
                    {device.name}
                  </p>
                  <p className="mt-1 text-[9px] text-slate-600">
                    {device.group} · {device.os} · {device.arch}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[9px] text-slate-600">
                    {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : "Never connected"}
                  </span>
                  <Badge tone={device.status === "online" ? "green" : "neutral"} dot>
                    {device.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-slate-300">No devices paired yet</p>
            <p className="mx-auto mt-2 max-w-md text-[10px] leading-5 text-slate-600">
              Build an installer from Agent deployment, then approve its endpoint pairing code in the console.
            </p>
          </div>
        )}
      </Panel>

      {hostedRelay && (
        <Panel className="mt-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Relay status" value={hostedRelay.status} />
            <DetailRow label="Service version" value={hostedRelay.version} />
            <DetailRow
              label="Last health check"
              value={hostedRelay.latency ? `${hostedRelay.latency} ms` : "Not checked yet"}
            />
            <DetailRow
              label="Device transport"
              value="Authenticated outbound WebSocket"
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
