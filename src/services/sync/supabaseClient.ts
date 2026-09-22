import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface SupabaseConfig {
  url: string
  anonKey: string
  enabled: boolean
}

const STORAGE_KEY = 'sml_coldstore_supabase_config'

// Default fallback config (or configured via environment variables)
const DEFAULT_CONFIG: SupabaseConfig = {
  url: (import.meta as any).env?.VITE_SUPABASE_URL || '',
  anonKey: (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '',
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
      return { ...DEFAULT_CONFIG, ...parsed }
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
