import type { AppSettings, AuditEvent, Device, Job, Relay, SupportSession } from './types'

const now = '2026-10-30T12:40:00.000Z'
const minutesAgo = (minutes: number) => new Date(new Date(now).getTime() - minutes * 60_000).toISOString()
const hoursAgo = (hours: number) => minutesAgo(hours * 60)

export const initialDevices: Device[] = [
  { id: 'dev-1001', name: 'ACCT-WEB-01', hostname: 'acct-web-01', platform: 'windows', os: 'Windows Server 2025', arch: 'x64', group: 'Infrastructure', status: 'online', ip: '10.24.8.21', lastSeen: minutesAgo(0), agentVersion: '1.0.0', relay: 'ldn-01', cpu: 31, memory: 58, disk: 64, user: 'SYSTEM', tags: ['production', 'web'], access: 'unattended', location: 'London, UK', sample: true },
  { id: 'dev-1002', name: 'HR-LAPTOP-005', hostname: 'hr-laptop-005', platform: 'windows', os: 'Windows 11 Pro 25H2', arch: 'x64', group: 'People', status: 'idle', ip: '10.24.16.42', lastSeen: minutesAgo(4), agentVersion: '1.0.0', relay: 'ldn-01', cpu: 12, memory: 71, disk: 79, user: 'maya.patel', tags: ['laptop'], access: 'interactive', location: 'Manchester, UK', sample: true },
  { id: 'dev-1003', name: 'DEV-MAC-022', hostname: 'dev-mac-022', platform: 'macos', os: 'macOS Tahoe 26.0.1', arch: 'arm64', group: 'Engineering', status: 'online', ip: '10.24.20.18', lastSeen: minutesAgo(1), agentVersion: '1.0.0', relay: 'dub-01', cpu: 46, memory: 67, disk: 52, user: 'noah.chen', tags: ['developer', 'design'], access: 'interactive', location: 'Dublin, IE', sample: true },
  { id: 'dev-1004', name: 'SALES-LT-119', hostname: 'sales-lt-119', platform: 'windows', os: 'Windows 11 Pro 25H2', arch: 'x64', group: 'Sales', status: 'offline', ip: '10.24.32.91', lastSeen: hoursAgo(3), agentVersion: '0.9.8', relay: 'nyc-01', cpu: 0, memory: 0, disk: 88, user: 'liam.wilson', tags: ['laptop', 'field'], access: 'interactive', location: 'New York, US', sample: true },
  { id: 'dev-1005', name: 'SRV-DATABASE-01', hostname: 'srv-database-01', platform: 'linux', os: 'Ubuntu 24.04.3 LTS', arch: 'x64', group: 'Infrastructure', status: 'attention', ip: '10.24.4.10', lastSeen: minutesAgo(2), agentVersion: '1.0.0', relay: 'dub-01', cpu: 84, memory: 91, disk: 73, user: 'postgres', tags: ['production', 'database'], access: 'unattended', location: 'Dublin, IE', sample: true },
  { id: 'dev-1006', name: 'MKT-LAPTOP-004', hostname: 'mkt-laptop-004', platform: 'macos', os: 'macOS Sequoia 15.7', arch: 'arm64', group: 'Marketing', status: 'offline', ip: '10.24.18.63', lastSeen: hoursAgo(27), agentVersion: '0.9.8', relay: 'ldn-01', cpu: 0, memory: 0, disk: 46, user: 'sofia.garcia', tags: ['laptop'], access: 'interactive', location: 'London, UK', sample: true },
  { id: 'dev-1007', name: 'CEO-WORKSTATION', hostname: 'ceo-workstation', platform: 'windows', os: 'Windows 11 Enterprise', arch: 'x64', group: 'Executive', status: 'idle', ip: '10.24.12.8', lastSeen: minutesAgo(7), agentVersion: '1.0.0', relay: 'ldn-01', cpu: 18, memory: 49, disk: 61, user: 'alex.morgan', tags: ['restricted'], access: 'interactive', location: 'London, UK', sample: true },
  { id: 'dev-1008', name: 'RETAIL-POS-12', hostname: 'retail-pos-12', platform: 'windows', os: 'Windows 10 IoT Enterprise', arch: 'x64', group: 'Retail', status: 'online', ip: '10.32.2.12', lastSeen: minutesAgo(0), agentVersion: '1.0.0', relay: 'nyc-01', cpu: 23, memory: 55, disk: 42, user: 'POSUser', tags: ['kiosk', 'store-012'], access: 'unattended', location: 'Brooklyn, US', sample: true },
  { id: 'dev-1009', name: 'BUILD-LINUX-04', hostname: 'build-linux-04', platform: 'linux', os: 'Debian 13.1', arch: 'arm64', group: 'Engineering', status: 'online', ip: '10.24.6.34', lastSeen: minutesAgo(1), agentVersion: '1.0.0', relay: 'dub-01', cpu: 72, memory: 63, disk: 81, user: 'runner', tags: ['ci', 'arm64'], access: 'unattended', location: 'Dublin, IE', sample: true },
  { id: 'dev-1010', name: 'FIELD-TABLET-031', hostname: 'field-tablet-031', platform: 'android', os: 'Android 16', arch: 'arm64', group: 'Field Ops', status: 'online', ip: '100.96.14.31', lastSeen: minutesAgo(3), agentVersion: '1.0.0', relay: 'fra-01', cpu: 29, memory: 62, disk: 57, user: 'field.tech31', tags: ['managed', 'mdm'], access: 'interactive', location: 'Frankfurt, DE', sample: true },
  { id: 'dev-1011', name: 'WAREHOUSE-SCAN-08', hostname: 'warehouse-scan-08', platform: 'android', os: 'Android 15', arch: 'arm64', group: 'Retail', status: 'attention', ip: '100.96.22.8', lastSeen: minutesAgo(18), agentVersion: '0.9.8', relay: 'fra-01', cpu: 37, memory: 86, disk: 92, user: 'scanner', tags: ['kiosk', 'warehouse'], access: 'unattended', location: 'Frankfurt, DE', sample: true },
  { id: 'dev-1012', name: 'DESIGN-STUDIO-02', hostname: 'design-studio-02', platform: 'macos', os: 'macOS Tahoe 26.0.1', arch: 'arm64', group: 'Marketing', status: 'online', ip: '10.24.18.22', lastSeen: minutesAgo(2), agentVersion: '1.0.0', relay: 'ldn-01', cpu: 52, memory: 74, disk: 69, user: 'studio', tags: ['render', 'shared'], access: 'interactive', location: 'London, UK', sample: true },
  { id: 'dev-1013', name: 'API-GATEWAY-02', hostname: 'api-gateway-02', platform: 'linux', os: 'Rocky Linux 10.0', arch: 'x64', group: 'Infrastructure', status: 'online', ip: '10.24.4.32', lastSeen: minutesAgo(0), agentVersion: '1.0.0', relay: 'sgp-01', cpu: 39, memory: 47, disk: 38, user: 'gateway', tags: ['production', 'api'], access: 'unattended', location: 'Singapore, SG', sample: true },
  { id: 'dev-1014', name: 'FINANCE-THIN-07', hostname: 'finance-thin-07', platform: 'windows', os: 'Windows 11 Enterprise', arch: 'arm64', group: 'Finance', status: 'online', ip: '10.24.28.47', lastSeen: minutesAgo(5), agentVersion: '1.0.0', relay: 'nyc-01', cpu: 16, memory: 53, disk: 44, user: 'finance07', tags: ['thin-client'], access: 'unattended', location: 'New York, US', sample: true },
]

