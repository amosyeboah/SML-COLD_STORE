import { FastifyPluginAsync } from 'fastify'
import * as inventoryService from '../services/inventoryService'

export const productRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/products', async () => {
    return await inventoryService.getProducts()
  })

  // Alias for backward compatibility with medicine terminology
  fastify.get('/api/medicines', async () => {
    return await inventoryService.getProducts()
  })

  fastify.get('/api/products/:id', async (request, reply) => {
    const { id } = request.params as any
    const product = await inventoryService.getProductById(id)
    if (!product) return reply.status(404).send({ error: `Product ${id} not found` })
    return product
  })

  fastify.post('/api/products', async (request, reply) => {
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    if (!body.name || !body.sku || !body.categoryId) {
      return reply.status(400).send({ error: 'name, sku, and categoryId are required' })
    }

    try {
      const product = await inventoryService.createProduct({
        ...body,
        deviceId,
      })
      return reply.status(201).send(product)
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  // Alias for backward compatibility
  fastify.post('/api/medicines', async (request, reply) => {
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId
    try {
      const product = await inventoryService.createProduct({ ...body, deviceId })
      return reply.status(201).send(product)
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  fastify.put('/api/products/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId

    try {
      const updated = await inventoryService.updateProduct(id, body, {
        deviceId,
        username: body.username,
        userRole: body.userRole,
      })
      return updated
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  fastify.put('/api/medicines/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    const deviceId = (request.headers['x-device-id'] as string) || body.deviceId
    try {
      const updated = await inventoryService.updateProduct(id, body, { deviceId, username: body.username, userRole: body.userRole })
      return updated
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  fastify.delete('/api/products/:id', async (request, reply) => {
    const { id } = request.params as any
    const deviceId = (request.headers['x-device-id'] as string) || undefined
    const deleted = await inventoryService.deleteProduct(id, { deviceId })
    if (!deleted) return reply.status(404).send({ error: `Product ${id} not found` })
    return { success: true, deleted }
  })

  fastify.delete('/api/medicines/:id', async (request, reply) => {
    const { id } = request.params as any
    const deviceId = (request.headers['x-device-id'] as string) || undefined
    const deleted = await inventoryService.deleteProduct(id, { deviceId })
    if (!deleted) return reply.status(404).send({ error: `Medicine ${id} not found` })
    return { success: true, deleted }
  })
}
