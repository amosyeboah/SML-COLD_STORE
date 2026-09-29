import { prisma } from '../db/prisma'
import { CreateSaleInput } from '../domain/types'
import { recordStockMovement } from './stockMovementService'
import { enqueueOutboxItem } from './syncOutboxService'
import { randomUUID } from 'crypto'

export async function completeSale(input: CreateSaleInput) {
  // Idempotency check: if an ID was supplied and already exists, return the existing sale
  if (input.id) {
    const existing = await prisma.sale.findUnique({
      where: { id: input.id },
      include: {
        items: { include: { batch: { include: { medicine: true } } } },
        payments: true,
        customer: true,
        prescription: true,
      },
    })
    if (existing) {
      return existing
    }
  }

  if (!input.items || input.items.length === 0) {
    throw new Error('Sale must contain at least one item')
  }

  // Execute full POS sale inside a single atomic SQLite transaction
  return await prisma.$transaction(async (tx) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // 1. Validation phase (within the transaction lock)
    const batchMap = new Map<string, any>()
    for (const item of input.items) {
      if (!item.batchId) {
        throw new Error('Each sale item must specify a valid batchId')
      }
      if (!item.quantity || item.quantity <= 0) {
        throw new Error(`Invalid quantity ${item.quantity} for item in batch ${item.batchId}`)
      }

      const batch = await tx.batch.findUnique({
        where: { id: item.batchId },
        include: { medicine: true },
      })

      if (!batch) {
        throw new Error(`Batch ID ${item.batchId} not found`)
      }

      if (new Date(batch.expiryDate) < today) {
        throw new Error(
          `Cannot sell expired product "${batch.medicine?.name}" (Batch: ${batch.batchNumber}, Expired: ${batch.expiryDate.toISOString().split('T')[0]})`
        )
      }

      if (batch.quantity < item.quantity) {
        throw new Error(
          `Insufficient stock for "${batch.medicine?.name}" (Batch: ${batch.batchNumber}). Requested: ${item.quantity}, Available: ${batch.quantity}`
        )
      }

      batchMap.set(item.batchId, batch)
    }

    // 2. Prepare payments
    const paymentRecords =
      input.payments && input.payments.length > 0
        ? input.payments.map((p) => {
            const methodUpper = (p.method || '').toUpperCase()
            const isMobile = methodUpper.includes('MOBILE') || methodUpper.includes('MOMO')
            const isCard = methodUpper.includes('CARD')
            const isBank = methodUpper.includes('BANK')
            const method = isMobile ? 'MOBILE' : isCard ? 'CARD' : isBank ? 'BANK TRANSFER' : 'CASH'
            return {
              id: randomUUID(),
              method,
              amount: Number(p.amount) || 0,
            }
          })
        : [
            {
              id: randomUUID(),
              method:
                (input.paymentMethod || '').toUpperCase().includes('MOBILE') ||
                (input.paymentMethod || '').toUpperCase().includes('MOMO')
                  ? 'MOBILE'
                  : 'CASH',
              amount: Number(input.total) || 0,
            },
          ]

    let primaryPaymentMethod = 'CASH'
    if (input.payments && input.payments.length > 1) {
      const cashAmt = paymentRecords.filter((p) => p.method === 'CASH').reduce((sum, p) => sum + p.amount, 0)
      const mobileAmt = paymentRecords.filter((p) => p.method === 'MOBILE').reduce((sum, p) => sum + p.amount, 0)
      primaryPaymentMethod = `SPLIT:CASH=${cashAmt},MOBILE=${mobileAmt}`
    } else {
      primaryPaymentMethod = paymentRecords[0]?.method || (input.paymentMethod || 'CASH').toUpperCase()
    }

    // 2b. Ensure Device exists if deviceId is provided
    if (input.deviceId) {
      await tx.device.upsert({
        where: { deviceId: input.deviceId },
        update: { lastSeen: new Date() },
        create: {
          id: randomUUID(),
          deviceId: input.deviceId,
          storeId: 'sml_accra_main',
          deviceName: input.deviceId,
          deviceType: 'TABLET',
          lastSeen: new Date(),
          status: 'ACTIVE',
        },
      })
    }

    const saleId = input.id || randomUUID()

    // 3. Create Sale Record
    const sale = await tx.sale.create({
      data: {
        id: saleId,
        customerId: input.customerId || null,
        paymentMethod: primaryPaymentMethod,
        total: Number(input.total) || 0,
        deviceId: input.deviceId || null,
        items: {
          create: input.items.map((i) => ({
            id: i.id || randomUUID(),
            batchId: i.batchId,
            quantity: i.quantity,
            price: Number(i.price) || 0,
          })),
        },
        payments: {
          create: paymentRecords,
        },
      },
      include: {
        items: {
          include: {
            batch: {
              include: {
                medicine: true,
              },
            },
          },
        },
        payments: true,
        customer: true,
      },
    })

    // 4. Update Batch Stocks and Record Stock Movements
    for (const item of input.items) {
      const batch = batchMap.get(item.batchId)

      // Decrement cached batch quantity
      await tx.batch.update({
        where: { id: item.batchId },
        data: { quantity: { decrement: item.quantity } },
      })

      // Append-only stock movement ledger
      await recordStockMovement(tx, {
        productId: batch.medicineId,
        batchId: item.batchId,
        quantityDelta: -item.quantity,
        movementType: 'SALE',
        referenceType: 'SALE',
        referenceId: sale.id,
        unitPrice: item.price,
        unitCost: batch.medicine.cost,
        userId: input.userId,
        deviceId: input.deviceId,
        notes: `Sold via POS (Invoice: ${sale.id.slice(0, 8).toUpperCase()})`,
      })
    }

    // 5. Create Prescription if provided
    let prescriptionRecord = null
    if (input.prescription && input.customerId) {
      prescriptionRecord = await tx.prescription.create({
        data: {
          id: randomUUID(),
          saleId: sale.id,
          customerId: input.customerId,
          doctorName: input.prescription.doctorName,
          notes: input.prescription.notes || null,
        },
      })
    }

    // 6. Record Audit Log
    const auditDetails = `Sale completed: GH₵${input.total.toFixed(2)} (${input.items.length} items, paid via ${primaryPaymentMethod})`
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        action: input.total >= 500 ? 'HIGH_VALUE_SALE' : 'POS_SALE',
        category: 'SALES',
        details: auditDetails,
        username: input.username || 'CASHIER',
        userRole: input.userRole || 'CASHIER',
        severity: input.total >= 500 ? 'WARNING' : 'INFO',
        deviceId: input.deviceId || null,
        metadata: JSON.stringify({
          saleId: sale.id,
          total: input.total,
          paymentMethod: primaryPaymentMethod,
          itemCount: input.items.length,
          customerId: input.customerId,
        }),
      },
    })

    // 7. Enqueue Sync Outbox Event (Atomic with the Sale)
    await enqueueOutboxItem(
      tx,
      'SALE',
      'INSERT',
      sale.id,
      {
        id: sale.id,
        customerId: sale.customerId,
        total: sale.total,
        paymentMethod: sale.paymentMethod,
        date: sale.date,
        deviceId: sale.deviceId,
        payments: paymentRecords,
        items: sale.items.map((i) => ({
          id: i.id,
          batchId: i.batchId,
          productId: i.batch.medicineId,
          productName: i.batch.medicine.name,
          sku: i.batch.medicine.sku,
          quantity: i.quantity,
          price: i.price,
          cost: i.batch.medicine.cost,
        })),
        prescription: prescriptionRecord,
      },
      input.deviceId
    )

    return sale
  })
}

