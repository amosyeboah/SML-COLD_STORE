import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { PrismaClient as PrismaClientType } from '../generated/client'
import * as bcrypt from 'bcryptjs'
import * as fs from 'fs'
import * as path from 'path'
import * as ExcelJS from 'exceljs'

// ─── Prisma ─────────────────────────────────────────────────────────────────
let prisma: PrismaClientType

function resolvePrismaClient(): typeof import('../generated/client') {
  if (is.dev) {
    return require(path.join(__dirname, '../../generated/client'))
  }
  const unpackedPath = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'generated',
    'client'
  )
  const enginePath = path.join(unpackedPath, 'query_engine-windows.dll.node')
  if (fs.existsSync(enginePath)) {
    process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath
  }
  return require(unpackedPath)
}

function resolveDatabaseUrl(): string {
  const dbDir = is.dev
    ? path.join(__dirname, '../../database')
    : path.join(app.getPath('userData'), 'database')

  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  const dbPath = path.join(dbDir, 'pharmacy.db')
  // Prisma SQLite requires 'file:' prefix with forward slashes (not file:/// triple-slash)
  // Convert Windows backslashes to forward slashes
  const normalizedPath = dbPath.replace(/\\/g, '/')
  return `file:${normalizedPath}`
}

function resolveDatabasePath(): string {
  const dbDir = is.dev
    ? path.join(__dirname, '../../database')
    : path.join(app.getPath('userData'), 'database')
  return path.join(dbDir, 'pharmacy.db')
}

async function initDatabase(): Promise<void> {
  const dbUrl = resolveDatabaseUrl()
  process.env.DATABASE_URL = dbUrl

  const { PrismaClient } = resolvePrismaClient()
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  await prisma.$connect()
  console.log('✅ Database connected:', dbUrl)
}

// ─── Audit Logger Helper (Important Activities Only) ──────────────────────────
async function recordAudit(entry: {
  action: string
  category: string
  details: string
  username?: string
  userRole?: string
  severity?: 'INFO' | 'WARNING' | 'CRITICAL'
  metadata?: any
}) {
  try {
    if (!prisma) return
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        category: entry.category,
        details: entry.details,
        username: entry.username || 'System',
        userRole: entry.userRole || 'SYSTEM',
        severity: entry.severity || 'INFO',
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    })
  } catch (err) {
    console.error('Failed to write audit log:', err)
  }
}

// ─── Window ──────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('❌ Renderer process gone:', details)
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
    console.error(`❌ Page failed to load: [${code}] ${desc}`)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.smllegacy.coldstore')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  await initDatabase()
  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  if (prisma) await prisma.$disconnect()
  if (process.platform !== 'darwin') app.quit()
})

// ═══════════════════════════════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Auth ─────────────────────────────────────────────────────────────────────
ipcMain.handle('auth:login', async (_, username: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { username } })
  let valid = false
  if (user) {
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      valid = await bcrypt.compare(password, user.password)
    } else {
      valid = password === user.password
    }
  }

  if (!user || !valid) {
    await recordAudit({
      action: 'LOGIN_FAILED',
      category: 'AUTH',
      details: `Failed sign-in attempt for username "${username}"`,
      username,
      userRole: user?.role || 'UNKNOWN',
      severity: 'WARNING',
      metadata: { attemptedUsername: username },
    })
    throw new Error('Invalid credentials')
  }

  await recordAudit({
    action: 'LOGIN_SUCCESS',
    category: 'AUTH',
    details: `Staff user "${user.username}" signed in with role [${user.role}]`,
    username: user.username,
    userRole: user.role,
    severity: 'INFO',
  })

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
})

ipcMain.handle('auth:loginWithPin', async (_, pin: string, selectedRole?: string) => {
  let targetUsername = ''
  if (selectedRole === 'ADMIN' || pin === '1111' || pin === '9999') {
    targetUsername = 'admin'
  } else if (selectedRole === 'MANAGER' || pin === '2222' || pin === '5555') {
    targetUsername = 'manager'
  } else if (selectedRole === 'CASHIER' || pin === '1234' || pin === '0000') {
    targetUsername = 'cashier'
  }

  let user = targetUsername ? await prisma.user.findUnique({ where: { username: targetUsername } }) : null
  if (!user) {
    const allUsers = await prisma.user.findMany()
    for (const u of allUsers) {
      if (u.password === pin) {
        user = u
        break
      }
    }
  }

  if (!user) {
    throw new Error('Invalid PIN code. Try 1111 (Admin) or 1234 (Cashier)')
  }

  await recordAudit({
    action: 'LOGIN_SUCCESS_PIN',
    category: 'AUTH',
    details: `Staff user "${user.username}" signed in via touch PIN pad [${user.role}]`,
    username: user.username,
    userRole: user.role,
    severity: 'INFO',
  })

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
})

// ─── Medicines ────────────────────────────────────────────────────────────────
ipcMain.handle('medicines:getAll', async () => {
  const meds = await prisma.medicine.findMany({
    include: { category: true, batches: true },
    orderBy: { name: 'asc' },
  })
  return meds
})

