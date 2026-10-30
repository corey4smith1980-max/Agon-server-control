export type Platform = 'windows' | 'macos' | 'linux' | 'android'
export type DeviceStatus = 'online' | 'idle' | 'offline' | 'attention'
export type SessionStatus = 'active' | 'waiting' | 'ended' | 'declined' | 'consent_required' | 'disconnected'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'awaiting relay'
export type AuditSeverity = 'info' | 'success' | 'warning' | 'critical'

export interface Device {
  id: string
  name: string
  hostname: string
  platform: Platform
  os: string
  arch: string
  group: string
  status: DeviceStatus
  ip: string
  lastSeen: string
  agentVersion: string
  relay: string
  cpu: number
  memory: number
  disk: number
  user: string
  tags: string[]
  access: 'unattended' | 'interactive'
  unattendedOptIn?: boolean
  location: string
  sample: boolean
}

export interface SupportSession {
  id: string
  code: string
  customer: string
  customerEmail: string
  deviceId?: string
  deviceName: string
  issue: string
  status: SessionStatus
  technician: string
  startedAt: string
  durationMinutes: number
  access: 'unattended' | 'interactive'
  relay: string
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'unmeasured'
  sample: boolean
}

export interface Relay {
  id: string
  name: string
  region: string
  city: string
  url: string
  status: 'healthy' | 'degraded' | 'offline' | 'unchecked'
  latency: number
  load: number
  connections: number
  version: string
  primary: boolean
  sample: boolean
}

export interface Job {
  id: string
  name: string
  action: 'agent.ping' | 'inventory.refresh' | 'diagnostics.network' | 'session.request'
  deviceIds: string[]
  deviceNames: string[]
  status: JobStatus
  createdAt: string
  completedAt?: string
  progress: number
  actor: string
  environment: 'lab' | 'relay'
  summary?: string
  results?: Record<string, string>
  remoteJobIds?: Record<string, string>
}

export interface AuditEvent {
  id: string
  at: string
  action: string
  actor: string
  target: string
  category: 'access' | 'device' | 'deployment' | 'security' | 'relay' | 'automation'
  severity: AuditSeverity
  detail: string
  ip: string
}

export interface AppSettings {
  organization: string
  consoleName: string
  defaultGroup: string
  requireConsent: boolean
  recordSessions: boolean
  notifyOnRecording: boolean
  requireMfa: boolean
  autoUpdateAgents: boolean
  routingPolicy: 'nearest' | 'primary' | 'redundant'
  sessionFallback: boolean
  bandwidthLimit: number
  sessionTimeout: number
}

export type OrganizationRole = 'owner' | 'admin' | 'technician' | 'auditor'

export interface OrganizationSummary {
  id: string
  name: string
  role: OrganizationRole
  isPersonal: boolean
}

export interface OrganizationMember {
  userId: string
  role: OrganizationRole
  joinedAt: string
}

export interface OrganizationInvitation {
  id: string
  role: OrganizationRole
  createdAt: string
  expiresAt: string
  createdBy: string
}

export interface OrganizationPolicy {
  unattendedDesktopEnabled: boolean
  allowedRoles: OrganizationRole[]
  allowedGroups: string[]
  maxSessionMinutes: number
}

export interface ToastMessage {
  id: string
  title: string
  description?: string
  tone: 'success' | 'info' | 'warning' | 'error'
}
