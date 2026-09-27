import { FastifyPluginAsync } from 'fastify'
import * as saleService from '../services/saleService'

export const saleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/sales', async (request, reply) => {
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return reply.status(400).send({ error: 'Sale must contain at least one item' })
    }

    try {
      const sale = await saleService.completeSale({
        id: body.id,
        customerId: body.customerId,
        paymentMethod: body.paymentMethod || 'CASH',
        total: Number(body.total) || 0,
        items: body.items,
        payments: body.payments,
        prescription: body.prescription,
        deviceId,
        userId: body.userId,
        username: body.username,
        userRole: body.userRole,
      })

      return reply.status(201).send({ success: true, sale })
    } catch (err: any) {
      request.log.error(err, 'Failed to complete sale')
      return reply.status(400).send({ error: err.message || 'Sale execution failed' })
    }
  })

  fastify.get('/api/sales', async (request) => {
    const { limit } = request.query as any
    return await saleService.getSales(limit ? Number(limit) : 100)
  })

  fastify.get('/api/sales/:id', async (request, reply) => {
    const { id } = request.params as any
    const sale = await saleService.getSaleById(id)
    if (!sale) {
      return reply.status(404).send({ error: `Sale ${id} not found` })
    }
    return sale
  })

  fastify.post('/api/sales/:id/refund', async (request, reply) => {
    const { id } = request.params as any
    const body = (request.body as any) || {}
    try {
      const result = await saleService.refundSale(id, body.username, body.userRole)
      return reply.send(result)
    } catch (err: any) {
      request.log.error(err, 'Failed to refund sale')
      return reply.status(400).send({ error: err.message || 'Refund failed' })
    }
  })
}
