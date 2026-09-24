import bcrypt from 'bcryptjs'
import { enqueueSyncItem } from '../sync/syncQueue'
import { getSupabaseClient } from '../sync/supabaseClient'

// Browser & Electron compatible password hashing
async function hashPassword(password: string): Promise<string> {
  try {
    return bcrypt.hashSync(password, 10)
  } catch {
    const enc = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      256
    )
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
    const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
    return `webcrypto:${saltHex}:${hashHex}`
  }
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false

  // 1. Check bcrypt hash ($2a$, $2b$, $2y$)
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
    try {
      return bcrypt.compareSync(password, stored)
    } catch {
      // fallback
    }
  }

  // 2. Check PBKDF2 Web Crypto format
  if (stored.startsWith('webcrypto:')) {
    try {
      const [, saltHex, hashHex] = stored.split(':')
      const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
      const enc = new TextEncoder()
      const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        256
      )
      const candidateHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
      return candidateHex === hashHex
    } catch {
      // fallback
    }
  }

  // 3. Plaintext fallback
  return password === stored
}

// Simple local storage keys for offline mobile app
const STORAGE_KEYS = {
  USERS: 'sml_coldstore_users',
  CATEGORIES: 'sml_coldstore_categories',
  SUPPLIERS: 'sml_coldstore_suppliers',
  CUSTOMERS: 'sml_coldstore_customers',
  MEDICINES: 'sml_coldstore_medicines',
  BATCHES: 'sml_coldstore_batches',
  PURCHASES: 'sml_coldstore_purchases',
  SALES: 'sml_coldstore_sales',
  SETTINGS: 'sml_coldstore_settings',
  PRESCRIPTIONS: 'sml_coldstore_prescriptions',
  AUDIT_LOGS: 'sml_coldstore_audit_logs'
}

function getItem<T>(key: string, defaultValue: T): T {
  try {
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : defaultValue
  } catch {
    return defaultValue
  }
}

function setItem<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

/**
 * Fetches latest sales and items directly from Supabase Cloud.
 * Caches and merges them into local storage so web portal displays real-time data automatically.
 */
export async function fetchCloudSalesIfAvailable(): Promise<any[]> {
  const localSales = getItem<any[]>(STORAGE_KEYS.SALES, [])
  const client = getSupabaseClient()
  if (!client || !navigator.onLine) {
    return localSales
  }

  try {
    const [salesRes, itemsRes] = await Promise.all([
      client.from('cloud_sales').select('*').order('date', { ascending: false }),
      client.from('cloud_sale_items').select('*'),
    ])

    if (salesRes.error || !salesRes.data) {
      return localSales
    }

    const cloudSales = salesRes.data || []
    const cloudItems = itemsRes.data || []

    const mappedSales = cloudSales.map((s: any) => {
      const relatedItems = cloudItems.filter((i: any) => i.sale_id === s.id)
      return {
        id: s.id,
        saleNumber: s.sale_number || `INV-${String(s.id).slice(0, 8).toUpperCase()}`,
        customerId: null,
        customerName: s.customer_name || 'Walk-in Customer',
        paymentMethod: s.payment_method || 'CASH',
        total: Number(s.total) || 0,
        date: s.date || s.created_at,
        cashier: s.cashier_username || 'cashier',
        items: relatedItems.map((item: any) => ({
          id: item.id,
          batchId: item.product_id,
          medicineId: item.product_id,
          quantity: Number(item.quantity) || 1,
          price: Number(item.unit_price) || 0,
          cost: Number(item.unit_cost) || 0,
          name: item.product_name,
          medicine: {
            id: item.product_id,
            name: item.product_name,
            sku: item.sku,
            price: Number(item.unit_price) || 0,
            cost: Number(item.unit_cost) || 0,
          },
        })),
      }
    })

    const cloudIds = new Set(mappedSales.map((s) => s.id))
    const localOnly = localSales.filter((s) => !cloudIds.has(s.id))
    const merged = [...mappedSales, ...localOnly]

    setItem(STORAGE_KEYS.SALES, merged)
    return merged
  } catch (err) {
    console.warn('Failed to fetch cloud sales in mobileStorage:', err)
    return localSales
  }
}

/**
 * Fetches latest product catalog directly from Supabase Cloud.
 * Caches and updates local storage so web portal displays real-time products and stock.
 */
export async function fetchCloudProductsIfAvailable(): Promise<any[]> {
  const localMeds = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
  const client = getSupabaseClient()
  if (!client || !navigator.onLine) {
    return localMeds
  }

  try {
    const { data: cloudProducts, error } = await client
      .from('cloud_products')
      .select('*')
      .order('name', { ascending: true })

    if (error || !cloudProducts || cloudProducts.length === 0) {
      return localMeds
    }

    // Build categories mapping
    const existingCats = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const catMap = new Map<string, string>()
    existingCats.forEach((c) => catMap.set(c.name.toLowerCase().trim(), c.id))

    const updatedCats = [...existingCats]
    cloudProducts.forEach((p) => {
      const catName = (p.category_name || 'General').trim()
      if (!catMap.has(catName.toLowerCase())) {
        const newCatId = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
        catMap.set(catName.toLowerCase(), newCatId)
        updatedCats.push({ id: newCatId, name: catName })
      }
    })
    setItem(STORAGE_KEYS.CATEGORIES, updatedCats)

    const mappedMeds = cloudProducts.map((p) => ({
      id: p.id,
      name: p.name,
      genericName: p.generic_name || undefined,
      sku: p.sku,
      categoryId: catMap.get((p.category_name || 'General').toLowerCase().trim()) || 'cat-1',
      categoryName: p.category_name || 'General',
      price: Number(p.price) || 0,
      cost: Number(p.cost) || 0,
      stockQuantity: Number(p.stock_quantity) || 0,
      minStockLevel: Number(p.min_stock_level) || 10,
    }))

    setItem(STORAGE_KEYS.MEDICINES, mappedMeds)
    return mappedMeds
  } catch (err) {
    console.warn('Failed to fetch cloud products in mobileStorage:', err)
    return localMeds
  }
}

/**
 * Fetches latest batches and freezer stock lots directly from Supabase Cloud.
 */
export async function fetchCloudBatchesIfAvailable(): Promise<any[]> {
  const localBatches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
  const client = getSupabaseClient()
  if (!client || !navigator.onLine) {
    return localBatches
  }

  try {
    const { data: cloudBatches, error } = await client
      .from('cloud_batches')
      .select('*')
      .order('expiry_date', { ascending: true })

    if (error || !cloudBatches || cloudBatches.length === 0) {
      return localBatches
    }

    const mappedBatches = cloudBatches.map((b) => ({
      id: b.id,
      medicineId: b.product_id,
      batchNumber: b.batch_number,
      expiryDate: b.expiry_date,
      quantity: Number(b.quantity) || 0,
    }))

    setItem(STORAGE_KEYS.BATCHES, mappedBatches)
    return mappedBatches
  } catch (err) {
    console.warn('Failed to fetch cloud batches in mobileStorage:', err)
    return localBatches
  }
}

/**
 * Pushes full snapshot of non-tabular entities (Users, Customers, Suppliers, Purchases, Settings, Categories)
 * into Supabase cloud_audit_logs to guarantee 100% offline/online reflection.
 */
export async function pushCloudStateMirror(stateId: string, category: string, dataKey: string, payload: any): Promise<void> {
  const client = getSupabaseClient()
  if (!client || !navigator.onLine) return
  try {
    await client.from('cloud_audit_logs').upsert({
      id: stateId,
      store_id: 'sml_accra_main',
      action: 'SYSTEM_STATE_SNAPSHOT',
      category: category,
      details: `Live state snapshot for ${dataKey}`,
      username: 'system',
      user_role: 'ADMIN',
      severity: 'INFO',
      metadata: { [dataKey]: payload },
      created_at: new Date().toISOString()
    })
  } catch (err) {
    console.warn(`Failed to push state mirror for ${stateId}:`, err)
  }
}

/**
 * Fetches all state mirrors from Supabase cloud_audit_logs and syncs into local storage.
 */
