import type { Platform } from './types'

export const HOSTED_CONTROL_PLANE_URL = 'https://agon-server-control.replit.app/deployment/api/agon'

export function cn(...classes: Array<string | false | null | undefined | Record<string, boolean>>) {
  return classes.flatMap((value) => {
    if (typeof value === 'string') return value ? [value] : []
    if (value && typeof value === 'object') return Object.entries(value).filter(([, enabled]) => enabled).map(([name]) => name)
    return []
  }).join(' ')
}

export function artifactPath(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

export function timeAgo(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function platformLabel(platform: Platform) {
  return ({ windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android' })[platform]
}

export function randomToken(prefix = 'agon_device') {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 36)}`
}

export function sessionCode() {
  const values = new Uint16Array(2)
  crypto.getRandomValues(values)
  return `AG-${1000 + (values[0] % 9000)}-${1000 + (values[1] % 9000)}`
}

export async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
  const input = document.createElement('textarea')
  input.value = text
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

export function openSessionLauncher(deviceId?: string) {
  window.dispatchEvent(new CustomEvent('agon:new-session', { detail: { deviceId } }))
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadText(content: string, filename: string, type = 'text/plain') {
  downloadBlob(new Blob([content], { type }), filename)
}

export function toCsv(rows: Array<Record<string, string | number | boolean | undefined>>) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n')
}