export const initialSessions: SupportSession[] = [
  { id: 'ses-401', code: 'SC-7842-9135', customer: 'Acme Corporation', customerEmail: 'support@acme.example', deviceId: 'dev-1003', deviceName: 'DEV-MAC-022', issue: 'Build agent cannot reach the package registry', status: 'active', technician: 'Alex Morgan', startedAt: minutesAgo(24), durationMinutes: 24, access: 'interactive', relay: 'dub-01', quality: 'excellent', sample: true },
  { id: 'ses-402', code: 'SC-5521-8841', customer: 'TechStart Inc.', customerEmail: 'help@techstart.example', deviceName: 'Waiting for customer', issue: 'New starter cannot access shared drives', status: 'waiting', technician: 'Unassigned', startedAt: minutesAgo(8), durationMinutes: 0, access: 'interactive', relay: 'ldn-01', quality: 'unmeasured', sample: true },
  { id: 'ses-403', code: 'SC-1199-2341', customer: 'Global Logistics', customerEmail: 'it@globallog.example', deviceId: 'dev-1011', deviceName: 'WAREHOUSE-SCAN-08', issue: 'Scanner storage is critically low', status: 'active', technician: 'Sarah Miller', startedAt: minutesAgo(41), durationMinutes: 41, access: 'unattended', relay: 'fra-01', quality: 'good', sample: true },
  { id: 'ses-404', code: 'SC-3388-7722', customer: 'Bright Solutions', customerEmail: 'admin@bright.example', deviceId: 'dev-1002', deviceName: 'HR-LAPTOP-005', issue: 'Payroll application update verification', status: 'ended', technician: 'Mike Turner', startedAt: hoursAgo(2), durationMinutes: 36, access: 'interactive', relay: 'ldn-01', quality: 'excellent', sample: true },
  { id: 'ses-405', code: 'SC-9921-4456', customer: 'Northstar Design', customerEmail: 'studio@northstar.example', deviceId: 'dev-1012', deviceName: 'DESIGN-STUDIO-02', issue: 'Color profile calibration after OS update', status: 'ended', technician: 'Alex Morgan', startedAt: hoursAgo(5), durationMinutes: 52, access: 'interactive', relay: 'ldn-01', quality: 'good', sample: true },
  { id: 'ses-406', code: 'SC-1123-9988', customer: 'Finance Pro', customerEmail: 'it@financepro.example', deviceName: 'Waiting for customer', issue: 'Quarter-end reporting workstation review', status: 'waiting', technician: 'Unassigned', startedAt: minutesAgo(16), durationMinutes: 0, access: 'interactive', relay: 'nyc-01', quality: 'unmeasured', sample: true },
  { id: 'ses-407', code: 'SC-7744-3321', customer: 'Health Plus', customerEmail: 'service@healthplus.example', deviceId: 'dev-1008', deviceName: 'RETAIL-POS-12', issue: 'Receipt printer spooler maintenance', status: 'ended', technician: 'Sarah Miller', startedAt: hoursAgo(26), durationMinutes: 18, access: 'unattended', relay: 'nyc-01', quality: 'fair', sample: true },
]

