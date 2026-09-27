import { FastifyPluginAsync } from 'fastify'
import * as reportService from '../services/reportService'

export const reportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/reports/dashboard', async () => {
    return await reportService.getDashboardStats()
  })

  // Alias for backward compatibility
  fastify.get('/api/dashboard/stats', async () => {
    return await reportService.getDashboardStats()
  })

  fastify.get('/api/reports/data', async (request) => {
    const { startDate, endDate } = request.query as any
    const now = new Date()
    const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const end = endDate || now.toISOString().split('T')[0]
    return await reportService.getReportsData(start, end)
  })
}
