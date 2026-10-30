import { motion } from "framer-motion";
import {
  Building2,
  Check,
  Database,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { downloadText } from "../lib/utils";
import { useAppStore } from "../store/AppStore";
import { Badge, Button, Modal, PageHeader, Panel, Toggle } from "../components/UI";

const sections = [
  { id: "general", label: "General", icon: Building2, description: "Workspace identity and defaults" },
  { id: "connection", label: "Control plane", icon: Server, description: "Hosted relay and live devices" },
  { id: "security", label: "Security policies", icon: ShieldCheck, description: "Consent and session safeguards" },
  { id: "data", label: "Data & workspace", icon: Database, description: "Export, retention and cache" },
];

export default function Settings() {
  const {
    settings,
    updateSettings,
    devices,
    sessions,
    jobs,
    audit,
    relays,
    syncControlPlane,
    syncing,
    resetWorkspace,
    toast,
  } = useAppStore();
  const navigate = useNavigate();
  const [section, setSection] = useState("general");
  const [resetOpen, setResetOpen] = useState(false);

  const save = () =>
    toast("Settings saved", "Workspace preferences are stored in this account’s browser.");
  const exportWorkspace = () => {
    downloadText(
      JSON.stringify(
        {
          format: "agon-workspace-v2",
          exportedAt: new Date().toISOString(),
          settings,
          devices,
          sessions,
          jobs,
          audit,
          relays,
        },
        null,
        2,
      ),
      `agon-workspace-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
    );
    toast("Workspace exported", "The export contains no device credentials.");
  };
  const storageSize = new Blob([
    Object.keys(localStorage)
      .filter((key) => key.startsWith("sc."))
      .map((key) => localStorage.getItem(key))
      .join(""),
  ]).size;

  return (
    <div>
      <PageHeader
        eyebrow="Workspace administration"
        title="Settings"
        description="Configure account preferences and review the hosted control plane."
        actions={
          <Button variant="primary" icon={Save} onClick={save}>
            Save preferences
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <div className="space-y-2">
          {sections.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition ${
                section === item.id
                  ? "border-lime-300/20 bg-lime-300/[0.05]"
                  : "border-transparent hover:bg-white/[0.025]"
              }`}
            >
              <div
                className={`rounded-lg p-2 ${
                  section === item.id
                    ? "bg-lime-300/[0.08] text-lime-300"
                    : "bg-white/[0.03] text-slate-500"
                }`}
              >
                <item.icon size={16} />
              </div>
              <div>
                <p
                  className={`text-[11px] font-medium ${
                    section === item.id ? "text-white" : "text-slate-400"
                  }`}
                >
                  {item.label}
                </p>
                <p className="mt-0.5 text-[8px] text-slate-600">{item.description}</p>
              </div>
            </button>
          ))}
          <Panel className="mt-4 p-4">
            <div className="flex items-center gap-2">
              <Database size={14} className="text-slate-500" />
              <p className="text-[10px] font-medium text-slate-300">Browser cache</p>
            </div>
            <p className="mt-2 text-[9px] leading-4 text-slate-600">
              {devices.length + sessions.length + jobs.length + audit.length + relays.length} cached records ·{" "}
              {(storageSize / 1024).toFixed(1)} KB stored in this browser.
            </p>
          </Panel>
        </div>

        <motion.div
          key={section}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {section === "general" && (
            <Panel className="overflow-hidden">
              <div className="border-b border-white/[0.07] p-5 sm:p-6">
                <h2 className="font-display text-base font-semibold text-white">
                  Workspace identity
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  Used in the console and workspace exports.
                </p>
              </div>
              <div className="space-y-5 p-5 sm:p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Organization name</label>
                    <input
                      className="input"
                      value={settings.organization}
                      onChange={(event) =>
                        updateSettings({ organization: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Console display name</label>
                    <input
                      className="input"
                      value={settings.consoleName}
                      onChange={(event) =>
                        updateSettings({ consoleName: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Default device group</label>
                    <select
                      className="input"
                      value={settings.defaultGroup}
                      onChange={(event) =>
                        updateSettings({ defaultGroup: event.target.value })
                      }
                    >
                      {[
                        "Unassigned",
                        "Infrastructure",
                        "Engineering",
                        "People",
                        "Sales",
                        "Marketing",
                        "Executive",
                        "Retail",
                        "Field Ops",
                        "Finance",
                      ].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Operator idle timeout</label>
                    <select
                      className="input"
                      value={settings.sessionTimeout}
                      onChange={(event) =>
                        updateSettings({ sessionTimeout: Number(event.target.value) })
                      }
                    >
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>60 minutes</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end border-t border-white/[0.06] pt-5">
                  <Button variant="primary" icon={Check} onClick={save}>
                    Save general settings
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          {section === "connection" && (
            <div className="space-y-4">
              <Panel className="overflow-hidden">
                <div className="border-b border-white/[0.07] p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-base font-semibold text-white">
                        Agon hosted control plane
                      </h2>
                      <p className="mt-1 text-[11px] text-slate-500">
                        The relay is hosted with this console. Agents connect to it over outbound WebSockets.
                      </p>
                    </div>
                    <Badge tone="green" dot>
                      {devices.filter((device) => !device.sample).length} live devices
                    </Badge>
                  </div>
                </div>
                <div className="space-y-5 p-5 sm:p-6">
                  <div className="rounded-xl border border-white/[0.06] bg-black/15 p-4">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate-600">
                      Hosted API
                    </p>
                    <p className="mt-2 break-all font-mono text-[11px] text-slate-300">
                      {window.location.origin}/api/agon
                    </p>
                    <p className="mt-2 text-[10px] leading-5 text-slate-500">
                      Sign-in protects operator actions. Device credentials are generated locally, and each new endpoint requires pairing-code approval before relay access.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="primary"
                      icon={syncing ? LoaderCircle : RefreshCw}
                      disabled={syncing}
                      onClick={() => void syncControlPlane()}
                    >
                      {syncing ? "Synchronizing…" : "Synchronize now"}
                    </Button>
                    <Button
                      icon={SlidersHorizontal}
                      onClick={() => navigate("/deployment")}
                    >
                      Build an installer
                    </Button>
                  </div>
                  <p className="text-[10px] leading-5 text-slate-600">
                    Device, job, session and audit data is stored in the server database and refreshes automatically while this console is open.
                  </p>
                </div>
              </Panel>
            </div>
          )}

          {section === "security" && (
            <Panel className="overflow-hidden">
              <div className="border-b border-white/[0.07] p-5 sm:p-6">
                <h2 className="font-display text-base font-semibold text-white">
                  Security & consent profile
                </h2>
                <p className="mt-1 text-[11px] text-slate-500">
                  Defaults for support requests and visible endpoint behavior.
                </p>
              </div>
              <div className="divide-y divide-white/[0.06] px-5 sm:px-6">
                {[
                  {
                    key: "requireConsent" as const,
                    title: "Require interactive consent by default",
                    copy: "New support invitations start in interactive mode. An endpoint may require local approval.",
                  },
                  {
                    key: "requireMfa" as const,
                    title: "Require MFA for privileged operators",
                    copy: "Configure MFA in your identity provider. This setting records the workspace preference.",
                  },
                  {
                    key: "recordSessions" as const,
                    title: "Retain session records",
                    copy: "Keep support request metadata in the workspace. Session media is not captured.",
                  },
                  {
                    key: "notifyOnRecording" as const,
                    title: "Show recording notices",
                    copy: "Display notices if a separately approved recording module is added.",
                  },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-5 py-5"
                  >
                    <div>
                      <p className="text-[12px] font-medium text-slate-200">
                        {item.title}
                      </p>
                      <p className="mt-1 max-w-xl text-[10px] leading-5 text-slate-500">
                        {item.copy}
                      </p>
                    </div>
                    <Toggle
                      checked={settings[item.key]}
                      onChange={(checked) => updateSettings({ [item.key]: checked })}
                      label={item.title}
                    />
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {section === "data" && (
            <div className="space-y-4">
              <Panel className="p-5 sm:p-6">
                <h2 className="font-display text-base font-semibold text-white">
                  Workspace export
                </h2>
                <p className="mt-1 max-w-xl text-[11px] leading-5 text-slate-500">
                  Download cached device, session, job, audit and preference data. Device credentials are never included.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Fleet records", value: devices.length },
                    { label: "Session records", value: sessions.length },
                    { label: "Audit events", value: audit.length },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-white/[0.025] p-4">
                      <p className="font-display text-2xl font-semibold text-white">
                        {item.value}
                      </p>
                      <p className="mt-1 text-[9px] text-slate-600">{item.label}</p>
                    </div>
                  ))}
                </div>
                <Button className="mt-5" icon={Download} onClick={exportWorkspace}>
                  Export workspace JSON
                </Button>
              </Panel>
              <Panel className="border-rose-300/10 p-5 sm:p-6">
                <h2 className="font-display text-base font-semibold text-rose-100">
                  Clear this browser’s cache
                </h2>
                <p className="mt-1 max-w-xl text-[11px] leading-5 text-slate-500">
                  Remove local cached data and preferences. This does not delete server records, revoke agents or uninstall software.
                </p>
                <Button
                  variant="danger"
                  className="mt-5"
                  icon={RotateCcw}
                  onClick={() => setResetOpen(true)}
                >
                  Clear local cache
                </Button>
              </Panel>
            </div>
          )}
        </motion.div>
      </div>
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Clear this browser’s local cache?"
        description="Server-side devices and audit records remain unchanged."
        size="sm"
      >
        <div className="p-6">
          <p className="text-sm leading-6 text-slate-400">
            Cached records will be loaded from your account again after clearing.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                resetWorkspace();
                setResetOpen(false);
              }}
            >
              Clear cache
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
