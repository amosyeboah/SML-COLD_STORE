import { prisma } from '../db/prisma'
import { getHubSupabaseClient, testCloudConnectivity } from './hubSupabase'
import * as syncOutboxService from './syncOutboxService'
import { randomUUID } from 'crypto'

export interface SyncEngineStatus {
  state: 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNC_ERROR'
  connected: boolean
  latencyMs: number
  lastSyncAt: string | null
  lastError: string | null
  pendingOutbox: number
  failedOutbox: number
  deadLetterOutbox: number
  syncedOutbox: number
  totalOutbox: number
  lastSyncCursor: string
}

let isSyncing = false
let lastSuccessfulSyncAt: string | null = null
let lastSyncError: string | null = null

export async function getSyncCursor(key = 'cloud_to_local_cursor'): Promise<number> {
  const record = await prisma.syncCursor.findUnique({ where: { key } })
  if (!record) return 0
  const parsed = parseInt(record.cursorValue, 10)
  return isNaN(parsed) ? 0 : parsed
}

export async function setSyncCursor(value: number, key = 'cloud_to_local_cursor'): Promise<void> {
  await prisma.syncCursor.upsert({
    where: { key },
    update: { cursorValue: String(value) },
    create: { key, cursorValue: String(value) },
  })
}

/**
 * Core Idempotent Outbox Synchronization Engine.
 * Pushes pending outbox events in batches to Supabase PostgreSQL with explicit ACKs and backoff.
 */
