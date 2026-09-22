import { api } from '../../electron/preload'

declare global {
  interface Window {
    api: typeof api
    electron: {
      ipcRenderer: {
        send(channel: string, ...args: any[]): void
        on(channel: string, listener: (...args: any[]) => void): () => void
        invoke(channel: string, ...args: any[]): Promise<any>
      }
    }
  }
}