ipcMain.handle('medicines:create', async (_, data: any) => {
  const created = await prisma.medicine.create({
    data,
    include: { category: true, batches: true },
  })
  await recordAudit({
    action: 'PRODUCT_CREATE',
    category: 'PRICING',
    details: `New product "${created.name}" (SKU: ${created.sku}) added with price GH₵${created.price.toFixed(2)}`,
    severity: 'INFO',
    metadata: { productId: created.id, name: created.name, price: created.price, cost: created.cost },
  })
  return created
})

ipcMain.handle('medicines:update', async (_, id: string, data: any) => {
  const existing = await prisma.medicine.findUnique({ where: { id } })
  const updated = await prisma.medicine.update({
    where: { id },
    data,
    include: { category: true, batches: true },
  })

  if (existing) {
    if (data.price !== undefined && Number(data.price) !== Number(existing.price)) {
      await recordAudit({
        action: 'PRICE_CHANGE',
        category: 'PRICING',
        details: `Selling price for "${existing.name}" changed from GH₵${existing.price.toFixed(2)} to GH₵${Number(data.price).toFixed(2)}`,
        severity: 'WARNING',
        metadata: { productId: id, name: existing.name, oldPrice: existing.price, newPrice: Number(data.price) },
      })
    }
    if (data.cost !== undefined && Number(data.cost) !== Number(existing.cost)) {
      await recordAudit({
        action: 'COST_CHANGE',
        category: 'PRICING',
        details: `Unit purchase cost for "${existing.name}" changed from GH₵${existing.cost.toFixed(2)} to GH₵${Number(data.cost).toFixed(2)}`,
        severity: 'WARNING',
        metadata: { productId: id, name: existing.name, oldCost: existing.cost, newCost: Number(data.cost) },
      })
    }
  }

  return updated
})

ipcMain.handle('medicines:delete', async (_, id: string) => {
  const existing = await prisma.medicine.findUnique({
    where: { id },
    include: { batches: true },
  })
  if (!existing) return null

  const batchIds = existing.batches.map((b) => b.id)

  await prisma.$transaction(async (tx) => {
    if (batchIds.length > 0) {
      await tx.saleItem.deleteMany({ where: { batchId: { in: batchIds } } })
      await tx.batch.deleteMany({ where: { medicineId: id } })
    }
    await tx.purchaseItem.deleteMany({ where: { medicineId: id } })
    await tx.medicine.delete({ where: { id } })
  })

  await recordAudit({
    action: 'PRODUCT_DELETE',
    category: 'INVENTORY',
    details: `Product "${existing.name}" (SKU: ${existing.sku}) and ${existing.batches.length} associated lot(s) were permanently removed`,
    severity: 'WARNING',
    metadata: { productId: id, name: existing.name, sku: existing.sku },
  })
  return existing
})

// ─── Users ────────────────────────────────────────────────────────────────────
ipcMain.handle('users:update', async (_, id: string, data: { username: string; role: string; passwordHash?: string }) => {
  const existing = await prisma.user.findUnique({ where: { id } })
  const updateData: any = { username: data.username, role: data.role }
  if (data.passwordHash) {
    updateData.password = await bcrypt.hash(data.passwordHash, 10)
  }
  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
  })

  await recordAudit({
    action: 'USER_UPDATE',
    category: 'AUTH',
    details: `Updated operator account "${data.username}" (Role: ${data.role}${data.passwordHash ? ', Password reset' : ''})`,
    severity: 'WARNING',
    metadata: { userId: id, username: data.username, role: data.role, roleChanged: existing?.role !== data.role },
  })

  return updated
})

ipcMain.handle('users:delete', async (_, id: string) => {
  const user = await prisma.user.findUnique({ where: { id } })
  const res = await prisma.user.delete({ where: { id } })
  await recordAudit({
    action: 'USER_DELETE',
    category: 'AUTH',
    details: `Deleted staff operator account "${user?.username || id}" (Former role: ${user?.role || 'UNKNOWN'})`,
    severity: 'CRITICAL',
    metadata: { userId: id, username: user?.username, role: user?.role },
  })
  return res
})


// ─── Categories ───────────────────────────────────────────────────────────────
ipcMain.handle('categories:getAll', async () => {
  return prisma.category.findMany({ orderBy: { name: 'asc' } })
})

ipcMain.handle('categories:create', async (_, data: { name: string }) => {
  return prisma.category.create({ data })
})

ipcMain.handle('categories:update', async (_, id: string, data: { name: string }) => {
  return prisma.category.update({ where: { id }, data })
})

ipcMain.handle('categories:delete', async (_, id: string) => {
  return prisma.category.delete({ where: { id } })
})

// ─── Batches ──────────────────────────────────────────────────────────────────
ipcMain.handle('batches:getAll', async (_, startDate?: string, endDate?: string) => {
  const where: any = {}
  if (startDate || endDate) {
    where.expiryDate = {}
    if (startDate) where.expiryDate.gte = new Date(startDate)
    if (endDate) where.expiryDate.lte = new Date(endDate)
  }
  return prisma.batch.findMany({
    where,
    include: { medicine: true },
    orderBy: { expiryDate: 'asc' },
  })
})