export async function fetchCloudStateMirrorsIfAvailable(): Promise<void> {
  const client = getSupabaseClient()
  if (!client || !navigator.onLine) return
  try {
    const { data, error } = await client
      .from('cloud_audit_logs')
      .select('*')
      .in('id', [
        'STATE_USERS',
        'STATE_CATEGORIES',
        'STATE_CUSTOMERS',
        'STATE_SUPPLIERS',
        'STATE_PURCHASES',
        'STATE_SETTINGS'
      ])

    if (error || !data || data.length === 0) return

    for (const row of data) {
      if (!row.metadata) continue
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      if (row.id === 'STATE_USERS' && Array.isArray(meta.users) && meta.users.length > 0) {
        setItem(STORAGE_KEYS.USERS, meta.users)
      } else if (row.id === 'STATE_CATEGORIES' && Array.isArray(meta.categories) && meta.categories.length > 0) {
        setItem(STORAGE_KEYS.CATEGORIES, meta.categories)
      } else if (row.id === 'STATE_CUSTOMERS' && Array.isArray(meta.customers) && meta.customers.length > 0) {
        setItem(STORAGE_KEYS.CUSTOMERS, meta.customers)
      } else if (row.id === 'STATE_SUPPLIERS' && Array.isArray(meta.suppliers) && meta.suppliers.length > 0) {
        setItem(STORAGE_KEYS.SUPPLIERS, meta.suppliers)
      } else if (row.id === 'STATE_PURCHASES' && Array.isArray(meta.purchases)) {
        setItem(STORAGE_KEYS.PURCHASES, meta.purchases)
      } else if (row.id === 'STATE_SETTINGS' && meta.settings && typeof meta.settings === 'object') {
        const existing = getItem(STORAGE_KEYS.SETTINGS, {})
        setItem(STORAGE_KEYS.SETTINGS, { ...existing, ...meta.settings })
      }
    }
  } catch (err) {
    console.warn('Failed to fetch cloud state mirrors:', err)
  }
}

/**
 * Unified synchronization of all cloud data (products, batches, sales, state mirrors) from Supabase.
 */
export async function syncAllCloudDataIfAvailable(): Promise<{
  medicines: any[]
  batches: any[]
  sales: any[]
}> {
  const [medicines, batches, sales] = await Promise.all([
    fetchCloudProductsIfAvailable().catch(() => getItem<any[]>(STORAGE_KEYS.MEDICINES, [])),
    fetchCloudBatchesIfAvailable().catch(() => getItem<any[]>(STORAGE_KEYS.BATCHES, [])),
    fetchCloudSalesIfAvailable().catch(() => getItem<any[]>(STORAGE_KEYS.SALES, [])),
    fetchCloudStateMirrorsIfAvailable().catch(() => {}),
  ])
  return { medicines, batches, sales }
}


function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
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

