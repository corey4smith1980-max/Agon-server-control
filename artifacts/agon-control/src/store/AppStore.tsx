/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { initialAudit, initialDevices, initialJobs, initialRelays, initialSessions, initialSettings } from '../lib/data'
import type { AppSettings, AuditEvent, Device, Job, Platform, Relay, SupportSession, ToastMessage } from '../lib/types'
import { randomToken, sessionCode } from '../lib/utils'

interface SessionInput {
  customer: string
  customerEmail: string
  deviceId?: string
  issue: string
  access: 'interactive' | 'unattended'
  technician: string
}

interface StoreValue {
  devices: Device[]
  sessions: SupportSession[]
  relays: Relay[]
  jobs: Job[]
  audit: AuditEvent[]
  settings: AppSettings
  toasts: ToastMessage[]
  adminToken: string
  syncing: boolean
  setAdminToken: (token: string) => void
  updateSettings: (patch: Partial<AppSettings>) => void
  updateDevice: (id: string, patch: Partial<Device>) => void
  removeDevices: (ids: string[]) => void
  createSession: (input: SessionInput) => Promise<SupportSession>
  updateSession: (id: string, patch: Partial<SupportSession>) => void
  runJob: (action: Job['action'], deviceIds: string[], name?: string) => Promise<void>
  addRelay: (relay: Pick<Relay, 'name' | 'region' | 'city' | 'url'>) => void
  removeRelay: (id: string) => void
  testRelay: (id: string) => Promise<boolean>
  syncControlPlane: () => Promise<boolean>
  regenerateEnrollmentToken: () => string
  addAudit: (event: Omit<AuditEvent, 'id' | 'at'>) => void
  toast: (title: string, description?: string, tone?: ToastMessage['tone']) => void
  dismissToast: (id: string) => void
  resetWorkspace: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      if (!stored) return initial
      const parsed = JSON.parse(stored) as T
      if (key === 'sc.settings.v1' && parsed && typeof parsed === 'object') {
        return {
          ...parsed,
          enrollmentToken: sessionStorage.getItem('sc.enrollmentToken') || '',
        } as T
      }
      return parsed
    } catch { return initial }
  })
  useEffect(() => {
    try {
      const safeValue = key === 'sc.settings.v1' && value && typeof value === 'object'
        ? { ...value, enrollmentToken: '' }
        : value
      localStorage.setItem(key, JSON.stringify(safeValue))
    } catch { /* storage can be disabled */ }
  }, [key, value])
  return [value, setValue] as const
}