export const initialRelays: Relay[] = [
  { id: 'ldn-01', name: 'London Edge', region: 'eu-west-2', city: 'London', url: 'https://ldn-01.relays.example.com', status: 'healthy', latency: 18, load: 42, connections: 68, version: '1.0.0', primary: true, sample: true },
  { id: 'dub-01', name: 'Dublin Core', region: 'eu-west-1', city: 'Dublin', url: 'https://dub-01.relays.example.com', status: 'healthy', latency: 24, load: 61, connections: 91, version: '1.0.0', primary: false, sample: true },
  { id: 'nyc-01', name: 'New York Edge', region: 'us-east-1', city: 'New York', url: 'https://nyc-01.relays.example.com', status: 'healthy', latency: 72, load: 37, connections: 54, version: '1.0.0', primary: false, sample: true },
  { id: 'fra-01', name: 'Frankfurt Edge', region: 'eu-central-1', city: 'Frankfurt', url: 'https://fra-01.relays.example.com', status: 'degraded', latency: 96, load: 83, connections: 112, version: '1.0.0', primary: false, sample: true },
  { id: 'sgp-01', name: 'Singapore Edge', region: 'ap-southeast-1', city: 'Singapore', url: 'https://sgp-01.relays.example.com', status: 'healthy', latency: 164, load: 29, connections: 31, version: '1.0.0', primary: false, sample: true },
]

