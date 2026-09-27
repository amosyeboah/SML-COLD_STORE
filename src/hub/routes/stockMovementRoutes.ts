import { FastifyPluginAsync } from 'fastify'
import * as stockMovementService from '../services/stockMovementService'
import { prisma } from '../db/prisma'

export const stockMovementRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/stock-movements', async (request) => {
    const filters = request.query as any
    return await stockMovementService.getStockMovements(filters)
  })

  fastify.get('/api/stock-movements/balance/:productId', async (request) => {
    const { productId } = request.params as any
    const { batchId } = request.query as any
    const balance = await stockMovementService.getStockBalanceFromLedger(productId, batchId)
    return { productId, batchId: batchId || null, balance }
  })

  fastify.post('/api/stock-movements/adjustment', async (request, reply) => {
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    if (!body.productId || body.quantityDelta === undefined || !body.movementType) {
      return reply.status(400).send({ error: 'productId, quantityDelta, and movementType are required' })
    }

    try {
      const movement = await prisma.$transaction(async (tx) => {
        if (body.batchId) {
          const batch = await tx.batch.findUnique({ where: { id: body.batchId } })
          if (!batch) throw new Error(`Batch ${body.batchId} not found`)
          await tx.batch.update({
            where: { id: body.batchId },
            data: { quantity: { increment: Number(body.quantityDelta) } },
          })
        }

        return await stockMovementService.recordStockMovement(tx, {
          productId: body.productId,
          batchId: body.batchId,
          quantityDelta: Number(body.quantityDelta),
          movementType: body.movementType,
          referenceType: 'ADJUSTMENT',
          referenceId: body.referenceId,
          notes: body.notes || 'Manual adjustment',
          userId: body.userId,
          deviceId,
        })
      })

      return reply.status(201).send({ success: true, movement })
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })
}
