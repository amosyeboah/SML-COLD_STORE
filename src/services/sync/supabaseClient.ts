import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfig {
  url: string
  anonKey: string
  enabled: boolean
}

const STORAGE_KEY = 'sml_coldstore_supabase_config'

// Default Supabase config for SML Legacy Limited cloud database
const DEFAULT_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://yhglbervaljjkmttzonk.supabase.co'
const DEFAULT_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloZ2xiZXJ2YWxqamttdHR6b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNDA4MzIsImV4cCI6MjEwNTYxNjgzMn0.8STKvBtPKL3J9BH7Mdvadrna-zcYYFqGXGaBx4y_Wis'

const DEFAULT_CONFIG: SupabaseConfig = {
  url: DEFAULT_URL,
  anonKey: DEFAULT_ANON_KEY,
  enabled: true,
}

let cachedClient: SupabaseClient | null = null
let cachedUrl: string | null = null
let cachedKey: string | null = null

export function getSupabaseConfig(): SupabaseConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        url: parsed.url && parsed.url.trim() ? parsed.url.trim() : DEFAULT_CONFIG.url,
        anonKey: parsed.anonKey && parsed.anonKey.trim() ? parsed.anonKey.trim() : DEFAULT_CONFIG.anonKey,
        enabled: parsed.enabled ?? true,
      }
    }
  } catch {
    // fallback
  }
  return DEFAULT_CONFIG
}

export function saveSupabaseConfig(config: Partial<SupabaseConfig>): SupabaseConfig {
  const current = getSupabaseConfig()
  const updated = { ...current, ...config }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  // Invalidate cached client
  cachedClient = null
  cachedUrl = null
  cachedKey = null
  return updated
}

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig()
  if (!config.url || !config.anonKey) {
    return null
  }

  if (cachedClient && cachedUrl === config.url && cachedKey === config.anonKey) {
    return cachedClient
  }

  try {
    cachedClient = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    cachedUrl = config.url
    cachedKey = config.anonKey
    return cachedClient
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err)
    return null
  }
}

export interface ConnectionCheckResult {
  connected: boolean
  message: string
  latencyMs: number
}

/**
 * Fast ping check to verify live connectivity to Supabase cloud.
 */
export async function checkCloudConnection(): Promise<ConnectionCheckResult> {
  const config = getSupabaseConfig()
  if (!config.url || !config.anonKey) {
    return {
      connected: false,
      message: 'Supabase URL or Anon Key is not configured',
      latencyMs: 0,
    }
  }

  const client = getSupabaseClient()
  if (!client) {
    return {
      connected: false,
      message: 'Invalid Supabase client configuration',
      latencyMs: 0,
    }
  }

  const startTime = Date.now()
  try {
    // Query stores table with 5s timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)

    const { error } = await client
      .from('sml_stores')
      .select('id')
      .limit(1)
      .abortSignal(controller.signal)

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (error && error.code !== 'PGRST116') {
      // If table doesn't exist yet, it's still connected to Supabase
      if (error.message?.includes('relation "sml_stores" does not exist') || error.code === '42P01') {
        return {
          connected: true,
          message: 'Connected to Supabase (Tables need schema.sql migration)',
          latencyMs,
        }
      }
      return {
        connected: false,
        message: error.message || 'Supabase request returned an error',
        latencyMs,
      }
    }

    return {
      connected: true,
      message: `Online (Connected to Supabase PostgreSQL)`,
      latencyMs,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime
    const isOffline =
      !navigator.onLine ||
      err.name === 'AbortError' ||
      err.message?.includes('Failed to fetch') ||
      err.message?.includes('NetworkError')

    return {
      connected: false,
      message: isOffline
        ? 'Offline (No internet connection)'
        : (err.message || 'Connection test failed'),
      latencyMs,
    }
  }
}

/**
 * Realtime subscription to cloud_sales table.
 * Automatically notifies when new sales are created, updated, or synced in Supabase.
 */
export function subscribeToCloudSales(onUpdate: (payload: any) => void): () => void {
  const client = getSupabaseClient()
  if (!client) return () => {}

  try {
    const channel = client
      .channel('cloud_sales_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_sales' },
        (payload) => {
          onUpdate(payload)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📡 [Supabase Realtime] Connected to cloud_sales stream')
        }
      })

    return () => {
      client.removeChannel(channel)
    }
  } catch (err) {
    console.warn('📡 [Supabase Realtime] Subscription error:', err)
    return () => {}
  }
}

/**
 * Realtime subscription to cloud_products table.
 * Automatically notifies when products catalog or stock is modified in Supabase.
 */
export function subscribeToCloudProducts(onUpdate: (payload: any) => void): () => void {
  const client = getSupabaseClient()
  if (!client) return () => {}

  try {
    const channel = client
      .channel('cloud_products_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_products' },
        (payload) => {
          onUpdate(payload)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📡 [Supabase Realtime] Connected to cloud_products stream')
        }
      })

    return () => {
      client.removeChannel(channel)
    }
  } catch (err) {
    console.warn('📡 [Supabase Realtime] Products subscription error:', err)
    return () => {}
  }
}

/**
 * Realtime subscription to cloud_batches table.
 * Automatically notifies when batches are received or modified in Supabase.
 */
export function subscribeToCloudBatches(onUpdate: (payload: any) => void): () => void {
  const client = getSupabaseClient()
  if (!client) return () => {}

  try {
    const channel = client
      .channel('cloud_batches_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_batches' },
        (payload) => {
          onUpdate(payload)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📡 [Supabase Realtime] Connected to cloud_batches stream')
        }
      })

    return () => {
      client.removeChannel(channel)
    }
  } catch (err) {
    console.warn('📡 [Supabase Realtime] Batches subscription error:', err)
    return () => {}
  }
}

/**
 * Realtime subscription to cloud_audit_logs table.
 * Automatically notifies when audit logs or state mirrors (customers, users, settings, purchases) are modified.
 */
export function subscribeToCloudAuditLogs(onUpdate: (payload: any) => void): () => void {
  const client = getSupabaseClient()
  if (!client) return () => {}

  try {
    const channel = client
      .channel('cloud_audit_logs_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_audit_logs' },
        (payload) => {
          onUpdate(payload)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📡 [Supabase Realtime] Connected to cloud_audit_logs stream')
        }
      })

    return () => {
      client.removeChannel(channel)
    }
  } catch (err) {
    console.warn('📡 [Supabase Realtime] Audit logs subscription error:', err)
    return () => {}
  }
}