export const initialJobs: Job[] = [
  { id: 'job-8104', name: 'Inventory refresh · Production', action: 'inventory.refresh', deviceIds: ['dev-1001', 'dev-1005', 'dev-1013'], deviceNames: ['ACCT-WEB-01', 'SRV-DATABASE-01', 'API-GATEWAY-02'], status: 'completed', createdAt: minutesAgo(18), completedAt: minutesAgo(17), progress: 100, actor: 'Alex Morgan', environment: 'lab', summary: '3 devices refreshed · 0 failures', results: { 'ACCT-WEB-01': 'Inventory signature verified', 'SRV-DATABASE-01': 'Inventory signature verified', 'API-GATEWAY-02': 'Inventory signature verified' } },
  { id: 'job-8103', name: 'Relay reachability · All regions', action: 'agent.ping', deviceIds: ['dev-1001', 'dev-1003', 'dev-1008', 'dev-1010', 'dev-1013'], deviceNames: ['ACCT-WEB-01', 'DEV-MAC-022', 'RETAIL-POS-12', 'FIELD-TABLET-031', 'API-GATEWAY-02'], status: 'completed', createdAt: hoursAgo(1), completedAt: hoursAgo(1), progress: 100, actor: 'System policy', environment: 'lab', summary: '5 responses · median 42 ms' },
  { id: 'job-8102', name: 'Network diagnostics · Database', action: 'diagnostics.network', deviceIds: ['dev-1005'], deviceNames: ['SRV-DATABASE-01'], status: 'failed', createdAt: hoursAgo(3), completedAt: hoursAgo(3), progress: 100, actor: 'Sarah Miller', environment: 'lab', summary: 'Agent timed out after 30 seconds', results: { 'SRV-DATABASE-01': 'No response before deadline; queued retry recommended' } },
  { id: 'job-8101', name: 'Unattended access review', action: 'session.request', deviceIds: ['dev-1007'], deviceNames: ['CEO-WORKSTATION'], status: 'completed', createdAt: hoursAgo(7), completedAt: hoursAgo(7), progress: 100, actor: 'Mike Turner', environment: 'lab', summary: 'Interactive consent correctly required', results: { 'CEO-WORKSTATION': 'Denied by endpoint policy: interactive consent required' } },
]

export const initialAudit: AuditEvent[] = []

export const initialSettings: AppSettings = {
  organization: 'Arcada Systems',
  consoleName: 'IT Operations',
  defaultGroup: 'Unassigned',
  requireConsent: true,
  recordSessions: true,
  notifyOnRecording: true,
  requireMfa: true,
  autoUpdateAgents: true,
  routingPolicy: 'nearest',
  sessionFallback: true,
  bandwidthLimit: 12,
  sessionTimeout: 15,
}

export const activitySeries = {
  labels: ['Fri 23', 'Sat 24', 'Sun 25', 'Mon 26', 'Tue 27', 'Wed 28', 'Thu 29', 'Fri 30'],
  support: [18, 9, 7, 26, 31, 28, 35, 24],
  access: [11, 14, 12, 19, 22, 17, 25, 20],
}

export const connectionQuality = [
  { label: 'Excellent', value: 68, color: '#b8ef62' },
  { label: 'Good', value: 24, color: '#5bd9c2' },
  { label: 'Fair', value: 6, color: '#f2b84b' },
  { label: 'Poor', value: 2, color: '#fb7185' },
]