ipcMain.handle('batches:create', async (_, data: any) => {
  const { expiryDate, ...rest } = data
  const created = await prisma.batch.create({
    data: {
      ...rest,
      expiryDate: new Date(expiryDate),
    },
    include: { medicine: true },
  })
  await recordAudit({
    action: 'BATCH_RECEIVE',
    category: 'INVENTORY',
    details: `Stock lot received: ${created.quantity} units of "${created.medicine?.name || 'Product'}" (Batch: ${created.batchNumber})`,
    severity: 'INFO',
    metadata: { batchId: created.id, batchNumber: created.batchNumber, quantity: created.quantity, productName: created.medicine?.name },
  })
  return created
})

ipcMain.handle('batches:update', async (_, id: string, data: any) => {
  const { expiryDate, ...rest } = data
  const updateData: any = { ...rest }
  if (expiryDate) updateData.expiryDate = new Date(expiryDate)
  return prisma.batch.update({
    where: { id },
    data: updateData,
    include: { medicine: true },
  })
})

ipcMain.handle('batches:delete', async (_, id: string) => {
  const existing = await prisma.batch.findUnique({ where: { id }, include: { medicine: true } })
  if (!existing) return null

  await prisma.$transaction(async (tx) => {
    await tx.saleItem.deleteMany({ where: { batchId: id } })
    await tx.batch.delete({ where: { id } })
  })

  await recordAudit({
    action: 'BATCH_DELETE',
    category: 'INVENTORY',
    details: `Discarded/Deleted batch "${existing.batchNumber || id}" of "${existing.medicine?.name || 'Product'}" (${existing.quantity || 0} units)`,
    severity: 'CRITICAL',
    metadata: { batchId: id, batchNumber: existing.batchNumber, quantity: existing.quantity, productName: existing.medicine?.name },
  })
  return existing
})

// ─── Suppliers ────────────────────────────────────────────────────────────────
ipcMain.handle('suppliers:getAll', async () => {
  return prisma.supplier.findMany({ orderBy: { name: 'asc' } })
})

ipcMain.handle('suppliers:create', async (_, data: any) => {
  return prisma.supplier.create({ data })
})

ipcMain.handle('suppliers:update', async (_, id: string, data: any) => {
  return prisma.supplier.update({ where: { id }, data })
})

ipcMain.handle('suppliers:delete', async (_, id: string) => {
  return prisma.supplier.delete({ where: { id } })
})

// ─── Customers ────────────────────────────────────────────────────────────────
ipcMain.handle('customers:getAll', async () => {
  return prisma.customer.findMany({ orderBy: { name: 'asc' } })
})

ipcMain.handle('customers:create', async (_, data: any) => {
  return prisma.customer.create({ data })
})

ipcMain.handle('customers:update', async (_, id: string, data: any) => {
  return prisma.customer.update({ where: { id }, data })
})

ipcMain.handle('customers:delete', async (_, id: string) => {
  return prisma.customer.delete({ where: { id } })
})