export async function getSales(limit = 100) {
  return await prisma.sale.findMany({
    take: limit,
    orderBy: { date: 'desc' },
    include: {
      customer: true,
      payments: true,
      prescription: true,
      items: {
        include: {
          batch: {
            include: {
              medicine: true,
            },
          },
        },
      },
    },
  })
}

export async function getSaleById(id: string) {
  return await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      payments: true,
      prescription: true,
      items: {
        include: {
          batch: {
            include: {
              medicine: true,
            },
          },
        },
      },
    },
  })
}

export async function refundSale(id: string, username?: string, userRole?: string) {
  const sale = await getSaleById(id)
  if (!sale) throw new Error('Sale not found')

  return await prisma.$transaction(async (tx) => {
    // 1. Return items to stock
    for (const item of sale.items) {
      await tx.batch.update({
        where: { id: item.batchId },
        data: { quantity: { increment: item.quantity } },
      })

      await recordStockMovement(tx, {
        productId: item.batch.medicineId,
        batchId: item.batchId,
        quantityDelta: item.quantity,
        movementType: 'RETURN',
        referenceType: 'SALE_REFUND',
        referenceId: sale.id,
        unitPrice: item.price,
        unitCost: item.batch.medicine.cost,
        userId: username,
        deviceId: sale.deviceId || undefined,
        notes: `Refund for Invoice: ${sale.id.slice(0, 8).toUpperCase()}`,
      })
    }

    // 2. Delete dependent records explicitly since we don't have cascade on all
    await tx.saleItem.deleteMany({ where: { saleId: sale.id } })
    await tx.salePayment.deleteMany({ where: { saleId: sale.id } })
    await tx.prescription.deleteMany({ where: { saleId: sale.id } })
    
    // 3. Delete the sale itself
    await tx.sale.delete({ where: { id: sale.id } })

    // 4. Audit Log
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        action: 'SALE_REFUND',
        category: 'SALES',
        details: `Refunded sale: GH₵${sale.total.toFixed(2)} (Invoice: ${sale.id.slice(0, 8).toUpperCase()})`,
        username: username || 'CASHIER',
        userRole: userRole || 'CASHIER',
        severity: sale.total >= 500 ? 'WARNING' : 'INFO',
        metadata: JSON.stringify({ saleId: sale.id, total: sale.total }),
      },
    })

    // 5. Outbox Event
    await enqueueOutboxItem(tx, 'SALE', 'DELETE', sale.id, { id: sale.id }, sale.deviceId)

    return { success: true, message: 'Sale successfully refunded' }
  })
}
