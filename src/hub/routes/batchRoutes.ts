import { FastifyPluginAsync } from 'fastify'
import * as inventoryService from '../services/inventoryService'

export const batchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/batches', async (request) => {
    const { startDate, endDate } = request.query as any
    return await inventoryService.getBatches(startDate, endDate)
  })

  fastify.post('/api/batches', async (request, reply) => {
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    if (!body.medicineId || !body.batchNumber || !body.expiryDate) {
      return reply.status(400).send({ error: 'medicineId, batchNumber, and expiryDate are required' })
    }

    try {
      const batch = await inventoryService.createBatch({
        ...body,
        deviceId,
      })
      return reply.status(201).send(batch)
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  fastify.put('/api/batches/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    try {
      const updated = await inventoryService.updateBatch(id, body, {
        deviceId,
        userId: body.userId,
        username: body.username,
        userRole: body.userRole,
        reason: body.reason,
      })
      return updated
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  fastify.delete('/api/batches/:id', async (request, reply) => {
    const { id } = request.params as any
    const deviceId = (request.headers['x-device-id'] as string) || undefined
    const deleted = await inventoryService.deleteBatch(id, { deviceId })
    if (!deleted) return reply.status(404).send({ error: `Batch ${id} not found` })
    return { success: true, deleted }
  })
}
