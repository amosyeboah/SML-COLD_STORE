import { prisma } from '../db/prisma'

export async function getDashboardStats() {
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
  last7DaysStart.setDate(last7DaysStart.getDate() - 6)

  const [
    todaySales,
    yesterdaySales,
    mtdSales,
    lastMonthSales,
    mtdPurchases,
    lastMonthPurchases,
    last7DaysSales,
    lowStockBatches,
    expiringBatchesAll,
  ] = await Promise.all([
    prisma.sale.findMany({ where: { date: { gte: today, lte: endOfDay } } }),
    prisma.sale.findMany({ where: { date: { gte: yesterday, lte: endOfYesterday } } }),
    prisma.sale.findMany({
      where: { date: { gte: startOfMonth, lte: endOfDay } },
      include: {
        items: { include: { batch: { include: { medicine: true } } } },
        customer: true,
        payments: true,
      },
    }),
    prisma.sale.findMany({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    prisma.purchase.findMany({ where: { date: { gte: startOfMonth, lte: endOfDay } } }),
    prisma.purchase.findMany({ where: { date: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    prisma.sale.findMany({ where: { date: { gte: last7DaysStart, lte: endOfDay } } }),
    prisma.batch.findMany({
      where: { quantity: { lte: 10, gt: 0 } },
      include: { medicine: true },
      orderBy: { quantity: 'asc' },
      take: 5,
    }),
    prisma.batch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) } },
      include: { medicine: true },
      orderBy: { expiryDate: 'asc' },
      take: 5,
    }),
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
  const salesOverviewData: { day: string; sales: number }[] = []
  salesByDay.forEach((sales, day) => salesOverviewData.push({ day, sales }))

  // Payment Breakdown
  let mtdCash = 0
  let mtdMobile = 0
  for (const sale of mtdSales) {
    if ((sale as any).payments && (sale as any).payments.length > 0) {
      for (const p of (sale as any).payments) {
        const method = (p.method || 'CASH').toUpperCase()
        if (method.includes('MOBILE') || method.includes('MOMO')) {
          mtdMobile += Number(p.amount) || 0
        } else {
          mtdCash += Number(p.amount) || 0
        }
      }
    } else {
      const pm = (sale.paymentMethod || 'CASH').toUpperCase()
      const tot = Number(sale.total) || 0
      if (pm.startsWith('SPLIT:')) {
        const cashMatch = pm.match(/CASH[=:]\s*([0-9.]+)/i)
        const mobileMatch = pm.match(/MOBILE[=:]\s*([0-9.]+)/i)
        const c = cashMatch ? parseFloat(cashMatch[1]) : 0
        const m = mobileMatch ? parseFloat(mobileMatch[1]) : 0
        if (c > 0 || m > 0) {
          mtdCash += c
          mtdMobile += m
        } else {
          mtdCash += tot / 2
          mtdMobile += tot / 2
        }
      } else if (pm === 'SPLIT') {
        mtdCash += tot / 2
        mtdMobile += tot / 2
      } else if (pm.includes('MOBILE') || pm.includes('MOMO')) {
        mtdMobile += tot
      } else {
        mtdCash += tot
      }
    }
  }

  const paymentData: any[] = [
    {
      name: 'Cash',
      value: mtdCash,
      percent: mtdRevenue > 0 ? Math.round((mtdCash / mtdRevenue) * 100) : 0,
      color: '#22c55e',
    },
    {
      name: 'Mobile Money',
      value: mtdMobile,
      percent: mtdRevenue > 0 ? Math.round((mtdMobile / mtdRevenue) * 100) : 0,
      color: '#f59e0b',
    },
  ]

  // Top Products
  const medicineTotals = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const sale of mtdSales) {
    for (const item of sale.items) {
      if (!item.batch?.medicine) continue
      const med = item.batch.medicine
      const existing = medicineTotals.get(med.id) || { name: med.name, qty: 0, revenue: 0 }
      existing.qty += item.quantity
      existing.revenue += item.quantity * item.price
      medicineTotals.set(med.id, existing)
    }
  }
  const topMedicines = Array.from(medicineTotals.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)

  // Low stock and expiring
  const lowStock = lowStockBatches.map((b) => ({
    name: b.medicine.name,
    batch: b.batchNumber,
    stock: b.quantity,
  }))

  const daysUntil = (d: Date) => Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  const expiring = expiringBatchesAll.map((b) => ({
    name: b.medicine.name,
    batch: b.batchNumber,
    days: daysUntil(b.expiryDate),
  }))

  // Recent Sales
  const recentSales = mtdSales.slice(0, 5).map((s) => ({
    id: `INV-${s.id.slice(0, 8).toUpperCase()}`,
    time: s.date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    total: s.total,
    items: s.items.length,
    paymentMethod: s.paymentMethod,
    customer: s.customer?.name || 'Walk-in Customer',
  }))

  return {
    kpis: {
      todayRevenue,
      todayRevenueTrend,
      mtdRevenue,
      mtdRevenueTrend,
      todayTransactions,
      todayTransactionsTrend,
      mtdGrossProfit,
      mtdGrossProfitTrend,
    },
    salesOverview: salesOverviewData,
    paymentData,
    topMedicines,
    lowStock,
    expiring,
    recentSales,
  }
}

export async function getReportsData(startDate: string, endDate: string) {
  const start = new Date(startDate)
  start.setHours(0, 0, 0, 0)
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999)

  const diffMs = end.getTime() - start.getTime()
  const prevStart = new Date(start.getTime() - diffMs)
  const prevEnd = new Date(start.getTime() - 1)

  const [sales, prevSales, purchases, prevPurchases, expiringBatches] = await Promise.all([
    prisma.sale.findMany({
      where: { date: { gte: start, lte: end } },
      include: { items: { include: { batch: { include: { medicine: true } } } }, customer: true, payments: true },
      orderBy: { date: 'asc' },
    }),
    prisma.sale.findMany({ where: { date: { gte: prevStart, lte: prevEnd } } }),
    prisma.purchase.findMany({
      where: { date: { gte: start, lte: end } },
      include: { supplier: true, items: true },
      orderBy: { date: 'asc' },
    }),
    prisma.purchase.findMany({ where: { date: { gte: prevStart, lte: prevEnd } } }),
    prisma.batch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } },
      include: { medicine: true },
      orderBy: { expiryDate: 'asc' },
      take: 10,
    }),
  ])

  const sum = (arr: any[], field = 'total') => arr.reduce((acc, x) => acc + (x[field] || 0), 0)
  const totalSales = sum(sales)
  const prevTotalSales = sum(prevSales)
  const totalPurchases = sum(purchases)
  const prevTotalPurchases = sum(prevPurchases)
  const grossProfit = totalSales - totalPurchases
  const prevGrossProfit = prevTotalSales - prevTotalPurchases
  const transactions = sales.length
  const prevTransactions = prevSales.length
  const daysDiff = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1)
  const avgDailySales = totalSales / daysDiff
  const prevAvgDaily = prevTotalSales / daysDiff

  const calcTrend = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? '+100%' : '0%'
    const v = ((cur - prev) / prev) * 100
    return v > 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`
  }

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
    },
    salesOverview: [],
    expiringBatches,
    recentSales: sales.slice(-20),
    purchases: purchases.slice(-20),
  }
}