// ─── Sales (POS) ──────────────────────────────────────────────────────────────
ipcMain.handle('sales:create', async (_, data: { customerId?: string; paymentMethod: string; total: number; items: { batchId: string; quantity: number; price: number }[]; prescription?: { doctorName: string; notes?: string } }) => {
  return await prisma.$transaction(async (tx) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // 1. Validate batches before creating sale
    for (const item of data.items) {
      const batch = await tx.batch.findUnique({
        where: { id: item.batchId },
        include: { medicine: true },
      })
      if (!batch) {
        throw new Error(`Batch ID ${item.batchId} not found`)
      }
      if (new Date(batch.expiryDate) < today) {
        throw new Error(`Cannot sell expired medicine "${batch.medicine?.name}" (Batch: ${batch.batchNumber})`)
      }
      if (batch.quantity < item.quantity) {
        throw new Error(`Insufficient stock for "${batch.medicine?.name}" (Batch: ${batch.batchNumber}). Requested: ${item.quantity}, Available: ${batch.quantity}`)
      }
    }

    // 2. Create Sale
    const sale = await tx.sale.create({
      data: {
        customerId: data.customerId,
        paymentMethod: data.paymentMethod,
        total: data.total,
        items: {
          create: data.items.map((i) => ({
            batchId: i.batchId,
            quantity: i.quantity,
            price: i.price,
          })),
        },
      },
      include: { items: true },
    })

    // 3. Reduce batch quantities
    for (const item of data.items) {
      await tx.batch.update({
        where: { id: item.batchId },
        data: { quantity: { decrement: item.quantity } },
      })
    }

    // 4. Create Prescription if provided
    if (data.prescription && data.customerId) {
      await tx.prescription.create({
        data: {
          saleId: sale.id,
          customerId: data.customerId,
          doctorName: data.prescription.doctorName,
          notes: data.prescription.notes,
        },
      })
    }

    if (data.total >= 500) {
      await recordAudit({
        action: 'HIGH_VALUE_SALE',
        category: 'SALES',
        details: `High-value POS transaction completed: GH₵${data.total.toFixed(2)} (${data.items.length} items, paid via ${data.paymentMethod})`,
        severity: 'INFO',
        metadata: {
          saleId: sale.id,
          total: data.total,
          paymentMethod: data.paymentMethod,
          itemCount: data.items.length,
          customerId: data.customerId,
        },
      })
    }

    return sale
  })
})

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
ipcMain.handle('dashboard:stats', async () => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endOfDay = new Date(today)
  endOfDay.setHours(23, 59, 59, 999)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const endOfYesterday = new Date(yesterday)
  endOfYesterday.setHours(23, 59, 59, 999)

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999)

  const last7DaysStart = new Date(today)
  last7DaysStart.setDate(last7DaysStart.getDate() - 6) // last 7 days including today

  const [
    todaySales, yesterdaySales,
    mtdSales, lastMonthSales,
    mtdPurchases, lastMonthPurchases,
    last7DaysSales,
    lowStockBatches,
    expiringBatchesAll
  ] = await Promise.all([
    prisma.sale.findMany({ where: { date: { gte: today, lte: endOfDay } } }),
    prisma.sale.findMany({ where: { date: { gte: yesterday, lte: endOfYesterday } } }),
    prisma.sale.findMany({ where: { date: { gte: startOfMonth, lte: endOfDay } }, include: { items: { include: { batch: { include: { medicine: true } } } }, customer: true } }),
    prisma.sale.findMany({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    prisma.purchase.findMany({ where: { date: { gte: startOfMonth, lte: endOfDay } } }),
    prisma.purchase.findMany({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    prisma.sale.findMany({ where: { date: { gte: last7DaysStart, lte: endOfDay } } }),
    prisma.batch.findMany({
      where: { quantity: { lte: 10, gt: 0 } },
      include: { medicine: true },
      orderBy: { quantity: 'asc' },
      take: 5
    }),
    prisma.batch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) } },
      include: { medicine: true },
      orderBy: { expiryDate: 'asc' },
      take: 5
    })
  ])

  const sumSales = (sales: any[]) => sales.reduce((acc, sale) => acc + sale.total, 0)
  const sumPurchases = (purchases: any[]) => purchases.reduce((acc, p) => acc + p.total, 0)
  const calcTrendStr = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? '+100%' : '0%'
    const trend = ((current - previous) / previous) * 100
    return trend > 0 ? `+${trend.toFixed(1)}%` : `${trend.toFixed(1)}%`
  }

  const todayRevenue = sumSales(todaySales)
  const yesterdayRevenue = sumSales(yesterdaySales)
  const todayRevenueTrend = calcTrendStr(todayRevenue, yesterdayRevenue)

  const mtdRevenue = sumSales(mtdSales)
  const lastMonthRevenue = sumSales(lastMonthSales)
  const mtdRevenueTrend = calcTrendStr(mtdRevenue, lastMonthRevenue)

  const todayTransactions = todaySales.length
  const todayTransactionsTrend = calcTrendStr(todayTransactions, yesterdaySales.length)

  const mtdGrossProfit = mtdRevenue - sumPurchases(mtdPurchases)
  const lastMonthGrossProfit = lastMonthRevenue - sumPurchases(lastMonthPurchases)
  const mtdGrossProfitTrend = calcTrendStr(mtdGrossProfit, lastMonthGrossProfit)

  // Sales Overview (Last 7 days)
  const salesByDay = new Map<string, number>()
  for (let d = new Date(last7DaysStart); d <= endOfDay; d.setDate(d.getDate() + 1)) {
    salesByDay.set(d.toLocaleDateString('en-US', { weekday: 'short' }), 0)
  }
  for (const sale of last7DaysSales) {
    const day = sale.date.toLocaleDateString('en-US', { weekday: 'short' })
    salesByDay.set(day, (salesByDay.get(day) || 0) + sale.total)
  }
  const salesOverviewData: { day: string, sales: number }[] = []
  salesByDay.forEach((sales, day) => salesOverviewData.push({ day, sales }))

  // Payment Breakdown
  const PAYMENT_COLORS: Record<string, string> = { CASH: '#22c55e', MOBILE: '#6366f1', CARD: '#a855f7', 'BANK TRANSFER': '#f59e0b' }
  const PAYMENT_LABELS: Record<string, string> = { CASH: 'Cash', MOBILE: 'Mobile Money', CARD: 'Card', 'BANK TRANSFER': 'Bank Transfer' }
  const paymentTotals = new Map<string, number>()
  for (const sale of mtdSales) {
    const method = sale.paymentMethod.toUpperCase()
    paymentTotals.set(method, (paymentTotals.get(method) || 0) + sale.total)
  }
  const paymentData: any[] = []
  paymentTotals.forEach((value, method) => {
    paymentData.push({
      name: PAYMENT_LABELS[method] || method,
      value,
      percent: mtdRevenue > 0 ? Math.round((value / mtdRevenue) * 100) : 0,
      color: PAYMENT_COLORS[method] || '#94a3b8'
    })
  })
  paymentData.sort((a, b) => b.value - a.value)

  // Top Medicines (from MTD Sales)
  const medicineTotals = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const sale of mtdSales) {
    for (const item of sale.items) {
      if (!item.batch?.medicine) continue
      const med = item.batch.medicine
      const existing = medicineTotals.get(med.id) || { name: med.name, qty: 0, revenue: 0 }
      existing.qty += item.quantity
      existing.revenue += item.price * item.quantity
      medicineTotals.set(med.id, existing)
    }
  }
  const topMedicinesArr: any[] = []
  medicineTotals.forEach(m => topMedicinesArr.push(m))
  const topMedicines = topMedicinesArr
    .sort((a, b) => b.revenue - a.revenue)
    .map((m, i) => ({
      rank: i + 1,
      name: m.name,
      desc: `${m.qty} items sold`,
      price: `₵${m.revenue.toLocaleString()}.00`
    }))

  // Recent Transactions
  const recentTransactions = [...mtdSales]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map((sale) => ({
      id: `INV-${sale.id.slice(0, 6).toUpperCase()}`,
      customer: sale.customer?.name || 'Walk-in Customer',
      time: sale.date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      date: sale.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      amount: sale.total,
      paymentMethod: sale.paymentMethod
    }))

  const lowStockItems = lowStockBatches.map(b => ({
    name: b.medicine?.name || 'Unknown',
    left: b.quantity
  }))

  const expiringItems = expiringBatchesAll.map(b => {
    const days = Math.ceil((b.expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return {
      name: b.medicine?.name || 'Unknown',
      days: `Expires in ${days} days`
    }
  })

  return {
    todayRevenue,
    todayRevenueTrend,
    mtdRevenue,
    mtdRevenueTrend,
    todayTransactions,
    todayTransactionsTrend,
    mtdGrossProfit,
    mtdGrossProfitTrend,
    salesOverviewData,
    paymentData,
    topMedicines,
    recentTransactions,
    lowStockItems,
    expiringItems,
  }
})

