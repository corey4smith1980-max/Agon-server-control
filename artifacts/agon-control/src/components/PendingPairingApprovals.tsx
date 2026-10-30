import { useCallback, useEffect, useState } from 'react'
import { Check, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Panel } from './UI'
import { useAppStore } from '../store/AppStore'

interface PendingDevice {
  id: string
  name: string
  hostname: string
  group: string
  os: string
  arch: string
  agent: string
  requestedAt: string
}

export function PendingPairingApprovals() {
  const { toast, syncControlPlane } = useAppStore()
  const [devices, setDevices] = useState<PendingDevice[]>([])
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')

  const loadPending = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const response = await fetch('/api/agon/pending-devices', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
      setDevices(Array.isArray(result.devices) ? result.devices : [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load pending devices.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPending(true)
    const timer = window.setInterval(() => void loadPending(), 12000)
    return () => window.clearInterval(timer)
  }, [loadPending])

  const approve = async (device: PendingDevice) => {
    const pairingCode = codes[device.id]?.trim()
    if (!pairingCode) {
      toast('Pairing code required', 'Enter the code printed by the device installer.', 'warning')
      return
    }
    setWorkingId(device.id)
    try {
      const response = await fetch(`/api/agon/pending-devices/${encodeURIComponent(device.id)}/approve`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `Approval failed (${response.status})`)
      setCodes((current) => {
        const next = { ...current }
        delete next[device.id]
        return next
      })
      await loadPending()
      await syncControlPlane(true)
      toast('Device approved', `${device.name} can now connect to the Agon relay.`)
    } catch (approvalError) {
      toast('Could not approve device', approvalError instanceof Error ? approvalError.message : 'Try again.', 'error')
    } finally {
      setWorkingId('')
    }
  }

  const ignore = async (device: PendingDevice) => {
    setWorkingId(device.id)
    try {
      const response = await fetch(`/api/agon/pending-devices/${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
      setCodes((current) => {
        const next = { ...current }
        delete next[device.id]
        return next
      })
      await loadPending()
      toast('Pairing request ignored', `${device.name} was not authorized to connect.`, 'warning')
    } catch (ignoreError) {
      toast('Could not ignore request', ignoreError instanceof Error ? ignoreError.message : 'Try again.', 'error')
    } finally {
      setWorkingId('')
    }
  }

  return (
    <Panel className="mb-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="eyebrow">Device access</span>
          <h2 className="mt-2 font-display text-base font-semibold text-white">Pending pairing approvals</h2>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            Approve only after the code matches the one shown on the device you manage.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPending(true)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
        >
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs text-rose-200">{error}</p>}
      {!error && !loading && devices.length === 0 && (
        <p className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-slate-500">
          No devices are waiting for approval. New installers will appear here after they request pairing.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {devices.map((device) => (
          <div key={device.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{device.name}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {device.hostname} · {device.os} · {device.arch} · {device.group}
                </p>
                <p className="mt-1 text-[10px] text-slate-600">Requested {new Date(device.requestedAt).toLocaleString()}</p>
              </div>
              <code className="max-w-full break-all rounded-md bg-black/20 px-2 py-1 text-[10px] text-slate-500">{device.id}</code>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                aria-label={`Pairing code for ${device.name}`}
                autoComplete="off"
                className="input min-w-0 flex-1 font-mono uppercase tracking-wider"
                placeholder="Enter code shown on device"
                value={codes[device.id] ?? ''}
                onChange={(event) => setCodes((current) => ({ ...current, [device.id]: event.target.value.toUpperCase() }))}
              />
              <button
                type="button"
                onClick={() => void approve(device)}
                disabled={workingId === device.id}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-lime-300 px-4 py-2 text-xs font-semibold text-[#14200d] hover:bg-lime-200 disabled:opacity-50"
              >
                {workingId === device.id ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                Approve
              </button>
              <button
                type="button"
                onClick={() => void ignore(device)}
                disabled={workingId === device.id}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
              >
                <X size={14} />
                Ignore
              </button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
