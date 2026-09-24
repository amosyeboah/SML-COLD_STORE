export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER'

export interface User {
  id: string
  username: string
  role: UserRole | string
  createdAt: string
}

export interface Category {
  id: string
  name: string
}

export interface Batch {
  id: string
  medicineId: string
  batchNumber: string
  expiryDate: string
  quantity: number // In Cold Store: Carton, Box, or Unit count
  purchaseItemId?: string | null
}
export type StockLot = Batch
export type Lot = Batch

export interface Medicine {
  id: string
  name: string
  /** In Cold Store: Cut, Origin, Variety, or Brand (e.g. Brazilian Grade A, Dutch Cut, 10kg Carton) */
  genericName?: string | null
  sku: string
  categoryId: string
  category?: Category
  price: number // Price per carton / unit
  cost: number // Cost per carton / unit
  minStockLevel: number // Reorder threshold (cartons)
  batches?: Batch[]
}
export type Product = Medicine
export type ColdStoreProduct = Medicine

export interface Supplier {
  id: string
  name: string
  contact?: string | null
  email?: string | null
  address?: string | null
}

export interface Customer {
  id: string
  name: string
  phone?: string | null
}

export interface SaleItem {
  id: string
  saleId: string
  batchId: string
  quantity: number
  price: number
}

export interface SalePayment {
  id?: string
  saleId?: string
  method: string
  amount: number
}

export interface Sale {
  id: string
  customerId?: string | null
  date: string
  total: number
  paymentMethod: string
  payments?: SalePayment[]
  items?: SaleItem[]
}

export interface DashboardStats {
  todayRevenue: number
  totalMedicines: number
  lowStockCount: number
  todaySalesCount: number
}

export interface ReportsKPIs {
  totalSales: number
  totalPurchases: number
  grossProfit: number
  transactions: number
  avgDailySales: number
  salesTrend: number
  purchasesTrend: number
  profitTrend: number
  transactionsTrend: number
  avgDailyTrend: number
  salesSparkline: number[]
  purchasesSparkline: number[]
  profitSparkline: number[]
  transactionsSparkline: number[]
  avgDailySparkline: number[]
}

export interface ReportsData {
  kpis: ReportsKPIs
  salesOverview: { date: string; sales: number; purchases: number; profit: number; transactions: number }[]
  paymentBreakdown: { name: string; value: number; percent: number; color: string }[]
  topMedicines: { name: string; qty: number; revenue: number }[]
  recentTransactions: { id: string; customer: string; amount: number; payment: string; time: string }[]
  expiringBatches: { name: string; batch: string; days: number }[]
  purchases: { id: string; date: string; supplier: string; total: number; status: string }[]
}

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AuditLog {
  id: string
  action: string
  category: string
  details: string
  username: string
  userRole: string
  severity: AuditSeverity
  metadata?: string | null
  createdAt: string
}

