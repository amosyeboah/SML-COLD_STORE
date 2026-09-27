import { hubClient } from './hubClient'

/**
 * Unified Authoritative API Client for SML Legacy Cold Store App.
 *
 * Architecture:
 * 1. In Electron Desktop App: uses Electron IPC (`window.api`), which directly delegates
 *    to the transactional SQLite database and Local Hub engine.
 * 2. On Android Tablets / LAN Browsers: uses `hubClient` which connects directly to the
 *    Local Depot Hub REST API over LAN/Wi-Fi (`http://<depot-hub-ip>:4820/api/...`).
 *
 * Browser localStorage is NEVER used as an authoritative transactional store.
 * The depot's local SQLite database is the single authoritative source of truth.
 */
export function getApi() {
  if (typeof window !== 'undefined' && window.api) {
    if (!window.api.refundSale) {
      window.api.refundSale = async (id: string, username?: string, userRole?: string) => {
        if ((window as any).electron?.ipcRenderer?.invoke) {
          try {
            return await (window as any).electron.ipcRenderer.invoke('sales:refund', id)
          } catch {
            // fallback
          }
        }
        return await (hubClient as any).refundSale(id, username, userRole)
      }
    }
    return window.api
  }
  return hubClient as any
}

export const api = getApi()

// Register this client device with the Local Depot Hub
if (typeof window !== 'undefined') {
  setTimeout(() => {
    hubClient.registerDeviceWithHub().catch(() => {})
  }, 1000)
}