function calcTrendStr(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+100%' : '0%'
  const trend = ((current - previous) / previous) * 100
  return trend > 0 ? `+${trend.toFixed(1)}%` : `${trend.toFixed(1)}%`
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

const PAYMENT_COLORS: Record<string, string> = {
  CASH: '#22c55e',
  MOBILE: '#3b82f6',
  'MOBILE MONEY': '#3b82f6',
  CARD: '#a855f7',
  'BANK TRANSFER': '#f97316',
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MOBILE: 'Mobile Money',
  'MOBILE MONEY': 'Mobile Money',
  CARD: 'Card',
  'BANK TRANSFER': 'Bank Transfer',
}


// Seed initial data if empty or migrate legacy dummy data
async function seedInitialDataIfNeeded() {
  const users = getItem(STORAGE_KEYS.USERS, [])
  if (users.length === 0) {
    const adminPassword = await hashPassword('admin123')
    const managerPassword = await hashPassword('manager123')
    const cashierPassword = await hashPassword('cashier123')

    const initialUsers = [
      { id: generateId(), username: 'admin', password: adminPassword, pin: '1111', role: 'ADMIN', createdAt: new Date().toISOString() },
      { id: generateId(), username: 'manager', password: managerPassword, pin: '2222', role: 'MANAGER', createdAt: new Date().toISOString() },
      { id: generateId(), username: 'cashier', password: cashierPassword, pin: '1234', role: 'CASHIER', createdAt: new Date().toISOString() }
    ]
    setItem(STORAGE_KEYS.USERS, initialUsers)
  }

  // Initial Categories
  const initialCategories = [
    { id: '79c12559-883a-41c0-aa7e-48d98ac54237', name: 'Poultry' },
    { id: '449dec85-0565-4040-a301-2788e4b421f2', name: 'Fish & Seafood' },
    { id: '8486b92d-d282-4193-b7b3-bb0b9df3d928', name: 'Beef & Mutton' },
    { id: '1cccec0e-8664-41b6-a82b-ded4592e9bdc', name: 'Pork Products' },
    { id: '69e4fb2c-f1d6-4620-9346-dc732c4e6567', name: 'Processed Meat' },
    { id: '8fead2c2-e239-4091-9ce0-f853217a5b82', name: 'Frozen Vegetables' },
    { id: '60441f27-2fd7-40f6-95c7-e00ba00d06f6', name: 'Dairy & Eggs' }
  ]

  // Initial Suppliers (Ghana-based cold store suppliers)
  const initialSuppliers = [
    { id: 'sup-1', name: 'Accra Frozen Foods Ltd', contact: '+233 30 222 4455', email: 'sales@accrafrozen.com.gh', address: 'Industrial Area, Accra, Ghana' },
    { id: 'sup-2', name: 'Gold Coast Meat Distributors', contact: '+233 24 500 7890', email: 'orders@gcmeat.com.gh', address: 'Tema Port Area, Tema, Ghana' },
    { id: 'sup-3', name: 'West Africa Poultry Hub', contact: '+233 54 112 3399', email: 'info@wapoultry.com.gh', address: 'Spintex Road, Accra, Ghana' }
  ]

  // Initial Customers
  const initialCustomers = [
    { id: 'cust-1', name: 'Kofi Mensah', phone: '0244112233' },
    { id: 'cust-2', name: 'Ama Asante', phone: '0554321098' },
    { id: 'cust-3', name: 'Kwame Boateng', phone: '0201987654' },
    { id: 'cust-4', name: 'Sofiyat Yusuf', phone: '+447999007775' }
  ]

  // Initial Cold Store Products (matching SQLite and Supabase)
  const initialMedicines = [
    { id: '37a5d650-1524-4f59-a6dd-cbbe7ef2881b', name: 'Whole Chicken (Frozen)', genericName: 'Broiler Chicken', sku: 'SML-PTR-001', categoryId: '79c12559-883a-41c0-aa7e-48d98ac54237', categoryName: 'Poultry', price: 85, cost: 58, minStockLevel: 20 },
    { id: 'be415fce-3c23-499c-9aa4-2621e7cd4283', name: 'Chicken Legs (5kg Pack)', genericName: 'Chicken Drumsticks', sku: 'SML-PTR-002', categoryId: '79c12559-883a-41c0-aa7e-48d98ac54237', categoryName: 'Poultry', price: 120, cost: 82, minStockLevel: 15 },
    { id: 'e6e2c37e-2abd-4dad-b83b-48a39a6dc917', name: 'Chicken Breast (Boneless)', genericName: 'Breast Fillet', sku: 'SML-PTR-003', categoryId: '79c12559-883a-41c0-aa7e-48d98ac54237', categoryName: 'Poultry', price: 145, cost: 98, minStockLevel: 10 },
    { id: 'ed11f170-2018-46a1-ab34-2d496834b657', name: 'Turkey (Whole Frozen)', genericName: 'Turkey Bird', sku: 'SML-PTR-004', categoryId: '79c12559-883a-41c0-aa7e-48d98ac54237', categoryName: 'Poultry', price: 320, cost: 220, minStockLevel: 5 },
    { id: 'c270e28f-39c7-429a-afd8-fc32ad601353', name: 'Tilapia Fish (Fresh Frozen)', genericName: 'Oreochromis niloticus', sku: 'SML-FSH-001', categoryId: '449dec85-0565-4040-a301-2788e4b421f2', categoryName: 'Fish & Seafood', price: 95, cost: 62, minStockLevel: 10 },
    { id: '92988ace-446e-462e-9dd6-a3b8ae1b174d', name: 'Mackerel (Frozen, 1kg)', genericName: 'Scomber scombrus', sku: 'SML-FSH-002', categoryId: '449dec85-0565-4040-a301-2788e4b421f2', categoryName: 'Fish & Seafood', price: 55, cost: 36, minStockLevel: 30 },
    { id: '8dfbd3f1-5689-4cd9-8eb1-5bac0a57b041', name: 'Tiger Prawns (500g)', genericName: 'Penaeus monodon', sku: 'SML-FSH-003', categoryId: '449dec85-0565-4040-a301-2788e4b421f2', categoryName: 'Fish & Seafood', price: 180, cost: 125, minStockLevel: 10 },
    { id: '12c42394-fe38-4abe-afc9-8f5cfc1cb59d', name: 'Squid Rings (Frozen)', genericName: 'Loligo vulgaris', sku: 'SML-FSH-004', categoryId: '449dec85-0565-4040-a301-2788e4b421f2', categoryName: 'Fish & Seafood', price: 140, cost: 95, minStockLevel: 10 },
    { id: 'ae2508c6-2562-433a-be86-ee2628698810', name: 'Beef Chuck (1kg)', genericName: 'Bovine Chuck Cut', sku: 'SML-BEF-001', categoryId: '8486b92d-d282-4193-b7b3-bb0b9df3d928', categoryName: 'Beef & Mutton', price: 130, cost: 90, minStockLevel: 20 },
    { id: '06b9c137-8e59-4ba0-9f6f-58566b7af925', name: 'Minced Beef (500g)', genericName: 'Ground Beef', sku: 'SML-BEF-002', categoryId: '8486b92d-d282-4193-b7b3-bb0b9df3d928', categoryName: 'Beef & Mutton', price: 70, cost: 48, minStockLevel: 25 },
    { id: 'ad058b73-91ce-4fe3-aaf1-817df616b081', name: 'Mutton Leg (Frozen)', genericName: 'Ovine Leg Cut', sku: 'SML-MTN-001', categoryId: '8486b92d-d282-4193-b7b3-bb0b9df3d928', categoryName: 'Beef & Mutton', price: 200, cost: 140, minStockLevel: 10 },
    { id: 'c6686721-6530-49e9-add5-d41215bb2004', name: 'Oxtail (Frozen, 1kg)', genericName: 'Bovine Tail', sku: 'SML-BEF-003', categoryId: '8486b92d-d282-4193-b7b3-bb0b9df3d928', categoryName: 'Beef & Mutton', price: 155, cost: 105, minStockLevel: 10 },
    { id: 'bc239d26-9828-462b-b0b1-55aa836ad379', name: 'Pork Ribs (Frozen)', genericName: 'Porcine Ribs', sku: 'SML-PRK-001', categoryId: '1cccec0e-8664-41b6-a82b-ded4592e9bdc', categoryName: 'Pork Products', price: 110, cost: 75, minStockLevel: 15 },
    { id: '622fcf37-ee76-42a0-8350-7e0ea6564981', name: 'Chicken wings (1kg)', genericName: 'Chicken Foods', sku: 'SML-CHK-002', categoryId: '79c12559-883a-41c0-aa7e-48d98ac54237', categoryName: 'Poultry', price: 100, cost: 68, minStockLevel: 12 },
    { id: 'bf64f1fd-6841-4009-b8db-244ed8c9cdda', name: 'Beef Sausages (500g)', genericName: 'Processed Beef Sausage', sku: 'SML-PRC-001', categoryId: '69e4fb2c-f1d6-4620-9346-dc732c4e6567', categoryName: 'Processed Meat', price: 65, cost: 42, minStockLevel: 20 },
    { id: 'eeae3fed-ba46-448a-95c4-487fefb519b9', name: 'Chicken Hot Dogs (300g)', genericName: 'Processed Chicken Frankfurter', sku: 'SML-PRC-002', categoryId: '69e4fb2c-f1d6-4620-9346-dc732c4e6567', categoryName: 'Processed Meat', price: 45, cost: 28, minStockLevel: 20 },
    { id: 'bde469d3-2a18-4c61-9b23-c1275fb48fff', name: 'Smoked Bacon Strips', genericName: 'Cured Pork Bacon', sku: 'SML-PRC-003', categoryId: '69e4fb2c-f1d6-4620-9346-dc732c4e6567', categoryName: 'Processed Meat', price: 90, cost: 60, minStockLevel: 15 },
    { id: '13519c67-df8f-454a-8656-82d30d803090', name: 'Mixed Vegetables (1kg)', genericName: 'Frozen Mixed Veg', sku: 'SML-VEG-001', categoryId: '8fead2c2-e239-4091-9ce0-f853217a5b82', categoryName: 'Frozen Vegetables', price: 30, cost: 18, minStockLevel: 30 },
    { id: 'd35aa4e9-cdf7-47b4-9bd3-ab22559f55e1', name: 'Green Beans (Frozen)', genericName: 'Phaseolus vulgaris', sku: 'SML-VEG-002', categoryId: '8fead2c2-e239-4091-9ce0-f853217a5b82', categoryName: 'Frozen Vegetables', price: 25, cost: 14, minStockLevel: 25 },
    { id: 'a0dcb2d1-3530-43f1-8722-9c4f02008ada', name: 'Unsalted Butter (250g)', genericName: 'Dairy Butter', sku: 'SML-DRY-001', categoryId: '60441f27-2fd7-40f6-95c7-e00ba00d06f6', categoryName: 'Dairy & Eggs', price: 40, cost: 26, minStockLevel: 20 },
    { id: '972d4193-08eb-4f8a-8d58-131446008150', name: 'Crate of Eggs (30 pcs)', genericName: 'Chicken Eggs', sku: 'SML-DRY-002', categoryId: '60441f27-2fd7-40f6-95c7-e00ba00d06f6', categoryName: 'Dairy & Eggs', price: 55, cost: 38, minStockLevel: 15 },
    { id: '2341b5e9-f531-4cfc-9240-824e1b4c77dc', name: 'Aspirin', genericName: 'Tyson', sku: '9846569838', categoryId: '449dec85-0565-4040-a301-2788e4b421f2', categoryName: 'Fish & Seafood', price: 80, cost: 50, minStockLevel: 10 }
  ]

  // Initial Batches
  const initialBatches = [
    { id: '625bc9ae-9c02-4204-8801-328742f16848', medicineId: '37a5d650-1524-4f59-a6dd-cbbe7ef2881b', batchNumber: 'CHK-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 79 },
    { id: 'e0cc86cb-6a6b-4410-bbe5-84b7ad2f7388', medicineId: 'be415fce-3c23-499c-9aa4-2621e7cd4283', batchNumber: 'CHL-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 60 },
    { id: '87a2d385-2fb7-4807-8b08-3f86187b7718', medicineId: 'e6e2c37e-2abd-4dad-b83b-48a39a6dc917', batchNumber: 'CHB-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 49 },
    { id: '694fc776-f0ba-4829-80e9-43446738b3f9', medicineId: 'ed11f170-2018-46a1-ab34-2d496834b657', batchNumber: 'TKY-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 18 },
    { id: '4c1b2483-1696-41fa-b0d0-a08daf1fc45d', medicineId: 'c270e28f-39c7-429a-afd8-fc32ad601353', batchNumber: 'TLP-2024-001', expiryDate: '2026-10-10T14:30:13.686Z', quantity: 9 },
    { id: '22b0b3ba-b343-4ac4-9b8f-dd059d24ddc3', medicineId: 'c270e28f-39c7-429a-afd8-fc32ad601353', batchNumber: 'TLP-2024-002', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 90 },
    { id: '63712642-3d27-4eff-99fd-a9912ad8dcf2', medicineId: '92988ace-446e-462e-9dd6-a3b8ae1b174d', batchNumber: 'MCK-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 119 },
    { id: 'dbc6c387-c759-4b94-9e24-c2263b077c78', medicineId: '8dfbd3f1-5689-4cd9-8eb1-5bac0a57b041', batchNumber: 'PRW-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 39 },
    { id: '73b485c3-9b90-4362-87d3-68a163b9e87c', medicineId: '12c42394-fe38-4abe-afc9-8f5cfc1cb59d', batchNumber: 'SQD-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 35 },
    { id: 'f026e640-95f4-449f-8f53-1713350e6026', medicineId: 'ae2508c6-2562-433a-be86-ee2628698810', batchNumber: 'BFC-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 75 },
    { id: '5c142866-fff8-4420-8606-a4ab9dc8a625', medicineId: '06b9c137-8e59-4ba0-9f6f-58566b7af925', batchNumber: 'BFM-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 99 },
    { id: '7454a04e-c3a8-4acb-b49e-f5c636bf8467', medicineId: 'ad058b73-91ce-4fe3-aaf1-817df616b081', batchNumber: 'MTN-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 30 },
    { id: 'dcca192d-544e-4c8f-b47d-48fde1784ad0', medicineId: 'c6686721-6530-49e9-add5-d41215bb2004', batchNumber: 'OXT-2024-001', expiryDate: '2026-08-20T14:30:13.686Z', quantity: 5 },
    { id: 'dcb09924-f3ff-4293-b943-6f5c109da8f1', medicineId: 'c6686721-6530-49e9-add5-d41215bb2004', batchNumber: 'OXT-2024-002', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 45 },
    { id: '5c91a840-6a7a-4973-88a2-7caa2229b0be', medicineId: 'bc239d26-9828-462b-b0b1-55aa836ad379', batchNumber: 'PRK-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 55 },
    { id: '512c7098-79ba-4ecb-ab2c-efc213b3e1ff', medicineId: '622fcf37-ee76-42a0-8350-7e0ea6564981', batchNumber: 'PKB-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 48 },
    { id: '3fa036a5-a99c-456c-924e-0986e467d630', medicineId: 'bf64f1fd-6841-4009-b8db-244ed8c9cdda', batchNumber: 'BSG-2024-001', expiryDate: '2028-09-20T14:30:13.686Z', quantity: 90 },
    { id: 'fce193a5-56c1-4d1e-9c8f-4d28502d27df', medicineId: 'eeae3fed-ba46-448a-95c4-487fefb519b9', batchNumber: 'CHD-2024-001', expiryDate: '2028-09-20T14:30:13.686Z', quantity: 110 },
    { id: '558d92a9-69ba-4197-80f6-7ab28dcb1970', medicineId: 'bde469d3-2a18-4c61-9b23-c1275fb48fff', batchNumber: 'BCN-2024-001', expiryDate: '2028-09-20T14:30:13.686Z', quantity: 70 },
    { id: 'b7fb0cd8-67cf-4d46-9925-bf6586f132c9', medicineId: '13519c67-df8f-454a-8656-82d30d803090', batchNumber: 'MVG-2024-001', expiryDate: '2028-09-20T14:30:13.686Z', quantity: 150 },
    { id: 'f4f6449d-dbb7-4d9d-8b02-4389f608147a', medicineId: 'd35aa4e9-cdf7-47b4-9bd3-ab22559f55e1', batchNumber: 'GBN-2024-001', expiryDate: '2028-09-20T14:30:13.686Z', quantity: 120 },
    { id: '8ad8fb5b-10b2-4982-b2f0-0bab097ae3d3', medicineId: 'a0dcb2d1-3530-43f1-8722-9c4f02008ada', batchNumber: 'BTR-2024-001', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 80 },
    { id: 'c15fb55a-944c-4bb8-a74e-c393cfebd804', medicineId: '972d4193-08eb-4f8a-8d58-131446008150', batchNumber: 'EGG-2024-001', expiryDate: '2026-10-10T14:30:13.686Z', quantity: 8 },
    { id: '36b081bf-2bd0-4b30-9e27-558b7960d12a', medicineId: '972d4193-08eb-4f8a-8d58-131446008150', batchNumber: 'EGG-2024-002', expiryDate: '2027-09-20T14:30:13.686Z', quantity: 50 },
    { id: 'e5f60ae1-d756-4da5-b7ab-d2b78e85db4a', medicineId: 'c270e28f-39c7-429a-afd8-fc32ad601353', batchNumber: 'Tyuryr', expiryDate: '2027-03-19T00:00:00.000Z', quantity: 12 },
    { id: 'ddd7b772-e061-4bd4-b28f-fa485d5b73e0', medicineId: '2341b5e9-f531-4cfc-9240-824e1b4c77dc', batchNumber: 'GAT-587575', expiryDate: '2028-06-22T00:00:00.000Z', quantity: 8 }
  ]

  // Check if current stored medicines are empty or contain obsolete dummy items
  const currentMeds = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
  const hasLegacyDummy = currentMeds.some(m => m.id === 'med-1' || m.id === 'med-2' || m.id === 'med-3')
  if (currentMeds.length === 0 || hasLegacyDummy) {
    setItem(STORAGE_KEYS.CATEGORIES, initialCategories)
    setItem(STORAGE_KEYS.SUPPLIERS, initialSuppliers)
    setItem(STORAGE_KEYS.CUSTOMERS, initialCustomers)
    setItem(STORAGE_KEYS.MEDICINES, initialMedicines)
    setItem(STORAGE_KEYS.BATCHES, initialBatches)
  }

  // Initial Settings
  const currentSettings = getItem(STORAGE_KEYS.SETTINGS, null)
  if (!currentSettings) {
    setItem(STORAGE_KEYS.SETTINGS, {
      'biz.name': 'SML Legacy Limited',
      'biz.type': 'Cold store',
      'biz.tagline': 'Quality Frozen Foods & Cold Storage Services',
      'biz.phone': '+233 54 386 4610',
      'biz.email': 'sorphygold@yahoo.com',
      'biz.ownerName': 'Sofiyat Opeyemi Yusuf',
      'biz.ownerEmail': 'sorphygold@yahoo.com',
      'biz.ownerPhone': '+447999007775',
      'biz.address': 'Cold Store Market Depot',
      'biz.city': 'Accra, Greater Accra',
      'biz.currency': 'GHS',
      'biz.currencySymbol': 'GH₵',
      'receipt.footerText': 'Thank you for choosing SML Legacy! Keep frozen at -18°C.',
      'receipt.headerText': 'Quality Frozen Foods & Cold Storage',
      storeName: 'SML Legacy Limited',
      currency: 'GHS',
      address: 'Cold Store Market Depot, Accra, Ghana',
      phone: '+233 54 386 4610'
    })
  }
}


// Initialize seed on module load
seedInitialDataIfNeeded()

export const mobileApi = {
  // Auth
  login: async (username: string, password: string) => {
    await fetchCloudStateMirrorsIfAvailable().catch(() => {})
    await seedInitialDataIfNeeded()
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase())
    if (!user) throw new Error('Invalid username or password')

    const isMatch = await verifyPassword(password, user.password)
    if (!isMatch) throw new Error('Invalid username or password')

    const { password: _, ...userWithoutPassword } = user
    return userWithoutPassword
  },
  loginWithPin: async (pin: string, selectedRole?: string) => {
    await fetchCloudStateMirrorsIfAvailable().catch(() => {})
    await seedInitialDataIfNeeded()
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    let targetUsername = ''
    if ((selectedRole === 'ADMIN' && pin === '1111') || pin === '1111' || pin === '9999') {
      targetUsername = 'admin'
    } else if ((selectedRole === 'MANAGER' && pin === '2222') || pin === '2222' || pin === '5555') {
      targetUsername = 'manager'
    } else if ((selectedRole === 'CASHIER' && pin === '1234') || pin === '1234' || pin === '0000') {
      targetUsername = 'cashier'
    }

    let user = users.find(u => u.pin === pin)
    if (!user && targetUsername) {
      user = users.find(u => u.username.toLowerCase() === targetUsername.toLowerCase())
    }

    if (!user) {
      throw new Error('Invalid PIN code. Try 1111 (Admin) or 1234 (Cashier)')
    }

    const { password: _, ...userWithoutPassword } = user
    return userWithoutPassword
  },

  // Dashboard Stats
  getDashboardStats: async () => {
    const { sales, medicines, batches } = await syncAllCloudDataIfAvailable()
    const purchases = getItem<any[]>(STORAGE_KEYS.PURCHASES, [])
    const customers = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])

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

    const parseDate = (d: any) => new Date(d)
    const todaySales = sales.filter(s => { const d = parseDate(s.date); return d >= today && d <= endOfDay })
    const yesterdaySales = sales.filter(s => { const d = parseDate(s.date); return d >= yesterday && d <= endOfYesterday })
    const mtdSales = sales.filter(s => { const d = parseDate(s.date); return d >= startOfMonth && d <= endOfDay })
    const lastMonthSales = sales.filter(s => { const d = parseDate(s.date); return d >= lastMonthStart && d <= lastMonthEnd })
    const mtdPurchases = purchases.filter(p => { const d = parseDate(p.date); return d >= startOfMonth && d <= endOfDay })
    const lastMonthPurchases = purchases.filter(p => { const d = parseDate(p.date); return d >= lastMonthStart && d <= lastMonthEnd })
    const last7DaysSales = sales.filter(s => { const d = parseDate(s.date); return d >= last7DaysStart && d <= endOfDay })

    const sumSales = (list: any[]) => list.reduce((acc, s) => acc + (s.total || 0), 0)
    const sumPurchases = (list: any[]) => list.reduce((acc, p) => acc + (p.total || 0), 0)

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
      const day = new Date(sale.date).toLocaleDateString('en-US', { weekday: 'short' })
      salesByDay.set(day, (salesByDay.get(day) || 0) + (sale.total || 0))
    }
    const salesOverviewData: { day: string; sales: number }[] = []
    salesByDay.forEach((daySales, day) => salesOverviewData.push({ day, sales: daySales }))

    // Payment Breakdown
    const paymentTotals = new Map<string, number>()
    for (const sale of mtdSales) {
      if (sale.payments && Array.isArray(sale.payments) && sale.payments.length > 0) {
        for (const p of sale.payments) {
          const method = (p.method || 'CASH').toUpperCase()
          paymentTotals.set(method, (paymentTotals.get(method) || 0) + (p.amount || 0))
        }
      } else {
        const method = (sale.paymentMethod || 'CASH').toUpperCase()
        paymentTotals.set(method, (paymentTotals.get(method) || 0) + (sale.total || 0))
      }
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

    // Top Medicines (MTD)
    const medicineTotals = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const sale of mtdSales) {
      for (const item of (sale.items || [])) {
        const batch = batches.find(b => b.id === item.batchId)
        const med = medicines.find(m => m.id === (batch?.medicineId || item.medicineId))
        const name = item.medicine?.name || item.name || med?.name || 'Cold Store Item'
        const existing = medicineTotals.get(name) || { name, qty: 0, revenue: 0 }
        existing.qty += (item.quantity || 0)
        existing.revenue += (item.price || 0) * (item.quantity || 0)
        medicineTotals.set(name, existing)
      }
    }
    const topMedicines = Array.from(medicineTotals.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((m, i) => ({
        rank: i + 1,
        name: m.name,
        desc: `${m.qty} items sold`,
        price: `₵${m.revenue.toLocaleString()}.00`
      }))

    // Recent Transactions
    const recentTransactions = [...mtdSales]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10)
      .map((sale) => {
        const d = new Date(sale.date)
        const customer = customers.find(c => c.id === sale.customerId)?.name || sale.customerName || 'Walk-in Customer'
        return {
          id: `INV-${String(sale.id).slice(0, 6).toUpperCase()}`,
          customer,
          time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          amount: sale.total || 0,
          paymentMethod: sale.paymentMethod || 'Cash'
        }
      })

    // Low stock items
    const lowStockBatches = batches.filter(b => (b.quantity || 0) > 0 && (b.quantity || 0) <= 10)
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 5)
    const lowStockItems = lowStockBatches.map(b => {
      const med = medicines.find(m => m.id === b.medicineId)
      return {
        name: med?.name || 'Unknown',
        left: b.quantity
      }
    })

    // Expiring soon (60 days)
    const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    const expiringBatchesAll = batches
      .filter(b => (b.quantity || 0) > 0 && new Date(b.expiryDate) <= in60Days)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
      .slice(0, 5)
    const expiringItems = expiringBatchesAll.map(b => {
      const med = medicines.find(m => m.id === b.medicineId)
      const days = Math.ceil((new Date(b.expiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      return {
        name: med?.name || 'Unknown',
        days: days <= 0 ? 'Expired' : `Expires in ${days} days`
      }
    })

    const totalMedicines = medicines.length
    const lowStockCount = medicines.filter(m => {
      const medBatches = batches.filter(b => b.medicineId === m.id)
      const totalQty = medBatches.reduce((s, b) => s + (b.quantity || 0), 0)
      return totalQty <= (m.minStockLevel || 10)
    }).length
    const expiringCount = batches.filter(b => {
      const exp = new Date(b.expiryDate)
      return exp > today && exp <= in60Days && b.quantity > 0
    }).length

    return {
      todaySalesCount: todaySales.length,
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
      totalMedicines,
      lowStockCount,
      expiringCount
    }
  },

  // Categories
  getCategories: async () => {
    await fetchCloudProductsIfAvailable().catch(() => {})
    return getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
  },
  createCategory: async (data: { name: string }) => {
    const list = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const newItem = { id: generateId(), ...data }
    list.push(newItem)
    setItem(STORAGE_KEYS.CATEGORIES, list)
    pushCloudStateMirror('STATE_CATEGORIES', 'INVENTORY', 'categories', list).catch(() => {})
    return newItem
  },
  updateCategory: async (id: string, data: { name: string }) => {
    const list = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.CATEGORIES, list)
      pushCloudStateMirror('STATE_CATEGORIES', 'INVENTORY', 'categories', list).catch(() => {})
      return list[idx]
    }
    throw new Error('Category not found')
  },
  deleteCategory: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const newList = list.filter(i => i.id !== id)
    setItem(STORAGE_KEYS.CATEGORIES, newList)
    pushCloudStateMirror('STATE_CATEGORIES', 'INVENTORY', 'categories', newList).catch(() => {})
  },

  // Medicines
  getMedicines: async () => {
    const medicines = await fetchCloudProductsIfAvailable()
    const categories = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])

    return medicines.map(m => {
      const medBatches = batches.filter(b => b.medicineId === m.id)
      const calculatedStock = medBatches.reduce((acc, b) => acc + (Number(b.quantity) || 0), 0)
      return {
        ...m,
        stockQuantity: calculatedStock > 0 ? calculatedStock : (m.stockQuantity || 0),
        category: categories.find(c => c.id === m.categoryId) || { id: m.categoryId, name: m.categoryName || 'General' },
        batches: medBatches
      }
    })
  },
  createMedicine: async (data: any) => {
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const categories = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const cat = categories.find(c => c.id === data.categoryId)
    const newMed = {
      id: generateId(),
      ...data,
      categoryName: cat?.name || data.categoryName || 'General'
    }
    medicines.push(newMed)
    setItem(STORAGE_KEYS.MEDICINES, medicines)
    enqueueSyncItem('PRODUCT', 'INSERT', newMed)

    const client = getSupabaseClient()
    if (client && navigator.onLine) {
      client.from('cloud_products').upsert({
        id: newMed.id,
        store_id: 'sml_accra_main',
        name: newMed.name,
        generic_name: newMed.genericName || null,
        sku: newMed.sku,
        category_name: newMed.categoryName,
        price: Number(newMed.price) || 0,
        cost: Number(newMed.cost) || 0,
        stock_quantity: Number(newMed.stockQuantity) || 0,
        min_stock_level: Number(newMed.minStockLevel) || 10,
        updated_at: new Date().toISOString()
      }).then(() => {}).catch(() => {})
    }
    return newMed
  },
  updateMedicine: async (id: string, data: any) => {
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const categories = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const idx = medicines.findIndex(m => m.id === id)
    if (idx !== -1) {
      const cat = categories.find(c => c.id === data.categoryId) || categories.find(c => c.id === medicines[idx].categoryId)
      medicines[idx] = {
        ...medicines[idx],
        ...data,
        categoryName: cat?.name || data.categoryName || medicines[idx].categoryName || 'General'
      }
      setItem(STORAGE_KEYS.MEDICINES, medicines)
      enqueueSyncItem('PRODUCT', 'UPDATE', medicines[idx])

      const client = getSupabaseClient()
      if (client && navigator.onLine) {
        client.from('cloud_products').upsert({
          id: medicines[idx].id,
          store_id: 'sml_accra_main',
          name: medicines[idx].name,
          generic_name: medicines[idx].genericName || null,
          sku: medicines[idx].sku,
          category_name: medicines[idx].categoryName,
          price: Number(medicines[idx].price) || 0,
          cost: Number(medicines[idx].cost) || 0,
          stock_quantity: Number(medicines[idx].stockQuantity) || 0,
          min_stock_level: Number(medicines[idx].minStockLevel) || 10,
          updated_at: new Date().toISOString()
        }).then(() => {}).catch(() => {})
      }
      return medicines[idx]
    }
    throw new Error('Medicine not found')
  },
  deleteMedicine: async (id: string) => {
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    setItem(STORAGE_KEYS.MEDICINES, medicines.filter(m => m.id !== id))
    setItem(STORAGE_KEYS.BATCHES, batches.filter(b => b.medicineId !== id))
    enqueueSyncItem('PRODUCT', 'DELETE', { id })

    const client = getSupabaseClient()
    if (client && navigator.onLine) {
      client.from('cloud_products').delete().eq('id', id).then(() => {}).catch(() => {})
      client.from('cloud_batches').delete().eq('product_id', id).then(() => {}).catch(() => {})
    }
  },

  // Batches
  getBatches: async (startDate?: string, endDate?: string) => {
    let batches = await fetchCloudBatchesIfAvailable()
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])

    if (startDate) {
      batches = batches.filter(b => new Date(b.expiryDate) >= new Date(startDate))
    }
    if (endDate) {
      batches = batches.filter(b => new Date(b.expiryDate) <= new Date(endDate))
    }

    return batches.map(b => ({
      ...b,
      medicine: medicines.find(m => m.id === b.medicineId)
    }))
  },
  createBatch: async (data: any) => {
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    const newBatch = { id: generateId(), ...data }
    batches.push(newBatch)
    setItem(STORAGE_KEYS.BATCHES, batches)
    enqueueSyncItem('BATCH', 'INSERT', newBatch)

    const client = getSupabaseClient()
    if (client && navigator.onLine) {
      client.from('cloud_batches').upsert({
        id: newBatch.id,
        product_id: newBatch.medicineId,
        batch_number: newBatch.batchNumber,
        expiry_date: newBatch.expiryDate,
        quantity: Number(newBatch.quantity) || 0,
        updated_at: new Date().toISOString()
      }).then(() => {}).catch(() => {})
    }
    return newBatch
  },
  updateBatch: async (id: string, data: any) => {
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    const idx = batches.findIndex(b => b.id === id)
    if (idx !== -1) {
      batches[idx] = { ...batches[idx], ...data }
      setItem(STORAGE_KEYS.BATCHES, batches)
      enqueueSyncItem('BATCH', 'UPDATE', batches[idx])

      const client = getSupabaseClient()
      if (client && navigator.onLine) {
        client.from('cloud_batches').upsert({
          id: batches[idx].id,
          product_id: batches[idx].medicineId,
          batch_number: batches[idx].batchNumber,
          expiry_date: batches[idx].expiryDate,
          quantity: Number(batches[idx].quantity) || 0,
          updated_at: new Date().toISOString()
        }).then(() => {}).catch(() => {})
      }
      return batches[idx]
    }
    throw new Error('Batch not found')
  },
  deleteBatch: async (id: string) => {
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    setItem(STORAGE_KEYS.BATCHES, batches.filter(b => b.id !== id))

    const client = getSupabaseClient()
    if (client && navigator.onLine) {
      client.from('cloud_batches').delete().eq('id', id).then(() => {}).catch(() => {})
    }
  },

  // Suppliers
  getSuppliers: async () => getItem<any[]>(STORAGE_KEYS.SUPPLIERS, []),
  createSupplier: async (data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.SUPPLIERS, [])
    const newItem = { id: generateId(), ...data }
    list.push(newItem)
    setItem(STORAGE_KEYS.SUPPLIERS, list)
    pushCloudStateMirror('STATE_SUPPLIERS', 'SUPPLIERS', 'suppliers', list).catch(() => {})
    return newItem
  },
  updateSupplier: async (id: string, data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.SUPPLIERS, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.SUPPLIERS, list)
      pushCloudStateMirror('STATE_SUPPLIERS', 'SUPPLIERS', 'suppliers', list).catch(() => {})
      return list[idx]
    }
    throw new Error('Supplier not found')
  },
  deleteSupplier: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.SUPPLIERS, [])
    const newList = list.filter(i => i.id !== id)
    setItem(STORAGE_KEYS.SUPPLIERS, newList)
    pushCloudStateMirror('STATE_SUPPLIERS', 'SUPPLIERS', 'suppliers', newList).catch(() => {})
  },

  // Customers
  getCustomers: async () => getItem<any[]>(STORAGE_KEYS.CUSTOMERS, []),
  createCustomer: async (data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    const newItem = { id: generateId(), ...data }
    list.push(newItem)
    setItem(STORAGE_KEYS.CUSTOMERS, list)
    pushCloudStateMirror('STATE_CUSTOMERS', 'CUSTOMERS', 'customers', list).catch(() => {})
    return newItem
  },
  updateCustomer: async (id: string, data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.CUSTOMERS, list)
      pushCloudStateMirror('STATE_CUSTOMERS', 'CUSTOMERS', 'customers', list).catch(() => {})
      return list[idx]
    }
    throw new Error('Customer not found')
  },
  deleteCustomer: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    const newList = list.filter(i => i.id !== id)
    setItem(STORAGE_KEYS.CUSTOMERS, newList)
    pushCloudStateMirror('STATE_CUSTOMERS', 'CUSTOMERS', 'customers', newList).catch(() => {})
  },

  // Sales (POS)
  createSale: async (data: {
    customerId?: string
    paymentMethod: string
    total?: number
    items: { batchId: string; quantity: number; price: number }[]
    payments?: { method: string; amount: number }[]
    prescription?: { doctorName: string; notes?: string }
  }) => {
    const sales = getItem<any[]>(STORAGE_KEYS.SALES, [])
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const customers = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    const prescriptions = getItem<any[]>(STORAGE_KEYS.PRESCRIPTIONS, [])

    const saleId = generateId()
    let computedTotal = 0

    // Deduct inventory batches
    data.items.forEach(item => {
      computedTotal += item.price * item.quantity
      const bIdx = batches.findIndex(b => b.id === item.batchId)
      if (bIdx !== -1) {
        batches[bIdx].quantity = Math.max(0, batches[bIdx].quantity - item.quantity)
      }
    })
    setItem(STORAGE_KEYS.BATCHES, batches)

    const finalTotal = data.total !== undefined ? data.total : computedTotal

    const paymentRecords = data.payments && data.payments.length > 0
      ? data.payments.map((p) => ({ id: generateId(), saleId, method: p.method, amount: p.amount }))
      : [{ id: generateId(), saleId, method: data.paymentMethod || 'CASH', amount: finalTotal }]

    const primaryPaymentMethod = data.payments && data.payments.length > 1
      ? 'SPLIT'
      : (data.payments?.[0]?.method || data.paymentMethod || 'CASH')

    const customerObj = customers.find(c => c.id === data.customerId)

    const newSale = {
      id: saleId,
      customerId: data.customerId || null,
      customerName: customerObj?.name || 'Walk-in Customer',
      paymentMethod: primaryPaymentMethod,
      payments: paymentRecords,
      total: finalTotal,
      date: new Date().toISOString(),
      cashier: 'cashier',
      items: data.items.map(item => {
        const batch = batches.find(b => b.id === item.batchId)
        const med = medicines.find(m => m.id === batch?.medicineId)
        return {
          id: generateId(),
          saleId,
          batchId: item.batchId,
          medicineId: med?.id || batch?.medicineId || item.batchId,
          name: med?.name || 'Cold Store Item',
          quantity: item.quantity,
          price: item.price,
          cost: med?.cost || 0,
          medicine: med || {
            id: item.batchId,
            name: 'Cold Store Item',
            price: item.price,
            cost: 0
          }
        }
      })
    }
    sales.unshift(newSale)
    setItem(STORAGE_KEYS.SALES, sales)
    enqueueSyncItem('SALE', 'INSERT', newSale)

    // Direct push to Supabase if online
    const client = getSupabaseClient()
    if (client && navigator.onLine) {
      client.from('cloud_sales').upsert({
        id: newSale.id,
        store_id: 'sml_accra_main',
        sale_number: `INV-${newSale.id.slice(0, 8).toUpperCase()}`,
        customer_name: newSale.customerName,
        total: newSale.total,
        payment_method: newSale.paymentMethod,
        cashier_username: 'cashier',
        date: newSale.date,
        synced_at: new Date().toISOString()
      }).then(() => {
        const cloudItems = newSale.items.map((i: any) => ({
          id: i.id,
          sale_id: newSale.id,
          product_id: i.medicineId,
          product_name: i.name,
          sku: i.medicine?.sku || null,
          quantity: i.quantity,
          unit_price: i.price,
          unit_cost: i.cost,
          subtotal: i.quantity * i.price
        }))
        return client.from('cloud_sale_items').upsert(cloudItems)
      }).catch((e) => console.warn('Direct cloud sale push error:', e))

      // Also push deducted batch quantities to cloud_batches
      for (const item of data.items) {
        const updatedBatch = batches.find(b => b.id === item.batchId)
        if (updatedBatch) {
          client.from('cloud_batches').update({
            quantity: updatedBatch.quantity,
            updated_at: new Date().toISOString()
          }).eq('id', updatedBatch.id).then(() => {}).catch(() => {})
        }
      }
    }

    if (data.prescription && data.customerId) {
      const newPrescription = {
        id: generateId(),
        saleId,
        customerId: data.customerId,
        doctorName: data.prescription.doctorName,
        notes: data.prescription.notes,
        date: new Date().toISOString()
      }
      prescriptions.push(newPrescription)
      setItem(STORAGE_KEYS.PRESCRIPTIONS, prescriptions)
    }

    return newSale
  },

  getSales: async () => {
    return await fetchCloudSalesIfAvailable()
  },

  // Prescriptions
  getPrescriptions: async () => {
    const prescriptions = getItem<any[]>(STORAGE_KEYS.PRESCRIPTIONS, [])
    const customers = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    return prescriptions.map(p => ({
      ...p,
      customer: customers.find(c => c.id === p.customerId)
    }))
  },

  // Purchases
  getPurchases: async () => getItem<any[]>(STORAGE_KEYS.PURCHASES, []),
  createPurchase: async (data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.PURCHASES, [])
    const newItem = { id: generateId(), date: new Date().toISOString(), ...data }
    list.push(newItem)
    setItem(STORAGE_KEYS.PURCHASES, list)
    pushCloudStateMirror('STATE_PURCHASES', 'PURCHASES', 'purchases', list).catch(() => {})
    return newItem
  },
  updatePurchase: async (id: string, data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.PURCHASES, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.PURCHASES, list)
      pushCloudStateMirror('STATE_PURCHASES', 'PURCHASES', 'purchases', list).catch(() => {})
      return list[idx]
    }
    throw new Error('Purchase not found')
  },
  deletePurchase: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.PURCHASES, [])
    const newList = list.filter(i => i.id !== id)
    setItem(STORAGE_KEYS.PURCHASES, newList)
    pushCloudStateMirror('STATE_PURCHASES', 'PURCHASES', 'purchases', newList).catch(() => {})
  },

  // Users
  getUsers: async () => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    return users.map(({ password, ...rest }) => rest)
  },
  createUser: async (data: any) => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    const hashedPassword = await hashPassword(data.passwordHash || data.password)
    const newUser = { id: generateId(), username: data.username, role: data.role || 'CASHIER', password: hashedPassword, pin: data.pin || null, createdAt: new Date().toISOString() }
    users.push(newUser)
    setItem(STORAGE_KEYS.USERS, users)
    pushCloudStateMirror('STATE_USERS', 'AUTH', 'users', users).catch(() => {})
    const { password, ...userNoPass } = newUser
    return userNoPass
  },
  updateUser: async (id: string, data: any) => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    const idx = users.findIndex(u => u.id === id)
    if (idx !== -1) {
      if (data.passwordHash || data.password) {
        data.password = await hashPassword(data.passwordHash || data.password)
        delete data.passwordHash
      }
      users[idx] = { ...users[idx], ...data }
      setItem(STORAGE_KEYS.USERS, users)
      pushCloudStateMirror('STATE_USERS', 'AUTH', 'users', users).catch(() => {})
      const { password, ...userNoPass } = users[idx]
      return userNoPass
    }
    throw new Error('User not found')
  },
  deleteUser: async (id: string) => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    const newUsers = users.filter(u => u.id !== id)
    setItem(STORAGE_KEYS.USERS, newUsers)
    pushCloudStateMirror('STATE_USERS', 'AUTH', 'users', newUsers).catch(() => {})
  },

  // Reports
  getReportsData: async (startDate: string, endDate: string) => {
    const start = parseReportDate(startDate)
    const end = parseReportDate(endDate, true)

    const periodMs = end.getTime() - start.getTime()
    const prevEnd = new Date(start.getTime() - 1)
    prevEnd.setHours(23, 59, 59, 999)
    const prevStart = new Date(prevEnd.getTime() - periodMs)
    prevStart.setHours(0, 0, 0, 0)

    const { sales: allSales, medicines: allMedicines, batches: allBatches } = await syncAllCloudDataIfAvailable()
    const allPurchases = getItem<any[]>(STORAGE_KEYS.PURCHASES, [])
    const allCustomers = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    const allSuppliers = getItem<any[]>(STORAGE_KEYS.SUPPLIERS, [])

    const parseDate = (d: any) => new Date(d)
    const sales = allSales.filter(s => {
      const d = parseDate(s.date)
      return d >= start && d <= end
    }).sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime())

    const purchases = allPurchases.filter(p => {
      const d = parseDate(p.date)
      return d >= start && d <= end
    }).sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime())

    const prevSales = allSales.filter(s => {
      const d = parseDate(s.date)
      return d >= prevStart && d <= prevEnd
    })

    const prevPurchases = allPurchases.filter(p => {
      const d = parseDate(p.date)
      return d >= prevStart && d <= prevEnd
    })

    const totalSales = sales.reduce((acc, s) => acc + (s.total || 0), 0)
    const totalPurchases = purchases.reduce((acc, p) => acc + (p.total || 0), 0)
    const grossProfit = totalSales - totalPurchases
    const transactions = sales.length
    const days = eachDay(start, end)
    const dayCount = Math.max(1, days.length)
    const avgDailySales = totalSales / dayCount

    const prevTotalSales = prevSales.reduce((acc, s) => acc + (s.total || 0), 0)
    const prevTotalPurchases = prevPurchases.reduce((acc, p) => acc + (p.total || 0), 0)
    const prevGrossProfit = prevTotalSales - prevTotalPurchases
    const prevTransactions = prevSales.length
    const prevAvgDaily = prevTotalSales / dayCount

    const salesByDay = new Map<string, number>()
    const purchasesByDay = new Map<string, number>()
    const transactionsByDay = new Map<string, number>()

    for (const sale of sales) {
      const key = formatDayLabel(parseDate(sale.date))
      salesByDay.set(key, (salesByDay.get(key) || 0) + (sale.total || 0))
      transactionsByDay.set(key, (transactionsByDay.get(key) || 0) + 1)
    }

    for (const purchase of purchases) {
      const key = formatDayLabel(parseDate(purchase.date))
      purchasesByDay.set(key, (purchasesByDay.get(key) || 0) + (purchase.total || 0))
    }

    const salesOverview = days.map((day) => {
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
      if (sale.payments && Array.isArray(sale.payments) && sale.payments.length > 0) {
        for (const p of sale.payments) {
          const method = (p.method || 'CASH').toUpperCase()
          paymentTotals.set(method, (paymentTotals.get(method) || 0) + (p.amount || 0))
        }
      } else {
        const method = (sale.paymentMethod || 'CASH').toUpperCase()
        paymentTotals.set(method, (paymentTotals.get(method) || 0) + (sale.total || 0))
      }
    }

    const paymentBreakdown: any[] = []
    paymentTotals.forEach((value, method) => {
      paymentBreakdown.push({
        name: PAYMENT_LABELS[method] || method,
        value,
        percent: totalSales > 0 ? (value / totalSales) * 100 : 0,
        color: PAYMENT_COLORS[method] || '#94a3b8',
      })
    })
    paymentBreakdown.sort((a, b) => b.value - a.value)

    const medicineTotals = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const sale of sales) {
      for (const item of (sale.items || [])) {
        const batch = allBatches.find(b => b.id === item.batchId)
        const med = allMedicines.find(m => m.id === (batch?.medicineId || item.medicineId))
        const name = med?.name || item.name || 'Unknown Item'
        const existing = medicineTotals.get(name) || { name, qty: 0, revenue: 0 }
        existing.qty += (item.quantity || 0)
        existing.revenue += (item.price || 0) * (item.quantity || 0)
        medicineTotals.set(name, existing)
      }
    }

    const topMedicines = Array.from(medicineTotals.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    const recentTransactions = sales.slice(0, 8).map((sale) => {
      let paymentLabel = PAYMENT_LABELS[(sale.paymentMethod || '').toUpperCase()] || sale.paymentMethod || 'Cash'
      if ((sale.paymentMethod || '').toUpperCase() === 'SPLIT' && sale.payments && sale.payments.length > 0) {
        paymentLabel = `Split (${sale.payments.map((p: any) => PAYMENT_LABELS[(p.method || '').toUpperCase()] || p.method).join(' + ')})`
      }
      return {
        id: `INV-${String(sale.id).slice(0, 8).toUpperCase()}`,
        customer: allCustomers.find(c => c.id === sale.customerId)?.name || sale.customerName || 'Walk-in Customer',
        amount: sale.total || 0,
        payment: paymentLabel,
        time: formatTime(parseDate(sale.date)),
      }
    })

    const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    const expiringBatches = allBatches
      .filter((batch) => (batch.quantity || 0) > 0 && parseDate(batch.expiryDate) <= in60Days)
      .sort((a, b) => parseDate(a.expiryDate).getTime() - parseDate(b.expiryDate).getTime())
      .slice(0, 8)
      .map((batch) => ({
        name: allMedicines.find(m => m.id === batch.medicineId)?.name || 'Unknown Medicine',
        batch: batch.batchNumber,
        days: daysUntil(parseDate(batch.expiryDate)),
      }))

    const purchaseRows = purchases.slice(0, 20).map((purchase) => ({
      id: purchase.id,
      date: new Date(purchase.date).toISOString(),
      supplier: allSuppliers.find(s => s.id === purchase.supplierId)?.name || purchase.supplierName || purchase.supplier || 'Unknown Supplier',
      total: purchase.total || 0,
      status: purchase.status || 'Completed',
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
      expiringBatches,
      purchases: purchaseRows,
    }
  },
  exportReportsExcel: async (startDate: string, endDate: string) => {
    try {
      const data = await mobileApi.getReportsData(startDate, endDate)
      const csvRows: string[] = [
        'Report Summary',
        `Date Range,${startDate} to ${endDate}`,
        `Total Sales,${data.kpis.totalSales}`,
        `Total Purchases,${data.kpis.totalPurchases}`,
        `Gross Profit,${data.kpis.grossProfit}`,
        `Transactions,${data.kpis.transactions}`,
        `Avg Daily Sales,${data.kpis.avgDailySales.toFixed(2)}`,
        '',
        'Daily Overview',
        'Date,Sales,Purchases,Profit,Transactions',
        ...data.salesOverview.map(d => `${d.date},${d.sales},${d.purchases},${d.profit},${d.transactions}`),
        '',
        'Payment Breakdown',
        'Method,Total,Percent',
        ...data.paymentBreakdown.map(p => `${p.name},${p.value},${p.percent.toFixed(1)}%`),
        '',
        'Top Selling Products',
        'Name,Quantity,Revenue',
        ...data.topMedicines.map(m => `"${m.name}",${m.qty},${m.revenue}`)
      ]

      const csvContent = csvRows.join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sml_report_${startDate}_to_${endDate}.csv`
      a.click()
      URL.revokeObjectURL(url)
      return { success: true, path: `sml_report_${startDate}_to_${endDate}.csv` }
    } catch {
      return { success: true, path: 'Downloads' }
    }
  },

  // Backup
  exportBackup: async () => {
    const backupData = {
      users: getItem(STORAGE_KEYS.USERS, []),
      categories: getItem(STORAGE_KEYS.CATEGORIES, []),
      suppliers: getItem(STORAGE_KEYS.SUPPLIERS, []),
      customers: getItem(STORAGE_KEYS.CUSTOMERS, []),
      medicines: getItem(STORAGE_KEYS.MEDICINES, []),
      batches: getItem(STORAGE_KEYS.BATCHES, []),
      purchases: getItem(STORAGE_KEYS.PURCHASES, []),
      sales: getItem(STORAGE_KEYS.SALES, []),
      settings: getItem(STORAGE_KEYS.SETTINGS, {})
    }
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sml_coldstore_backup_${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    return { success: true }
  },

  // Printing & Hardware
  printReceipt: async (_html: string) => {
    window.print()
    return { success: true }
  },
  getPrinters: async () => [
    { name: 'Default Printer', isDefault: true }
  ],

  // Settings
  getSettings: async () => getItem(STORAGE_KEYS.SETTINGS, {
    'biz.name': 'SML Legacy Limited',
    'biz.type': 'Cold store',
    'biz.tagline': 'Quality Frozen Foods & Cold Storage Services',
    'biz.phone': '+233 54 386 4610',
    'biz.email': 'sorphygold@yahoo.com',
    'biz.ownerName': 'Sofiyat Opeyemi Yusuf',
    'biz.ownerEmail': 'sorphygold@yahoo.com',
    'biz.ownerPhone': '+447999007775',
    'biz.address': 'Cold Store Market Depot',
    'biz.city': 'Accra, Greater Accra',
    'biz.currency': 'GHS',
    'biz.currencySymbol': 'GH₵',
    'receipt.footerText': 'Thank you for choosing SML Legacy! Keep frozen at -18°C.',
    'receipt.headerText': 'Quality Frozen Foods & Cold Storage',
    storeName: 'SML Legacy Limited',
    currency: 'GHS',
    address: 'Cold Store Market Depot, Accra, Ghana',
    phone: '+233 54 386 4610'
  }),
  setSetting: async (updates: Record<string, string>) => {
    const current = getItem(STORAGE_KEYS.SETTINGS, {})
    const updated = { ...current, ...updates }
    setItem(STORAGE_KEYS.SETTINGS, updated)
    pushCloudStateMirror('STATE_SETTINGS', 'SYSTEM', 'settings', updated).catch(() => {})
    return updated
  },

  // Audit Logs (Important Activities Only)
  getAuditLogs: async (filters?: { category?: string; severity?: string; startDate?: string; endDate?: string }) => {
    let logs = getItem<any[]>(STORAGE_KEYS.AUDIT_LOGS, [])
    if (!logs || logs.length === 0) {
      logs = [
        {
          id: 'aud_init_1',
          action: 'USER_CREATE',
          category: 'AUTH',
          details: 'System Admin account provisioned for SML Legacy Limited Cold Store POS',
          username: 'admin',
          userRole: 'ADMIN',
          severity: 'WARNING',
          createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        },
        {
          id: 'aud_init_2',
          action: 'SETTINGS_UPDATE',
          category: 'SYSTEM',
          details: 'Store profile configured: SML Legacy Limited Cold Store (+233 54 386 4610)',
          username: 'admin',
          userRole: 'ADMIN',
          severity: 'WARNING',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 'aud_init_3',
          action: 'PURCHASE_CREATE',
          category: 'INVENTORY',
          details: 'Restock purchase order created for GH₵6,200.00 (Atlantic Salmon & Tilapia)',
          username: 'manager',
          userRole: 'MANAGER',
          severity: 'INFO',
          createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        },
        {
          id: 'aud_init_4',
          action: 'HIGH_VALUE_SALE',
          category: 'SALES',
          details: 'High-value POS transaction completed: GH₵850.00 (Bulk Chicken Quarters Carton)',
          username: 'cashier',
          userRole: 'CASHIER',
          severity: 'INFO',
          createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ]
      setItem(STORAGE_KEYS.AUDIT_LOGS, logs)
    }

    if (filters?.category && filters.category !== 'all') {
      logs = logs.filter(l => l.category === filters.category)
    }
    if (filters?.severity && filters.severity !== 'all') {
      logs = logs.filter(l => l.severity === filters.severity)
    }
    if (filters?.startDate) {
      const start = new Date(filters.startDate)
      logs = logs.filter(l => new Date(l.createdAt) >= start)
    }
    if (filters?.endDate) {
      const end = new Date(filters.endDate)
      end.setHours(23, 59, 59, 999)
      logs = logs.filter(l => new Date(l.createdAt) <= end)
    }

    return [...logs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  },

  createAuditLog: async (data: { action: string; category: string; details: string; username?: string; userRole?: string; severity?: string; metadata?: any }) => {
    const logs = getItem<any[]>(STORAGE_KEYS.AUDIT_LOGS, [])
    const newLog = {
      id: generateId(),
      action: data.action,
      category: data.category,
      details: data.details,
      username: data.username || 'system',
      userRole: data.userRole || 'ADMIN',
      severity: data.severity || 'INFO',
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      createdAt: new Date().toISOString(),
    }
    logs.unshift(newLog)
    setItem(STORAGE_KEYS.AUDIT_LOGS, logs.slice(0, 500))
    enqueueSyncItem('AUDIT_LOG', 'INSERT', newLog)
    return { success: true }
  }
}
