import { FastifyPluginAsync } from 'fastify'
import * as syncEngine from '../services/syncEngine'
import * as syncOutboxService from '../services/syncOutboxService'
import { prisma, resolveDatabasePath } from '../db/prisma'

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. Real-time Synchronization Status
  fastify.get('/api/sync/status', async () => {
    const status = await syncEngine.getSyncState()
    return {
      ...status,
      database: resolveDatabasePath(),
      mode: 'AUTHORITATIVE_LOCAL_HUB',
      timestamp: new Date().toISOString(),
    }
  })

  // 2. Manual/Triggered Outbox Flush
  fastify.post('/api/sync/flush', async (request) => {
    const { batchSize } = (request.body as any) || {}
    const result = await syncEngine.flushOutboxBatch(batchSize ? Number(batchSize) : 50)
    return result
  })

  // 3. Manual/Triggered Cloud Changes Pull
  fastify.post('/api/sync/pull', async (request) => {
    const { limit } = (request.body as any) || {}
    const result = await syncEngine.pullCloudChanges(limit ? Number(limit) : 50)
    return result
  })

  // 4. Reconciliation & Diagnostics Report
  fastify.get('/api/sync/reconcile', async () => {
    return await syncEngine.getReconciliationReport()
  })

  // 5. Inspect Outbox Items
  fastify.get('/api/sync/outbox', async (request) => {
    const { status, limit } = request.query as any
    const where: any = {}
    if (status) where.status = status

    const items = await prisma.syncOutbox.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit ? Number(limit) : 100,
    })

    const metrics = await syncOutboxService.getOutboxMetrics()
    return { metrics, count: items.length, items }
  })

  // 6. Inspect Sync Sessions History
  fastify.get('/api/sync/sessions', async (request) => {
    const { limit } = request.query as any
    const sessions = await prisma.syncSession.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit ? Number(limit) : 40,
    })
    return sessions
  })

  // 7. Reset Dead-Lettered Events back to PENDING
  fastify.post('/api/sync/retry-dead-letter', async () => {
    const updated = await prisma.syncOutbox.updateMany({
      where: { status: 'DEAD_LETTER' },
      data: {
        status: 'PENDING',
        retryCount: 0,
        nextAttemptAt: null,
        errorMessage: null,
        lastError: null,
      },
    })
    return { success: true, count: updated.count }
  })
}
