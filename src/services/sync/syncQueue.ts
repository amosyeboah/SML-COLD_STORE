import { getSupabaseClient, checkCloudConnection } from './supabaseClient'

export type SyncEntity = 'SALE' | 'AUDIT_LOG' | 'PRODUCT' | 'BATCH' | 'PURCHASE'
export type SyncAction = 'INSERT' | 'UPDATE' | 'DELETE'

export interface SyncQueueItem {
  id: string
  entity: SyncEntity
  action: SyncAction
  payload: any
  status: 'PENDING' | 'SYNCING' | 'FAILED'
  retryCount: number
  createdAt: string
  lastAttemptAt?: string
  error?: string
}

export interface SyncSessionLog {
  id: string
  timestamp: string
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'OFFLINE'
  itemsSynced: number
  durationMs: number
  details: string
}

const QUEUE_STORAGE_KEY = 'sml_coldstore_sync_queue'
const LAST_SYNC_KEY = 'sml_coldstore_last_synced_at'
const HISTORY_STORAGE_KEY = 'sml_coldstore_sync_history'

type SyncListener = (status: {
  isSyncing: boolean
  pendingCount: number
  lastSyncTime: string | null
}) => void

const listeners: Set<SyncListener> = new Set()
let isCurrentlySyncing = false

export function subscribeToSyncState(listener: SyncListener): () => void {
  listeners.add(listener)
  listener({
    isSyncing: isCurrentlySyncing,
    pendingCount: getPendingQueue().length,
    lastSyncTime: getLastSyncTime(),
  })
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners() {
  const pendingCount = getPendingQueue().length
  const lastSyncTime = getLastSyncTime()
  listeners.forEach((l) =>
    l({
      isSyncing: isCurrentlySyncing,
      pendingCount,
      lastSyncTime,
    })
  )
}

// ─── Queue Management ────────────────────────────────────────────────────────

export function getQueue(): SyncQueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveQueue(queue: SyncQueueItem[]): void {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue))
  notifyListeners()
}

export function getPendingQueue(): SyncQueueItem[] {
  return getQueue().filter((item) => item.status === 'PENDING' || item.status === 'FAILED')
}

export function enqueueSyncItem(entity: SyncEntity, action: SyncAction, payload: any): SyncQueueItem {
  const queue = getQueue()
  const item: SyncQueueItem = {
    id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    entity,
    action,
    payload,
    status: 'PENDING',
    retryCount: 0,
    createdAt: new Date().toISOString(),
  }

  queue.push(item)
  saveQueue(queue)

  // If online, attempt background flush
  if (navigator.onLine && !isCurrentlySyncing) {
    flushSyncQueue().catch((err) => console.warn('Background auto-sync failed:', err))
  }

  return item
}

// ─── Last Sync Timestamp ──────────────────────────────────────────────────────

export function getLastSyncTime(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY)
}

export function setLastSyncTime(timestamp: string): void {
  localStorage.setItem(LAST_SYNC_KEY, timestamp)
  notifyListeners()
}

// ─── Sync History ─────────────────────────────────────────────────────────────

export function getSyncHistory(): SyncSessionLog[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addSyncHistoryLog(log: Omit<SyncSessionLog, 'id'>): void {
  const history = getSyncHistory()
  const newLog: SyncSessionLog = {
    ...log,
    id: `hist_${Date.now()}`,
  }
  history.unshift(newLog)
  // Keep last 40 sync runs
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 40)))
}

// ─── Flush / Process Sync Queue ───────────────────────────────────────────────

