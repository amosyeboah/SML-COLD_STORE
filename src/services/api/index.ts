import { mobileApi } from './mobileStorage'

/**
 * Unified API Client for SML Legacy Cold Store App.
 * Automatically uses Electron IPC (`window.api`) when running in Electron Desktop App,
 * or falls back to local mobile storage (`mobileApi`) when running on Android Tablet / Web.
 */
export function getApi() {
  if (typeof window !== 'undefined' && window.api) {
    return window.api
  }
  return mobileApi as any
}

export const api = getApi()
