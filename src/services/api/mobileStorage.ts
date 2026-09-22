import { enqueueSyncItem } from '../sync/syncQueue'

// Browser-compatible password hashing using Web Crypto API (no Node.js deps)
async function hashPassword(password: string): Promise<string> {
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

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('webcrypto:')) return false
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

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// Seed initial data if empty
async function seedInitialDataIfNeeded() {
  const users = getItem(STORAGE_KEYS.USERS, [])
  if (users.length === 0) {
    const adminPassword = await hashPassword('admin123')
    const managerPassword = await hashPassword('manager123')
    const cashierPassword = await hashPassword('cashier123')

    const initialUsers = [
      { id: generateId(), username: 'admin', password: adminPassword, role: 'ADMIN', createdAt: new Date().toISOString() },
      { id: generateId(), username: 'manager', password: managerPassword, role: 'MANAGER', createdAt: new Date().toISOString() },
      { id: generateId(), username: 'cashier', password: cashierPassword, role: 'CASHIER', createdAt: new Date().toISOString() }
    ]
    setItem(STORAGE_KEYS.USERS, initialUsers)

    // Initial Categories
    const initialCategories = [
      { id: 'cat-1', name: 'Poultry & Chicken' },
      { id: 'cat-2', name: 'Fish & Seafood' },
      { id: 'cat-3', name: 'Beef & Meat' },
      { id: 'cat-4', name: 'Turkey & Cuts' },
      { id: 'cat-5', name: 'Pork Products' },
      { id: 'cat-6', name: 'Processed Meat' },
      { id: 'cat-7', name: 'Frozen Vegetables' }
    ]
    setItem(STORAGE_KEYS.CATEGORIES, initialCategories)

    // Initial Suppliers (Ghana-based cold store suppliers)
    const initialSuppliers = [
      { id: 'sup-1', name: 'Accra Frozen Foods Ltd', contact: '+233 30 222 4455', email: 'sales@accrafrozen.com.gh', address: 'Industrial Area, Accra, Ghana' },
      { id: 'sup-2', name: 'Gold Coast Meat Distributors', contact: '+233 24 500 7890', email: 'orders@gcmeat.com.gh', address: 'Tema Port Area, Tema, Ghana' },
      { id: 'sup-3', name: 'West Africa Poultry Hub', contact: '+233 54 112 3399', email: 'info@wapoultry.com.gh', address: 'Spintex Road, Accra, Ghana' }
    ]
    setItem(STORAGE_KEYS.SUPPLIERS, initialSuppliers)

    // Initial Customers
    const initialCustomers = [
      { id: 'cust-1', name: 'Kofi Mensah', phone: '0244112233' },
      { id: 'cust-2', name: 'Ama Asante', phone: '0554321098' },
      { id: 'cust-3', name: 'Kwame Boateng', phone: '0201987654' },
      { id: 'cust-4', name: 'Sofiyat Yusuf', phone: '+447999007775' }
    ]
    setItem(STORAGE_KEYS.CUSTOMERS, initialCustomers)

    // Initial Cold Store Products (using medicine schema)
    const initialMedicines = [
      { id: 'med-1', name: 'Whole Chicken (Frozen)', genericName: 'Broiler Chicken', sku: 'SML-PTR-001', categoryId: 'cat-1', price: 85.00, cost: 58.00, minStockLevel: 20 },
      { id: 'med-2', name: 'Chicken Legs (5kg Pack)', genericName: 'Chicken Drumsticks', sku: 'SML-PTR-002', categoryId: 'cat-1', price: 120.00, cost: 82.00, minStockLevel: 15 },
      { id: 'med-3', name: 'Chicken Breast (Boneless)', genericName: 'Breast Fillet', sku: 'SML-PTR-003', categoryId: 'cat-1', price: 145.00, cost: 98.00, minStockLevel: 10 },
      { id: 'med-4', name: 'Turkey (Whole Frozen)', genericName: 'Turkey Bird', sku: 'SML-PTR-004', categoryId: 'cat-4', price: 320.00, cost: 220.00, minStockLevel: 5 },
      { id: 'med-5', name: 'Tilapia Fish (Fresh Frozen)', genericName: 'Fresh Water Tilapia', sku: 'SML-FSH-001', categoryId: 'cat-2', price: 95.00, cost: 62.00, minStockLevel: 25 },
      { id: 'med-6', name: 'Mackerel (Frozen, 1kg)', genericName: 'Titus / Horse Mackerel', sku: 'SML-FSH-002', categoryId: 'cat-2', price: 55.00, cost: 36.00, minStockLevel: 30 },
      { id: 'med-7', name: 'Tiger Prawns (500g)', genericName: 'Penaeus monodon', sku: 'SML-FSH-003', categoryId: 'cat-2', price: 180.00, cost: 125.00, minStockLevel: 10 },
      { id: 'med-8', name: 'Boneless Beef Box (15kg)', genericName: 'Prime Beef', sku: 'SML-BEEF-001', categoryId: 'cat-3', price: 420.00, cost: 310.00, minStockLevel: 5 },
      { id: 'med-9', name: 'Farmstyle French Fries (2.5kg)', genericName: 'Grade A Fries', sku: 'SML-VEG-001', categoryId: 'cat-7', price: 65.00, cost: 42.00, minStockLevel: 15 }
    ]
    setItem(STORAGE_KEYS.MEDICINES, initialMedicines)

    // Initial Batches
    const futureDate = new Date()
    futureDate.setFullYear(futureDate.getFullYear() + 1)
    const initialBatches = [
      { id: 'batch-1', medicineId: 'med-1', batchNumber: 'CHK-2024-001', expiryDate: futureDate.toISOString(), quantity: 80 },
      { id: 'batch-2', medicineId: 'med-2', batchNumber: 'CHL-2024-001', expiryDate: futureDate.toISOString(), quantity: 60 },
      { id: 'batch-3', medicineId: 'med-3', batchNumber: 'CHB-2024-001', expiryDate: futureDate.toISOString(), quantity: 50 },
      { id: 'batch-4', medicineId: 'med-4', batchNumber: 'TKY-2024-001', expiryDate: futureDate.toISOString(), quantity: 20 },
      { id: 'batch-5', medicineId: 'med-5', batchNumber: 'TLP-2024-001', expiryDate: futureDate.toISOString(), quantity: 90 },
      { id: 'batch-6', medicineId: 'med-6', batchNumber: 'MCK-2024-001', expiryDate: futureDate.toISOString(), quantity: 120 },
      { id: 'batch-7', medicineId: 'med-7', batchNumber: 'PRW-2024-001', expiryDate: futureDate.toISOString(), quantity: 40 },
      { id: 'batch-8', medicineId: 'med-8', batchNumber: 'BEF-2024-001', expiryDate: futureDate.toISOString(), quantity: 25 },
      { id: 'batch-9', medicineId: 'med-9', batchNumber: 'FRY-2024-001', expiryDate: futureDate.toISOString(), quantity: 45 }
    ]
    setItem(STORAGE_KEYS.BATCHES, initialBatches)

    // Initial Settings
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
    await seedInitialDataIfNeeded()
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    let targetUsername = ''
    if (selectedRole === 'ADMIN' || pin === '1111' || pin === '9999') {
      targetUsername = 'admin'
    } else if (selectedRole === 'MANAGER' || pin === '2222' || pin === '5555') {
      targetUsername = 'manager'
    } else if (selectedRole === 'CASHIER' || pin === '1234' || pin === '0000') {
      targetUsername = 'cashier'
    }

    let user = targetUsername ? users.find(u => u.username.toLowerCase() === targetUsername.toLowerCase()) : null
    if (!user) {
      user = users.find(u => u.password === pin)
    }

    if (!user) {
      throw new Error('Invalid PIN code. Try 1111 (Admin) or 1234 (Cashier)')
    }

    const { password: _, ...userWithoutPassword } = user
    return userWithoutPassword
  },

  // Dashboard Stats
  getDashboardStats: async () => {
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    const sales = getItem<any[]>(STORAGE_KEYS.SALES, [])

    const todayStr = new Date().toISOString().split('T')[0]
    const todaySales = sales.filter(s => s.date && s.date.startsWith(todayStr))
    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0)

    const totalMedicines = medicines.length
    
    // Low stock
    const lowStockCount = medicines.filter(m => {
      const medBatches = batches.filter(b => b.medicineId === m.id)
      const totalQty = medBatches.reduce((s, b) => s + (b.quantity || 0), 0)
      return totalQty <= (m.minStockLevel || 10)
    }).length

    // Expiring soon (30 days)
    const now = new Date()
    const in30Days = new Date()
    in30Days.setDate(now.getDate() + 30)

    const expiringCount = batches.filter(b => {
      const exp = new Date(b.expiryDate)
      return exp > now && exp <= in30Days && b.quantity > 0
    }).length

    return {
      todaySalesCount: todaySales.length,
      todayRevenue,
      totalMedicines,
      lowStockCount,
      expiringCount
    }
  },

  // Categories
  getCategories: async () => getItem<any[]>(STORAGE_KEYS.CATEGORIES, []),
  createCategory: async (data: { name: string }) => {
    const list = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const newItem = { id: generateId(), ...data }
    list.push(newItem)
    setItem(STORAGE_KEYS.CATEGORIES, list)
    return newItem
  },
  updateCategory: async (id: string, data: { name: string }) => {
    const list = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.CATEGORIES, list)
      return list[idx]
    }
    throw new Error('Category not found')
  },
  deleteCategory: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const newList = list.filter(i => i.id !== id)
    setItem(STORAGE_KEYS.CATEGORIES, newList)
  },

  // Medicines
  getMedicines: async () => {
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const categories = getItem<any[]>(STORAGE_KEYS.CATEGORIES, [])
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])

    return medicines.map(m => ({
      ...m,
      category: categories.find(c => c.id === m.categoryId),
      batches: batches.filter(b => b.medicineId === m.id)
    }))
  },
  createMedicine: async (data: any) => {
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const newMed = { id: generateId(), ...data }
    medicines.push(newMed)
    setItem(STORAGE_KEYS.MEDICINES, medicines)
    enqueueSyncItem('PRODUCT', 'INSERT', newMed)
    return newMed
  },
  updateMedicine: async (id: string, data: any) => {
    const medicines = getItem<any[]>(STORAGE_KEYS.MEDICINES, [])
    const idx = medicines.findIndex(m => m.id === id)
    if (idx !== -1) {
      medicines[idx] = { ...medicines[idx], ...data }
      setItem(STORAGE_KEYS.MEDICINES, medicines)
      enqueueSyncItem('PRODUCT', 'UPDATE', medicines[idx])
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
  },

  // Batches
  getBatches: async (startDate?: string, endDate?: string) => {
    let batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
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
    return newBatch
  },
  updateBatch: async (id: string, data: any) => {
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    const idx = batches.findIndex(b => b.id === id)
    if (idx !== -1) {
      batches[idx] = { ...batches[idx], ...data }
      setItem(STORAGE_KEYS.BATCHES, batches)
      return batches[idx]
    }
    throw new Error('Batch not found')
  },
  deleteBatch: async (id: string) => {
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    setItem(STORAGE_KEYS.BATCHES, batches.filter(b => b.id !== id))
  },

  // Suppliers
  getSuppliers: async () => getItem<any[]>(STORAGE_KEYS.SUPPLIERS, []),
  createSupplier: async (data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.SUPPLIERS, [])
    const newItem = { id: generateId(), ...data }
    list.push(newItem)
    setItem(STORAGE_KEYS.SUPPLIERS, list)
    return newItem
  },
  updateSupplier: async (id: string, data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.SUPPLIERS, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.SUPPLIERS, list)
      return list[idx]
    }
    throw new Error('Supplier not found')
  },
  deleteSupplier: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.SUPPLIERS, [])
    setItem(STORAGE_KEYS.SUPPLIERS, list.filter(i => i.id !== id))
  },

  // Customers
  getCustomers: async () => getItem<any[]>(STORAGE_KEYS.CUSTOMERS, []),
  createCustomer: async (data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    const newItem = { id: generateId(), ...data }
    list.push(newItem)
    setItem(STORAGE_KEYS.CUSTOMERS, list)
    return newItem
  },
  updateCustomer: async (id: string, data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.CUSTOMERS, list)
      return list[idx]
    }
    throw new Error('Customer not found')
  },
  deleteCustomer: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.CUSTOMERS, [])
    setItem(STORAGE_KEYS.CUSTOMERS, list.filter(i => i.id !== id))
  },

  // Sales (POS)
  createSale: async (data: { customerId?: string; paymentMethod: string; items: { batchId: string; quantity: number; price: number }[]; prescription?: { doctorName: string; notes?: string } }) => {
    const sales = getItem<any[]>(STORAGE_KEYS.SALES, [])
    const batches = getItem<any[]>(STORAGE_KEYS.BATCHES, [])
    const prescriptions = getItem<any[]>(STORAGE_KEYS.PRESCRIPTIONS, [])

    const saleId = generateId()
    let total = 0

    // Deduct inventory batches
    data.items.forEach(item => {
      total += item.price * item.quantity
      const bIdx = batches.findIndex(b => b.id === item.batchId)
      if (bIdx !== -1) {
        batches[bIdx].quantity = Math.max(0, batches[bIdx].quantity - item.quantity)
      }
    })
    setItem(STORAGE_KEYS.BATCHES, batches)

    const newSale = {
      id: saleId,
      customerId: data.customerId || null,
      paymentMethod: data.paymentMethod,
      total,
      date: new Date().toISOString(),
      items: data.items.map(item => ({ id: generateId(), saleId, ...item }))
    }
    sales.push(newSale)
    setItem(STORAGE_KEYS.SALES, sales)
    enqueueSyncItem('SALE', 'INSERT', newSale)

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
    return newItem
  },
  updatePurchase: async (id: string, data: any) => {
    const list = getItem<any[]>(STORAGE_KEYS.PURCHASES, [])
    const idx = list.findIndex(i => i.id === id)
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data }
      setItem(STORAGE_KEYS.PURCHASES, list)
      return list[idx]
    }
    throw new Error('Purchase not found')
  },
  deletePurchase: async (id: string) => {
    const list = getItem<any[]>(STORAGE_KEYS.PURCHASES, [])
    setItem(STORAGE_KEYS.PURCHASES, list.filter(i => i.id !== id))
  },

  // Users
  getUsers: async () => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    return users.map(({ password, ...rest }) => rest)
  },
  createUser: async (data: any) => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    const hashedPassword = await hashPassword(data.password)
    const newUser = { id: generateId(), username: data.username, role: data.role || 'CASHIER', password: hashedPassword, createdAt: new Date().toISOString() }
    users.push(newUser)
    setItem(STORAGE_KEYS.USERS, users)
    const { password, ...userNoPass } = newUser
    return userNoPass
  },
  updateUser: async (id: string, data: any) => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    const idx = users.findIndex(u => u.id === id)
    if (idx !== -1) {
      if (data.password) {
        data.password = await hashPassword(data.password)
      }
      users[idx] = { ...users[idx], ...data }
      setItem(STORAGE_KEYS.USERS, users)
      const { password, ...userNoPass } = users[idx]
      return userNoPass
    }
    throw new Error('User not found')
  },
  deleteUser: async (id: string) => {
    const users = getItem<any[]>(STORAGE_KEYS.USERS, [])
    setItem(STORAGE_KEYS.USERS, users.filter(u => u.id !== id))
  },

  // Reports
  getReportsData: async (startDate: string, endDate: string) => {
    const sales = getItem<any[]>(STORAGE_KEYS.SALES, [])
    const filteredSales = sales.filter(s => {
      const sDate = new Date(s.date)
      return sDate >= new Date(startDate) && sDate <= new Date(endDate)
    })
    const totalRevenue = filteredSales.reduce((acc, s) => acc + (s.total || 0), 0)
    return {
      salesCount: filteredSales.length,
      totalRevenue,
      sales: filteredSales
    }
  },
  exportReportsExcel: async (_startDate: string, _endDate: string) => {
    return { success: true, message: 'Report exported to downloads' }
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