// ─── Prescriptions ─────────────────────────────────────────────────────────────
ipcMain.handle('prescriptions:getAll', async () => {
  return prisma.prescription.findMany({
    include: { customer: true, sale: { include: { items: { include: { batch: { include: { medicine: true } } } } } } },
    orderBy: { date: 'desc' },
  })
})

// ─── Purchases ─────────────────────────────────────────────────────────────────
ipcMain.handle('purchases:getAll', async () => {
  return prisma.purchase.findMany({
    include: { supplier: true, items: { include: { batches: true } } },
    orderBy: { date: 'desc' },
  })
})

ipcMain.handle('purchases:create', async (_, data: { supplierId: string; total: number; items: { medicineId: string; quantity: number; cost: number; batchNumber: string; expiryDate: string }[] }) => {
  return await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        supplierId: data.supplierId,
        total: data.total,
        status: 'COMPLETED',
        items: {
          create: data.items.map((i) => ({
            medicineId: i.medicineId,
            quantity: i.quantity,
            cost: i.cost,
          })),
        },
      },
      include: { items: true },
    })

    // Recreate batches using the actual new item order
    for (let index = 0; index < data.items.length; index++) {
      const item = data.items[index]
      const createdItem = purchase.items[index]
      await tx.batch.create({
        data: {
          medicineId: item.medicineId,
          batchNumber: item.batchNumber,
          expiryDate: new Date(item.expiryDate),
          quantity: item.quantity,
          purchaseItemId: createdItem?.id,
        },
      })
    }

    await recordAudit({
      action: 'PURCHASE_CREATE',
      category: 'INVENTORY',
      details: `Restock purchase order created for GH₵${data.total.toFixed(2)} (${data.items.length} product lines)`,
      severity: 'INFO',
      metadata: {
        purchaseId: purchase.id,
        supplierId: data.supplierId,
        total: data.total,
        itemCount: data.items.length,
      },
    })

    return purchase
  })
})

ipcMain.handle('purchases:delete', async (_, id: string) => {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({ where: { id } })
    // Delete batches associated with purchase items first
    const items = await tx.purchaseItem.findMany({ where: { purchaseId: id } })
    for (const item of items) {
      await tx.batch.deleteMany({ where: { purchaseItemId: item.id } })
    }
    const deleted = await tx.purchase.delete({ where: { id } })

    await recordAudit({
      action: 'PURCHASE_DELETE',
      category: 'INVENTORY',
      details: `Purchase order #${id.slice(0, 8)} for GH₵${existing?.total?.toFixed(2) ?? '0.00'} was deleted`,
      severity: 'WARNING',
      metadata: { purchaseId: id, total: existing?.total },
    })

    return deleted
  })
})