function platformFromOs(os = ''): Platform {
  const value = os.toLowerCase()
  if (value.includes('darwin') || value.includes('mac')) return 'macos'
  if (value.includes('android')) return 'android'
  if (value.includes('linux') || value.includes('ubuntu') || value.includes('debian')) return 'linux'
  return 'windows'
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = usePersistentState<Device[]>('sc.devices.v1', initialDevices)
  const [sessions, setSessions] = usePersistentState<SupportSession[]>('sc.sessions.v1', initialSessions)
  const [relays, setRelays] = usePersistentState<Relay[]>('sc.relays.v1', initialRelays)
  const [jobs, setJobs] = usePersistentState<Job[]>('sc.jobs.v1', initialJobs)
  const [audit, setAudit] = usePersistentState<AuditEvent[]>('sc.audit.v1', initialAudit)
  const [settings, setSettings] = usePersistentState<AppSettings>('sc.settings.v1', initialSettings)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [syncing, setSyncing] = useState(false)
  const [adminToken, setAdminTokenState] = useState(() => sessionStorage.getItem('sc.adminToken') || '')
  const settingsRef = useRef(settings)
  const adminTokenRef = useRef(adminToken)
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { adminTokenRef.current = adminToken }, [adminToken])

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
    if (patch.enrollmentToken !== undefined) {
      try {
        if (patch.enrollmentToken) sessionStorage.setItem('sc.enrollmentToken', patch.enrollmentToken)
        else sessionStorage.removeItem('sc.enrollmentToken')
      } catch { /* session storage can be disabled */ }
    }
    setSettings((current) => ({ ...current, ...patch }))
  }, [setSettings])

  const setAdminToken = useCallback((token: string) => {
    setAdminTokenState(token)
    adminTokenRef.current = token
    if (token) sessionStorage.setItem('sc.adminToken', token)
    else sessionStorage.removeItem('sc.adminToken')
  }, [])

  const updateDevice = useCallback((id: string, patch: Partial<Device>) => {
    setDevices((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [setDevices])

  const removeDevices = useCallback((ids: string[]) => {
    const names = devices.filter((item) => ids.includes(item.id)).map((item) => item.name)
    setDevices((items) => items.filter((item) => !ids.includes(item.id)))
    addAudit({ action: 'device.removed', actor: 'Alex Morgan', target: names.join(', '), category: 'device', severity: 'warning', detail: `${names.length} device record${names.length === 1 ? '' : 's'} removed from this console. This does not uninstall the endpoint agent.`, ip: 'This browser' })
    toast('Device records removed', `${names.length} record${names.length === 1 ? '' : 's'} removed. Endpoint agents were not uninstalled.`, 'warning')
  }, [devices, setDevices, addAudit, toast])

  const updateSession = useCallback((id: string, patch: Partial<SupportSession>) => {
    setSessions((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [setSessions])

  const createSession = useCallback(async (input: SessionInput) => {
    const device = devices.find((item) => item.id === input.deviceId)
    let session: SupportSession = {
      id: crypto.randomUUID(), code: sessionCode(), customer: input.customer, customerEmail: input.customerEmail,
      deviceId: input.deviceId, deviceName: device?.name || 'Waiting for customer', issue: input.issue,
      status: 'waiting', technician: input.technician || 'Alex Morgan', startedAt: new Date().toISOString(),
      durationMinutes: 0, access: input.access, relay: device?.relay || 'ldn-01', quality: 'unmeasured', sample: device?.sample ?? true,
    }
    if (device && !device.sample && settingsRef.current.controlPlaneUrl && adminTokenRef.current) {
      const response = await fetch(`${settingsRef.current.controlPlaneUrl.replace(/\/$/, '')}/api/sessions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminTokenRef.current}` },
        body: JSON.stringify({ deviceId: device.id, mode: input.access, customer: input.customer, issue: input.issue }),
      })
      if (!response.ok) throw new Error((await response.json()).error || 'The relay rejected the session request')
      const data = await response.json()
      const relayStatus = data.session.status
      session = {
        ...session,
        id: data.session.id,
        code: data.session.code,
        status: relayStatus === 'accepted' ? 'active' : relayStatus === 'consent_required' ? 'consent_required' : 'waiting',
        relay: data.session.relayId,
      }
    }
    setSessions((items) => [session, ...items])
    addAudit({ action: 'session.requested', actor: session.technician, target: session.deviceName, category: 'access', severity: 'info', detail: `${input.access === 'interactive' ? 'Interactive' : 'Unattended'} support request ${session.code} created for ${input.customer}.`, ip: 'This browser' })
    toast('Support session created', `${session.code} · ${session.deviceName}`)
    return session
  }, [devices, setSessions, addAudit, toast])

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
      actor: 'Alex Morgan', environment, results: {},
    }
    setJobs((items) => [job, ...items])
    addAudit({ action: 'job.created', actor: 'Alex Morgan', target: selected.map((item) => item.name).join(', '), category: 'automation', severity: 'info', detail: `${action} dispatched through the ${environment === 'lab' ? 'local device emulator' : 'configured control plane'}.`, ip: 'This browser' })
    toast(environment === 'lab' ? 'Lab job started' : 'Job sent to relay', `${action} · ${selected.length} target${selected.length === 1 ? '' : 's'}`, 'info')

    if (environment === 'lab') {
      window.setTimeout(() => setJobs((items) => items.map((item) => item.id === id ? { ...item, progress: 72 } : item)), 650)
      window.setTimeout(() => {
        const results: Record<string, string> = {}
        for (const device of selected) {
          if (device.status === 'offline') results[device.name] = 'Device offline · job will remain queued until the next agent connection'
          else if (action === 'agent.ping') results[device.name] = `pong · agent ${device.agentVersion} · ${device.relay} · ${Math.max(8, Math.round(device.cpu / 2 + 17))} ms`
          else if (action === 'inventory.refresh') results[device.name] = `${device.os} · ${device.arch} · ${device.memory}% memory · ${device.disk}% disk`
          else if (action === 'diagnostics.network') results[device.name] = `${device.ip} · relay ${device.relay} reachable · outbound WebSocket path healthy`
          else results[device.name] = device.access === 'unattended' ? 'Accepted by installed unattended endpoint policy' : 'Interactive approval required at the endpoint'
        }
        setJobs((items) => items.map((item) => item.id === id ? { ...item, status: 'completed', progress: 100, completedAt: new Date().toISOString(), summary: `${selected.length} lab result${selected.length === 1 ? '' : 's'} returned · no live endpoint affected`, results } : item))
        toast('Lab job completed', `${selected.length} emulated result${selected.length === 1 ? '' : 's'} ready`, 'success')
      }, 1500)
      return
    }

    if (!settingsRef.current.controlPlaneUrl || !adminTokenRef.current) {
      setJobs((items) => items.map((item) => item.id === id ? { ...item, status: 'awaiting relay', summary: 'Add a control-plane URL and administrator token in Settings to dispatch this job.' } : item))
      toast('Job awaiting relay credentials', 'Configure the control plane in Settings.', 'warning')
      return
    }
    const results: Record<string, string> = {}
    const remoteJobIds: Record<string, string> = {}
    const remoteStatuses: string[] = []
    let completed = 0
    await Promise.all(real.map(async (device) => {
      try {
        const response = await fetch(`${settingsRef.current.controlPlaneUrl.replace(/\/$/, '')}/api/devices/${device.id}/commands`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminTokenRef.current}` },
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
      summary: `${remoteJobIds ? Object.keys(remoteJobIds).length : 0} accepted by relay; synchronize for endpoint results`,
      results: { ...results }, remoteJobIds,
    } : item))
    toast(failedDispatches ? 'Some dispatches failed' : 'Commands accepted by relay', 'Synchronize the control plane to see endpoint results.', failedDispatches ? 'warning' : 'info')
  }, [devices, setJobs, addAudit, toast])

  const addRelay = useCallback((input: Pick<Relay, 'name' | 'region' | 'city' | 'url'>) => {
    const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID()
    setRelays((items) => [...items, { ...input, id, status: 'unchecked', latency: 0, load: 0, connections: 0, version: 'unknown', primary: false, sample: false }])
    addAudit({ action: 'relay.registered', actor: 'Alex Morgan', target: id, category: 'relay', severity: 'info', detail: `${input.name} registered at ${input.url}. Health remains unchecked until the first successful probe.`, ip: 'This browser' })
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

  const syncControlPlane = useCallback(async () => {
    if (!settings.controlPlaneUrl || !adminToken) {
      toast('Control plane not configured', 'Add the relay URL and administrator token first.', 'warning')
      return false
    }
    setSyncing(true)
    try {
      const baseUrl = settings.controlPlaneUrl.replace(/\/$/, '')
      const headers = { Authorization: `Bearer ${adminToken}` }
      const [deviceResponse, jobResponse, auditResponse, sessionResponse] = await Promise.all([
        fetch(`${baseUrl}/api/devices`, { headers, cache: 'no-store' }),
        fetch(`${baseUrl}/api/jobs`, { headers, cache: 'no-store' }),
        fetch(`${baseUrl}/api/audit?limit=500`, { headers, cache: 'no-store' }),
        fetch(`${baseUrl}/api/sessions`, { headers, cache: 'no-store' }),
      ])
      const responses = [deviceResponse, jobResponse, auditResponse, sessionResponse]
      const errorResponse = responses.find((response) => !response.ok)
      if (errorResponse) {
        const error = await errorResponse.json().catch(() => ({}))
        throw new Error(error.error || `HTTP ${errorResponse.status}`)
      }
      const [deviceData, jobData, auditData, sessionData] = await Promise.all(responses.map((response) => response.json()))
      const realDevices: Device[] = (Array.isArray(deviceData.devices) ? deviceData.devices : []).map((device: Record<string, unknown>) => ({
        id: String(device.id), name: String(device.name || device.hostname), hostname: String(device.hostname || device.name),
        platform: platformFromOs(String(device.os)), os: String(device.os || 'Unknown'), arch: String(device.arch || 'unknown'),
        group: String(device.group || 'Unassigned'), status: device.online ? 'online' : 'offline', ip: 'Reported by agent',
        lastSeen: String(device.lastSeen || device.enrolledAt || new Date().toISOString()), agentVersion: String(device.agent || 'unknown'),
        relay: String(device.relayId || 'relay'), cpu: 0, memory: 0, disk: 0, user: 'Managed endpoint', tags: ['enrolled'],
        access: 'interactive', location: 'Not reported', sample: false,
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
          issue: String(session.issue || 'Consent and endpoint-policy status request.'), status: statusValue === 'accepted'
            ? 'active' : statusValue === 'consent_required' ? 'consent_required' : statusValue === 'declined'
              ? 'declined' : statusValue === 'ended' || statusValue === 'expired' ? 'ended' : 'waiting',
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
            : action.includes('enrollment') ? 'deployment'
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
      toast('Control plane synchronized', `${realDevices.length} devices, ${remoteJobs.length} jobs, and ${relayAudit.length} relay events loaded.`)
      return true
    } catch (error) {
      toast('Synchronization failed', error instanceof Error ? error.message : 'Could not reach the control plane', 'error')
      return false
    } finally { setSyncing(false) }
  }, [settings.controlPlaneUrl, adminToken, setDevices, setSessions, setJobs, setAudit, toast])

  const regenerateEnrollmentToken = useCallback(() => {
    const token = randomToken()
    updateSettings({ enrollmentToken: token })
    addAudit({ action: 'enrollment.token.rotated', actor: 'Alex Morgan', target: 'Console enrollment profile', category: 'security', severity: 'warning', detail: 'A new local enrollment token was generated. Update ENROLLMENT_TOKEN on the relay before deploying packages.', ip: 'This browser' })
    toast('Enrollment token regenerated', 'Use the same token on your control plane.', 'warning')
    return token
  }, [updateSettings, addAudit, toast])

  const resetWorkspace = useCallback(() => {
    setDevices(initialDevices); setSessions(initialSessions); setRelays(initialRelays); setJobs(initialJobs); setAudit(initialAudit); setSettings(initialSettings)
    setAdminToken('')
    toast('Lab workspace restored', 'Local changes were cleared and the supplied sample fleet restored.', 'info')
  }, [setDevices, setSessions, setRelays, setJobs, setAudit, setSettings, setAdminToken, toast])

  const value = useMemo<StoreValue>(() => ({
    devices, sessions, relays, jobs, audit, settings, toasts, adminToken, syncing,
    setAdminToken, updateSettings, updateDevice, removeDevices, createSession, updateSession, runJob,
    addRelay, removeRelay, testRelay, syncControlPlane, regenerateEnrollmentToken, addAudit, toast, dismissToast, resetWorkspace,
  }), [devices, sessions, relays, jobs, audit, settings, toasts, adminToken, syncing, setAdminToken, updateSettings, updateDevice, removeDevices, createSession, updateSession, runJob, addRelay, removeRelay, testRelay, syncControlPlane, regenerateEnrollmentToken, addAudit, toast, dismissToast, resetWorkspace])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useAppStore() {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider')
  return value
}
