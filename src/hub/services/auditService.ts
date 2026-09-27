import { prisma } from '../db/prisma'
import { AuditLogInput } from '../domain/types'
import { enqueueOutboxItem } from './syncOutboxService'
import { randomUUID } from 'crypto'

export async function recordAudit(input: AuditLogInput, client: any = prisma) {
  const metadataStr = input.metadata
    ? typeof input.metadata === 'string'
      ? input.metadata
      : JSON.stringify(input.metadata)
    : null

  const log = await client.auditLog.create({
    data: {
      id: randomUUID(),
      action: input.action,
      category: input.category,
      details: input.details,
      username: input.username || 'SYSTEM',
      userRole: input.userRole || 'CASHIER',
      severity: input.severity || 'INFO',
      deviceId: input.deviceId || null,
      metadata: metadataStr,
    },
  })

  // Enqueue to outbox for cloud sync
  await enqueueOutboxItem(
    client,
    'AUDIT_LOG',
    'INSERT',
    log.id,
    {
      id: log.id,
      action: log.action,
      category: log.category,
      details: log.details,
      username: log.username,
      userRole: log.userRole,
      severity: log.severity,
      deviceId: log.deviceId,
      metadata: input.metadata,
      createdAt: log.createdAt,
    },
    input.deviceId
  )

  return log
}

export async function getAuditLogs(filters?: {
  category?: string
  severity?: string
  startDate?: string
  endDate?: string
  limit?: number
}) {
  const where: any = {}
  if (filters?.category) where.category = filters.category
  if (filters?.severity) where.severity = filters.severity
  if (filters?.startDate || filters?.endDate) {
    where.createdAt = {}
    if (filters?.startDate) where.createdAt.gte = new Date(filters.startDate)
    if (filters?.endDate) where.createdAt.lte = new Date(filters.endDate)
  }

  return await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filters?.limit || 200,
  })
}
