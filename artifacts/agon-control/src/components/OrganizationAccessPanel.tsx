import {
  Building2,
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  Copy,
  Link2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Panel } from "./UI";
import type {
  OrganizationInvitation,
  OrganizationMember,
  OrganizationPolicy,
  OrganizationRole,
  OrganizationSummary,
} from "../lib/types";

export interface OrganizationAccessPanelProps {
  organizations: OrganizationSummary[];
  activeOrganizationId: string;
  currentUserId: string;
  currentRole: OrganizationRole;
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
  policy: OrganizationPolicy;
  deviceGroups: string[];
  loading: boolean;
  saving: boolean;
  inviteLink: string | null;
  error: string | null;
  onSwitchOrganization: (id: string) => void;
  onCreateOrganization: (name: string) => Promise<void>;
  onRenameOrganization: (name: string) => Promise<void>;
  onCreateInvitation: (role: OrganizationRole) => Promise<string>;
  onAcceptInvitation: (token: string) => Promise<void>;
  onRevokeInvitation: (id: string) => Promise<void>;
  onUpdateMemberRole: (userId: string, role: OrganizationRole) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onSavePolicy: (policy: OrganizationPolicy) => Promise<void>;
  onRefresh: () => void;
}

const roles: OrganizationRole[] = ["owner", "admin", "technician", "auditor"];
const unattendedRoles: OrganizationRole[] = ["owner", "admin", "technician"];
const roleDescriptions: Record<OrganizationRole, string> = {
  owner: "Full organization control, including administrator access.",
  admin: "Manage members, invitations, and organization policy.",
  technician: "Provide authorized support to assigned endpoints.",
  auditor: "Review organization access without managing settings.",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function initials(value: string) {
  const parts = value.split(/[@.\s_-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2)).toUpperCase();
}

export default function OrganizationAccessPanel({
  organizations,
  activeOrganizationId,
  currentUserId,
  currentRole,
  members,
  invitations,
  policy,
  deviceGroups,
  loading,
  saving,
  inviteLink,
  error,
  onSwitchOrganization,
  onCreateOrganization,
  onRenameOrganization,
  onCreateInvitation,
  onAcceptInvitation,
  onRevokeInvitation,
  onUpdateMemberRole,
  onRemoveMember,
  onSavePolicy,
  onRefresh,
}: OrganizationAccessPanelProps) {
  const activeOrganization = organizations.find((item) => item.id === activeOrganizationId);
  const canManage = currentRole === "owner" || currentRole === "admin";
  const isOwner = currentRole === "owner";
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [rename, setRename] = useState("");
  const [invitationRole, setInvitationRole] = useState<OrganizationRole>("technician");
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [createdLink, setCreatedLink] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [copied, setCopied] = useState(false);
  const [acceptToken, setAcceptToken] = useState("");
  const [policyDraft, setPolicyDraft] = useState<OrganizationPolicy>(policy);
  const [notice, setNotice] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);
  const [inviteToRevoke, setInviteToRevoke] = useState<string | null>(null);

  useEffect(() => {
    setPolicyDraft(policy);
  }, [policy, activeOrganizationId]);
  useEffect(() => {
    setRename(activeOrganization?.name ?? "");
  }, [activeOrganization?.id, activeOrganization?.name]);
  useEffect(() => {
    setCreatedLink(inviteLink ?? "");
  }, [inviteLink]);

  const policyChanged = useMemo(
    () =>
      policyDraft.unattendedDesktopEnabled !== policy.unattendedDesktopEnabled ||
      policyDraft.maxSessionMinutes !== policy.maxSessionMinutes ||
      policyDraft.allowedRoles.join("|") !== policy.allowedRoles.join("|") ||
      policyDraft.allowedGroups.join("|") !== policy.allowedGroups.join("|"),
    [policyDraft, policy],
  );

  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4000);
  };

  const createOrganization = async () => {
    const name = newOrganizationName.trim();
    if (!name) return;
    try {
      await onCreateOrganization(name);
      setNewOrganizationName("");
      announce(`Organization “${name}” created.`);
    } catch {
      announce("Organization could not be created. Try again.");
    }
  };

  const saveRename = async () => {
    const name = rename.trim();
    if (!name || name === activeOrganization?.name) return;
    try {
      await onRenameOrganization(name);
      announce("Organization name updated.");
    } catch {
      announce("Organization name could not be updated. Try again.");
    }
  };

  const createInvitation = async () => {
    setInvitationBusy(true);
    setInvitationError("");
    try {
      const link = await onCreateInvitation(invitationRole);
      setCreatedLink(link);
      announce("One-time invitation link created.");
    } catch {
      setInvitationError("The invitation could not be created. Try again.");
    } finally {
      setInvitationBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopied(true);
      announce("Invitation link copied.");
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setInvitationError("Clipboard access is unavailable. Select and copy the link manually.");
    }
  };

  const updateDraftRole = (role: OrganizationRole, checked: boolean) => {
    setPolicyDraft((previous) => ({
      ...previous,
      allowedRoles: checked
        ? [...new Set([...previous.allowedRoles, role])]
        : previous.allowedRoles.filter((item) => item !== role),
    }));
  };

  const updateDraftGroup = (group: string, checked: boolean) => {
    setPolicyDraft((previous) => ({
      ...previous,
      allowedGroups: checked
        ? [...new Set([...previous.allowedGroups, group])]
        : previous.allowedGroups.filter((item) => item !== group),
    }));
  };

  const savePolicy = async () => {
    try {
      await onSavePolicy(policyDraft);
      announce("Organization access policy saved.");
    } catch {
      announce("The access policy could not be saved. Review the error and try again.");
    }
  };

  const acceptInvitation = async () => {
    if (!acceptToken.trim()) return;
    try {
      await onAcceptInvitation(acceptToken.trim());
      setAcceptToken("");
      announce("Invitation accepted.");
    } catch {
      announce("The invitation could not be accepted. Check that it is valid and unused.");
    }
  };

  const runAction = async (action: () => Promise<void>, success: string) => {
    try {
      await action();
      announce(success);
    } catch {
      announce("The action failed. Review the access error and try again.");
    }
  };

  return (
    <div className="space-y-5" data-testid="panel-organization-access">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-2">Organization administration</p>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-white">Organization &amp; access</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Manage trusted operators and set the boundaries for authorized endpoint support.
          </p>
        </div>
        <Button icon={RefreshCw} onClick={onRefresh} disabled={loading} data-testid="button-refresh-organization">
          Refresh access data
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)]">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] p-5">
            <div className="flex items-center gap-3">
              <span className="rounded-xl border border-lime-700/15 bg-lime-700/[0.07] p-2.5 text-lime-700"><Building2 size={18} /></span>
              <div>
                <h3 className="font-display text-sm font-semibold text-white">Organization</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Current workspace boundary</p>
              </div>
            </div>
            <Badge tone={isOwner ? "green" : "neutral"}>{currentRole} access</Badge>
          </div>
          <div className="space-y-5 p-5">
            <div>
              <label className="label" htmlFor="organization-switcher">Active organization</label>
              <div className="relative">
                <select
                  id="organization-switcher"
                  className="input appearance-none pr-10"
                  value={activeOrganizationId}
                  onChange={(event) => onSwitchOrganization(event.target.value)}
                  data-testid="select-active-organization"
                >
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}{organization.isPersonal ? " · Personal" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3 text-slate-500" size={15} />
              </div>
            </div>

            {canManage ? (
              <div className="grid gap-4 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
                <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
                  <label className="label" htmlFor="rename-organization">Organization name</label>
                  <div className="flex gap-2">
                    <input id="rename-organization" className="input min-w-0" value={rename} maxLength={100} onChange={(event) => setRename(event.target.value)} disabled={!activeOrganization || saving} data-testid="input-rename-organization" />
                    <Button type="submit" size="sm" disabled={!activeOrganization || !rename.trim() || rename.trim() === activeOrganization.name || saving} data-testid="button-rename-organization">Save</Button>
                  </div>
                </form>
                <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void createOrganization(); }}>
                  <label className="label" htmlFor="create-organization">Create organization</label>
                  <div className="flex gap-2">
                    <input id="create-organization" className="input min-w-0" placeholder="Organization name" value={newOrganizationName} maxLength={100} onChange={(event) => setNewOrganizationName(event.target.value)} disabled={saving} data-testid="input-create-organization" />
                    <Button type="submit" size="sm" icon={Plus} disabled={!newOrganizationName.trim() || saving} data-testid="button-create-organization">Create</Button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3 text-xs leading-5 text-slate-500">
                <LockKeyhole className="mt-0.5 shrink-0" size={14} />
                Organization settings are managed by owners and administrators.
              </div>
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] p-5">
            <div className="flex items-center gap-3">
              <span className="rounded-xl border border-cyan-700/15 bg-cyan-700/[0.06] p-2.5 text-cyan-700"><ShieldCheck size={18} /></span>
              <div>
                <h3 className="font-display text-sm font-semibold text-white">Unattended desktop access</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Two independent controls are required</p>
              </div>
            </div>
            <Badge tone={policy.unattendedDesktopEnabled ? "amber" : "neutral"} dot>
              {policy.unattendedDesktopEnabled ? "Policy enabled" : "Disabled by default"}
            </Badge>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-xl border border-amber-700/15 bg-amber-700/[0.045] p-4">
              <div className="flex items-start gap-3">
                <LockKeyhole className="mt-0.5 shrink-0 text-amber-700" size={16} />
                <p className="text-xs leading-5 text-slate-600">
                  Unattended access is disabled by default. It requires both an administrator-enabled organization policy and an endpoint package explicitly opted in at installation. This policy alone never enables unattended access on an endpoint.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
              <div>
                <p className="text-xs font-medium text-slate-200">Allow unattended desktop sessions</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">Organization policy gate; installation opt-in is still required.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={policyDraft.unattendedDesktopEnabled}
                aria-label="Allow unattended desktop sessions"
                disabled={!canManage || saving}
                onClick={() => setPolicyDraft((previous) => ({ ...previous, unattendedDesktopEnabled: !previous.unattendedDesktopEnabled }))}
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${policyDraft.unattendedDesktopEnabled ? "border-lime-700/30 bg-lime-700" : "border-slate-300 bg-slate-200"}`}
                data-testid="switch-unattended-desktop-policy"
              >
                <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${policyDraft.unattendedDesktopEnabled ? "translate-x-[20px]" : "translate-x-0.5"}`} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="max-session-duration">Maximum session duration</label>
                <div className="relative">
                  <select id="max-session-duration" className="input pr-10" value={policyDraft.maxSessionMinutes} onChange={(event) => setPolicyDraft((previous) => ({ ...previous, maxSessionMinutes: Number(event.target.value) }))} disabled={!canManage || saving} data-testid="select-max-session-duration">
                    {[15, 30, 60, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                  </select>
                  <Clock3 aria-hidden="true" className="pointer-events-none absolute right-3 top-3 text-slate-500" size={14} />
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.025] px-3 py-2.5">
                <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500">Current maximum</p>
                <p className="mt-1 font-display text-lg font-semibold text-white" data-testid="text-max-session-duration">{policy.maxSessionMinutes} <span className="text-xs font-normal text-slate-500">minutes</span></p>
              </div>
            </div>

            <div>
              <p className="label mb-2">Roles permitted by policy</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {unattendedRoles.map((role) => (
                  <label key={role} className={`flex items-start gap-2.5 rounded-lg border border-white/[0.06] p-3 ${!canManage ? "opacity-65" : "cursor-pointer hover:bg-white/[0.025]"}`}>
                    <input type="checkbox" className="mt-0.5 accent-lime-700" checked={policyDraft.allowedRoles.includes(role)} onChange={(event) => updateDraftRole(role, event.target.checked)} disabled={!canManage || saving} data-testid={`checkbox-policy-role-${role}`} />
                    <span><span className="block text-[11px] font-medium capitalize text-slate-200">{role}</span><span className="mt-0.5 block text-[9px] leading-4 text-slate-500">{roleDescriptions[role]}</span></span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="label mb-2">Allowed device groups</p>
              {deviceGroups.length ? (
                <div className="flex flex-wrap gap-2">
                  {deviceGroups.map((group) => (
                    <label key={group} className={`inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] text-slate-600 ${canManage ? "cursor-pointer hover:border-lime-700/25" : "opacity-65"}`}>
                      <input type="checkbox" className="accent-lime-700" checked={policyDraft.allowedGroups.includes(group)} onChange={(event) => updateDraftGroup(group, event.target.checked)} disabled={!canManage || saving} data-testid={`checkbox-policy-group-${group}`} />
                      {group}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-white/[0.1] px-3 py-4 text-xs text-slate-500">No device groups are available in this organization.</p>
              )}
            </div>
            {canManage && (
              <div className="flex justify-end border-t border-white/[0.06] pt-4">
                  <Button variant="primary" icon={Check} onClick={() => void savePolicy()} disabled={!policyChanged || saving} data-testid="button-save-organization-policy">
                  {saving ? "Saving policy…" : "Save access policy"}
                </Button>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] p-5">
            <div className="flex items-center gap-3">
              <span className="rounded-xl border border-lime-700/15 bg-lime-700/[0.07] p-2.5 text-lime-700"><Users size={18} /></span>
              <div>
                <h3 className="font-display text-sm font-semibold text-white">Organization members</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">{members.length} {members.length === 1 ? "member" : "members"} · roles define console permissions</p>
              </div>
            </div>
            {canManage && <Badge>{members.length} total</Badge>}
          </div>
          {loading ? (
            <div className="space-y-3 p-5" aria-label="Loading organization members" aria-busy="true">
              {[0, 1, 2].map((item) => <div key={item} className="flex animate-pulse items-center gap-3 py-2"><span className="h-9 w-9 rounded-full bg-lime-900/10" /><span className="h-3 w-32 rounded bg-lime-900/10" /><span className="ml-auto h-6 w-20 rounded bg-lime-900/10" /></div>)}
            </div>
          ) : members.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Users className="mx-auto mb-3 text-slate-400" size={22} />
              <p className="text-sm font-medium text-slate-600">No members to show</p>
              <p className="mt-1 text-xs text-slate-500">Organization membership will appear here when available.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.055]">
              {members.map((member) => {
                const self = member.userId === currentUserId;
                const canChangeThisRole = canManage && !self && (isOwner || (member.role !== "admin" && member.role !== "owner"));
                const canRemoveThisMember = canManage && !self && (isOwner || (member.role !== "admin" && member.role !== "owner"));
                return (
                  <div key={member.userId} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid={`row-organization-member-${member.userId}`}>
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-lime-800/10 bg-lime-800/[0.06] font-mono text-[10px] font-medium text-lime-800">{initials(member.userId)}</div>
                    <div className="min-w-[130px] flex-1">
                      <p className="break-all text-xs font-medium text-slate-200">{member.userId}{self && <span className="ml-2 text-[9px] font-normal text-slate-500">(you)</span>}</p>
                      <p className="mt-1 text-[9px] text-slate-500">Joined {formatDate(member.joinedAt)}</p>
                    </div>
                    {canChangeThisRole ? (
                      <select aria-label={`Role for ${member.userId}`} className="input w-auto min-w-[125px] py-2 text-[11px]" value={member.role} onChange={(event) => void runAction(() => onUpdateMemberRole(member.userId, event.target.value as OrganizationRole), "Member role updated.")} disabled={saving} data-testid={`select-member-role-${member.userId}`}>
                        {roles.filter((role) => role !== "owner" && (isOwner || role !== "admin")).map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
                      </select>
                    ) : <Badge tone={member.role === "owner" ? "green" : "neutral"}>{member.role}</Badge>}
                    {canRemoveThisMember && (
                      memberToRemove === member.userId ? (
                        <div className="flex items-center gap-1">
                          <Button variant="danger" size="sm" icon={Trash2} onClick={() => { void runAction(() => onRemoveMember(member.userId), "Member removed."); setMemberToRemove(null); }} data-testid={`button-confirm-remove-member-${member.userId}`}>Remove</Button>
                          <Button variant="ghost" size="sm" onClick={() => setMemberToRemove(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove ${member.userId}`} onClick={() => setMemberToRemove(member.userId)} data-testid={`button-remove-member-${member.userId}`}>Remove</Button>
                      )
                    )}
                    {!isOwner && (member.role === "admin" || member.role === "owner") && <span className="basis-full text-right text-[9px] text-slate-500">Only an owner can change or remove an administrator.</span>}
                  </div>
                );
              })}
            </div>
          )}
          {!isOwner && canManage && <p className="border-t border-white/[0.06] px-5 py-3 text-[10px] leading-4 text-slate-500">Only an owner can grant or revoke administrator roles. Administrators cannot change owner access.</p>}
        </Panel>

        <div className="space-y-4">
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-white/[0.07] p-5">
              <span className="rounded-xl border border-cyan-700/15 bg-cyan-700/[0.06] p-2.5 text-cyan-700"><UserPlus size={18} /></span>
              <div>
                <h3 className="font-display text-sm font-semibold text-white">One-time invitation</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Generate a link for a specific organization role</p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {canManage ? (
                <>
                  <div>
                    <label className="label" htmlFor="invitation-role">Invite as</label>
                    <select id="invitation-role" className="input" value={invitationRole} onChange={(event) => setInvitationRole(event.target.value as OrganizationRole)} disabled={saving || invitationBusy} data-testid="select-invitation-role">
                      {roles.filter((role) => role !== "owner" && (isOwner || role !== "admin")).map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
                    </select>
                    {!isOwner && <p className="mt-1.5 text-[10px] text-slate-500">Only owners can invite administrators.</p>}
                  </div>
                  <Button variant="primary" icon={Link2} onClick={() => void createInvitation()} disabled={invitationBusy || saving} data-testid="button-create-invitation">
                    {invitationBusy ? "Creating secure link…" : "Create one-time link"}
                  </Button>
                  {createdLink && (
                    <div className="rounded-xl border border-lime-800/15 bg-lime-800/[0.035] p-3.5" role="status" data-testid="status-invitation-created">
                      <p className="mb-2 flex items-center gap-2 text-[10px] font-medium text-lime-800"><Check size={13} />One-time link ready</p>
                      <div className="flex gap-2">
                        <input className="input min-w-0 font-mono text-[10px]" aria-label="One-time invitation link" readOnly value={createdLink} onFocus={(event) => event.currentTarget.select()} data-testid="input-invitation-link" />
                        <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copyInvite()} data-testid="button-copy-invitation-link">{copied ? "Copied" : "Copy"}</Button>
                      </div>
                      <p className="mt-2 text-[9px] leading-4 text-slate-500">Share only with the intended person. This link is one-time use; expiration and revocation are shown below.</p>
                    </div>
                  )}
                  {invitationError && <p role="alert" className="text-xs text-rose-700">{invitationError}</p>}
                </>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3 text-xs leading-5 text-slate-500">
                  <LockKeyhole className="mt-0.5 shrink-0" size={14} />
                  Only organization owners and administrators can create invitations.
                </div>
              )}
              <div className="border-t border-white/[0.06] pt-4">
                <label className="label" htmlFor="accept-invitation-token">Accept an invitation</label>
                <div className="flex gap-2">
                  <input id="accept-invitation-token" className="input min-w-0" placeholder="Paste invitation link or token" value={acceptToken} onChange={(event) => setAcceptToken(event.target.value)} data-testid="input-accept-invitation-token" />
                  <Button size="sm" icon={Check} onClick={() => void acceptInvitation()} disabled={!acceptToken.trim() || saving} data-testid="button-accept-invitation">Accept</Button>
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] p-5">
              <div>
                <h3 className="font-display text-sm font-semibold text-white">Pending invitations</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Review active links and expiry dates</p>
              </div>
              <Badge>{invitations.length} active</Badge>
            </div>
            {loading ? (
              <div className="space-y-3 p-5" aria-label="Loading invitations" aria-busy="true"><div className="h-10 animate-pulse rounded bg-lime-900/10" /><div className="h-10 animate-pulse rounded bg-lime-900/10" /></div>
            ) : invitations.length === 0 ? (
              <div className="px-5 py-7 text-center">
                <Link2 className="mx-auto mb-2 text-slate-400" size={19} />
                <p className="text-xs font-medium text-slate-600">No pending invitations</p>
                <p className="mt-1 text-[10px] text-slate-500">New links will appear here with their role and expiry.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.055]">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid={`row-organization-invitation-${invitation.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium capitalize text-slate-200">{invitation.role} invitation</p>
                      <p className="mt-1 text-[9px] text-slate-500">Created {formatDate(invitation.createdAt)} · Expires {formatDate(invitation.expiresAt)}</p>
                    </div>
                    {canManage && (inviteToRevoke === invitation.id ? (
                      <div className="flex items-center gap-1">
                        <Button variant="danger" size="sm" icon={X} onClick={() => { void runAction(() => onRevokeInvitation(invitation.id), "Invitation revoked."); setInviteToRevoke(null); }} data-testid={`button-confirm-revoke-invitation-${invitation.id}`}>Revoke</Button>
                        <Button variant="ghost" size="sm" onClick={() => setInviteToRevoke(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" icon={X} onClick={() => setInviteToRevoke(invitation.id)} data-testid={`button-revoke-invitation-${invitation.id}`}>Revoke</Button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
        <Shield className="mt-0.5 shrink-0 text-slate-500" size={15} />
        <p className="flex-1 text-[10px] leading-5 text-slate-500">
          Roles control organization administration and support eligibility. Unattended access remains subject to organization policy and explicit endpoint installation opt-in.
        </p>
        <span className="inline-flex items-center gap-1.5 text-[9px] text-slate-500"><Clipboard size={12} />Changes are recorded by the organization service</span>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-700/15 bg-rose-700/[0.04] px-4 py-3 text-xs text-rose-700" data-testid="status-organization-error">{error}</div>}
      {notice && <div role="status" aria-live="polite" className="rounded-xl border border-lime-800/15 bg-lime-800/[0.04] px-4 py-3 text-xs text-lime-800" data-testid="status-organization-notice">{notice}</div>}
    </div>
  );
}
