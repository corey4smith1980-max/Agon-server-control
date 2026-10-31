import JSZip from 'jszip'
import { motion } from 'framer-motion'
import { Apple, Check, CloudDownload, Code2, Copy, Download, FileCheck2, Laptop, LoaderCircle, PackageCheck, PackagePlus, Server, ShieldCheck, Smartphone, Terminal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Platform } from '../lib/types'
import { artifactPath, cn, copyText, formatBytes, HOSTED_CONTROL_PLANE_URL, platformLabel } from '../lib/utils'
import { useAppStore } from '../store/AppStore'
import { Badge, Button, DetailRow, PageHeader, Panel, Toggle } from '../components/UI'
import { PendingPairingApprovals } from '../components/PendingPairingApprovals'

interface Artifact { platform: string; arch: string; file: string; bytes: number; sha256: string; version: string }

async function loadAgentManifest(): Promise<Artifact[]> {
  const response = await fetch(artifactPath('agent/manifest.json'), { cache: 'no-store' })
  if (!response.ok) throw new Error('Artifact manifest unavailable')
  const data = await response.json()
  if (!Array.isArray(data.artifacts)) throw new Error('Artifact manifest is invalid')
  return data.artifacts as Artifact[]
}

const platformMeta: Record<Platform, { title: string; subtitle: string; icon: typeof Laptop; arches: Array<{ value: string; label: string }>; package: string }> = {
  windows: { title: 'Windows', subtitle: 'MSI on x64 · native ARM64 package', icon: Laptop, arches: [{ value: 'amd64', label: 'x64 (Intel / AMD)' }, { value: 'arm64', label: 'ARM64' }], package: 'Windows MSI / ARM64 PowerShell ZIP' },
  macos: { title: 'macOS', subtitle: 'LaunchDaemon', icon: Apple, arches: [{ value: 'arm64', label: 'Apple silicon' }, { value: 'amd64', label: 'Intel x64' }], package: 'Native binary + shell installer' },
  linux: { title: 'Linux', subtitle: 'Hardened systemd unit', icon: Terminal, arches: [{ value: 'amd64', label: 'x64 (Intel / AMD)' }, { value: 'arm64', label: 'ARM64' }], package: 'Native binary + shell installer' },
  android: { title: 'Android', subtitle: 'MDM / ADB managed', icon: Smartphone, arches: [{ value: 'arm64', label: 'ARM64' }], package: 'Native binary + ADB installer' },
}

function unixInstaller(platform: Platform) {
  return `#!/bin/sh
set -eu
PKG_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
chmod +x "$PKG_DIR/agon-agent"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
echo "Installing Agon Agent for ${platform === 'macos' ? 'macOS (LaunchDaemon)' : 'Linux (systemd)'}..."
"$PKG_DIR/agon-agent" -config "$PKG_DIR/agent.json" -pair
$SUDO "$PKG_DIR/agon-agent" -config "$PKG_DIR/agent.json" -install -consent
echo "Installation complete. The service is visible in your operating system service manager."
`
}

function windowsInstaller() {
  return `# Agon Agent 1.0.3
#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
if (-not $PSCommandPath) { throw "Run the saved install.ps1 file from the extracted package." }
$PackageRoot = Split-Path -Parent $PSCommandPath
$Agent = Join-Path $PackageRoot "agon-agent.exe"
$Config = Join-Path $PackageRoot "agent.json"
if (-not (Test-Path $Agent -PathType Leaf)) { throw "Agent binary not found: $Agent" }
if (-not (Test-Path $Config -PathType Leaf)) { throw "Agent configuration not found: $Config" }
Write-Host "Requesting device pairing..." -ForegroundColor Cyan
$pairOutput = & $Agent -config $Config -pair 2>&1
$pairExitCode = $LASTEXITCODE
if ($pairOutput) { $pairOutput | ForEach-Object { Write-Host $_ } }
if ($pairExitCode -ne 0) { throw "Pairing request failed with exit code $pairExitCode." }
Write-Host "Installing the visible Agon Agent service..." -ForegroundColor Cyan
$installOutput = & $Agent -config $Config -install -consent 2>&1
$installExitCode = $LASTEXITCODE
if ($installOutput) { $installOutput | ForEach-Object { Write-Host $_ } }
if ($installExitCode -ne 0) { throw "Service installation failed with exit code $installExitCode." }
$service = Get-Service -Name "AgonAgent" -ErrorAction SilentlyContinue
if (-not $service) { throw "Windows did not register the AgonAgent service." }
if ($service.Status -ne "Running") { Start-Service -Name "AgonAgent" }
Write-Host "Installed. Approve the pairing code above in the published Agon Control console." -ForegroundColor Green
`
}

