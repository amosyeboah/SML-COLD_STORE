import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './styles/globals.css'
import { getApi } from './services/api'
import { initWorkManager } from './services/sync/syncQueue'
import ErrorBoundary from './components/ErrorBoundary'

// Ensure window.api is equipped with unified wrappers (Bluetooth printer, cash drawer, etc.)
if (typeof window !== 'undefined') {
  try {
    const existing = Object.getOwnPropertyDescriptor(window, 'api')
    const api = getApi()
    if (!existing || existing.writable) {
      // safe to assign
      ;(window as any).api = api
    } else {
      // merge methods onto existing read-only object where possible
      try {
        for (const k of Object.keys(api)) {
          try {
            ;(window as any).api[k] = (api as any)[k]
          } catch {}
        }
      } catch {}
    }
  } catch (e) {
    // fallback: do nothing
  }

  // Global error logging hooks to catch errors before React mounts
  window.addEventListener('error', (ev) => {
    try {
      const err = ev.error || new Error(ev.message || 'Unknown error')
      // best-effort remote log
      ;(window as any).api?.logError?.({ message: String(err.message), stack: err.stack || '' })
      // eslint-disable-next-line no-console
      console.error('Global error:', err)
    } catch {}
  })

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const reason = ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason))
      ;(window as any).api?.logError?.({ message: String(reason.message), stack: reason.stack || '' })
      // eslint-disable-next-line no-console
      console.error('Unhandled promise rejection:', reason)
    } catch {}
  })
}

// Start offline background WorkManager (handles reconnection & periodic flush)
initWorkManager()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

