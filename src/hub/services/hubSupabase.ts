import { createClient, SupabaseClient } from '@supabase/supabase-js'

if (typeof globalThis.WebSocket === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ws = require('ws')
    ;(globalThis as any).WebSocket = ws.default || ws
  } catch {
    // WebSocket is natively available in Node 18+ and Electron
  }
}

let supabaseInstance: SupabaseClient | null = null

export function getSupabaseCredentials() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://yhglbervaljjkmttzonk.supabase.co'

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloZ2xiZXJ2YWxqamttdHR6b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNDA4MzIsImV4cCI6MjEwNTYxNjgzMn0.8STKvBtPKL3J9BH7Mdvadrna-zcYYFqGXGaBx4y_Wis'

  return { url, key }
}

export function getHubSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const { url, key } = getSupabaseCredentials()
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return supabaseInstance
}

export async function testCloudConnectivity(): Promise<{
  connected: boolean
  latencyMs: number
  error?: string
}> {
  const client = getHubSupabaseClient()
  const start = Date.now()
  try {
    const { error } = await client
      .from('sml_stores')
      .select('id')
      .limit(1)

    const latencyMs = Date.now() - start
    if (error) {
      return { connected: false, latencyMs, error: error.message }
    }
    return { connected: true, latencyMs }
  } catch (err: any) {
    return { connected: false, latencyMs: Date.now() - start, error: err.message || 'Network unreachable' }
  }
}