ipcMain.handle('purchases:update', async (_, id: string, data: { supplierId: string; total: number; items: { medicineId: string; quantity: number; cost: number; batchNumber: string; expiryDate: string }[] }) => {
  return await prisma.$transaction(async (tx) => {
    // Delete existing batches for this purchase
    const existingItems = await tx.purchaseItem.findMany({ where: { purchaseId: id } })
    for (const item of existingItems) {
      await tx.batch.deleteMany({ where: { purchaseItemId: item.id } })
    }
    // Delete existing purchase items
    await tx.purchaseItem.deleteMany({ where: { purchaseId: id } })

    // Update purchase info
    const purchase = await tx.purchase.update({
      where: { id },
      data: {
        supplierId: data.supplierId,
        total: data.total,
        items: {
          create: data.items.map((i) => ({
            medicineId: i.medicineId,
            quantity: i.quantity,
            cost: i.cost,
          })),
        },
      },
      include: { items: true },
    })

    // Recreate batches using the actual new item order
    for (let index = 0; index < data.items.length; index++) {
      const item = data.items[index]
      const createdItem = purchase.items[index]
      await tx.batch.create({
        data: {
          medicineId: item.medicineId,
          batchNumber: item.batchNumber,
          expiryDate: new Date(item.expiryDate),
          quantity: item.quantity,
          purchaseItemId: createdItem?.id,
        },
      })
    }
    return purchase
  })
})

// ─── Backup ───────────────────────────────────────────────────────────────────
ipcMain.handle('backup:export', async () => {
  const dbPath = resolveDatabasePath()
  
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Database Backup',
    defaultPath: `sml-coldstore-backup-${new Date().toISOString().split('T')[0]}.db`,
    filters: [{ name: 'SQLite DB', extensions: ['db'] }],
  })

  if (filePath) {
    fs.copyFileSync(dbPath, filePath)
    await recordAudit({
      action: 'BACKUP_EXPORT',
      category: 'SYSTEM',
      details: `Database backup snapshot exported to ${path.basename(filePath)}`,
      severity: 'INFO',
      metadata: { destination: filePath },
    })
    return { success: true, path: filePath }
  }
  return { success: false }
})

// ─── Print POS ────────────────────────────────────────────────────────────────
ipcMain.handle('system:getPrinters', async () => {
  try {
    const win = mainWindow || new BrowserWindow({ show: false })
    const printers = await win.webContents.getPrintersAsync()
    if (!mainWindow) win.close()
    return printers
  } catch (err) {
    console.error('Failed to get system printers:', err)
    return []
  }
})

ipcMain.handle('print:receipt', async (_, htmlContent: string) => {
  let configuredPrinter = ''
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'hw.printerName' } })
    if (setting?.value) {
      configuredPrinter = setting.value.trim()
    }
  } catch (err) {
    console.error('Error reading hw.printerName setting:', err)
  }

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true }
  })
  printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)

  return new Promise((resolve) => {
    printWindow.webContents.on('did-finish-load', async () => {
      let printers: Electron.PrinterInfo[] = []
      try {
        printers = await printWindow.webContents.getPrintersAsync()
      } catch (e) {
        console.error('Failed to get printers:', e)
      }

      const printOptions: Electron.WebContentsPrintOptions = {
        silent: true,
        printBackground: true,
      }

      if (configuredPrinter) {
        const matched = printers.find(
          (p) =>
            p.name.toLowerCase() === configuredPrinter.toLowerCase() ||
            p.displayName?.toLowerCase() === configuredPrinter.toLowerCase()
        )
        if (matched) {
          printOptions.deviceName = matched.name
        } else {
          printOptions.deviceName = configuredPrinter
        }
      } else {
        const defaultPrinter = printers.find((p) => p.isDefault)
        const defaultName = (defaultPrinter?.name || '').toLowerCase()

        const isVirtualOrOneNote =
          !defaultName ||
          defaultName.includes('onenote') ||
          defaultName.includes('pdf') ||
          defaultName.includes('xps') ||
          defaultName.includes('fax')

        if (isVirtualOrOneNote) {
          const realPrinter = printers.find((p) => {
            const name = p.name.toLowerCase()
            return (
              !name.includes('onenote') &&
              !name.includes('pdf') &&
              !name.includes('xps') &&
              !name.includes('fax') &&
              !name.includes('microsoft')
            )
          })

          if (realPrinter) {
            printOptions.deviceName = realPrinter.name
          } else {
            printOptions.silent = false
          }
        }
      }

      printWindow.webContents.print(printOptions, (success, failureReason) => {
        printWindow.close()
        resolve({ success, failureReason })
      })
    })
  })
})

// ─── Reports ──────────────────────────────────────────────────────────────────

const PAYMENT_COLORS: Record<string, string> = {
  CASH: '#22c55e',
  MOBILE: '#3b82f6',
  CARD: '#a855f7',
  'BANK TRANSFER': '#f97316',
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MOBILE: 'Mobile Money',
  CARD: 'Card',
  'BANK TRANSFER': 'Bank Transfer',
}

function parseReportDate(dateStr: string, endOfDay = false): Date {
  const date = new Date(dateStr)
  if (endOfDay) {
    date.setHours(23, 59, 59, 999)
  } else {
    date.setHours(0, 0, 0, 0)
  }
  return date
}

