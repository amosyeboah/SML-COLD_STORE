import { FastifyPluginAsync } from 'fastify'
import * as auditService from '../services/auditService'

export const auditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/audit', async (request) => {
    const filters = request.query as any
    return await auditService.getAuditLogs(filters)
  })

  fastify.post('/api/audit', async (request, reply) => {
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    if (!body.action || !body.category || !body.details) {
      return reply.status(400).send({ error: 'action, category, and details are required' })
    }

    const log = await auditService.recordAudit({
      ...body,
      deviceId,
    })

    return reply.status(201).send({ success: true, log })
  })
}
