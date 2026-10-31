/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { initialSettings } from '../lib/data'
import type { AppSettings, AuditEvent, Device, Job, OrganizationInvitation, OrganizationMember, OrganizationPolicy, OrganizationRole, OrganizationSummary, Platform, Relay, SupportSession, ToastMessage } from '../lib/types'

interface SessionInput {
  customer: string
  customerEmail: string
  deviceId?: string
  issue: string
  access: 'interactive' | 'unattended'
  technician: string
}

interface StoreValue {
  userId: string
  organizations: OrganizationSummary[]
  activeOrganizationId: string
  organizationRole: OrganizationRole
  organizationMembers: OrganizationMember[]
  organizationInvitations: OrganizationInvitation[]
  organizationPolicy: OrganizationPolicy
  organizationLoading: boolean
  organizationSaving: boolean
  organizationInviteLink: string | null
  organizationError: string | null
  canStartSupportSessions: boolean
  devices: Device[]
  sessions: SupportSession[]
  relays: Relay[]
  jobs: Job[]
  audit: AuditEvent[]
  settings: AppSettings
  toasts: ToastMessage[]
  syncing: boolean
  updateSettings: (patch: Partial<AppSettings>) => void
  updateDevice: (id: string, patch: Partial<Device>) => void
  removeDevices: (ids: string[]) => void
  createSession: (input: SessionInput) => Promise<SupportSession>
  connectSession: (id: string) => Promise<{ viewerToken: string }>
  endSession: (id: string) => Promise<void>
  updateSession: (id: string, patch: Partial<SupportSession>) => void
  runJob: (action: Job['action'], deviceIds: string[], name?: string) => Promise<void>
  addRelay: (relay: Pick<Relay, 'name' | 'region' | 'city' | 'url'>) => void
  removeRelay: (id: string) => void
  testRelay: (id: string) => Promise<boolean>
  syncControlPlane: (silent?: boolean) => Promise<boolean>
  switchOrganization: (id: string) => void
  createOrganization: (name: string) => Promise<void>
  renameOrganization: (name: string) => Promise<void>
  createOrganizationInvitation: (role: OrganizationRole) => Promise<string>
  acceptOrganizationInvitation: (tokenOrLink: string) => Promise<void>
  revokeOrganizationInvitation: (id: string) => Promise<void>
  updateOrganizationMemberRole: (memberId: string, role: OrganizationRole) => Promise<void>
  removeOrganizationMember: (memberId: string) => Promise<void>
  saveOrganizationPolicy: (policy: OrganizationPolicy) => Promise<void>
  canRequestUnattended: (deviceId?: string) => boolean
  requestControlPlane: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  addAudit: (event: Omit<AuditEvent, 'id' | 'at'>) => void
  toast: (title: string, description?: string, tone?: ToastMessage['tone']) => void
  dismissToast: (id: string) => void
  resetWorkspace: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

function readPersistentState<T>(key: string, initial: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return initial
    return JSON.parse(stored) as T
  } catch { return initial }
}

function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const initialRef = useRef(initial)
  const [entry, setEntry] = useState(() => ({
    key,
    value: readPersistentState(key, initialRef.current),
  }))
  useEffect(() => {
    if (entry.key !== key) setEntry({ key, value: readPersistentState(key, initialRef.current) })
  }, [entry.key, key])
  const value = entry.key === key ? entry.value : initialRef.current
  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setEntry((current) => {
      const base = current.key === key ? current.value : readPersistentState(key, initialRef.current)
      const updated = typeof next === 'function'
        ? (next as (previous: T) => T)(base)
        : next
      return { key, value: updated }
    })
  }, [key])
  useEffect(() => {
    if (entry.key !== key) return
    try {
      localStorage.setItem(key, JSON.stringify(entry.value))
    } catch { /* storage can be disabled */ }
  }, [entry, key])
  return [value, setValue]
}

const defaultOrganizationPolicy: OrganizationPolicy = {
  unattendedDesktopEnabled: false,
  allowedRoles: ['owner', 'admin'],
  allowedGroups: [],
  maxSessionMinutes: 30,
}

function platformFromOs(os = ''): Platform {
  const value = os.toLowerCase()
  if (value.includes('darwin') || value.includes('mac')) return 'macos'
  if (value.includes('android')) return 'android'
  if (value.includes('linux') || value.includes('ubuntu') || value.includes('debian')) return 'linux'
  return 'windows'
}

function makeHostedRelay(): Relay[] {
  return [{
    id: 'agon-hosted',
    name: 'Agon Hosted Relay',
    region: 'Global',
    city: 'Hosted',
    url: `${window.location.origin}/api/agon`,
    status: 'unchecked',
    latency: 0,
    load: 0,
    connections: 0,
    version: '1.0.0',
    primary: true,
    sample: false,
  }]
}

