import { FastifyPluginAsync } from 'fastify'
import * as deviceService from '../services/deviceService'

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/devices/register', async (request, reply) => {
    const body = request.body as any
    if (!body.deviceId || !body.deviceName || !body.deviceType) {
      return reply.status(400).send({ error: 'deviceId, deviceName, and deviceType are required' })
    }

    const ipAddress = request.ip
    const device = await deviceService.registerDevice({
      deviceId: body.deviceId,
      storeId: body.storeId || 'sml_accra_main',
      deviceName: body.deviceName,
      deviceType: body.deviceType,
      appVersion: body.appVersion,
      ipAddress,
    })

    return { success: true, device }
  })

  fastify.post('/api/devices/heartbeat', async (request, reply) => {
    const deviceId = (request.headers['x-device-id'] as string) || (request.body as any)?.deviceId
    if (!deviceId) {
      return reply.status(400).send({ error: 'Device ID required' })
    }

    const updated = await deviceService.touchDeviceHeartbeat(deviceId, request.ip)
    return { success: true, device: updated }
  })

  fastify.get('/api/devices', async () => {
    return await deviceService.getDevices()
  })
}