function windowsUninstaller() {
  return `#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$Agent = "C:\\Program Files\\Agon\\agon-agent.exe"
if (Test-Path $Agent) { & $Agent -uninstall -consent } else { sc.exe stop AgonAgent; sc.exe delete AgonAgent }
Write-Host "Agon Agent service removed."
`
}

function unixUninstaller(platform: Platform) {
  return `#!/bin/sh
set -eu
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
if [ "${platform}" = "macos" ]; then AGENT="/usr/local/libexec/agon-agent/agon-agent"; else AGENT="/opt/agon-agent/agon-agent"; fi
if [ -x "$AGENT" ]; then $SUDO "$AGENT" -uninstall -consent; else echo "Installed agent not found"; exit 1; fi
echo "Agon service removed."
`
}

function androidInstaller() {
  return `#!/bin/sh
set -eu
PKG_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v adb >/dev/null 2>&1 || { echo "Android Platform Tools (adb) are required"; exit 1; }
adb wait-for-device
adb shell mkdir -p /data/local/tmp/agon-agent
adb push "$PKG_DIR/agon-agent" /data/local/tmp/agon-agent/agon-agent
adb push "$PKG_DIR/agent.json" /data/local/tmp/agon-agent/agent.json
adb shell chmod 700 /data/local/tmp/agon-agent/agon-agent
adb shell chmod 600 /data/local/tmp/agon-agent/agent.json
adb shell "cd /data/local/tmp/agon-agent && ./agon-agent -config agent.json -pair"
adb shell "cd /data/local/tmp/agon-agent && nohup ./agon-agent -config agent.json > agent.log 2>&1 &"
echo "Agent started. Inspect with: adb shell tail -f /data/local/tmp/agon-agent/agent.log"
echo "For boot persistence, deploy explicitly through your MDM. This package does not hide or bypass Android controls."
`
}