export async function flushSyncQueue(): Promise<{
  success: boolean
  syncedCount: number
  failedCount: number
  message: string
}> {
  if (isCurrentlySyncing) {
    return {
      success: false,
      syncedCount: 0,
      failedCount: 0,
      message: 'Sync is already in progress',
    }
  }

  const queue = getQueue()
  const pendingItems = queue.filter((i) => i.status === 'PENDING' || i.status === 'FAILED')

  if (pendingItems.length === 0) {
    // Queue is empty, but verify cloud connection and update last checked
    const health = await checkCloudConnection()
    if (health.connected) {
      setLastSyncTime(new Date().toISOString())
    }
    return {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      message: 'Sync queue is up to date. No pending items.',
    }
  }

  const client = getSupabaseClient()
  if (!client) {
    return {
      success: false,
      syncedCount: 0,
      failedCount: pendingItems.length,
      message: 'Supabase URL or Anon Key is missing. Configure settings in Offline Sync page.',
    }
  }

  // Fast connection check
  const health = await checkCloudConnection()
  if (!health.connected) {
    addSyncHistoryLog({
      timestamp: new Date().toISOString(),
      status: 'OFFLINE',
      itemsSynced: 0,
      durationMs: health.latencyMs,
      details: `Offline mode: ${pendingItems.length} items queued for next connection.`,
    })
    return {
      success: false,
      syncedCount: 0,
      failedCount: pendingItems.length,
      message: health.message,
    }
  }

  isCurrentlySyncing = true
  notifyListeners()

  const startTime = Date.now()
  let syncedCount = 0
  let failedCount = 0
  const remainingQueue: SyncQueueItem[] = []

  try {
    for (const item of queue) {
      if (item.status !== 'PENDING' && item.status !== 'FAILED') {
        continue
      }

      item.status = 'SYNCING'
      item.lastAttemptAt = new Date().toISOString()

      try {
        let uploadError: any = null

        if (item.entity === 'SALE') {
          const sale = item.payload
          // 1. Upload parent sale
          const { error: saleErr } = await client.from('cloud_sales').upsert({
            id: sale.id,
            store_id: 'sml_accra_main',
            sale_number: sale.saleNumber || `INV-${sale.id.slice(0, 8).toUpperCase()}`,
            customer_name: sale.customer?.name || sale.customerName || 'Walk-in Customer',
            total: sale.total,
            payment_method: sale.paymentMethod || 'CASH',
            cashier_username: sale.cashier || 'cashier',
            date: sale.date || new Date().toISOString(),
            synced_at: new Date().toISOString(),
          })

          if (saleErr) uploadError = saleErr

          // 2. Upload sale items
          if (!uploadError && sale.items && Array.isArray(sale.items)) {
            const cloudItems = sale.items.map((i: any) => ({
              sale_id: sale.id,
              product_id: i.batch?.medicineId || i.medicineId || i.productId || null,
              product_name: i.batch?.medicine?.name || i.name || 'Cold Store Item',
              sku: i.batch?.medicine?.sku || i.sku || null,
              quantity: i.quantity,
              unit_price: i.price,
              unit_cost: i.cost || 0,
              subtotal: (i.quantity || 1) * (i.price || 0),
            }))

            const { error: itemsErr } = await client.from('cloud_sale_items').upsert(cloudItems)
            if (itemsErr) uploadError = itemsErr
          }
        } else if (item.entity === 'AUDIT_LOG') {
          const log = item.payload
          const { error } = await client.from('cloud_audit_logs').upsert({
            id: log.id,
            store_id: 'sml_accra_main',
            action: log.action,
            category: log.category,
            details: log.details,
            operator: log.username || 'System',
            role: log.userRole || 'STAFF',
            severity: log.severity || 'INFO',
            metadata: log.metadata || null,
            created_at: log.createdAt || new Date().toISOString(),
            synced_at: new Date().toISOString(),
          })
          if (error) uploadError = error
        } else if (item.entity === 'PRODUCT') {
          const product = item.payload
          const { error } = await client.from('cloud_products').upsert({
            id: product.id,
            store_id: 'sml_accra_main',
            name: product.name,
            generic_name: product.genericName || null,
            sku: product.sku,
            category_name: product.category?.name || product.categoryName || 'General',
            price: product.price,
            cost: product.cost || 0,
            stock_quantity: product.stockQuantity || 0,
            min_stock_level: product.minStockLevel || 10,
            updated_at: new Date().toISOString(),
          })
          if (error) uploadError = error
        } else if (item.entity === 'BATCH') {
          const batch = item.payload
          const { error } = await client.from('cloud_batches').upsert({
            id: batch.id,
            product_id: batch.medicineId,
            batch_number: batch.batchNumber,
            expiry_date: batch.expiryDate,
            quantity: batch.quantity,
            updated_at: new Date().toISOString(),
          })
          if (error) uploadError = error
        }

        if (uploadError) {
          throw uploadError
        }

        syncedCount++
        // Don't add to remainingQueue (item is considered successfully synced)
      } catch (itemErr: any) {
        failedCount++
        item.status = 'FAILED'
        item.retryCount += 1
        item.error = itemErr.message || 'Upload error'
        remainingQueue.push(item)
      }
    }

    // Save remaining (failed or untouched) items back to queue
    saveQueue(remainingQueue)

    const durationMs = Date.now() - startTime
    const nowIso = new Date().toISOString()
    setLastSyncTime(nowIso)

    const sessionStatus = failedCount === 0 ? 'SUCCESS' : syncedCount > 0 ? 'PARTIAL' : 'FAILED'
    addSyncHistoryLog({
      timestamp: nowIso,
      status: sessionStatus,
      itemsSynced: syncedCount,
      durationMs,
      details:
        sessionStatus === 'SUCCESS'
          ? `Uploaded all ${syncedCount} queued change(s) to UK Owner Cloud.`
          : `Synced ${syncedCount} item(s), ${failedCount} item(s) failed.`,
    })

    // Log sync session to Supabase cloud as well
    client
      .from('cloud_sync_sessions')
      .insert({
        store_id: 'sml_accra_main',
        device_id: 'Main POS Terminal (Accra Depot)',
        sync_type: 'AUTO_BACKGROUND',
        status: sessionStatus,
        items_count: syncedCount,
        duration_ms: durationMs,
      })
      .then(() => {})
      .catch(() => {})

    return {
      success: sessionStatus !== 'FAILED',
      syncedCount,
      failedCount,
      message:
        sessionStatus === 'SUCCESS'
          ? `Synchronized ${syncedCount} items successfully to Supabase cloud.`
          : `Partially synced: ${syncedCount} succeeded, ${failedCount} retrying later.`,
    }
  } catch (err: any) {
    const durationMs = Date.now() - startTime
    addSyncHistoryLog({
      timestamp: new Date().toISOString(),
      status: 'FAILED',
      itemsSynced: syncedCount,
      durationMs,
      details: err.message || 'Fatal sync error',
    })
    return {
      success: false,
      syncedCount,
      failedCount,
      message: err.message || 'Synchronization failed',
    }
  } finally {
    isCurrentlySyncing = false
    notifyListeners()
  }
}

// ─── WorkManager Background Auto-Sync Lifecycle ──────────────────────────────

let isWorkManagerInitialized = false

export function initWorkManager(): void {
  if (isWorkManagerInitialized || typeof window === 'undefined') return
  isWorkManagerInitialized = true

  // 1. Online reconnection event: automatically trigger sync when internet returns
  window.addEventListener('online', () => {
    console.log('🌐 Internet connection restored. WorkManager running sync queue flush...')
    flushSyncQueue().catch((e) => console.warn('Sync on reconnection failed:', e))
  })

  // 2. Periodic interval: check every 60 seconds if online and items exist
  setInterval(() => {
    if (navigator.onLine && getPendingQueue().length > 0 && !isCurrentlySyncing) {
      flushSyncQueue().catch(() => {})
    }
  }, 60000)

  // 3. Initial startup check
  if (navigator.onLine && getPendingQueue().length > 0) {
    setTimeout(() => {
      flushSyncQueue().catch(() => {})
    }, 4000)
  }
}
