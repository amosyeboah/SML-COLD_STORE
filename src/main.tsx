import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './styles/globals.css'
import { getApi } from './services/api'
import { initWorkManager } from './services/sync/syncQueue'

// Polyfill window.api for Capacitor / Android Tablet runtime and ensure complete API surface
if (typeof window !== 'undefined') {
  if (!window.api) {
    window.api = getApi()
  } else {
    getApi()
  }
}

// Start offline background WorkManager (handles reconnection & periodic flush)
initWorkManager()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

