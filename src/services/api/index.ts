import { hubClient, isCloudHosting } from './hubClient'
import { mobileApi } from './mobileStorage'

/**
 * Unified Resilient API Client for SML Legacy Cold Store App.
 *
 * Architecture:
 * 1. In Electron Desktop App: uses Electron IPC (`window.api`), which directly delegates
 *    to the authoritative transactional SQLite database and Local Hub engine.
 * 2. On Android Tablets / LAN Browsers: uses `hubClient` which connects directly to the
 *    Local Depot Hub REST API over LAN/Wi-Fi (`http://<depot-hub-ip>:4821/api/...`).
 * 3. On Vercel / Cloud Web / Hub Offline: automatically routes to `mobileApi`, which
 *    connects directly to Supabase Cloud, ensuring 100% login and system availability
 *    with zero network mixed-content errors.
 */
export function getApi() {
  if (typeof window !== 'undefined' && window.api) {
    const electronApi = window.api as any
    
    // Create a wrapper object that includes both Electron IPC and custom methods
    const wrappedApi = {
      ...electronApi,
      
      refundSale: async (id: string, username?: string, userRole?: string) => {
        if ((window as any).electron?.ipcRenderer?.invoke) {
          try {
            return await (window as any).electron.ipcRenderer.invoke('sales:refund', id)
          } catch {
            // fallback
          }
        }
        return await (hubClient as any).refundSale(id, username, userRole)
      },
      
      // Bluetooth printer methods
      connectBluetoothPrinter: () => hubClient.connectBluetoothPrinter(),
      disconnectBluetoothPrinter: () => hubClient.disconnectBluetoothPrinter(),
      getBluetoothPrinterStatus: () => hubClient.getBluetoothPrinterStatus(),
      testBluetoothPrinter: () => hubClient.testBluetoothPrinter(),
      setBluetoothPaperWidth: (w: any) => hubClient.setBluetoothPaperWidth(w),
      
      // Enhanced printReceipt with Bluetooth printer priority
      printReceipt: async (html: string) => {
        const btStatus = hubClient.getBluetoothPrinterStatus()
        if (btStatus.isConnected) {
          const btRes = await hubClient.printReceipt(html)
          if (btRes.success) return btRes
        }
        if (typeof electronApi.printReceipt === 'function') {
          return await electronApi.printReceipt(html)
        }
        return await hubClient.printReceipt(html)
      },

      // Enhanced openCashDrawer with Bluetooth printer priority
      openCashDrawer: async () => {
        const btStatus = hubClient.getBluetoothPrinterStatus()
        if (btStatus.isConnected) {
          const btRes = await hubClient.openCashDrawer()
          if (btRes.success) return btRes
        }
        if (typeof electronApi.openCashDrawer === 'function') {
          return await electronApi.openCashDrawer()
        }
        return await hubClient.openCashDrawer()
      },

      // Enhanced getPrinters including Bluetooth printer
      getPrinters: async () => {
        let list: any[] = []
        if (typeof electronApi.getPrinters === 'function') {
          try {
            list = (await electronApi.getPrinters()) || []
          } catch {
            list = []
          }
        }
        const btStatus = hubClient.getBluetoothPrinterStatus()
        if (btStatus.isConnected && btStatus.deviceName) {
          list = [{ name: `Bluetooth: ${btStatus.deviceName}`, displayName: `Bluetooth: ${btStatus.deviceName}`, isDefault: true }, ...list]
        }
        return list
      }
    }

    // Keep window.api updated with wrapped handlers
    try {
      window.api = wrappedApi
    } catch {
      // ignore if non-writable
    }

    return wrappedApi
  }

  // Running on Web, Android Tablet browser, or Vercel
  // If hosted on Vercel or cloud web with no custom depot hub URL, use mobileApi directly
  if (isCloudHosting()) {
    return mobileApi as any
  }

  // When on LAN or with custom hub URL, wrap hubClient with automatic fallback to mobileApi
  const resilientApi = new Proxy(hubClient as any, {
    get(target, prop: string) {
      const hubMethod = (target as any)[prop]
      const mobileMethod = (mobileApi as any)[prop]

      if (typeof hubMethod === 'function') {
        return async (...args: any[]) => {
          try {
            return await hubMethod.apply(target, args)
          } catch (err: any) {
            const isConnectionError =
              err?.message?.includes('Cannot connect to Local Depot Hub') ||
              err?.message?.includes('Failed to fetch') ||
              err?.message?.includes('NetworkError') ||
              err?.name === 'TypeError'
            if (isConnectionError && typeof mobileMethod === 'function') {
              console.warn(`Local Depot Hub unreachable for ${prop}. Falling back to Standalone Cloud API.`)
              return await mobileMethod.apply(mobileApi, args)
            }
            throw err
          }
        }
      }

      return mobileMethod || hubMethod
    }
  })

  return resilientApi
}

export const api = getApi()

// Register this client device with the Local Depot Hub only when on local network
if (typeof window !== 'undefined' && !isCloudHosting()) {
  setTimeout(() => {
    hubClient.registerDeviceWithHub().catch(() => {})
  }, 1000)
}

