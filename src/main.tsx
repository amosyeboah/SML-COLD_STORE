import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './styles/globals.css'
import { getApi } from './services/api'
import { initWorkManager } from './services/sync/syncQueue'

// Polyfill window.api for Capacitor / Android Tablet runtime
if (typeof window !== 'undefined' && !window.api) {
  window.api = getApi()
}

// Start offline background WorkManager (handles reconnection & periodic flush)
initWorkManager()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

