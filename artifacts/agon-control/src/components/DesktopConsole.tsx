import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, CircleHelp, Keyboard, Monitor, MousePointer2, Radio, ShieldCheck, Square, Wifi, WifiOff, FolderOpen, Terminal, MessageSquare, Clipboard } from 'lucide-react'

type Props = {
  sessionId: string
  deviceName: string
  sessionCode: string
  websocketUrl: string
  onEnd: () => Promise<void>
}

type RemoteStatus = 'awaiting_consent' | 'waiting' | 'active' | 'ended' | 'disconnected' | 'declined' | 'consent_required'
type ConnectionState = 'connecting' | 'connected' | 'reconnecting'
type PointerButton = 'left' | 'right' | 'middle'

type ServerMessage =
  | { type: 'desktop_frame'; sessionId: string; jpeg: string; width: number; height: number }
  | { type: 'session_status'; status: RemoteStatus }
  | { type: 'error'; message: string }

const MOVE_INTERVAL_MS = 50
const RECONNECT_LIMIT = 6

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function buttonName(button: number): PointerButton | undefined {
  if (button === 0) return 'left'
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  return undefined
}

export default function DesktopConsole({ sessionId, deviceName, sessionCode, websocketUrl, onEnd }: Props) {
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>('awaiting_consent')
  const [frame, setFrame] = useState<{ src: string; width: number; height: number } | null>(null)
  const [error, setError] = useState('')
  const [ending, setEnding] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const moveSentAtRef = useRef(0)
  const movePendingRef = useRef<{ x: number; y: number } | null>(null)
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const endingRef = useRef(false)
  const remoteStatusRef = useRef<RemoteStatus>('awaiting_consent')

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN || remoteStatusRef.current !== 'active' || endingRef.current) return
    socket.send(JSON.stringify(payload))
  }, [])

  useEffect(() => {
    mountedRef.current = true
    endingRef.current = false
    retryCountRef.current = 0
    remoteStatusRef.current = 'awaiting_consent'
    setConnection('connecting')
    setRemoteStatus('awaiting_consent')
    setFrame(null)
    setError('')

    let disposed = false
    const connect = () => {
      if (disposed || endingRef.current) return
      setConnection(retryCountRef.current > 0 ? 'reconnecting' : 'connecting')
      let socket: WebSocket
      try {
        socket = new WebSocket(websocketUrl)
      } catch {
        scheduleReconnect()
        return
      }
      socketRef.current = socket
      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) return
        retryCountRef.current = 0
        setConnection('connected')
        setError('')
      }
      socket.onmessage = (event) => {
        if (disposed || socketRef.current !== socket) return
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage
          if (message.type === 'desktop_frame') {
            if (message.sessionId !== sessionId || !message.jpeg || !Number.isFinite(message.width) || !Number.isFinite(message.height)) return
            setFrame({ src: `data:image/jpeg;base64,${message.jpeg}`, width: message.width, height: message.height })
          } else if (message.type === 'session_status') {
            remoteStatusRef.current = message.status
            setRemoteStatus(message.status)
            if (message.status === 'ended') {
              setFrame(null)
              socket.close(1000, 'Remote session ended')
            } else if (message.status === 'disconnected') {
              setConnection('reconnecting')
              socket.close()
            }
          } else if (message.type === 'error') {
            setError(message.message || 'The remote session reported an error.')
          }
        } catch {
          setError('A message from the remote session could not be read.')
        }
      }
      socket.onerror = () => {
        if (!disposed && socketRef.current === socket) setError('Connection interrupted. Retrying the secure relay.')
      }
      socket.onclose = () => {
        if (disposed || endingRef.current || remoteStatusRef.current === 'ended') return
        socketRef.current = null
        scheduleReconnect()
      }
    }
    const scheduleReconnect = () => {
      if (disposed || endingRef.current || remoteStatusRef.current === 'ended') return
      if (retryCountRef.current >= RECONNECT_LIMIT) {
        setConnection('reconnecting')
        setError('The relay could not be reached. Reconnect attempts are paused.')
        return
      }
      retryCountRef.current += 1
      setConnection('reconnecting')
      const delay = Math.min(1000 * 2 ** (retryCountRef.current - 1), 12000)
      retryTimerRef.current = setTimeout(connect, delay)
    }
    connect()

    return () => {
      disposed = true
      mountedRef.current = false
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
      movePendingRef.current = null
      const socket = socketRef.current
      socketRef.current = null
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Viewer closed')
    }
  }, [sessionId, websocketUrl])

  const handlePointer = (event: ReactPointerEvent<HTMLDivElement>, kind: 'move' | 'down' | 'up') => {
    if (remoteStatusRef.current !== 'active' || !frame) return
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height)
    const drawnWidth = frame.width * scale
    const drawnHeight = frame.height * scale
    const offsetX = (rect.width - drawnWidth) / 2
    const offsetY = (rect.height - drawnHeight) / 2
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left - offsetX) / drawnWidth))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top - offsetY) / drawnHeight))
    const button = kind === 'move' ? undefined : buttonName(event.button)
    if (kind !== 'move' && !button) return
    const payload = { type: 'desktop_input', sessionId, event: 'pointer', kind, x, y, ...(button ? { button } : {}) }

    if (kind === 'move') {
      const now = Date.now()
      const elapsed = now - moveSentAtRef.current
      if (elapsed >= MOVE_INTERVAL_MS) {
        moveSentAtRef.current = now
        send(payload)
        return
      }
      movePendingRef.current = { x, y }
      if (!moveTimerRef.current) {
        moveTimerRef.current = setTimeout(() => {
          moveTimerRef.current = null
          const pending = movePendingRef.current
          movePendingRef.current = null
          if (pending && remoteStatusRef.current === 'active') {
            moveSentAtRef.current = Date.now()
            send({ type: 'desktop_input', sessionId, event: 'pointer', kind: 'move', ...pending })
          }
        }, MOVE_INTERVAL_MS - elapsed)
      }
    } else {
      send(payload)
    }
  }

  const handleKey = (event: ReactKeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (remoteStatusRef.current !== 'active' || isEditableTarget(event.target) || event.metaKey || (event.altKey && event.code === 'F4')) return
    event.preventDefault()
    send({ type: 'desktop_input', sessionId, event: 'key', key: event.code, down })
  }

  const endSession = async () => {
    if (endingRef.current) return
    endingRef.current = true
    setEnding(true)
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    try {
      await onEnd()
      remoteStatusRef.current = 'ended'
      setRemoteStatus('ended')
      setFrame(null)
      const socket = socketRef.current
      socketRef.current = null
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Session ended by administrator')
    } catch {
      endingRef.current = false
      if (mountedRef.current) {
        setEnding(false)
        setError('The session could not be ended. Please retry.')
      }
    }
  }

  const status = remoteStatus === 'active'
    ? 'Live access active'
    : remoteStatus === 'ended'
      ? 'Session ended'
        : remoteStatus === 'disconnected'
        ? 'Endpoint disconnected'
          : remoteStatus === 'declined'
            ? 'Endpoint declined consent'
            : remoteStatus === 'consent_required'
              ? 'Consent required'
        : connection === 'connected'
          ? 'Waiting for endpoint consent'
          : connection === 'reconnecting'
            ? 'Reconnecting to relay'
            : 'Connecting to secure relay'

  const statusTone = remoteStatus === 'active' ? 'text-lime-300' : remoteStatus === 'ended' || remoteStatus === 'disconnected' || remoteStatus === 'declined' ? 'text-rose-300' : 'text-amber-300'

  return <section className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#10171c] text-slate-200 shadow-[0_18px_60px_rgba(0,0,0,0.26)]" data-testid="desktop-console">
    <header className="flex flex-col gap-4 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-200"><Monitor size={18} /></div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white" data-testid="text-device-name">{deviceName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500"><span className="font-mono">{sessionCode}</span><span aria-hidden="true" className="text-slate-700">/</span><span data-testid="text-session-id">{sessionId}</span></p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2" role="status" aria-live="polite" data-testid="status-desktop-session">
          {connection === 'connecting' || connection === 'reconnecting'
            ? <Radio size={13} className="animate-pulse text-amber-300" />
            : remoteStatus === 'active'
              ? <Wifi size={13} className="text-lime-300" />
              : <WifiOff size={13} className={statusTone} />}
          <span className={`text-[10px] font-medium ${statusTone}`}>{status}</span>
        </div>
        <button type="button" onClick={endSession} disabled={ending || remoteStatus === 'ended'} data-testid="button-end-desktop-session" className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-300/20 bg-rose-400/[0.08] px-3 text-[11px] font-semibold text-rose-200 transition hover:border-rose-300/35 hover:bg-rose-400/[0.14] disabled:cursor-not-allowed disabled:opacity-50">
          <Square size={12} fill="currentColor" />{ending ? 'Ending…' : 'End session'}
        </button>
      </div>
    </header>

    <div className="grid lg:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0 p-3 sm:p-5">
        <div
          className={`relative flex aspect-video min-h-[220px] w-full items-center justify-center overflow-hidden rounded-xl border bg-[#090e12] outline-none transition-colors ${remoteStatus === 'active' ? 'cursor-crosshair border-lime-300/15 focus-visible:ring-2 focus-visible:ring-lime-300/60' : 'border-white/[0.07]'}`}
          tabIndex={remoteStatus === 'active' ? 0 : -1}
          aria-label={remoteStatus === 'active' ? `Live desktop view for ${deviceName}. Focus this view to send keyboard input.` : 'Desktop view. Waiting for endpoint consent.'}
          onPointerMove={(event) => handlePointer(event, 'move')}
          onPointerDown={(event) => { if (remoteStatus === 'active') { event.currentTarget.focus(); handlePointer(event, 'down') } }}
          onPointerUp={(event) => handlePointer(event, 'up')}
          onTouchStart={(event) => { if (remoteStatus === 'active') { event.preventDefault(); handlePointer(event as any, 'down') } }}
          onTouchMove={(event) => { if (remoteStatus === 'active') { event.preventDefault(); handlePointer(event as any, 'move') } }}
          onTouchEnd={(event) => { if (remoteStatus === 'active') { event.preventDefault(); handlePointer(event as any, 'up') } }}
          onContextMenu={(event) => { if (remoteStatus === 'active') event.preventDefault() }}
          onKeyDown={(event) => handleKey(event, true)}
          onKeyUp={(event) => handleKey(event, false)}
          onBlur={() => {
            if (remoteStatus === 'active') {
              send({ type: 'desktop_input', sessionId, event: 'key', key: 'ShiftLeft', down: false })
              send({ type: 'desktop_input', sessionId, event: 'key', key: 'ControlLeft', down: false })
              send({ type: 'desktop_input', sessionId, event: 'key', key: 'AltLeft', down: false })
              send({ type: 'desktop_input', sessionId, event: 'key', key: 'MetaLeft', down: false })
            }
          }}
          data-testid="frame-desktop-view"
        >
          {frame && remoteStatus === 'active' ? <img src={frame.src} alt={`Live desktop frame from ${deviceName}, ${frame.width} by ${frame.height} pixels`} className="pointer-events-none h-full w-full select-none object-contain" draggable={false} data-testid="img-desktop-frame" /> : (
            <div className="mx-auto flex max-w-md flex-col items-center px-6 text-center">
              {remoteStatus === 'ended' ? <Square size={26} className="text-slate-500" /> : remoteStatus === 'disconnected' ? <WifiOff size={27} className="text-rose-300/80" /> : connection !== 'connected' ? <Radio size={27} className="animate-pulse text-amber-300" /> : <ShieldCheck size={28} className="text-amber-300" />}
              <h3 className="mt-4 text-sm font-semibold text-slate-200" data-testid="text-frame-state">
                {remoteStatus === 'ended' ? 'Remote session has ended' : remoteStatus === 'declined' ? 'Endpoint declined this request' : remoteStatus === 'consent_required' ? 'Endpoint consent is required' : remoteStatus === 'disconnected' ? 'Endpoint is disconnected' : connection !== 'connected' ? 'Establishing relay connection' : 'Waiting for endpoint consent'}
              </h3>
              <p className="mt-2 text-xs leading-5 text-slate-500" data-testid="text-frame-description">
                {remoteStatus === 'ended' ? 'The endpoint has closed this support session.' : remoteStatus === 'declined' ? 'No screen or input was shared. You can create a new request if further support is needed.' : remoteStatus === 'consent_required' ? 'The endpoint must approve the local prompt before any desktop content is available.' : remoteStatus === 'disconnected' ? 'The endpoint is disconnected. Reconnect only after its visible companion returns online.' : connection !== 'connected' ? 'The viewer is connecting. No desktop content is available yet.' : 'The endpoint must accept its local consent prompt before a live desktop view is available.'}
              </p>
            </div>
          )}
          {remoteStatus === 'active' && !frame && <span className="absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[9px] font-medium text-slate-300" data-testid="status-frame-waiting">Live session active · waiting for first frame</span>}
        </div>
        {error && <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300/15 bg-rose-300/[0.05] px-3 py-2.5 text-xs leading-5 text-rose-200" data-testid="status-desktop-error"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div>}
        <div className="mt-3 flex items-start gap-2 text-[10px] leading-5 text-slate-500"><CircleHelp size={13} className="mt-0.5 shrink-0 text-slate-600" /><p>Remote input is available only after endpoint consent. Click the desktop view to focus it before using the keyboard.</p></div>
      </div>

      <aside className="border-t border-white/[0.07] bg-black/[0.08] p-4 sm:p-5 lg:border-l lg:border-t-0" aria-label="Session access details">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-600">ScreenConnect-style tools</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[9px] text-slate-300 hover:bg-white/10" disabled={remoteStatus !== 'active'}>
            <FolderOpen size={14} /> Files
          </button>
          <button className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[9px] text-slate-300 hover:bg-white/10" disabled={remoteStatus !== 'active'}>
            <Terminal size={14} /> Shell
          </button>
          <button className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[9px] text-slate-300 hover:bg-white/10" disabled={remoteStatus !== 'active'}>
            <MessageSquare size={14} /> Chat
          </button>
          <button className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[9px] text-slate-300 hover:bg-white/10" disabled={remoteStatus !== 'active'}>
            <Clipboard size={14} /> Clipboard
          </button>
        </div>
        <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-600">Access record</p>
        <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
          <div className="flex items-start gap-2.5"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-cyan-300/80" /><div><p className="text-[11px] font-medium text-slate-200">Consent-gated access</p><p className="mt-1 text-[10px] leading-4 text-slate-500">Enterprise policy + endpoint opt-in required. Full audit trail maintained.</p></div></div>
        </div>
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <div className="flex items-center gap-2 text-[10px] text-slate-500"><MousePointer2 size={13} className="text-slate-600" /><span>Pointer input</span><span className={`ml-auto ${remoteStatus === 'active' ? 'text-lime-300' : 'text-slate-600'}`}>{remoteStatus === 'active' ? 'Available' : 'Locked'}</span></div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500"><Keyboard size={13} className="text-slate-600" /><span>Keyboard input</span><span className={`ml-auto ${remoteStatus === 'active' ? 'text-lime-300' : 'text-slate-600'}`}>{remoteStatus === 'active' ? 'Available' : 'Locked'}</span></div>
        </div>
        <p className="mt-5 border-t border-white/[0.06] pt-4 text-[9px] leading-4 text-slate-600">Session activity is associated with this administrator and session code for audit review. Core system style: ScreenConnect.</p>
      </aside>
    </div>
  </section>
}
