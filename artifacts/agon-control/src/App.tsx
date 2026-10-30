import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ConsoleLayout } from './components/ConsoleLayout'
import { AppStoreProvider } from './store/AppStore'

const Overview = lazy(() => import('./pages/Overview'))
const Devices = lazy(() => import('./pages/Devices'))
const Sessions = lazy(() => import('./pages/Sessions'))
const Deployment = lazy(() => import('./pages/Deployment'))
const Automation = lazy(() => import('./pages/Automation'))
const RelayNetwork = lazy(() => import('./pages/RelayNetwork'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

function PageLoader() {
  return <div className="flex min-h-[50vh] items-center justify-center"><div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600"><span className="h-4 w-4 animate-spin rounded-full border border-white/10 border-t-lime-300" />Loading workspace</div></div>
}

export default function App() {
  return <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
    <AppStoreProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<ConsoleLayout />}>
            <Route index element={<Overview />} />
            <Route path="devices" element={<Devices />} />
            <Route path="devices/:deviceId" element={<Devices />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="deployment" element={<Deployment />} />
            <Route path="automation" element={<Automation />} />
            <Route path="relay" element={<RelayNetwork />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AppStoreProvider>
  </BrowserRouter>
}