async function sha256(value: string | ArrayBuffer) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default function Deployment() {
  const { settings, addAudit, toast, userId, activeOrganizationId, organizationRole, requestControlPlane } = useAppStore()
  const [platform, setPlatform] = useState<Platform>('windows')
  const [arch, setArch] = useState('amd64')
  const [group, setGroup] = useState(settings.defaultGroup)
  const [access, setAccess] = useState<'interactive' | 'unattended'>('interactive')
  const [manifest, setManifest] = useState<Artifact[]>([])
  const [manifestError, setManifestError] = useState('')
  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const [packageInfo, setPackageInfo] = useState<{ name: string; blob: Blob; sha: string; size: number } | null>(null)
  const canOptInForUnattended = platform === 'windows' && (organizationRole === 'owner' || organizationRole === 'admin')

  useEffect(() => {
    if (!canOptInForUnattended && access === 'unattended') setAccess('interactive')
  }, [access, canOptInForUnattended])

  useEffect(() => {
    loadAgentManifest().then(setManifest).catch((error) => setManifestError(error.message))
  }, [])
  const choosePlatform = (next: Platform) => {
    setPlatform(next)
    setArch(platformMeta[next].arches[0].value)
    setPackageInfo(null)
    setProgress(0)
    setStage('')
  }
  const artifact = useMemo(() => manifest.find((item) => item.platform === platform && item.arch === arch), [manifest, platform, arch])

  const buildPackage = async () => {
    setBuilding(true); setProgress(4); setPackageInfo(null)
    try {
      const latestManifest = await loadAgentManifest()
      setManifest(latestManifest)
      setManifestError('')
      const currentArtifact = latestManifest.find((item) => item.platform === platform && item.arch === arch)
      if (!currentArtifact) throw new Error(`No agent build is available for ${platform}/${arch}`)
      setStage('Fetching verified native agent')
      const response = await fetch(artifactPath(currentArtifact.file), { cache: 'no-store' })
      if (!response.ok) throw new Error(`Agent download failed (${response.status})`)
      const binary = await response.arrayBuffer()
      const binaryHash = await sha256(binary)
      if (binaryHash !== currentArtifact.sha256) throw new Error('Agent checksum mismatch. Package generation stopped.')
      setProgress(24); setStage('Preparing relay and device policy')
      if (!userId || !activeOrganizationId) throw new Error('Could not determine the signed-in organization.')
      if (platform === 'windows' && arch === 'amd64') {
        setProgress(36)
        setStage('Building configured Windows MSI')
        const msiResponse = await requestControlPlane('/api/agon/agent-installer/msi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            architecture: arch,
            group,
            allowUnattended: canOptInForUnattended && access === 'unattended',
          }),
        })
        if (!msiResponse.ok) {
          const error = await msiResponse.json().catch(() => ({}))
          throw new Error(error.error || `MSI build failed (${msiResponse.status})`)
        }
        const blob = await msiResponse.blob()
        if (blob.size < 1024) throw new Error('The server returned an empty MSI package.')
        const name = `agon-agent-windows-${arch}-v${currentArtifact.version}.msi`
        const packageHash = await sha256(await blob.arrayBuffer())
        setPackageInfo({ name, blob, sha: packageHash, size: blob.size })
        setProgress(100)
        setStage('MSI ready')
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = name
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 3000)
        addAudit({
          action: 'installer.generated',
          actor: 'Operator',
          target: `Windows · ${arch}`,
          category: 'deployment',
          severity: 'success',
          detail: `${name} generated for ${group} with ${access} access. Native agent checksum verified before packaging.`,
          ip: 'This browser',
        })
        toast('Windows MSI built and downloaded', `${name} · ${formatBytes(blob.size)}`)
        return
      }
      const serverUrl = HOSTED_CONTROL_PLANE_URL
      const config = JSON.stringify({ serverUrl, ownerId: activeOrganizationId, deviceName: '', group, allowUnattended: canOptInForUnattended && access === 'unattended' }, null, 2) + '\n'
      const configHash = await sha256(config)
      const zip = new JSZip()
      const binaryName = platform === 'windows' ? 'agon-agent.exe' : 'agon-agent'
      zip.file(binaryName, binary)
      zip.file('agent.json', config)
      const scripts: Record<string, string> = {}
      if (platform === 'windows') { scripts['install.ps1'] = windowsInstaller(); scripts['uninstall.ps1'] = windowsUninstaller() }
      else if (platform === 'android') scripts['install-android.sh'] = androidInstaller()
      else { scripts['install.sh'] = unixInstaller(platform); scripts['uninstall.sh'] = unixUninstaller(platform) }
      Object.entries(scripts).forEach(([name, content]) => zip.file(name, content, { unixPermissions: name.endsWith('.sh') ? 0o755 : undefined }))
      const instructions = platform === 'windows'
        ? '1. Extract the Windows ARM64 ZIP.\n2. Open PowerShell as administrator and run the saved install.ps1 file.\n3. Copy the pairing code printed by the installer.\n4. Approve it in Agon Control → Pending pairing approvals.\n5. Confirm AgonAgent appears in services.msc and keep the visible companion open.\n\nInteractive desktop sessions require local consent.'
        : platform === 'android'
          ? '1. Enable Android debugging through your approved MDM or device administrator workflow.\n2. Connect the device and run: sh install-android.sh\n3. Copy the pairing code printed by the installer.\n4. Enter that code in Agon Control → Pending pairing approvals.\n\nThis ARM64 package uses ADB. It is not an APK and does not bypass Android security. Boot persistence requires explicit MDM provisioning.'
          : `1. Extract this ZIP on the managed ${platformLabel(platform)} device.\n2. Open Terminal in the extracted folder.\n3. Run: sh install.sh\n4. Copy the pairing code printed by the installer.\n5. Enter that code in Agon Control → Pending pairing approvals.\n\nThe service and configuration paths are printed by the installer.`
      zip.file('INSTALL.txt', `Agon Agent 1.0.3\n${platformLabel(platform)} ${arch}\n\n${instructions}\n`)
      zip.file('SHA256SUMS', `${binaryHash}  ${binaryName}\n${configHash}  agent.json\n`)
      zip.file('BUILD-RECEIPT.json', JSON.stringify({ product: 'Agon Agent', version: '1.0.3', platform, architecture: arch, builtAt: new Date().toISOString(), serverUrl, group, access, identity: 'device-generated', authorization: 'operator-approved-pairing-code', artifactSha256: binaryHash, capabilities: ['device-pairing', 'heartbeat', 'inventory.refresh', 'agent.ping', 'diagnostics.network', 'host-inventory', ...(platform === 'windows' ? ['visible-desktop-companion', 'local-desktop-consent', 'desktop-view', 'pointer-input', 'keyboard-input'] : [])], excluded: ['arbitrary-shell', 'credential-collection', 'covert-persistence', 'secure-desktop-control'] }, null, 2))
      setProgress(38); setStage('Compressing installer package')
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (metadata) => { setProgress(38 + metadata.percent * .57); setStage(`Compressing ${metadata.currentFile || 'package'}`) })
      const name = `agon-${platform}-${arch}-v1.0.3.zip`
      setProgress(98); setStage('Hashing package receipt')
      const packageHash = await sha256(await blob.arrayBuffer())
      setPackageInfo({ name, blob, sha: packageHash, size: blob.size }); setProgress(100); setStage('Package ready')
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 3000)
      addAudit({ action: 'installer.generated', actor: 'Operator', target: `${platformLabel(platform)} · ${arch}`, category: 'deployment', severity: 'success', detail: `${name} generated with ${access} access for ${group}. Native agent checksum verified before packaging.`, ip: 'This browser' })
      toast('Installer built and downloaded', `${name} · ${formatBytes(blob.size)}`)
    } catch (error) {
      setStage('Build failed'); toast('Installer build failed', error instanceof Error ? error.message : 'Unknown packaging error', 'error')
    } finally { setBuilding(false) }
  }

  const downloadAgain = () => {
    if (!packageInfo) return
    const url = URL.createObjectURL(packageInfo.blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = packageInfo.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 3000)
  }
  const copy = async (value: string, label: string) => { await copyText(value); toast(`${label} copied`) }
  return <div>
      <PageHeader eyebrow="Real artifacts · Agent v1.0.3" title="Agent deployment" description="Build a configured Windows MSI or download native packages for other platforms. Installation requires administrator consent." actions={<><Button icon={Download} onClick={() => { const anchor = document.createElement('a'); anchor.href = artifactPath('downloads/agon-agent-builds.zip'); anchor.download = ''; anchor.click() }}>Agent builds ZIP</Button><Button icon={Code2} onClick={() => { const anchor = document.createElement('a'); anchor.href = artifactPath('downloads/agon-agent-source.zip'); anchor.download = ''; anchor.click() }}>Agent source</Button></>} />
    {window.location.hostname.endsWith('.replit.dev') && <div className="mb-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4 text-[10px] leading-5 text-amber-100/80">This development preview uses separate organization records. Windows MSI agents still connect to the published relay, so build production installers from the <a className="underline underline-offset-2" href="https://agon-server-control.replit.app/deployment" target="_blank" rel="noreferrer">published deployment page</a> to keep the installer and laptop in the same organization.</div>}
    <PendingPairingApprovals />
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.8fr)]">
      <div className="space-y-4">
        <Panel className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><span className="eyebrow">01 · Target</span><h2 className="mt-2 font-display text-base font-semibold text-white">Choose an operating system</h2></div><Badge tone="green" dot>Native builds ready</Badge></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(platformMeta) as Platform[]).map((item) => { const meta = platformMeta[item]; const selected = platform === item; return <button key={item} onClick={() => choosePlatform(item)} className={cn('relative rounded-2xl border p-4 text-left transition-all duration-300', selected ? 'border-lime-300/35 bg-lime-300/[0.055] shadow-[0_0_30px_rgba(195,243,107,.035)]' : 'border-white/[0.07] bg-white/[0.018] hover:border-white/[0.14] hover:bg-white/[0.035]')}><div className="flex items-center justify-between"><meta.icon size={21} className={selected ? 'text-lime-300' : 'text-slate-500'} />{selected && <motion.div layoutId="platform-check" className="rounded-full bg-lime-300 p-0.5 text-[#15200c]"><Check size={11}/></motion.div>}</div><p className="mt-4 text-sm font-medium text-white">{meta.title}</p><p className="mt-1 text-[10px] text-slate-500">{meta.subtitle}</p></button>})}</div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><div><label className="label" htmlFor="deploy-arch">Processor architecture</label><select id="deploy-arch" className="input" value={arch} onChange={(event) => { setArch(event.target.value); setPackageInfo(null) }}>{platformMeta[platform].arches.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div><label className="label" htmlFor="deploy-group">Device group</label><select id="deploy-group" className="input" value={group} onChange={(event) => setGroup(event.target.value)}>{['Unassigned', 'Infrastructure', 'Engineering', 'People', 'Sales', 'Marketing', 'Executive', 'Retail', 'Field Ops', 'Finance'].map((item) => <option key={item}>{item}</option>)}</select></div></div>
        </Panel>
        <Panel className="p-5 sm:p-6">
          <span className="eyebrow">02 · Device pairing</span><h2 className="mt-2 font-display text-base font-semibold text-white">Connect automatically</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">The agent creates a stable device identity and asks the signed-in operator to approve its first relay connection.</p>
          <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/15 p-4"><div className="flex items-center gap-2 text-[11px] font-medium text-slate-200"><Server size={14} className="text-lime-300"/>Agon hosted control plane</div><p className="mt-2 break-all font-mono text-[10px] text-slate-500">{HOSTED_CONTROL_PLANE_URL}</p><p className="mt-2 text-[10px] leading-4 text-slate-600">The x64 MSI installs the service and visible companion shortcut. Launch the companion to see the pairing code, then approve it in the published console. Windows ARM64 uses the PowerShell package.</p><a className="mt-2 inline-block text-[10px] text-lime-200 underline underline-offset-2" href="https://agon-server-control.replit.app/deployment" target="_blank" rel="noreferrer">Open published deployment page</a></div>
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.022] p-4"><div><p className="text-[12px] font-medium text-slate-200">Opt this installer into unattended desktop support</p><p className="mt-1 max-w-md text-[10px] leading-4 text-slate-500">Windows only. Requires an owner/admin-built installer, explicit endpoint opt-in, and a separate organization policy for roles and device groups. The visible companion stays open.</p>{!canOptInForUnattended && <p className="mt-1 text-[10px] text-amber-300">Only organization owners and administrators can build a Windows package with this opt-in.</p>}</div><Toggle checked={access === 'unattended'} onChange={(checked) => { setAccess(checked ? 'unattended' : 'interactive'); setPackageInfo(null) }} label="Opt in for unattended desktop support" disabled={!canOptInForUnattended}/></div>
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel className="overflow-hidden">
           <div className="subtle-grid border-b border-white/[0.07] p-5"><div className="flex items-start justify-between"><div><span className="eyebrow">03 · Package</span><h2 className="mt-2 font-display text-base font-semibold text-white">Ready to assemble</h2></div><div className="rounded-xl border border-lime-300/15 bg-lime-300/[0.06] p-2.5 text-lime-300"><PackagePlus size={21}/></div></div><div className="mt-4 space-y-1"><DetailRow label="Platform" value={`${platformLabel(platform)} · ${arch}`} /><DetailRow label="Installer" value={platform === 'windows' && arch === 'amd64' ? 'Windows MSI (.msi)' : platform === 'windows' ? 'ARM64 ZIP + PowerShell' : platformMeta[platform].package} /><DetailRow label="Binary size" value={artifact ? formatBytes(artifact.bytes) : 'Loading…'} /><DetailRow label="Access" value={access} /></div></div>
          <div className="p-5">
              <div className="rounded-xl border border-white/[0.065] bg-black/15 p-4"><p className="font-mono text-[9px] uppercase tracking-wider text-slate-600">Package contents</p><div className="mt-3 space-y-2">{(platform === 'windows' && arch === 'amd64' ? ['Agon Agent Windows service', 'Organization and group config', 'Visible desktop companion shortcut', 'Windows Add/Remove Programs entry'] : platform === 'windows' ? ['agon-agent.exe', 'agent.json', 'install.ps1 + uninstall.ps1', 'INSTALL.txt', 'SHA256SUMS', 'BUILD-RECEIPT.json'] : ['agon-agent', 'agent.json', platform === 'android' ? 'install-android.sh' : 'install.sh + uninstall.sh', 'INSTALL.txt', 'SHA256SUMS', 'BUILD-RECEIPT.json']).map((file) => <div key={file} className="flex items-center gap-2 text-[10px] text-slate-400"><FileCheck2 size={12} className="text-slate-600"/><span className="font-mono">{file}</span></div>)}</div></div>
            {artifact && <div className="mt-3 rounded-xl border border-white/[0.055] p-3"><div className="flex items-center justify-between"><span className="font-mono text-[8px] uppercase tracking-wider text-slate-600">Native binary SHA-256</span><button onClick={() => copy(artifact.sha256, 'Checksum')} className="text-slate-600 hover:text-white"><Copy size={12}/></button></div><p className="mt-2 break-all font-mono text-[8px] leading-4 text-slate-500">{artifact.sha256}</p></div>}
            {building && <div className="mt-4"><div className="mb-2 flex items-center justify-between text-[10px]"><span className="flex items-center gap-2 text-slate-400"><LoaderCircle size={12} className="animate-spin"/>{stage}</span><span className="font-mono text-lime-300">{Math.round(progress)}%</span></div><div className="h-1 overflow-hidden rounded-full bg-white/[0.06]"><motion.div className="h-full bg-lime-300" animate={{ width: `${progress}%` }}/></div></div>}
            {packageInfo && <motion.div className="mt-4 rounded-xl border border-lime-300/15 bg-lime-300/[0.04] p-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div className="flex items-center gap-2 text-[11px] font-medium text-lime-200"><PackageCheck size={15}/>Build verified</div><p className="mt-2 break-all font-mono text-[9px] text-slate-500">{packageInfo.name}</p><div className="mt-3 flex items-center justify-between text-[9px] text-slate-500"><span>{formatBytes(packageInfo.size)}</span><button onClick={downloadAgain} className="text-lime-300 hover:text-lime-200">Download again</button></div></motion.div>}
            {manifestError && <p className="mt-3 text-[10px] text-rose-300">{manifestError}</p>}
              <Button variant="primary" size="lg" className="mt-5 w-full" icon={building ? LoaderCircle : CloudDownload} disabled={building || !artifact} onClick={buildPackage}>{building ? 'Building native package…' : packageInfo ? 'Build another installer' : platform === 'windows' && arch === 'amd64' ? 'Build & download Windows MSI' : 'Build & download installer'}</Button>
            <p className="mt-3 flex items-start gap-2 text-[9px] leading-4 text-slate-600"><ShieldCheck size={12} className="mt-0.5 shrink-0"/>The agent binary is checksum-verified. It generates its own long-lived device credential locally; the hosted relay stores only a hash and requires code confirmation before activation.</p>
          </div>
        </Panel>
        {platform === 'android' && <Panel className="border-amber-300/10 bg-amber-300/[0.02] p-4"><div className="flex gap-3"><Smartphone size={17} className="shrink-0 text-amber-300"/><div><p className="text-[11px] font-medium text-amber-100">Android deployment scope</p><p className="mt-1 text-[10px] leading-5 text-slate-500">This is a real ARM64 agent for MDM/ADB-managed devices, not an APK. Android boot persistence requires explicit device-owner provisioning.</p></div></div></Panel>}
      </div>
    </div>
  </div>
}