function calcTrend(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = []
  const cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)
  while (cursor <= endDay) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function daysUntil(date: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

async function buildReportsData(startDate: string, endDate: string) {
  const start = parseReportDate(startDate)
  const end = parseReportDate(endDate, true)

  const periodMs = end.getTime() - start.getTime()
  const prevEnd = new Date(start.getTime() - 1)
  prevEnd.setHours(23, 59, 59, 999)
  const prevStart = new Date(prevEnd.getTime() - periodMs)
  prevStart.setHours(0, 0, 0, 0)

  const [sales, purchases, prevSales, prevPurchases, expiringBatches, recentSales] = await Promise.all([
    prisma.sale.findMany({
      where: { date: { gte: start, lte: end } },
      include: {
        customer: true,
        items: { include: { batch: { include: { medicine: true } } } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.purchase.findMany({
      where: { date: { gte: start, lte: end } },
      include: { supplier: true },
      orderBy: { date: 'desc' },
    }),
    prisma.sale.findMany({ where: { date: { gte: prevStart, lte: prevEnd } } }),
    prisma.purchase.findMany({ where: { date: { gte: prevStart, lte: prevEnd } } }),
    prisma.batch.findMany({
      where: {
        quantity: { gt: 0 },
        expiryDate: { lte: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) },
      },
      include: { medicine: true },
      orderBy: { expiryDate: 'asc' },
      take: 8,
    }),
    prisma.sale.findMany({
      where: { date: { gte: start, lte: end } },
      include: { customer: true },
      orderBy: { date: 'desc' },
      take: 8,
    }),
  ])

  const totalSales = sales.reduce((acc, sale) => acc + sale.total, 0)
  const totalPurchases = purchases.reduce((acc, purchase) => acc + purchase.total, 0)
  const grossProfit = totalSales - totalPurchases
  const transactions = sales.length
  const dayCount = Math.max(1, eachDay(start, end).length)
  const avgDailySales = totalSales / dayCount

  const prevTotalSales = prevSales.reduce((acc, sale) => acc + sale.total, 0)
  const prevTotalPurchases = prevPurchases.reduce((acc, purchase) => acc + purchase.total, 0)
  const prevGrossProfit = prevTotalSales - prevTotalPurchases
  const prevTransactions = prevSales.length
  const prevAvgDaily = prevTotalSales / dayCount

  const salesByDay = new Map<string, number>()
  const purchasesByDay = new Map<string, number>()
  const transactionsByDay = new Map<string, number>()

  for (const sale of sales) {
    const key = formatDayLabel(sale.date)
    salesByDay.set(key, (salesByDay.get(key) || 0) + sale.total)
    transactionsByDay.set(key, (transactionsByDay.get(key) || 0) + 1)
  }

  for (const purchase of purchases) {
    const key = formatDayLabel(purchase.date)
    purchasesByDay.set(key, (purchasesByDay.get(key) || 0) + purchase.total)
  }

  const salesOverview = eachDay(start, end).map((day) => {
    const label = formatDayLabel(day)
    const daySales = salesByDay.get(label) || 0
    const dayPurchases = purchasesByDay.get(label) || 0
    return {
      date: label,
      sales: daySales,
      purchases: dayPurchases,
      profit: daySales - dayPurchases,
      transactions: transactionsByDay.get(label) || 0,
    }
  })

  const paymentTotals = new Map<string, number>()
  for (const sale of sales) {
    const method = sale.paymentMethod.toUpperCase()
    paymentTotals.set(method, (paymentTotals.get(method) || 0) + sale.total)
  }

  const paymentBreakdownArr: any[] = []
  paymentTotals.forEach((value, method) => paymentBreakdownArr.push([method, value]))
  
  const paymentBreakdown = paymentBreakdownArr
    .map(([method, value]) => ({
      name: PAYMENT_LABELS[method] || method,
      value,
      percent: totalSales > 0 ? (value / totalSales) * 100 : 0,
      color: PAYMENT_COLORS[method] || '#94a3b8',
    }))
    .sort((a, b) => b.value - a.value)

  const medicineTotals = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const sale of sales) {
    for (const item of sale.items) {
      const med = item.batch.medicine
      const existing = medicineTotals.get(med.id) || { name: med.name, qty: 0, revenue: 0 }
      existing.qty += item.quantity
      existing.revenue += item.price * item.quantity
      medicineTotals.set(med.id, existing)
    }
  }

  const topMedicinesArr: any[] = []
  medicineTotals.forEach(m => topMedicinesArr.push(m))
  const topMedicines = topMedicinesArr
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  const recentTransactions = recentSales.map((sale) => ({
    id: `INV-${sale.id.slice(0, 8).toUpperCase()}`,
    customer: sale.customer?.name || 'Walk-in Customer',
    amount: sale.total,
    payment: PAYMENT_LABELS[sale.paymentMethod.toUpperCase()] || sale.paymentMethod,
    time: formatTime(sale.date),
  }))

  const expiring = expiringBatches.map((batch) => ({
    name: batch.medicine.name,
    batch: batch.batchNumber,
    days: daysUntil(batch.expiryDate),
  }))

  const purchaseRows = purchases.slice(0, 20).map((purchase) => ({
    id: purchase.id,
    date: purchase.date.toISOString(),
    supplier: purchase.supplier.name,
    total: purchase.total,
    status: purchase.status,
  }))

  return {
    kpis: {
      totalSales,
      totalPurchases,
      grossProfit,
      transactions,
      avgDailySales,
      salesTrend: calcTrend(totalSales, prevTotalSales),
      purchasesTrend: calcTrend(totalPurchases, prevTotalPurchases),
      profitTrend: calcTrend(grossProfit, prevGrossProfit),
      transactionsTrend: calcTrend(transactions, prevTransactions),
      avgDailyTrend: calcTrend(avgDailySales, prevAvgDaily),
      salesSparkline: salesOverview.map((d) => d.sales),
      purchasesSparkline: salesOverview.map((d) => d.purchases),
      profitSparkline: salesOverview.map((d) => d.profit),
      transactionsSparkline: salesOverview.map((d) => d.transactions),
      avgDailySparkline: salesOverview.map((d) => (d.sales > 0 ? d.sales : 0)),
    },
    salesOverview,
    paymentBreakdown,
    topMedicines,
    recentTransactions,
    expiringBatches: expiring,
    purchases: purchaseRows,
  }
}

ipcMain.handle('reports:getData', async (_, startDate: string, endDate: string) => {
  return buildReportsData(startDate, endDate)
})

ipcMain.handle('reports:exportExcel', async (_, startDate: string, endDate: string) => {
  const data = await buildReportsData(startDate, endDate)

  const workbook = new ExcelJS.Workbook()
  const summary = workbook.addWorksheet('Summary')
  summary.addRow(['SML Legacy Limited Cold Store Report'])
  summary.addRow(['Period', `${startDate} to ${endDate}`])
  summary.addRow([])
  summary.addRow(['Metric', 'Value'])
  summary.addRow(['Total Sales', data.kpis.totalSales])
  summary.addRow(['Total Purchases', data.kpis.totalPurchases])
  summary.addRow(['Gross Profit', data.kpis.grossProfit])
  summary.addRow(['Transactions', data.kpis.transactions])
  summary.addRow(['Avg Daily Sales', data.kpis.avgDailySales])

  const salesSheet = workbook.addWorksheet('Sales')
  salesSheet.addRow(['Date', 'Sales', 'Purchases', 'Profit', 'Transactions'])
  data.salesOverview.forEach((row) => {
    salesSheet.addRow([row.date, row.sales, row.purchases, row.profit, row.transactions])
  })

  const topSheet = workbook.addWorksheet('Top Medicines')
  topSheet.addRow(['Medicine', 'Quantity Sold', 'Revenue'])
  data.topMedicines.forEach((med) => {
    topSheet.addRow([med.name, med.qty, med.revenue])
  })

  const txnSheet = workbook.addWorksheet('Transactions')
  txnSheet.addRow(['Invoice', 'Customer', 'Amount', 'Payment', 'Time'])
  data.recentTransactions.forEach((txn) => {
    txnSheet.addRow([txn.id, txn.customer, txn.amount, txn.payment, txn.time])
  })

  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Report',
    defaultPath: `sml-coldstore-report-${startDate}-to-${endDate}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })

  if (!filePath) return { success: false }

  await workbook.xlsx.writeFile(filePath)
  return { success: true, path: filePath }
})

// ─── Users ────────────────────────────────────────────────────────────────────
ipcMain.handle('users:getAll', async () => {
  return prisma.user.findMany({
    select: { id: true, username: true, role: true, createdAt: true },
    orderBy: { username: 'asc' },
  })
})

ipcMain.handle('users:create', async (_, data: { username: string; passwordHash: string; role: string }) => {
  const password = await bcrypt.hash(data.passwordHash, 10)
  const newUser = await prisma.user.create({
    data: {
      username: data.username,
      password: password,
      role: data.role,
    }
  })
  await recordAudit({
    action: 'USER_CREATE',
    category: 'AUTH',
    details: `New staff user "${data.username}" created with role "${data.role}"`,
    severity: 'WARNING',
    metadata: { userId: newUser.id, username: data.username, role: data.role },
  })
  return newUser
})

// ─── Settings ─────────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', async () => {
  const rows = await prisma.setting.findMany()
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
})

ipcMain.handle('settings:set', async (_, updates: Record<string, string>) => {
  await Promise.all(
    Object.entries(updates).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  )
  await recordAudit({
    action: 'SETTINGS_UPDATE',
    category: 'SYSTEM',
    details: `Cold store system settings updated (${Object.keys(updates).join(', ')})`,
    severity: 'WARNING',
    metadata: { updatedKeys: Object.keys(updates) },
  })
  return { success: true }
})

// ─── Audit Trail (Important Activities Only) ──────────────────────────────────
ipcMain.handle('audit:getAll', async (_, filters?: { category?: string; severity?: string; startDate?: string; endDate?: string }) => {
  const where: any = {}
  if (filters?.category && filters.category !== 'all') {
    where.category = filters.category
  }
  if (filters?.severity && filters.severity !== 'all') {
    where.severity = filters.severity
  }
  if (filters?.startDate || filters?.endDate) {
    where.createdAt = {}
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate)
    if (filters.endDate) {
      const end = new Date(filters.endDate)
      end.setHours(23, 59, 59, 999)
      where.createdAt.lte = end
    }
  }
  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
})

ipcMain.handle('audit:log', async (_, data: { action: string; category: string; details: string; username?: string; userRole?: string; severity?: any; metadata?: any }) => {
  await recordAudit(data)
  return { success: true }
})

