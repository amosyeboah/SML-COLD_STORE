import { FastifyPluginAsync } from 'fastify'
import * as purchaseService from '../services/purchaseService'

export const purchaseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/purchases', async (request, reply) => {
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    if (!body.supplierId || !body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return reply.status(400).send({ error: 'supplierId and items array are required' })
    }

    try {
      const purchase = await purchaseService.createPurchase({
        id: body.id,
        supplierId: body.supplierId,
        total: Number(body.total) || 0,
        items: body.items,
        deviceId,
        userId: body.userId,
        username: body.username,
        userRole: body.userRole,
      })

      return reply.status(201).send({ success: true, purchase })
    } catch (err: any) {
      request.log.error(err, 'Failed to create purchase')
      return reply.status(400).send({ error: err.message || 'Purchase creation failed' })
    }
  })

  fastify.get('/api/purchases', async () => {
    return await purchaseService.getPurchases()
  })

  fastify.delete('/api/purchases/:id', async (request, reply) => {
    const { id } = request.params as any
    const deleted = await purchaseService.deletePurchase(id)
    if (!deleted) {
      return reply.status(404).send({ error: `Purchase ${id} not found` })
    }
    return { success: true, deleted }
  })
}
