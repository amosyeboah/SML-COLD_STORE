import { FastifyPluginAsync } from 'fastify'
import * as authService from '../services/authService'

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || undefined

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' })
    }

    try {
      const user = await authService.login(username, password, deviceId)
      return { success: true, user }
    } catch (err: any) {
      return reply.status(401).send({ error: err.message || 'Invalid credentials' })
    }
  })

  fastify.post('/api/auth/pin', async (request, reply) => {
    const { pin, selectedRole } = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || undefined

    if (!pin) {
      return reply.status(400).send({ error: 'PIN required' })
    }

    try {
      const user = await authService.loginWithPin(pin, selectedRole, deviceId)
      return { success: true, user }
    } catch (err: any) {
      return reply.status(401).send({ error: err.message || 'Invalid PIN' })
    }
  })

  fastify.get('/api/users', async () => {
    return await authService.getUsers()
  })

  fastify.post('/api/users', async (request, reply) => {
    const data = request.body as any
    if (!data.username || !data.passwordHash || !data.role) {
      return reply.status(400).send({ error: 'Missing required user fields' })
    }
    const user = await authService.createUser(data)
    return { success: true, user }
  })

  fastify.put('/api/users/:id', async (request) => {
    const { id } = request.params as any
    const data = request.body as any
    return await authService.updateUser(id, data)
  })

  fastify.delete('/api/users/:id', async (request) => {
    const { id } = request.params as any
    return await authService.deleteUser(id)
  })
}