export function AppStoreProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const scopedKey = (name: string) => `sc.${userId}.${name}.v2`
  const [activeOrganizationId, setActiveOrganizationId] = usePersistentState(scopedKey('active-organization'), userId)
  const organizationScopedKey = (name: string) => `sc.${userId}.${activeOrganizationId}.${name}.v3`
  const [devices, setDevices] = usePersistentState<Device[]>(organizationScopedKey('devices'), [])
  const [sessions, setSessions] = usePersistentState<SupportSession[]>(organizationScopedKey('sessions'), [])
  const [relays, setRelays] = usePersistentState<Relay[]>(organizationScopedKey('relays'), makeHostedRelay())
  const [jobs, setJobs] = usePersistentState<Job[]>(organizationScopedKey('jobs'), [])
  const [audit, setAudit] = usePersistentState<AuditEvent[]>(organizationScopedKey('audit'), [])
  const [settings, setSettings] = usePersistentState<AppSettings>(scopedKey('settings'), initialSettings)
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([])
  const [organizationRole, setOrganizationRole] = useState<OrganizationRole>('owner')
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([])
  const [organizationInvitations, setOrganizationInvitations] = useState<OrganizationInvitation[]>([])
  const [organizationPolicy, setOrganizationPolicy] = useState<OrganizationPolicy>(defaultOrganizationPolicy)
  const [organizationLoading, setOrganizationLoading] = useState(false)
  const [organizationSaving, setOrganizationSaving] = useState(false)
  const [organizationInviteLink, setOrganizationInviteLink] = useState<string | null>(null)
  const [organizationError, setOrganizationError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [syncing, setSyncing] = useState(false)
  const syncInFlightRef = useRef(false)
  const activeOrganizationIdRef = useRef(activeOrganizationId)
  activeOrganizationIdRef.current = activeOrganizationId

  const controlPlaneFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (activeOrganizationId) headers.set('X-Agon-Organization-Id', activeOrganizationId)
    return fetch(input, {
      ...init,
      credentials: init.credentials ?? 'same-origin',
      headers,
    })
  }, [activeOrganizationId])

  const dismissToast = useCallback((id: string) => setToasts((items) => items.filter((item) => item.id !== id)), [])
  const toast = useCallback((title: string, description?: string, tone: ToastMessage['tone'] = 'success') => {
    const id = crypto.randomUUID()
    setToasts((items) => [...items.slice(-3), { id, title, description, tone }])
    window.setTimeout(() => dismissToast(id), 4800)
  }, [dismissToast])

  const addAudit = useCallback((event: Omit<AuditEvent, 'id' | 'at'>) => {
    setAudit((items) => [{ ...event, id: crypto.randomUUID(), at: new Date().toISOString() }, ...items].slice(0, 1000))
  }, [setAudit])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [setSettings])

  const updateDevice = useCallback((id: string, patch: Partial<Device>) => {
    setDevices((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [setDevices])

  const removeDevices = useCallback((ids: string[]) => {
    const names = devices.filter((item) => ids.includes(item.id)).map((item) => item.name)
    setDevices((items) => items.filter((item) => !ids.includes(item.id)))
    void Promise.all(ids.map((id) => controlPlaneFetch(`/api/agon/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }))).then((responses) => {
      const failed = responses.find((response) => !response.ok)
      if (failed) throw new Error(`Device removal failed (HTTP ${failed.status})`)
    }).catch((error) => {
      toast('Device removal failed', error instanceof Error ? error.message : 'Could not remove device', 'error')
    })
    toast('Device records removed', `${names.length} record${names.length === 1 ? '' : 's'} removed. Endpoint agents were not uninstalled.`, 'warning')
  }, [devices, setDevices, toast, controlPlaneFetch])

  const updateSession = useCallback((id: string, patch: Partial<SupportSession>) => {
    setSessions((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [setSessions])

  const createSession = useCallback(async (input: SessionInput) => {
    const device = devices.find((item) => item.id === input.deviceId)
    if (organizationRole === 'auditor') {
      throw new Error('Auditor access is read-only and cannot start support sessions.')
    }
    if (input.access === 'unattended') {
      const allowed = Boolean(
        device &&
        !device.sample &&
        device.unattendedOptIn &&
        organizationPolicy.unattendedDesktopEnabled &&
        organizationPolicy.allowedRoles.includes(organizationRole) &&
        organizationPolicy.allowedGroups.includes(device.group),
      )
      if (!allowed) {
        throw new Error('Unattended access requires an opted-in endpoint and an organization policy that allows your role and device group.')
      }
    }
    const response = await controlPlaneFetch('/api/agon/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: device?.sample ? undefined : device?.id,
        mode: input.access,
        customer: input.customer,
        issue: input.issue,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'The control plane rejected the session request')
    const remote = data.session
    const session: SupportSession = {
      id: String(remote.id),
      code: String(remote.code),
      customer: input.customer,
      customerEmail: input.customerEmail,
      deviceId: remote.deviceId || undefined,
      deviceName: String(remote.deviceName || device?.name || 'Waiting for device'),
      issue: input.issue,
      status: remote.status === 'consent_required' ? 'consent_required' : 'waiting',
      technician: input.technician || 'Operator',
      startedAt: String(remote.createdAt || new Date().toISOString()),
      durationMinutes: 0,
      access: input.access,
      relay: 'agon-hosted',
      quality: 'unmeasured',
      sample: false,
    }
    setSessions((items) => [session, ...items])
    toast('Support session created', `${session.code} · ${session.deviceName}`)
    return session
  }, [devices, organizationRole, organizationPolicy, setSessions, toast, controlPlaneFetch])

  const connectSession = useCallback(async (id: string) => {
    const response = await controlPlaneFetch(`/api/agon/sessions/${encodeURIComponent(id)}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Could not connect to endpoint (HTTP ${response.status})`)
    if (typeof data.viewerToken !== 'string') throw new Error('The relay did not return a viewer authorization.')
    setSessions((items) => items.map((session) => session.id === id ? { ...session, status: 'waiting' } : session))
    return { viewerToken: data.viewerToken as string }
  }, [setSessions, controlPlaneFetch])

  const endSession = useCallback(async (id: string) => {
    const response = await controlPlaneFetch(`/api/agon/sessions/${encodeURIComponent(id)}/end`, {
      method: 'POST',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Could not end session (HTTP ${response.status})`)
    setSessions((items) => items.map((session) => session.id === id ? { ...session, status: 'ended' } : session))
  }, [setSessions, controlPlaneFetch])

  const runJob = useCallback(async (action: Job['action'], deviceIds: string[], name?: string) => {
    const selected = devices.filter((device) => deviceIds.includes(device.id))
    if (!selected.length) { toast('Select at least one device', undefined, 'warning'); return }
    const real = selected.filter((device) => !device.sample)
    const environment: Job['environment'] = real.length ? 'relay' : 'lab'
    const id = crypto.randomUUID()
    const job: Job = {
      id, name: name || `${action.replaceAll('.', ' · ')} · ${selected.length} device${selected.length === 1 ? '' : 's'}`,
      action, deviceIds: selected.map((item) => item.id), deviceNames: selected.map((item) => item.name),
      status: environment === 'lab' ? 'running' : 'queued', createdAt: new Date().toISOString(), progress: environment === 'lab' ? 24 : 0,
      actor: 'Operator', environment, results: {},
    }
    setJobs((items) => [job, ...items])
    const isAccessPolicyCheck = action === 'session.request'
    addAudit({
      action: isAccessPolicyCheck ? 'access.policy.checked' : 'job.created',
      actor: 'Operator',
      target: selected.map((item) => item.name).join(', '),
      category: isAccessPolicyCheck ? 'access' : 'automation',
      severity: 'info',
      detail: isAccessPolicyCheck
        ? 'Requested a server-side access-policy check. No desktop session was opened.'
        : `${action} dispatched through the ${environment === 'lab' ? 'local device emulator' : 'hosted control plane'}.`,
      ip: 'This browser',
    })
    toast(isAccessPolicyCheck ? 'Checking access policy' : environment === 'lab' ? 'Lab job started' : 'Job sent to relay', `${action} · ${selected.length} target${selected.length === 1 ? '' : 's'}`, 'info')

    if (action === 'session.request') {
      const results: Record<string, string> = {}
      if (environment === 'lab') {
        for (const device of selected) {
          results[device.name] = 'Lab record only; no live endpoint policy was evaluated.'
        }
      } else {
        await Promise.all(real.map(async (device) => {
          try {
            const response = await controlPlaneFetch(
              `/api/agon/devices/${encodeURIComponent(device.id)}/access-policy`,
              { cache: 'no-store' },
            )
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || `Policy check failed (HTTP ${response.status})`)
            const interactive = data.interactiveAllowed ? 'Interactive access available' : 'Interactive access blocked for this role'
            const unattended = data.unattendedAllowed
              ? 'Unattended access permitted by current server policy'
              : `Unattended access blocked: ${String(data.unattendedReason || 'policy requirements are not met')}`
            results[device.name] = `${interactive}; ${unattended}.`
          } catch (error) {
            results[device.name] = error instanceof Error ? error.message : 'Policy check failed.'
          }
        }))
      }
      const failed = Object.values(results).every((result) => result.includes('failed') || result.includes('blocked for this role'))
      setJobs((items) => items.map((item) => item.id === id ? {
        ...item,
        status: failed ? 'failed' : 'completed',
        progress: 100,
        completedAt: new Date().toISOString(),
        summary: 'Server-side access prerequisites checked; session connection rechecks policy.',
        results,
      } : item))
      toast('Access policy check complete', `${real.length} live endpoint${real.length === 1 ? '' : 's'} checked. Session connection will recheck server policy.`, failed ? 'warning' : 'success')
      return
    }

    if (environment === 'lab') {
      window.setTimeout(() => setJobs((items) => items.map((item) => item.id === id ? { ...item, progress: 72 } : item)), 650)
      window.setTimeout(() => {
        const results: Record<string, string> = {}
        for (const device of selected) {
          if (device.status === 'offline') results[device.name] = 'Device offline · job will remain queued until the next agent connection'
          else if (action === 'agent.ping') results[device.name] = `pong · agent ${device.agentVersion} · ${device.relay} · ${Math.max(8, Math.round((device.cpu ?? 0) / 2 + 17))} ms`
          else if (action === 'inventory.refresh') results[device.name] = `${device.os} · ${device.arch} · ${device.memory === null ? 'memory not reported' : `${device.memory}% memory`} · ${device.disk === null ? 'disk not reported' : `${device.disk}% disk`}`
          else if (action === 'diagnostics.network') results[device.name] = `${device.ip} · relay ${device.relay} reachable · outbound WebSocket path healthy`
          else results[device.name] = device.access === 'unattended' ? 'Accepted by installed unattended endpoint policy' : 'Interactive approval required at the endpoint'
        }
        setJobs((items) => items.map((item) => item.id === id ? { ...item, status: 'completed', progress: 100, completedAt: new Date().toISOString(), summary: `${selected.length} lab result${selected.length === 1 ? '' : 's'} returned · no live endpoint affected`, results } : item))
        toast('Lab job completed', `${selected.length} emulated result${selected.length === 1 ? '' : 's'} ready`, 'success')
      }, 1500)
      return
    }

    const results: Record<string, string> = {}
    const remoteJobIds: Record<string, string> = {}
    const remoteStatuses: string[] = []
    let completed = 0
    await Promise.all(real.map(async (device) => {
      try {
        const response = await controlPlaneFetch(`/api/agon/devices/${encodeURIComponent(device.id)}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, payload: { requestedBy: 'web-console' } }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Dispatch failed')
        remoteJobIds[device.name] = String(data.job.id)
        remoteStatuses.push(String(data.job.status))
        results[device.name] = `${data.job.status === 'queued' ? 'Queued' : 'Dispatched'} at relay · awaiting endpoint result`
      } catch (error) { results[device.name] = error instanceof Error ? error.message : 'Dispatch failed' }
      completed += 1
      setJobs((items) => items.map((item) => item.id === id ? { ...item, progress: Math.round(completed / real.length * 100), results: { ...results } } : item))
    }))
    const failedDispatches = real.length - Object.keys(remoteJobIds).length
    const status: Job['status'] = failedDispatches === real.length
      ? 'failed'
      : remoteStatuses.length > 0 && remoteStatuses.every((value) => value === 'queued') ? 'queued' : 'running'
    setJobs((items) => items.map((item) => item.id === id ? {
      ...item, status, progress: 0, completedAt: failedDispatches === real.length ? new Date().toISOString() : undefined,
      summary: `${Object.keys(remoteJobIds).length} accepted by relay; endpoint results update automatically`,
      results: { ...results }, remoteJobIds,
    } : item))
    toast(failedDispatches ? 'Some dispatches failed' : 'Commands accepted by relay', 'Endpoint results update automatically.', failedDispatches ? 'warning' : 'info')
  }, [devices, setJobs, addAudit, toast, controlPlaneFetch])

  const addRelay = useCallback((input: Pick<Relay, 'name' | 'region' | 'city' | 'url'>) => {
    const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID()
    setRelays((items) => [...items, { ...input, id, status: 'unchecked', latency: 0, load: 0, connections: 0, version: 'unknown', primary: false, sample: false }])
    addAudit({ action: 'relay.registered', actor: 'Operator', target: id, category: 'relay', severity: 'info', detail: `${input.name} registered at ${input.url}. Health remains unchecked until the first successful probe.`, ip: 'This browser' })
    toast('Relay registered', `${input.name} is ready for a health check.`)
  }, [setRelays, addAudit, toast])

  const removeRelay = useCallback((id: string) => {
    setRelays((items) => items.filter((item) => item.id !== id))
    toast('Relay removed from console', 'The server itself was not stopped or deleted.', 'warning')
  }, [setRelays, toast])

  const testRelay = useCallback(async (id: string) => {
    const relay = relays.find((item) => item.id === id)
    if (!relay) return false
    const started = performance.now()
    try {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 6000)
      const response = await fetch(`${relay.url.replace(/\/$/, '')}/health`, { signal: controller.signal, cache: 'no-store' })
      window.clearTimeout(timeout)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const latency = Math.round(performance.now() - started)
      setRelays((items) => items.map((item) => item.id === id ? { ...item, status: 'healthy', latency, version: data.version || 'unknown', connections: data.onlineAgents ?? item.connections } : item))
      toast('Relay healthy', `${relay.name} responded in ${latency} ms.`)
      return true
    } catch (error) {
      setRelays((items) => items.map((item) => item.id === id ? { ...item, status: relay.sample ? 'unchecked' : 'offline' } : item))
      toast('Health check failed', error instanceof Error ? `${relay.name}: ${error.message}` : `${relay.name} did not respond`, 'error')
      return false
    }
  }, [relays, setRelays, toast])

  const syncControlPlane = useCallback(async (silent = false) => {
    if (syncInFlightRef.current) return false
    syncInFlightRef.current = true
    setSyncing(true)
    setOrganizationLoading(true)
    try {
      const organizationResponse = await controlPlaneFetch('/api/agon/organizations', { cache: 'no-store' })
      const organizationData = await organizationResponse.json().catch(() => ({}))
      if (!organizationResponse.ok) {
        throw new Error(organizationData.error || `Organization request failed (HTTP ${organizationResponse.status})`)
      }
      const availableOrganizations: OrganizationSummary[] = Array.isArray(organizationData.organizations)
        ? organizationData.organizations
        : []
      setOrganizations(availableOrganizations)
      const selectedOrganizationId = String(organizationData.activeOrganizationId || userId)
      const selectedOrganization = availableOrganizations.find((item) => item.id === selectedOrganizationId)
      setOrganizationRole(selectedOrganization?.role || 'owner')
      if (selectedOrganizationId !== activeOrganizationId) {
        setActiveOrganizationId(selectedOrganizationId)
        return true
      }

      const organizationPath = `/api/agon/organizations/${encodeURIComponent(activeOrganizationId)}`
      const [
        deviceResponse,
        jobResponse,
        auditResponse,
        sessionResponse,
        memberResponse,
        invitationResponse,
        policyResponse,
      ] = await Promise.all([
        controlPlaneFetch('/api/agon/devices', { cache: 'no-store' }),
        controlPlaneFetch('/api/agon/jobs', { cache: 'no-store' }),
        controlPlaneFetch('/api/agon/audit?limit=500', { cache: 'no-store' }),
        controlPlaneFetch('/api/agon/sessions', { cache: 'no-store' }),
        controlPlaneFetch(`${organizationPath}/members`, { cache: 'no-store' }),
        controlPlaneFetch(`${organizationPath}/invitations`, { cache: 'no-store' }),
        controlPlaneFetch(`${organizationPath}/policy`, { cache: 'no-store' }),
      ])
      if (activeOrganizationIdRef.current !== activeOrganizationId) return false
      const responses = [
        deviceResponse, jobResponse, auditResponse, sessionResponse,
        memberResponse, invitationResponse, policyResponse,
      ]
      const errorResponse = responses.find((response) => !response.ok)
      if (errorResponse) {
        const error = await errorResponse.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${errorResponse.status}`)
      }
      const [
        deviceData, jobData, auditData, sessionData,
        memberData, invitationData, policyData,
      ] = await Promise.all(responses.map((response) => response.json()))
      setOrganizationMembers(Array.isArray(memberData.members) ? memberData.members : [])
      setOrganizationInvitations(Array.isArray(invitationData.invitations) ? invitationData.invitations : [])
      setOrganizationPolicy(policyData as OrganizationPolicy)
      const toPercent = (used: unknown, total: unknown) => {
        if (typeof used !== 'number' || typeof total !== 'number' || total <= 0) return null
        return Math.max(0, Math.min(100, Math.round((used / total) * 100)))
      }
      const realDevices: Device[] = (Array.isArray(deviceData.devices) ? deviceData.devices : []).map((device: Record<string, unknown>) => ({
        id: String(device.id), name: String(device.name || device.hostname), hostname: String(device.hostname || device.name),
        platform: platformFromOs(String(device.os)), os: String(device.os || 'Unknown'), arch: String(device.arch || 'unknown'),
        group: String(device.group || 'Unassigned'), status: device.online ? 'online' : 'offline',
        ip: Array.isArray(device.ipAddresses) && device.ipAddresses.length
          ? device.ipAddresses.map(String).join(', ')
          : 'Not reported by agent',
        lastSeen: String(device.lastSeen || device.pairedAt || device.enrolledAt || new Date().toISOString()), agentVersion: String(device.agent || 'unknown'),
        relay: String(device.relayId || 'Agon hosted'), cpu: null,
        memory: toPercent(device.memoryUsedBytes, device.memoryTotalBytes),
        disk: toPercent(device.diskUsedBytes, device.diskTotalBytes),
        cpuCores: typeof device.cpus === 'number' ? device.cpus : undefined,
        cpuModel: typeof device.cpuModel === 'string' ? device.cpuModel : undefined,
        osVersion: typeof device.osVersion === 'string' ? device.osVersion : undefined,
        memoryTotalBytes: typeof device.memoryTotalBytes === 'number' ? device.memoryTotalBytes : undefined,
        memoryUsedBytes: typeof device.memoryUsedBytes === 'number' ? device.memoryUsedBytes : undefined,
        diskTotalBytes: typeof device.diskTotalBytes === 'number' ? device.diskTotalBytes : undefined,
        diskUsedBytes: typeof device.diskUsedBytes === 'number' ? device.diskUsedBytes : undefined,
        user: 'Not reported by agent service', tags: ['paired'],
        access: device.allowUnattended === true ? 'unattended' : 'interactive',
        unattendedOptIn: device.allowUnattended === true,
        location: 'Not reported', sample: false,
      }))
      const deviceNames = new Map(realDevices.map((device) => [device.id, device.name]))
      const remoteJobs: Job[] = (Array.isArray(jobData.jobs) ? jobData.jobs : []).flatMap((job: Record<string, unknown>) => {
        const action = String(job.action) as Job['action']
        if (!['agent.ping', 'inventory.refresh', 'diagnostics.network', 'session.request'].includes(action)) return []
        const deviceId = String(job.deviceId || '')
        const deviceName = deviceNames.get(deviceId) || deviceId || 'Unknown device'
        const remoteStatus = String(job.status)
        const status: Job['status'] = remoteStatus === 'completed' || remoteStatus === 'failed'
          ? remoteStatus
          : remoteStatus === 'queued' ? 'queued' : 'running'
        const result = job.error ? String(job.error) : job.result == null
          ? (status === 'queued' ? 'Queued at relay' : status === 'running' ? 'Dispatched; awaiting endpoint response' : status)
          : typeof job.result === 'string' ? job.result : JSON.stringify(job.result)
        return [{
          id: String(job.id), name: `${action.replaceAll('.', ' · ')} · ${deviceName}`, action,
          deviceIds: [deviceId], deviceNames: [deviceName], status,
          createdAt: String(job.createdAt || new Date().toISOString()),
          completedAt: status === 'completed' || status === 'failed' ? String(job.updatedAt || '') : undefined,
          progress: status === 'completed' || status === 'failed' ? 100 : status === 'running' ? 35 : 10,
          actor: String(job.actor || 'Relay operator'), environment: 'relay',
          summary: status === 'completed' || status === 'failed' ? result : undefined,
          results: { [deviceName]: result },
        }]
      })
      const remoteJobById = new Map(remoteJobs.map((job) => [job.id, job]))
      const liveSessions: SupportSession[] = (Array.isArray(sessionData.sessions) ? sessionData.sessions : []).map((session: Record<string, unknown>) => {
        const deviceId = String(session.deviceId || '')
        const statusValue = String(session.status)
        const startedAt = String(session.createdAt || new Date().toISOString())
        return {
          id: String(session.id), code: String(session.code || 'Pending'), customer: String(session.customer || 'Operator request'),
          customerEmail: '', deviceId, deviceName: deviceNames.get(deviceId) || deviceId || 'Unknown device',
          issue: String(session.issue || 'Consent and endpoint-policy status request.'), status: statusValue === 'active' || statusValue === 'accepted'
            ? 'active' : statusValue === 'consent_required' ? 'consent_required' : statusValue === 'disconnected'
              ? 'disconnected' : statusValue === 'declined' ? 'declined' : statusValue === 'ended' || statusValue === 'expired' ? 'ended' : 'waiting',
          technician: 'Relay operator', startedAt,
          durationMinutes: Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000)),
          access: session.mode === 'unattended' ? 'unattended' : 'interactive',
          relay: String(session.relayId || 'relay'), quality: 'unmeasured', sample: false,
        }
      })
      const relayAudit: AuditEvent[] = (Array.isArray(auditData.events) ? auditData.events : []).map((event: Record<string, unknown>) => {
        const detail = event.detail && typeof event.detail === 'object' ? event.detail as Record<string, unknown> : {}
        const action = String(event.action || 'relay.event')
        const category: AuditEvent['category'] = action.includes('session') ? 'access'
          : action.includes('device') || action.includes('agent') ? 'device'
            : action.includes('pairing') ? 'device'
              : action.includes('security') || action.includes('auth') ? 'security'
                : action.includes('relay') ? 'relay' : 'automation'
        const rawSeverity = String(event.severity)
        const severity: AuditEvent['severity'] = rawSeverity === 'warning' || rawSeverity === 'critical' || rawSeverity === 'success'
          ? rawSeverity : 'info'
        const target = String(detail.deviceId || detail.jobId || detail.sessionId || event.relayId || 'Relay')
        return {
          id: `relay-${String(event.id)}`, at: String(event.at || new Date().toISOString()), action,
          actor: String(event.actor || 'Relay'), target, category, severity,
          detail: JSON.stringify(detail), ip: 'Relay event',
        }
      })
      setDevices((current) => [...current.filter((item) => item.sample), ...realDevices])
      setSessions((current) => [...current.filter((item) => item.sample), ...liveSessions])
      setAudit((current) => [...relayAudit, ...current.filter((item) => !item.id.startsWith('relay-'))]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
      setJobs((current) => {
        const localRelayJobs = current.filter((job) => job.environment === 'relay')
        const linkedIds = new Set(localRelayJobs.flatMap((job) => Object.values(job.remoteJobIds || {})))
        const updatedAggregates = localRelayJobs.map((job) => {
          const related = Object.values(job.remoteJobIds || {}).map((id) => remoteJobById.get(id)).filter((item): item is Job => Boolean(item))
          if (!related.length) return job
          const finished = related.filter((item) => item.status === 'completed' || item.status === 'failed')
          const failed = finished.filter((item) => item.status === 'failed')
          const allJobsFinished = related.length === Object.keys(job.remoteJobIds || {}).length && finished.length === related.length
          const allTargetsAccepted = Object.keys(job.remoteJobIds || {}).length === job.deviceIds.length
          const status: Job['status'] = allJobsFinished
            ? (failed.length || !allTargetsAccepted ? 'failed' : 'completed')
            : related.every((item) => item.status === 'queued') ? 'queued' : 'running'
          return {
            ...job, status, progress: Math.round(finished.length / Math.max(job.deviceIds.length, 1) * 100),
            completedAt: allJobsFinished ? new Date().toISOString() : undefined,
            summary: `${finished.length} of ${job.deviceIds.length} endpoint responses received`,
            results: Object.assign({}, ...related.map((item) => item.results || {})),
          }
        })
        const standaloneRemoteJobs = remoteJobs.filter((job) => !linkedIds.has(job.id))
        return [...updatedAggregates, ...standaloneRemoteJobs, ...current.filter((job) => job.environment === 'lab')]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      })
      if (!silent) toast('Control plane synchronized', `${realDevices.length} devices, ${remoteJobs.length} jobs, and ${relayAudit.length} relay events loaded.`)
      return true
    } catch (error) {
      if (!silent) toast('Synchronization failed', error instanceof Error ? error.message : 'Could not reach the control plane', 'error')
      return false
    } finally {
      setSyncing(false)
      setOrganizationLoading(false)
      syncInFlightRef.current = false
    }
  }, [
    activeOrganizationId,
    userId,
    setActiveOrganizationId,
    controlPlaneFetch,
    setDevices,
    setSessions,
    setJobs,
    setAudit,
    toast,
  ])

  const organizationRequest = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await controlPlaneFetch(path, init)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || `Organization request failed (HTTP ${response.status})`)
    }
    return data
  }, [controlPlaneFetch])

  const switchOrganization = useCallback((id: string) => {
    setActiveOrganizationId(id)
    setOrganizationRole(organizations.find((item) => item.id === id)?.role || 'auditor')
    setOrganizationInviteLink(null)
    setOrganizationError(null)
    setOrganizationMembers([])
    setOrganizationInvitations([])
    setOrganizationPolicy(defaultOrganizationPolicy)
  }, [organizations, setActiveOrganizationId])

  const createOrganization = useCallback(async (name: string) => {
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      const result = await organizationRequest('/api/agon/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setOrganizations((items) => [...items, result.organization as OrganizationSummary])
      setActiveOrganizationId(String(result.organization.id))
      setOrganizationRole('owner')
      toast('Organization created', `${name} is ready for invited operators.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create organization.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [organizationRequest, setActiveOrganizationId, toast])

  const renameOrganization = useCallback(async (name: string) => {
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      await organizationRequest(`/api/agon/organizations/${encodeURIComponent(activeOrganizationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setOrganizations((items) => items.map((item) => item.id === activeOrganizationId ? { ...item, name } : item))
      toast('Organization updated', name)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not rename organization.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [activeOrganizationId, organizationRequest, toast])

  const createOrganizationInvitation = useCallback(async (role: OrganizationRole) => {
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      const result = await organizationRequest(
        `/api/agon/organizations/${encodeURIComponent(activeOrganizationId)}/invitations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        },
      )
      const inviteUrl = new URL(window.location.href)
      inviteUrl.searchParams.set('invite', String(result.token))
      const link = inviteUrl.toString()
      setOrganizationInviteLink(link)
      toast('Invitation created', 'The one-time link is ready to copy and share securely.')
      void syncControlPlane(true)
      return link
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create invitation.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [activeOrganizationId, organizationRequest, syncControlPlane, toast])

  const acceptOrganizationInvitation = useCallback(async (tokenOrLink: string) => {
    let token = tokenOrLink.trim()
    try {
      const url = new URL(token)
      token = url.searchParams.get('invite') || url.searchParams.get('token') || token
    } catch { /* a raw invitation token is also accepted */ }
    if (token.length < 40) throw new Error('Paste a valid organization invitation link or token.')
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      const result = await organizationRequest('/api/agon/organizations/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const acceptedOrganizationId = String(result.organizationId)
      setActiveOrganizationId(acceptedOrganizationId)
      setOrganizationRole(result.role as OrganizationRole)
      setOrganizationInviteLink(null)
      const url = new URL(window.location.href)
      url.searchParams.delete('invite')
      window.history.replaceState({}, '', url)
      toast('Invitation accepted', `You joined as ${String(result.role)}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not accept invitation.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [organizationRequest, setActiveOrganizationId, toast])

  const revokeOrganizationInvitation = useCallback(async (id: string) => {
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      await organizationRequest(
        `/api/agon/organizations/${encodeURIComponent(activeOrganizationId)}/invitations/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      setOrganizationInvitations((items) => items.filter((item) => item.id !== id))
      toast('Invitation revoked', 'The one-time link can no longer be used.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not revoke invitation.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [activeOrganizationId, organizationRequest, toast])

  const updateOrganizationMemberRole = useCallback(async (memberId: string, role: OrganizationRole) => {
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      await organizationRequest(
        `/api/agon/organizations/${encodeURIComponent(activeOrganizationId)}/members/${encodeURIComponent(memberId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        },
      )
      setOrganizationMembers((items) => items.map((member) => member.userId === memberId ? { ...member, role } : member))
      toast('Member role updated', `${memberId} is now ${role}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update member role.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [activeOrganizationId, organizationRequest, toast])

  const removeOrganizationMember = useCallback(async (memberId: string) => {
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      await organizationRequest(
        `/api/agon/organizations/${encodeURIComponent(activeOrganizationId)}/members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE' },
      )
      setOrganizationMembers((items) => items.filter((member) => member.userId !== memberId))
      toast('Member removed', `${memberId} can no longer access this organization.`, 'warning')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not remove organization member.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [activeOrganizationId, organizationRequest, toast])

  const saveOrganizationPolicy = useCallback(async (policy: OrganizationPolicy) => {
    setOrganizationSaving(true)
    setOrganizationError(null)
    try {
      const saved = await organizationRequest(
        `/api/agon/organizations/${encodeURIComponent(activeOrganizationId)}/policy`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(policy),
        },
      )
      setOrganizationPolicy(saved as OrganizationPolicy)
      toast('Access policy saved', policy.unattendedDesktopEnabled
        ? 'Unattended access is limited to the allowed roles, groups, and session duration.'
        : 'Unattended desktop sessions remain disabled.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save organization policy.'
      setOrganizationError(message)
      throw error
    } finally {
      setOrganizationSaving(false)
    }
  }, [activeOrganizationId, organizationRequest, toast])

  const canRequestUnattended = useCallback((deviceId?: string) => {
    if (
      !organizationPolicy.unattendedDesktopEnabled ||
      !organizationPolicy.allowedRoles.includes(organizationRole)
    ) return false
    const device = devices.find((item) => item.id === deviceId)
    return Boolean(
      device &&
      !device.sample &&
      device.unattendedOptIn &&
      organizationPolicy.allowedGroups.includes(device.group),
    )
  }, [devices, organizationPolicy, organizationRole])

  const canStartSupportSessions = organizationRole !== 'auditor'

  useEffect(() => {
    void syncControlPlane(true)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncControlPlane(true)
    }, 12_000)
    const onFocus = () => void syncControlPlane(true)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [syncControlPlane])

  const autoAcceptedInviteRef = useRef<string | null>(null)
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite')
    if (!token || autoAcceptedInviteRef.current === token) return
    autoAcceptedInviteRef.current = token
    void acceptOrganizationInvitation(token).catch((error) => {
      toast('Invitation could not be accepted', error instanceof Error ? error.message : 'Check that you are signed in and that the link is valid.', 'error')
    })
  }, [acceptOrganizationInvitation, toast])

  const resetWorkspace = useCallback(() => {
    setDevices([]); setSessions([]); setRelays(makeHostedRelay()); setJobs([]); setAudit([]); setSettings(initialSettings)
    toast('Local cache cleared', 'Live server records and installed agents were not changed.', 'info')
  }, [setDevices, setSessions, setRelays, setJobs, setAudit, setSettings, toast])

  const value = useMemo<StoreValue>(() => ({
    userId,
    organizations,
    activeOrganizationId,
    organizationRole,
    organizationMembers,
    organizationInvitations,
    organizationPolicy,
    organizationLoading,
    organizationSaving,
    organizationInviteLink,
    organizationError,
    canStartSupportSessions,
    devices, sessions, relays, jobs, audit, settings, toasts, syncing,
    updateSettings, updateDevice, removeDevices, createSession, connectSession, endSession, updateSession, runJob,
    addRelay, removeRelay, testRelay, syncControlPlane,
    switchOrganization, createOrganization, renameOrganization, createOrganizationInvitation,
    acceptOrganizationInvitation, revokeOrganizationInvitation, updateOrganizationMemberRole,
    removeOrganizationMember, saveOrganizationPolicy, canRequestUnattended,
    requestControlPlane: controlPlaneFetch,
    addAudit, toast, dismissToast, resetWorkspace,
  }), [
    userId, organizations, activeOrganizationId, organizationRole, organizationMembers,
    organizationInvitations, organizationPolicy, organizationLoading, organizationSaving,
    organizationInviteLink, organizationError, canStartSupportSessions, devices, sessions,
    relays, jobs, audit, settings, toasts, syncing, updateSettings, updateDevice, removeDevices,
    createSession, connectSession, endSession, updateSession, runJob, addRelay, removeRelay,
    testRelay, syncControlPlane, switchOrganization, createOrganization, renameOrganization,
    createOrganizationInvitation, acceptOrganizationInvitation, revokeOrganizationInvitation,
    updateOrganizationMemberRole, removeOrganizationMember, saveOrganizationPolicy,
    canRequestUnattended, controlPlaneFetch, addAudit, toast, dismissToast, resetWorkspace,
  ])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useAppStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider')
  return value
}
