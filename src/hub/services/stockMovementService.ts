import { prisma } from '../db/prisma'
import { StockMovementType, StockReferenceType } from '../domain/types'
import { enqueueOutboxItem } from './syncOutboxService'
import { randomUUID } from 'crypto'

export interface CreateMovementInput {
  productId: string
  batchId?: string
  quantityDelta: number
  movementType: StockMovementType
  referenceType: StockReferenceType
  referenceId?: string
  unitCost?: number
  unitPrice?: number
  userId?: string
  deviceId?: string
  notes?: string
  storeId?: string
}

export async function recordStockMovement(
  txOrInput: any,
  maybeInput?: CreateMovementInput
) {
  const tx = maybeInput ? txOrInput : prisma
  const input: CreateMovementInput = maybeInput ? maybeInput : txOrInput
  const id = randomUUID()
  const storeId = input.storeId || 'sml_accra_main'

  const movement = await tx.stockMovement.create({
    data: {
      id,
      storeId,
      productId: input.productId,
      batchId: input.batchId || null,
      quantityDelta: input.quantityDelta,
      movementType: input.movementType,
      referenceType: input.referenceType || 'MANUAL',
      referenceId: input.referenceId || null,
      unitCost: input.unitCost !== undefined ? input.unitCost : null,
      unitPrice: input.unitPrice !== undefined ? input.unitPrice : null,
      userId: input.userId || null,
      deviceId: input.deviceId || null,
      notes: input.notes || null,
    },
  })

  // Enqueue outbox event for cloud sync
  await enqueueOutboxItem(
    tx,
    'STOCK_MOVEMENT',
    'INSERT',
    movement.id,
    {
      id: movement.id,
      storeId: movement.storeId,
      productId: movement.productId,
      batchId: movement.batchId,
      quantityDelta: movement.quantityDelta,
      movementType: movement.movementType,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      unitCost: movement.unitCost,
      unitPrice: movement.unitPrice,
      userId: movement.userId,
      deviceId: movement.deviceId,
      notes: movement.notes,
      createdAt: movement.createdAt,
    },
    input.deviceId,
    storeId,
    'PRODUCT',
    movement.productId
  )

  return movement
}

export async function getStockMovements(filters?: {
  productId?: string
  batchId?: string
  movementType?: string
  startDate?: string
  endDate?: string
  limit?: number
}) {
  const where: any = {}
  if (filters?.productId) where.productId = filters.productId
  if (filters?.batchId) where.batchId = filters.batchId
  if (filters?.movementType) where.movementType = filters.movementType
  if (filters?.startDate || filters?.endDate) {
    where.createdAt = {}
    if (filters?.startDate) where.createdAt.gte = new Date(filters.startDate)
    if (filters?.endDate) where.createdAt.lte = new Date(filters.endDate)
  }

  return await prisma.stockMovement.findMany({
    where,
    include: {
      medicine: true,
      batch: true,
      device: true,
    },
    orderBy: { createdAt: 'desc' },
    take: filters?.limit || 200,
  })
}

export async function getStockBalanceFromLedger(productId: string, batchId?: string) {
  const where: any = { productId }
  if (batchId) where.batchId = batchId

  const aggregates = await prisma.stockMovement.aggregate({
    where,
    _sum: {
      quantityDelta: true,
    },
  })

  return aggregates._sum.quantityDelta || 0
}