export async function flushOutboxBatch(batchSize = 50): Promise<{
  success: boolean
  attempted: number
  succeeded: number
  failed: number
  durationMs: number
  error?: string
}> {
  if (isSyncing) {
    return { success: false, attempted: 0, succeeded: 0, failed: 0, durationMs: 0, error: 'Sync already in progress' }
  }

  const startTime = Date.now()
  const events = await syncOutboxService.getBatchForSync(batchSize)
  if (events.length === 0) {
    return { success: true, attempted: 0, succeeded: 0, failed: 0, durationMs: 0 }
  }

  // 1. Verify cloud connectivity
  const conn = await testCloudConnectivity()
  if (!conn.connected) {
    lastSyncError = conn.error || 'Cloud unreachable'
    await prisma.syncSession.create({
      data: {
        id: randomUUID(),
        status: 'OFFLINE',
        eventsAttempted: events.length,
        eventsSucceeded: 0,
        eventsFailed: events.length,
        durationMs: Date.now() - startTime,
        latencyMs: conn.latencyMs,
        errorSummary: lastSyncError,
        details: 'Offline mode: events remain queued safely in local outbox.',
      },
    })
    return {
      success: false,
      attempted: events.length,
      succeeded: 0,
      failed: events.length,
      durationMs: Date.now() - startTime,
      error: lastSyncError,
    }
  }

  isSyncing = true
  let succeeded = 0
  let failed = 0
  const supabase = getHubSupabaseClient()

  try {
    for (const event of events) {
      try {
        let payload: any
        try {
          payload = JSON.parse(event.payload)
        } catch {
          payload = event.payload
        }

        // 2. Idempotency Check: Has this event already been recorded in Supabase?
        const { data: existingCloudEvent } = await supabase
          .from('cloud_sync_events')
          .select('cursor_seq')
          .eq('event_id', event.eventId)
          .maybeSingle()

        if (existingCloudEvent) {
          // Previously committed in cloud but local ACK was lost; mark as synced immediately
          await syncOutboxService.markEventSynced(event.eventId)
          succeeded++
          continue
        }

        // 3. Idempotent Cloud Writes per Entity Type
        const entity = event.entity || event.entityType
        const action = event.action || event.operation || 'INSERT'
        const storeId = event.storeId || 'sml_accra_main'

        if (entity === 'SALE') {
          // Idempotent write to cloud_sales
          const saleNumber = payload.saleNumber || `INV-${payload.id.slice(0, 8).toUpperCase()}`
          const { error: saleErr } = await supabase.from('cloud_sales').upsert(
            {
              id: payload.id,
              store_id: storeId,
              sale_number: saleNumber,
              customer_name: payload.customer?.name || payload.customerName || 'Walk-in Customer',
              total: Number(payload.total) || 0,
              payment_method: payload.paymentMethod || 'CASH',
              cashier_username: payload.username || 'cashier',
              device_id: event.deviceId || payload.deviceId || null,
              date: payload.date || new Date().toISOString(),
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
          if (saleErr) throw saleErr

          // Idempotent write to cloud_sale_items
          if (payload.items && Array.isArray(payload.items) && payload.items.length > 0) {
            const itemsToUpsert = payload.items.map((i: any) => ({
              id: i.id || `${payload.id}_${i.batchId || i.productId}`,
              sale_id: payload.id,
              product_id: i.productId || i.batch?.medicineId || null,
              batch_id: i.batchId || null,
              product_name: i.productName || i.name || 'Cold Store Item',
              sku: i.sku || null,
              quantity: Number(i.quantity) || 1,
              unit_price: Number(i.price) || 0,
              unit_cost: Number(i.cost) || 0,
              subtotal: (Number(i.quantity) || 1) * (Number(i.price) || 0),
            }))
            const { error: itemsErr } = await supabase.from('cloud_sale_items').upsert(itemsToUpsert, { onConflict: 'id' })
            if (itemsErr) throw itemsErr
          }

          // Idempotent write to cloud_sale_payments
          if (payload.payments && Array.isArray(payload.payments) && payload.payments.length > 0) {
            const paymentsToUpsert = payload.payments.map((p: any) => ({
              id: p.id || randomUUID(),
              sale_id: payload.id,
              method: p.method,
              amount: Number(p.amount) || 0,
            }))
            const { error: payErr } = await supabase.from('cloud_sale_payments').upsert(paymentsToUpsert, { onConflict: 'id' })
            if (payErr) throw payErr
          }
        } else if (entity === 'STOCK_MOVEMENT') {
          // Idempotent write to cloud_stock_movements (Append-only Ledger)
          const { error: smErr } = await supabase.from('cloud_stock_movements').upsert(
            {
              id: payload.id,
              store_id: storeId,
              product_id: payload.productId,
              batch_id: payload.batchId || null,
              quantity_delta: Number(payload.quantityDelta),
              movement_type: payload.movementType,
              reference_type: payload.referenceType,
              reference_id: payload.referenceId || null,
              unit_cost: payload.unitCost !== undefined ? Number(payload.unitCost) : null,
              unit_price: payload.unitPrice !== undefined ? Number(payload.unitPrice) : null,
              user_id: payload.userId || null,
              device_id: event.deviceId || payload.deviceId || null,
              notes: payload.notes || null,
              created_at: payload.createdAt || new Date().toISOString(),
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
          if (smErr) throw smErr
        } else if (entity === 'PURCHASE') {
          // Idempotent write to cloud_purchases
          const { error: purErr } = await supabase.from('cloud_purchases').upsert(
            {
              id: payload.id,
              store_id: storeId,
              supplier_name: payload.supplier?.name || payload.supplierName || 'Local Supplier',
              total: Number(payload.total) || 0,
              status: payload.status || 'COMPLETED',
              device_id: event.deviceId || payload.deviceId || null,
              date: payload.date || new Date().toISOString(),
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
          if (purErr) throw purErr

          if (payload.items && Array.isArray(payload.items) && payload.items.length > 0) {
            const purchaseItems = payload.items.map((i: any) => ({
              id: i.id || randomUUID(),
              purchase_id: payload.id,
              product_id: i.medicineId || i.productId,
              quantity: Number(i.quantity) || 1,
              cost: Number(i.cost) || 0,
              batch_number: i.batchNumber || null,
              expiry_date: i.expiryDate ? new Date(i.expiryDate).toISOString() : null,
            }))
            const { error: piErr } = await supabase.from('cloud_purchase_items').upsert(purchaseItems, { onConflict: 'id' })
            if (piErr) throw piErr
          }
        } else if (entity === 'PRODUCT') {
          if (action === 'DELETE') {
            await supabase.from('cloud_batches').delete().eq('product_id', payload.id)
            const { error: delErr } = await supabase.from('cloud_products').delete().eq('id', payload.id)
            if (delErr) console.warn('Supabase product delete warning:', delErr)
          } else {
            const { error: prodErr } = await supabase.from('cloud_products').upsert(
              {
                id: payload.id,
                store_id: storeId,
                name: payload.name,
                generic_name: payload.genericName || null,
                sku: payload.sku,
                category_name: payload.category?.name || payload.categoryName || 'General',
                price: Number(payload.price) || 0,
                cost: Number(payload.cost) || 0,
                min_stock_level: Number(payload.minStockLevel) || 10,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'id' }
            )
            if (prodErr) throw prodErr
          }
        } else if (entity === 'BATCH') {
          if (action === 'DELETE') {
            const { error: delErr } = await supabase.from('cloud_batches').delete().eq('id', payload.id)
            if (delErr) console.warn('Supabase batch delete warning:', delErr)
          } else {
            const { error: batchErr } = await supabase.from('cloud_batches').upsert(
              {
                id: payload.id,
                product_id: payload.medicineId,
                batch_number: payload.batchNumber,
                expiry_date: new Date(payload.expiryDate).toISOString(),
                quantity: Number(payload.quantity) || 0,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'id' }
            )
            if (batchErr) throw batchErr
          }
        } else if (entity === 'AUDIT_LOG') {
          const { error: auditErr } = await supabase.from('cloud_audit_logs').upsert(
            {
              id: payload.id,
              store_id: storeId,
              action: payload.action,
              category: payload.category,
              details: payload.details,
              operator: payload.username || 'System',
              role: payload.userRole || 'STAFF',
              severity: payload.severity || 'INFO',
              device_id: event.deviceId || payload.deviceId || null,
              metadata: payload.metadata || null,
              created_at: payload.createdAt || new Date().toISOString(),
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
          if (auditErr) throw auditErr
        }

        // 4. Record in cloud_sync_events (Idempotency Ledger)
        await supabase.from('cloud_sync_events').upsert(
          {
            event_id: event.eventId,
            store_id: storeId,
            entity_type: entity,
            entity_id: event.recordId || event.entityId || payload.id,
            operation: action,
            payload: typeof payload === 'object' ? payload : { raw: payload },
            device_id: event.deviceId || null,
            created_at: event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString(),
            applied_at: new Date().toISOString(),
          },
          { onConflict: 'event_id' }
        )

        // 5. Explicit Local Acknowledgement: Mark SYNCED locally only upon cloud success
        await syncOutboxService.markEventSynced(event.eventId)
        succeeded++
      } catch (itemErr: any) {
        failed++
        const errMessage = itemErr.message || 'Cloud write failure'
        lastSyncError = errMessage
        await syncOutboxService.recordEventFailure(event.eventId, errMessage)
      }
    }

    const durationMs = Date.now() - startTime
    const sessionStatus = failed === 0 ? 'SUCCESS' : succeeded > 0 ? 'PARTIAL' : 'FAILED'
    lastSuccessfulSyncAt = succeeded > 0 ? new Date().toISOString() : lastSuccessfulSyncAt

    // Log Local Sync Session
    await prisma.syncSession.create({
      data: {
        id: randomUUID(),
        status: sessionStatus,
        eventsAttempted: events.length,
        eventsSucceeded: succeeded,
        eventsFailed: failed,
        durationMs,
        latencyMs: conn.latencyMs,
        errorSummary: failed > 0 ? lastSyncError : null,
        details: `Batch completed with ${succeeded} synced and ${failed} failed.`,
      },
    })

    // Log Cloud Sync Session (best-effort)
    supabase
      .from('cloud_sync_sessions')
      .insert({
        store_id: 'sml_accra_main',
        device_id: 'Local Depot Hub',
        sync_type: 'OUTBOX_BATCH',
        status: sessionStatus,
        events_attempted: events.length,
        events_succeeded: succeeded,
        events_failed: failed,
        duration_ms: durationMs,
        latency_ms: conn.latencyMs,
        error_summary: failed > 0 ? lastSyncError : null,
      })
      .then(() => {}, () => {})

    return {
      success: sessionStatus !== 'FAILED',
      attempted: events.length,
      succeeded,
      failed,
      durationMs,
      error: failed > 0 ? lastSyncError || undefined : undefined,
    }
  } finally {
    isSyncing = false
  }
}

/**
 * Incremental Cursor Cloud-to-Local Pull.
 * Reads changes from cloud_sync_events with cursor > lastSyncCursor, saves to local SyncInbox, and applies them.
 */
export async function pullCloudChanges(limit = 100): Promise<{
  pulledCount: number
  appliedCount: number
  newCursor: number
}> {
  const currentCursor = await getSyncCursor()
  const conn = await testCloudConnectivity()
  if (!conn.connected) {
    return { pulledCount: 0, appliedCount: 0, newCursor: currentCursor }
  }

  const supabase = getHubSupabaseClient()
  const { data: cloudEvents, error } = await supabase
    .from('cloud_sync_events')
    .select('*')
    .gt('cursor_seq', currentCursor)
    .order('cursor_seq', { ascending: true })
    .limit(limit)

  if (error || !cloudEvents || cloudEvents.length === 0) {
    return { pulledCount: 0, appliedCount: 0, newCursor: currentCursor }
  }

  let appliedCount = 0
  let maxCursor = currentCursor

  for (const cEvent of cloudEvents) {
    const seq = Number(cEvent.cursor_seq)
    if (seq > maxCursor) maxCursor = seq

    // Deduplication check in local SyncInbox
    const existingInbox = await prisma.syncInbox.findUnique({
      where: { eventId: cEvent.event_id },
    })

    if (existingInbox) {
      continue
    }

    // Save to local inbox
    const inboxItem = await prisma.syncInbox.create({
      data: {
        id: randomUUID(),
        eventId: cEvent.event_id,
        storeId: cEvent.store_id || 'sml_accra_main',
        entityType: cEvent.entity_type,
        entityId: cEvent.entity_id,
        operation: cEvent.operation,
        payload: JSON.stringify(cEvent.payload),
        status: 'PENDING',
      },
    })

    // Apply master data changes (e.g. price updates by UK Owner from cloud)
    try {
      if (cEvent.entity_type === 'PRODUCT') {
        if (cEvent.operation === 'UPDATE') {
          const p = cEvent.payload
          if (p.id) {
            const localProd = await prisma.medicine.findUnique({ where: { id: p.id } })
            if (localProd) {
              await prisma.medicine.update({
                where: { id: p.id },
                data: {
                  ...(p.price !== undefined ? { price: Number(p.price) } : {}),
                  ...(p.cost !== undefined ? { cost: Number(p.cost) } : {}),
                  ...(p.name ? { name: p.name } : {}),
                },
              })
            }
          }
        } else if (cEvent.operation === 'DELETE') {
          const p = cEvent.payload
          if (p.id) {
            const localProd = await prisma.medicine.findUnique({ where: { id: p.id }, include: { batches: true } })
            if (localProd) {
              const batchIds = Array.isArray(localProd.batches) ? localProd.batches.map((b: any) => b.id) : []

              const deleteErrors: string[] = []

              if (batchIds.length > 0) {
                try {
                  await prisma.saleItem.deleteMany({ where: { batchId: { in: batchIds } } })
                } catch (err: any) {
                  deleteErrors.push(`saleItem.deleteMany failed: ${err.message || String(err)}`)
                }

                try {
                  await prisma.stockMovement.deleteMany({ where: { productId: p.id } })
                } catch (err: any) {
                  deleteErrors.push(`stockMovement.deleteMany failed: ${err.message || String(err)}`)
                }

                try {
                  await prisma.batch.deleteMany({ where: { medicineId: p.id } })
                } catch (err: any) {
                  deleteErrors.push(`batch.deleteMany failed: ${err.message || String(err)}`)
                }
              }

              try {
                await prisma.purchaseItem.deleteMany({ where: { medicineId: p.id } })
              } catch (err: any) {
                deleteErrors.push(`purchaseItem.deleteMany failed: ${err.message || String(err)}`)
              }

              try {
                await prisma.medicine.delete({ where: { id: p.id } })
              } catch (err: any) {
                deleteErrors.push(`medicine.delete failed: ${err.message || String(err)}`)
              }

              if (deleteErrors.length > 0) {
                // Provide detailed failure context on the inbox item so operators can inspect later
                throw new Error(`Partial/failed deletes for product ${p.id}: ${deleteErrors.join('; ')}`)
              }
            }
          }
        }
      }

      await prisma.syncInbox.update({
        where: { id: inboxItem.id },
        data: {
          status: 'APPLIED',
          appliedAt: new Date(),
        },
      })
      appliedCount++
    } catch (applyErr: any) {
      await prisma.syncInbox.update({
        where: { id: inboxItem.id },
        data: {
          status: 'FAILED',
          error: applyErr.message || 'Failed to apply inbox change locally',
        },
      })
    }
  }

  await setSyncCursor(maxCursor)
  return {
    pulledCount: cloudEvents.length,
    appliedCount,
    newCursor: maxCursor,
  }
}

export interface ReconciliationReport {
  timestamp: string
  status: 'IN_SYNC' | 'DISCREPANCY_DETECTED' | 'CLOUD_UNAVAILABLE'
  connected: boolean
  local: {
    salesCount: number
    salesTotal: number
    salesTotalRevenue: number
    stockMovementsCount: number
    productsCount: number
    batchesCount: number
    purchasesCount: number
    pendingOutboxCount: number
    deadLetterCount: number
  }
  cloud: {
    salesCount: number
    salesTotal: number
    salesTotalRevenue: number
    stockMovementsCount: number
    productsCount: number
    batchesCount: number
    purchasesCount: number
  } | null
  outbox: {
    pending: number
    failed: number
    deadLetter: number
    synced: number
    total?: number
  }
  discrepancies: Array<{
    metric: string
    localValue: number
    cloudValue: number
    difference: number
    description: string
  }>
  recommendations: string[]
  reconciliationSafe: boolean
}

/**
 * Diagnostic & Reconciliation Report.
 * Compares local SQLite counts and totals against Supabase Cloud counts and totals.
 */
export async function getReconciliationReport(): Promise<ReconciliationReport> {
  const [
    localSalesCount,
    localSalesTotalAgg,
    localStockMovementsCount,
    localProductsCount,
    localBatchesCount,
    outboxMetrics,
  ] = await Promise.all([
    prisma.sale.count(),
    prisma.sale.aggregate({ _sum: { total: true } }),
    prisma.stockMovement.count(),
    prisma.medicine.count(),
    prisma.batch.count(),
    syncOutboxService.getOutboxMetrics(),
  ])

  const localSalesTotal = localSalesTotalAgg._sum.total || 0

  const conn = await testCloudConnectivity()
  if (!conn.connected) {
    return {
      timestamp: new Date().toISOString(),
      status: 'CLOUD_UNAVAILABLE',
      connected: false,
      local: {
        salesCount: localSalesCount,
        salesTotal: localSalesTotal,
        salesTotalRevenue: localSalesTotal,
        stockMovementsCount: localStockMovementsCount,
        productsCount: localProductsCount,
        batchesCount: localBatchesCount,
        purchasesCount: 0,
        pendingOutboxCount: outboxMetrics.pending,
        deadLetterCount: outboxMetrics.deadLetter,
      },
      cloud: null,
      outbox: outboxMetrics,
      discrepancies: [
        {
          metric: 'Cloud Connection',
          localValue: localSalesCount,
          cloudValue: 0,
          difference: localSalesCount,
          description: 'Cloud connection currently unavailable; local records held securely in SQLite.',
        },
      ],
      recommendations: [
        'Depot local transactions continue with zero disruption.',
        'When connection is restored, pending outbox events will flush automatically.',
      ],
      reconciliationSafe: false,
    }
  }

  const supabase = getHubSupabaseClient()

  // Fetch Cloud Aggregates
  const [
    cloudSalesRes,
    cloudSmRes,
    cloudProdRes,
    cloudBatchRes,
    allCloudSalesData,
  ] = await Promise.all([
    supabase.from('cloud_sales').select('*', { count: 'exact', head: true }),
    supabase.from('cloud_stock_movements').select('*', { count: 'exact', head: true }),
    supabase.from('cloud_products').select('*', { count: 'exact', head: true }),
    supabase.from('cloud_batches').select('*', { count: 'exact', head: true }),
    supabase.from('cloud_sales').select('id, total'),
  ])

  const cloudSalesCount = cloudSalesRes.count || 0
  const cloudStockMovementsCount = cloudSmRes.count || 0
  const cloudProductsCount = cloudProdRes.count || 0
  const cloudBatchesCount = cloudBatchRes.count || 0
  const cloudSalesTotal = (allCloudSalesData.data || []).reduce((acc: number, s: any) => acc + (Number(s.total) || 0), 0)

  // Identify missing cloud sales without deleting anything
  const cloudSaleIdSet = new Set((allCloudSalesData.data || []).map((s: any) => s.id))
  const localSales = await prisma.sale.findMany({ select: { id: true } })
  const missingInCloudSales = localSales.filter((s) => !cloudSaleIdSet.has(s.id)).map((s) => s.id)

  const isExactSync = localSalesCount === cloudSalesCount && Math.abs(localSalesTotal - cloudSalesTotal) < 0.01

  return {
    timestamp: new Date().toISOString(),
    status: isExactSync ? 'IN_SYNC' : 'DISCREPANCY_DETECTED',
    connected: true,
    local: {
      salesCount: localSalesCount,
      salesTotal: localSalesTotal,
      salesTotalRevenue: localSalesTotal,
      stockMovementsCount: localStockMovementsCount,
      productsCount: localProductsCount,
      batchesCount: localBatchesCount,
      purchasesCount: 0,
      pendingOutboxCount: outboxMetrics.pending,
      deadLetterCount: outboxMetrics.deadLetter,
    },
    cloud: {
      salesCount: cloudSalesCount,
      salesTotal: cloudSalesTotal,
      salesTotalRevenue: cloudSalesTotal,
      stockMovementsCount: cloudStockMovementsCount,
      productsCount: cloudProductsCount,
      batchesCount: cloudBatchesCount,
      purchasesCount: 0,
    },
    outbox: outboxMetrics,
    discrepancies: [
      ...(localSalesCount !== cloudSalesCount
        ? [
            {
              metric: 'Sales Count',
              localValue: localSalesCount,
              cloudValue: cloudSalesCount,
              difference: localSalesCount - cloudSalesCount,
              description: `${Math.abs(localSalesCount - cloudSalesCount)} sale(s) difference between local SQLite and cloud replica.`,
            },
          ]
        : []),
      ...(Math.abs(localSalesTotal - cloudSalesTotal) >= 0.01
        ? [
            {
              metric: 'Total Revenue (GHS)',
              localValue: localSalesTotal,
              cloudValue: cloudSalesTotal,
              difference: Number((localSalesTotal - cloudSalesTotal).toFixed(2)),
              description: `GHS ${(localSalesTotal - cloudSalesTotal).toFixed(2)} variance in sales totals.`,
            },
          ]
        : []),
      ...(localStockMovementsCount !== cloudStockMovementsCount
        ? [
            {
              metric: 'Stock Movements',
              localValue: localStockMovementsCount,
              cloudValue: cloudStockMovementsCount,
              difference: localStockMovementsCount - cloudStockMovementsCount,
              description: `${localStockMovementsCount - cloudStockMovementsCount} pending stock movement entries.`,
            },
          ]
        : []),
    ],
    recommendations: [
      ...(missingInCloudSales.length > 0
        ? [`${missingInCloudSales.length} local sales have not yet acknowledged cloud receipt. Trigger Push Outbox.`]
        : ['All records in sync.']),
    ],
    reconciliationSafe: true,
  }
}

/**
 * Returns complete real-time sync state for the UI.
 */
export async function getSyncState(): Promise<any> {
  const [conn, metrics, cursor] = await Promise.all([
    testCloudConnectivity(),
    syncOutboxService.getOutboxMetrics(),
    getSyncCursor(),
  ])

  let state: 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNC_ERROR' = 'ONLINE'
  if (isSyncing) {
    state = 'SYNCING'
  } else if (!conn.connected) {
    state = 'OFFLINE'
  } else if (metrics.failed > 0 || metrics.deadLetter > 0) {
    state = 'SYNC_ERROR'
  }

  return {
    state,
    connected: conn.connected,
    online: conn.connected,
    latencyMs: conn.latencyMs,
    lastSyncAt: lastSuccessfulSyncAt,
    lastSyncTime: lastSuccessfulSyncAt,
    lastError: conn.connected ? lastSyncError : conn.error || 'Offline',
    pendingOutbox: metrics.pending,
    pendingCount: metrics.pending,
    failedOutbox: metrics.failed,
    failedCount: metrics.failed,
    deadLetterOutbox: metrics.deadLetter,
    deadLetterCount: metrics.deadLetter,
    syncedOutbox: metrics.synced,
    totalOutbox: metrics.total,
    lastSyncCursor: String(cursor),
    inboundCursor: Number(cursor) || 0,
    depotId: 'sml_accra_main',
    cloudConfigured: true,
  }
}

let syncIntervalTimer: any = null

/**
 * Starts the periodic background sync worker in the Local Hub.
 */
export function startPeriodicSyncWorker(intervalMs = 30000): void {
  if (syncIntervalTimer) return

  syncIntervalTimer = setInterval(async () => {
    try {
      await flushOutboxBatch(50)
      await pullCloudChanges(50)
    } catch (err) {
      console.warn('[Sync Worker Background Notice]:', err)
    }
  }, intervalMs)

  // Trigger immediate initial flush
  setTimeout(() => {
    flushOutboxBatch(50).catch(() => {})
    pullCloudChanges(50).catch(() => {})
  }, 3000)
}

export function stopPeriodicSyncWorker(): void {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer)
    syncIntervalTimer = null
  }
}
