import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../hub/db/prisma'
import { completeSale, getSaleById } from '../hub/services/saleService'
import { createPurchase } from '../hub/services/purchaseService'
import { recordStockMovement, getStockBalanceFromLedger } from '../hub/services/stockMovementService'
import { buildServer } from '../hub/server'
import { randomUUID } from 'crypto'

describe('Authoritative Local Depot Hub & Transaction Engine', () => {
  let testProductId: string
  let testBatchId: string
  let testSupplierId: string
  let testCategoryId: string
  const fastifyApp = buildServer({ logger: false })

  beforeAll(async () => {
    await fastifyApp.ready()

    // Setup test master data
    let cat = await prisma.category.findFirst()
    if (!cat) {
      cat = await prisma.category.create({ data: { name: 'Test Category ' + Date.now() } })
    }
    testCategoryId = cat.id

    let sup = await prisma.supplier.findFirst()
    if (!sup) {
      sup = await prisma.supplier.create({ data: { name: 'Test Supplier ' + Date.now() } })
    }
    testSupplierId = sup.id

    // Create a dedicated product and batch for testing
    const prod = await prisma.medicine.create({
      data: {
        id: randomUUID(),
        name: 'Test Cold Item ' + Date.now(),
        sku: 'TEST-' + Date.now(),
        categoryId: testCategoryId,
        price: 50.0,
        cost: 30.0,
        minStockLevel: 5,
      },
    })
    testProductId = prod.id

    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 90)

    const batch = await prisma.batch.create({
      data: {
        id: randomUUID(),
        medicineId: testProductId,
        batchNumber: 'LOT-TEST-100',
        expiryDate: futureDate,
        quantity: 100,
      },
    })
    testBatchId = batch.id
  })

  afterAll(async () => {
    // Clean up test records
    try {
      await prisma.saleItem.deleteMany({ where: { batchId: testBatchId } })
      await prisma.stockMovement.deleteMany({ where: { productId: testProductId } })
      await prisma.batch.deleteMany({ where: { id: testBatchId } })
      await prisma.medicine.deleteMany({ where: { id: testProductId } })
      await fastifyApp.close()
    } catch {
      // ignore cleanup errors
    }
  })

  // 1. Successful sale
  it('1. Successfully executes sale with all associated records', async () => {
    const saleId = randomUUID()
    const sale = await completeSale({
      id: saleId,
      total: 100.0,
      paymentMethod: 'CASH',
      items: [{ batchId: testBatchId, quantity: 2, price: 50.0 }],
      payments: [{ method: 'CASH', amount: 100.0 }],
      deviceId: 'test-pos-01',
      username: 'test-cashier',
    })

    expect(sale).toBeDefined()
    expect(sale.id).toBe(saleId)
    expect(sale.total).toBe(100.0)
    expect(sale.items.length).toBe(1)
    expect(sale.payments.length).toBe(1)
  })

  // 2. Failed sale rolls everything back
  it('2. Fails and rolls back everything if any constraint is violated (e.g. insufficient stock)', async () => {
    const currentBatch = await prisma.batch.findUnique({ where: { id: testBatchId } })
    const initialQty = currentBatch!.quantity

    const duplicateSaleId = randomUUID()
    // Try to buy 9999 items (more than available)
    await expect(
      completeSale({
        id: duplicateSaleId,
        total: 500000,
        paymentMethod: 'CASH',
        items: [{ batchId: testBatchId, quantity: 9999, price: 50.0 }],
        deviceId: 'test-pos-01',
      })
    ).rejects.toThrow(/Insufficient stock/)

    // Verify sale was NOT created
    const notFoundSale = await prisma.sale.findUnique({ where: { id: duplicateSaleId } })
    expect(notFoundSale).toBeNull()

    // Verify batch stock was NOT changed
    const afterBatch = await prisma.batch.findUnique({ where: { id: testBatchId } })
    expect(afterBatch!.quantity).toBe(initialQty)
  })

  // 3. Sale deducts correct stock and logs to StockMovement
  it('3. Deducts correct stock and creates immutable StockMovement ledger entry', async () => {
    const beforeBatch = await prisma.batch.findUnique({ where: { id: testBatchId } })
    const qtyBefore = beforeBatch!.quantity

    const sale = await completeSale({
      total: 50.0,
      paymentMethod: 'CASH',
      items: [{ batchId: testBatchId, quantity: 5, price: 50.0 }],
      deviceId: 'test-pos-01',
    })

    const afterBatch = await prisma.batch.findUnique({ where: { id: testBatchId } })
    expect(afterBatch!.quantity).toBe(qtyBefore - 5)

    // Check StockMovement ledger
    const movements = await prisma.stockMovement.findMany({
      where: { referenceId: sale.id, movementType: 'SALE' },
    })
    expect(movements.length).toBe(1)
    expect(movements[0].quantityDelta).toBe(-5)
    expect(movements[0].productId).toBe(testProductId)
  })

  // 4. Purchase adds correct stock and logs to StockMovement
  it('4. Purchase adds correct stock and creates StockMovement ledger entry', async () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 180)

    const purchase = await createPurchase({
      supplierId: testSupplierId,
      total: 600.0,
      items: [
        {
          medicineId: testProductId,
          batchNumber: 'LOT-PURCHASE-01',
          quantity: 20,
          cost: 30.0,
          expiryDate: futureDate.toISOString(),
        },
      ],
      deviceId: 'test-desktop',
    })

    expect(purchase).toBeDefined()

    const createdBatch = await prisma.batch.findFirst({
      where: { medicineId: testProductId, batchNumber: 'LOT-PURCHASE-01' },
    })
    expect(createdBatch).toBeDefined()
    expect(createdBatch!.quantity).toBe(20)

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceId: purchase.id, movementType: 'PURCHASE' },
    })
    expect(movement).toBeDefined()
    expect(movement!.quantityDelta).toBe(20)

    // Cleanup
    await prisma.stockMovement.deleteMany({ where: { referenceId: purchase.id } })
    await prisma.batch.deleteMany({ where: { id: createdBatch!.id } })
    await prisma.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } })
    await prisma.purchase.delete({ where: { id: purchase.id } })
  })

  // 5. Payment is linked to sale
  it('5. Links payment records directly to the sale in SQLite', async () => {
    const sale = await completeSale({
      total: 150.0,
      paymentMethod: 'SPLIT',
      payments: [
        { method: 'CASH', amount: 100.0 },
        { method: 'MOBILE', amount: 50.0 },
      ],
      items: [{ batchId: testBatchId, quantity: 3, price: 50.0 }],
      deviceId: 'test-pos-02',
    })

    const foundSale = await getSaleById(sale.id)
    expect(foundSale).toBeDefined()
    expect(foundSale!.payments.length).toBe(2)
    const totalPaid = foundSale!.payments.reduce((sum, p) => sum + p.amount, 0)
    expect(totalPaid).toBe(150.0)
  })

  // 6. Audit log is created
  it('6. Creates an audit log entry for the transaction', async () => {
    const sale = await completeSale({
      total: 550.0, // High value
      paymentMethod: 'CASH',
      items: [{ batchId: testBatchId, quantity: 1, price: 550.0 }],
      deviceId: 'test-pos-01',
      username: 'auditor-test',
    })

    const audit = await prisma.auditLog.findFirst({
      where: {
        category: 'SALES',
        metadata: { contains: sale.id },
      },
    })
    expect(audit).toBeDefined()
    expect(audit!.username).toBe('auditor-test')
  })

  // 7. Transaction creates synchronization outbox event
  it('7. Transaction atomically creates a SyncOutbox event with full payload', async () => {
    const sale = await completeSale({
      total: 50.0,
      paymentMethod: 'CASH',
      items: [{ batchId: testBatchId, quantity: 1, price: 50.0 }],
      deviceId: 'test-pos-01',
    })

    const outbox = await prisma.syncOutbox.findFirst({
      where: {
        recordId: sale.id,
        entity: 'SALE',
        action: 'INSERT',
      },
    })

    expect(outbox).toBeDefined()
    expect(outbox!.status).toBe('PENDING')
    const payload = JSON.parse(outbox!.payload)
    expect(payload.id).toBe(sale.id)
    expect(payload.total).toBe(50.0)
  })

  // 8. Duplicate transaction ID cannot create a second sale (Idempotency)
  it('8. Duplicate transaction ID returns existing sale without double-charging or deducting stock twice', async () => {
    const fixedId = randomUUID()

    const beforeBatch = await prisma.batch.findUnique({ where: { id: testBatchId } })
    const qtyBefore = beforeBatch!.quantity

    // First attempt
    const sale1 = await completeSale({
      id: fixedId,
      total: 50.0,
      paymentMethod: 'CASH',
      items: [{ batchId: testBatchId, quantity: 1, price: 50.0 }],
      deviceId: 'test-pos-01',
    })
    expect(sale1.id).toBe(fixedId)

    const midBatch = await prisma.batch.findUnique({ where: { id: testBatchId } })
    expect(midBatch!.quantity).toBe(qtyBefore - 1)

    // Second attempt with exact same ID
    const sale2 = await completeSale({
      id: fixedId,
      total: 50.0,
      paymentMethod: 'CASH',
      items: [{ batchId: testBatchId, quantity: 1, price: 50.0 }],
      deviceId: 'test-pos-01',
    })
    expect(sale2.id).toBe(fixedId)

    // Verify stock was NOT deducted again
    const finalBatch = await prisma.batch.findUnique({ where: { id: testBatchId } })
    expect(finalBatch!.quantity).toBe(qtyBefore - 1)

    // Verify only 1 sale exists with this ID
    const count = await prisma.sale.count({ where: { id: fixedId } })
    expect(count).toBe(1)
  })

  // 9. Multiple POS requests cannot create inconsistent inventory (Oversell prevention)
  it('9. Concurrency test: Prevents overselling when stock runs out', async () => {
    // Create a special low-stock batch with exactly 2 items
    const limitedBatch = await prisma.batch.create({
      data: {
        id: randomUUID(),
        medicineId: testProductId,
        batchNumber: 'LOT-LIMITED-2',
        expiryDate: new Date(Date.now() + 86400000 * 30),
        quantity: 2,
      },
    })

    // Fire 3 simultaneous sales of 1 item each
    const promises = [
      completeSale({
        total: 50.0,
        paymentMethod: 'CASH',
        items: [{ batchId: limitedBatch.id, quantity: 1, price: 50.0 }],
        deviceId: 'pos-1',
      }),
      completeSale({
        total: 50.0,
        paymentMethod: 'CASH',
        items: [{ batchId: limitedBatch.id, quantity: 1, price: 50.0 }],
        deviceId: 'pos-2',
      }),
      completeSale({
        total: 50.0,
        paymentMethod: 'CASH',
        items: [{ batchId: limitedBatch.id, quantity: 1, price: 50.0 }],
        deviceId: 'pos-3',
      }),
    ]

    const results = await Promise.allSettled(promises)
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    // Exactly 2 sales should succeed, and 1 MUST fail due to insufficient stock
    expect(fulfilled.length).toBe(2)
    expect(rejected.length).toBe(1)

    const finalBatch = await prisma.batch.findUnique({ where: { id: limitedBatch.id } })
    expect(finalBatch!.quantity).toBe(0)

    // Cleanup limited batch
    await prisma.saleItem.deleteMany({ where: { batchId: limitedBatch.id } })
    await prisma.stockMovement.deleteMany({ where: { batchId: limitedBatch.id } })
    await prisma.batch.delete({ where: { id: limitedBatch.id } })
  })

  // 10. Integration test via HTTP API (LAN client simulation)
  it('10. Client -> Local HTTP API -> Local Hub -> SQLite completes sale over HTTP', async () => {
    const response = await fastifyApp.inject({
      method: 'POST',
      url: '/api/sales',
      headers: {
        'x-device-id': 'android-tablet-depot-01',
      },
      payload: {
        total: 50.0,
        paymentMethod: 'CASH',
        items: [{ batchId: testBatchId, quantity: 1, price: 50.0 }],
      },
    })

    expect(response.statusCode).toBe(201)
    const json = JSON.parse(response.payload)
    expect(json.success).toBe(true)
    expect(json.sale.deviceId).toBe('android-tablet-depot-01')

    // Verify device was touched/recorded
    const device = await prisma.device.findUnique({ where: { deviceId: 'android-tablet-depot-01' } })
    expect(device).toBeDefined()
  })
})
