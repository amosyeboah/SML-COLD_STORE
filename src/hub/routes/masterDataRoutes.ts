import { FastifyPluginAsync } from 'fastify'
import * as inventoryService from '../services/inventoryService'

export const masterDataRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Categories ─────────────────────────────────────────────────────────────
  fastify.get('/api/categories', async () => {
    return await inventoryService.getCategories()
  })

  fastify.post('/api/categories', async (request, reply) => {
    const body = request.body as any
    if (!body.name) return reply.status(400).send({ error: 'name is required' })
    const created = await inventoryService.createCategory({ name: body.name })
    return reply.status(201).send(created)
  })

  fastify.put('/api/categories/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    if (!body.name) return reply.status(400).send({ error: 'name is required' })
    return await inventoryService.updateCategory(id, { name: body.name })
  })

  fastify.delete('/api/categories/:id', async (request) => {
    const { id } = request.params as any
    return await inventoryService.deleteCategory(id)
  })

  // ─── Customers ──────────────────────────────────────────────────────────────
  fastify.get('/api/customers', async () => {
    return await inventoryService.getCustomers()
  })

  fastify.post('/api/customers', async (request, reply) => {
    const body = request.body as any
    if (!body.name) return reply.status(400).send({ error: 'name is required' })
    const created = await inventoryService.createCustomer(body)
    return reply.status(201).send(created)
  })

  fastify.put('/api/customers/:id', async (request) => {
    const { id } = request.params as any
    const body = request.body as any
    return await inventoryService.updateCustomer(id, body)
  })

  fastify.delete('/api/customers/:id', async (request) => {
    const { id } = request.params as any
    return await inventoryService.deleteCustomer(id)
  })

  // ─── Suppliers ──────────────────────────────────────────────────────────────
  fastify.get('/api/suppliers', async () => {
    return await inventoryService.getSuppliers()
  })

  fastify.post('/api/suppliers', async (request, reply) => {
    const body = request.body as any
    if (!body.name) return reply.status(400).send({ error: 'name is required' })
    const created = await inventoryService.createSupplier(body)
    return reply.status(201).send(created)
  })

  fastify.put('/api/suppliers/:id', async (request) => {
    const { id } = request.params as any
    const body = request.body as any
    return await inventoryService.updateSupplier(id, body)
  })

  fastify.delete('/api/suppliers/:id', async (request) => {
    const { id } = request.params as any
    return await inventoryService.deleteSupplier(id)
  })

  // ─── Settings ───────────────────────────────────────────────────────────────
  fastify.get('/api/settings', async () => {
    return await inventoryService.getSettings()
  })

  fastify.post('/api/settings', async (request) => {
    const updates = request.body as Record<string, string>
    await inventoryService.setSettings(updates)
    return { success: true }
  })
}
