import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PlusCircle,
  Search,
  AlertCircle,
  ChevronsLeft,
  ChevronsRight,
  Package,
  AlertTriangle,
  CheckCircle2,
  Layers,
  SlidersHorizontal,
  Edit2,
  Check,
  Calendar,
  Loader2,
  Pencil,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Batch, Medicine } from '@/types'

const batchSchema = z.object({
  medicineId: z.string().min(1, 'Product is required'),
  batchNumber: z.string().min(1, 'Batch number is required'),
  expiryDate: z.string().min(1, 'Expiry date is required'),
  quantity: z.preprocess((v) => Number(v), z.number().min(1, 'Quantity must be at least 1')),
})
type BatchFormData = z.infer<typeof batchSchema>

const ITEMS_PER_PAGE = 12

export default function Inventory() {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out' | 'healthy'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [isOpen, setIsOpen] = useState(false)
  const [selectedMedicineForBatch, setSelectedMedicineForBatch] = useState<string>('')
  const [isManageLotsOpen, setIsManageLotsOpen] = useState(false)
  const [selectedMedicineForLots, setSelectedMedicineForLots] = useState<Medicine | null>(null)
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null)
  const [editQuantity, setEditQuantity] = useState<number>(0)
  const [editBatchNumber, setEditBatchNumber] = useState<string>('')
  const [editExpiryDate, setEditExpiryDate] = useState<string>('')
  const [modalTab, setModalTab] = useState<'lots' | 'restock'>('lots')
  const [newLotNumber, setNewLotNumber] = useState('')
  const [newLotQuantity, setNewLotQuantity] = useState<number | ''>('')
  const [newLotExpiry, setNewLotExpiry] = useState('')
  const [newLotError, setNewLotError] = useState('')

  const { data: batches = [], isLoading: batchesLoading } = useQuery<Batch[]>({
    queryKey: ['batches'],
    queryFn: () => window.api.getBatches(),
  })

  const { data: medicines = [], isLoading: medicinesLoading } = useQuery<Medicine[]>({
    queryKey: ['medicines'],
    queryFn: () => window.api.getMedicines(),
  })

  const createBatchMutation = useMutation({
    mutationFn: (data: BatchFormData) => window.api.createBatch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] })
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      setIsOpen(false)
      reset()
    },
  })

  const updateBatchMutation = useMutation({
    mutationFn: (data: { id: string; batchNumber: string; quantity: number; expiryDate: string }) =>
      window.api.updateBatch(data.id, {
        batchNumber: data.batchNumber,
        quantity: data.quantity,
        expiryDate: data.expiryDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] })
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      setEditingBatchId(null)
    },
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<BatchFormData>({
    resolver: zodResolver(batchSchema),
  })

  const openAddBatchModal = (medicineId?: string) => {
    if (medicineId) {
      setValue('medicineId', medicineId)
      setSelectedMedicineForBatch(medicineId)
    }
    setIsOpen(true)
  }

  const openManageLotsModal = (med: Medicine, defaultTab: 'lots' | 'restock' = 'lots') => {
    setSelectedMedicineForLots(med)
    setEditingBatchId(null)
    setModalTab(defaultTab)
    setNewLotNumber('')
    setNewLotQuantity('')
    setNewLotExpiry('')
    setNewLotError('')
    setIsManageLotsOpen(true)
  }

  const handleModalRestock = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedMedicineForLots) return
    if (!newLotNumber.trim()) {
      setNewLotError('Lot / Pallet / Batch # is required')
      return
    }
    if (!newLotQuantity || Number(newLotQuantity) <= 0) {
      setNewLotError('Cartons quantity must be at least 1')
      return
    }
    if (!newLotExpiry) {
      setNewLotError('Best Before / Expiry date is required')
      return
    }
    setNewLotError('')
    createBatchMutation.mutate(
      {
        medicineId: selectedMedicineForLots.id,
        batchNumber: newLotNumber.trim().toUpperCase(),
        quantity: Number(newLotQuantity),
        expiryDate: newLotExpiry,
      },
      {
        onSuccess: () => {
          setNewLotNumber('')
          setNewLotQuantity('')
          setNewLotExpiry('')
          setModalTab('lots')
        },
      }
    )
  }

  const handleStartEditBatch = (batch: Batch) => {
    setEditingBatchId(batch.id)
    setEditQuantity(batch.quantity)
    setEditBatchNumber(batch.batchNumber)
    setEditExpiryDate(new Date(batch.expiryDate).toISOString().split('T')[0])
  }

  const handleSaveBatchEdit = (batchId: string) => {
    if (editQuantity < 0 || !editBatchNumber || !editExpiryDate) return
    updateBatchMutation.mutate({
      id: batchId,
      batchNumber: editBatchNumber,
      quantity: editQuantity,
      expiryDate: editExpiryDate,
    })
  }

  const getLotStatus = (expiryDate: string) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const exp = new Date(expiryDate)
    if (exp < today) return { label: 'Expired', color: 'bg-rose-50 text-rose-700 border-rose-200' }
    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays <= 30) return { label: `Expires in ${diffDays}d`, color: 'bg-amber-50 text-amber-700 border-amber-200' }
    return { label: 'Active', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  }

  const lotsForSelectedMedicine = useMemo(() => {
    if (!selectedMedicineForLots) return []
    return batches.filter(
      (b) => ((b as any).medicineId || (b as any).medicine?.id) === selectedMedicineForLots.id
    )
  }, [batches, selectedMedicineForLots])

  const selectedMedValidStock = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return lotsForSelectedMedicine.reduce((sum, b) => {
      const isExp = new Date(b.expiryDate) < today
      return !isExp && b.quantity > 0 ? sum + b.quantity : sum
    }, 0)
  }, [lotsForSelectedMedicine])

  const onSubmit = (data: BatchFormData) => {
    createBatchMutation.mutate(data)
  }

  // Aggregate stock statistics per Medicine
  const aggregatedInventory = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const batchMap = new Map<string, { validStock: number; expiredStock: number; batchCount: number; earliestExp?: string }>()

    for (const b of batches) {
      const medId = (b as any).medicineId || (b as any).medicine?.id
      if (!medId) continue
      if (!batchMap.has(medId)) {
        batchMap.set(medId, { validStock: 0, expiredStock: 0, batchCount: 0 })
      }
      const item = batchMap.get(medId)!
      const isExp = new Date(b.expiryDate) < today
      if (b.quantity > 0) {
        if (isExp) {
          item.expiredStock += b.quantity
        } else {
          item.validStock += b.quantity
          item.batchCount += 1
        }
      }
    }

    return medicines.map((med) => {
      const stats = batchMap.get(med.id) || { validStock: 0, expiredStock: 0, batchCount: 0 }
      const validStock = stats.validStock
      const minStock = med.minStockLevel || 10

      let status: 'healthy' | 'low' | 'out' = 'healthy'
      if (validStock === 0) status = 'out'
      else if (validStock <= minStock) status = 'low'

      const inventoryValue = validStock * (med.cost || med.price)

      return { medicine: med, validStock, expiredStock: stats.expiredStock, batchCount: stats.batchCount, minStock, status, inventoryValue }
    })
  }, [medicines, batches])

  const filteredInventory = useMemo(() => {
    const q = searchTerm.toLowerCase()
    return aggregatedInventory.filter((item) => {
      const matchSearch =
        !q ||
        item.medicine.name.toLowerCase().includes(q) ||
        item.medicine.genericName?.toLowerCase().includes(q) ||
        item.medicine.sku?.toLowerCase().includes(q)
      const matchStatus = statusFilter === 'all' || item.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [aggregatedInventory, searchTerm, statusFilter])

  const totalSKUs = medicines.length
  const totalStockUnits = aggregatedInventory.reduce((acc, i) => acc + i.validStock, 0)
  const lowStockCount = aggregatedInventory.filter((i) => i.status === 'low').length
  const outOfStockCount = aggregatedInventory.filter((i) => i.status === 'out').length

  const totalPages = Math.max(1, Math.ceil(filteredInventory.length / ITEMS_PER_PAGE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE
  const paginatedInventory = filteredInventory.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  const statusBadge = (status: 'healthy' | 'low' | 'out') => {
    if (status === 'out') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
        <AlertCircle className="h-3.5 w-3.5" /> Out of Stock
      </span>
    )
    if (status === 'low') return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" /> Low Stock
      </span>
    )
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5" /> Healthy
      </span>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4 md:p-6 landscape:p-3.5 space-y-3.5 sm:space-y-4 md:space-y-6 font-sans">

      {/* ── Hero Banner ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-200 p-3.5 sm:p-5 md:p-6 landscape:py-3 landscape:px-4 text-white shadow-lg shadow-blue-500/10" style={{ backgroundColor: '#2563eb' }}>
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan-300/20 blur-2xl" />
        <div className="absolute -bottom-12 left-10 h-28 w-28 rounded-full bg-violet-300/20 blur-2xl" />
        <div className="absolute right-14 top-10 h-20 w-20 rounded-full border border-white/20 bg-white/5" />

        <div className="relative flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between landscape:flex-row landscape:items-center landscape:justify-between">
          <div className="space-y-1 sm:space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 sm:py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-100">
                Aggregated Inventory Control
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-400/20 px-2.5 py-0.5 sm:py-1 text-[10px] font-medium text-emerald-100 ring-1 ring-inset ring-emerald-200/30">
                Real-time stock totals
              </span>
            </div>
            <h2 className="text-lg sm:text-2xl font-bold">Inventory Management</h2>
            <p className="max-w-2xl text-xs sm:text-sm text-blue-50/90 hidden sm:block landscape:block landscape:text-xs">Monitor aggregated cold store stock levels per product, carton valuation, and reorder thresholds across active lots.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 flex-shrink-0">
            <div className="rounded-xl border border-white/10 bg-white/10 px-2.5 py-1.5 sm:px-3 sm:py-2 backdrop-blur">
              <p className="text-[9px] sm:text-[11px] uppercase tracking-[0.2em] text-sky-100">Total Products</p>
              <p className="text-base sm:text-lg font-semibold">{totalSKUs}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-emerald-400/15 px-2.5 py-1.5 sm:px-3 sm:py-2 backdrop-blur">
              <p className="text-[9px] sm:text-[11px] uppercase tracking-[0.2em] text-emerald-100">Cartons / Units</p>
              <p className="text-base sm:text-lg font-semibold">{totalStockUnits}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-amber-400/15 px-2.5 py-1.5 sm:px-3 sm:py-2 backdrop-blur">
              <p className="text-[9px] sm:text-[11px] uppercase tracking-[0.2em] text-amber-100">Low Stock</p>
              <p className="text-base sm:text-lg font-semibold">{lowStockCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-rose-400/15 px-2.5 py-1.5 sm:px-3 sm:py-2 backdrop-blur">
              <p className="text-[9px] sm:text-[11px] uppercase tracking-[0.2em] text-rose-100">Out of Stock</p>
              <p className="text-base sm:text-lg font-semibold">{outOfStockCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-800">Product Stock Overview</h3>
          <p className="text-xs sm:text-sm text-slate-500">Aggregated quantities and carton totals across active cold storage lots.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => openAddBatchModal()} className="gap-1.5 text-white font-medium shadow-sm h-8.5 sm:h-9 text-xs sm:text-sm" style={{ backgroundColor: '#2563eb' }}>
              <PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Receive Stock Lot
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Receive Cold Store Lot</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Product Item</Label>
                <select
                  {...register('medicineId')}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Select product</option>
                  {medicines.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.genericName || 'Standard cut'})</option>
                  ))}
                </select>
                {errors.medicineId && <p className="text-xs text-red-500">{errors.medicineId.message}</p>}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Lot / Pallet / Batch #</Label>
                  <Input {...register('batchNumber')} placeholder="e.g. LOT-2024A / PLT-01" />
                  {errors.batchNumber && <p className="text-xs text-red-500">{errors.batchNumber.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Cartons Received</Label>
                  <Input type="number" {...register('quantity')} />
                  {errors.quantity && <p className="text-xs text-red-500">{errors.quantity.message}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Best Before / Expiry Date</Label>
                <Input type="date" {...register('expiryDate')} />
                {errors.expiryDate && <p className="text-xs text-red-500">{errors.expiryDate.message}</p>}
              </div>
              <Button type="submit" className="mt-4 w-full bg-blue-600 text-white hover:bg-blue-700">
                Receive Stock Lot
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Stock Table Card ─────────────────────────────────────────── */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-3 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              <CardTitle className="text-base font-semibold text-slate-800">Live Inventory Registry</CardTitle>
            </div>
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by product, cut/origin, SKU..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
                className="border-slate-200 bg-slate-50 pl-9 text-xs"
              />
            </div>
          </div>

          {/* Status Filter — wraps naturally on narrow screens */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium mr-1">Filter:</span>
            {(['all', 'low', 'out'] as const).map((f) => {
              const label = f === 'all' ? `All (${aggregatedInventory.length})` : f === 'low' ? `Low Stock (${lowStockCount})` : `Out of Stock (${outOfStockCount})`
              const activeClass = f === 'all' ? 'bg-slate-800 text-white' : f === 'low' ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white'
              const inactiveClass = f === 'all' ? 'text-slate-600 hover:bg-slate-100' : f === 'low' ? 'text-amber-700 hover:bg-amber-50' : 'text-rose-700 hover:bg-rose-50'
              return (
                <button
                  key={f}
                  onClick={() => { setStatusFilter(f); setCurrentPage(1) }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${statusFilter === f ? activeClass : `border border-slate-200 bg-white ${inactiveClass}`}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </CardHeader>

        <CardContent>
          {medicinesLoading || batchesLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            <>
              {/* ── Card layout: portrait tablets & small screens ── */}
              <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 landscape:grid-cols-2 md:grid-cols-2 gap-3 max-h-[calc(100vh-290px)] landscape:max-h-[calc(100vh-210px)] overflow-y-auto pr-0.5">
                {paginatedInventory.length === 0 && (
                  <p className="col-span-full py-10 text-center text-sm text-slate-500">No products match the selected search or filter.</p>
                )}
                {paginatedInventory.map((item) => (
                  <div key={item.medicine.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                    {/* Card header row */}
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0">
                            <Package className="w-4 h-4 text-sky-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-sm truncate">{item.medicine.name}</p>
                            <p className="text-xs text-slate-400 truncate">{item.medicine.genericName || 'Standard cut'}</p>
                          </div>
                        </div>
                        {statusBadge(item.status)}
                      </div>

                      {/* Card detail grid */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
                        <div>
                          <span className="text-slate-400">SKU</span>
                          <p className="font-mono font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 inline-block mt-0.5">{item.medicine.sku}</p>
                        </div>
                        <div>
                          <span className="text-slate-400">Selling Price</span>
                          <p className="font-bold text-slate-800">₵{item.medicine.price.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-slate-400">Valid Stock</span>
                          <p className="font-bold text-slate-800">{item.validStock} units</p>
                          {item.expiredStock > 0 && (
                            <p className="text-[10px] text-rose-500">({item.expiredStock} expired excluded)</p>
                          )}
                        </div>
                        <div>
                          <span className="text-slate-400">Active Lots</span>
                          <p className="inline-flex items-center gap-1 font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 mt-0.5">
                            <Layers className="h-3 w-3" /> {item.batchCount} lot(s)
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Reorder Level</span>
                          <p className="font-semibold text-slate-600">Min: {item.minStock} units</p>
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openManageLotsModal(item.medicine)}
                      className="w-full h-8.5 text-xs gap-1.5 border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50/60 active:scale-95 mt-2 font-medium shadow-sm transition-all"
                    >
                      <Pencil className="h-3.5 w-3.5 text-blue-600" /> Adjust / Restock
                    </Button>
                  </div>
                ))}
              </div>

              {/* ── Full table: landscape tablet & desktop ── */}
              <div className="hidden lg:block max-h-[calc(100vh-320px)] landscape:max-h-[calc(100vh-220px)] overflow-y-auto overflow-x-auto rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50">
                      <TableHead className="text-slate-700">Product Item</TableHead>
                      <TableHead className="text-slate-700">Selling Price</TableHead>
                      <TableHead className="text-slate-700">Valid Stock Available</TableHead>
                      <TableHead className="text-slate-700">Active Lots</TableHead>
                      <TableHead className="text-slate-700">Reorder Level</TableHead>
                      <TableHead className="text-slate-700">Stock Status</TableHead>
                      <TableHead className="text-center text-slate-700">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedInventory.map((item) => (
                      <TableRow key={item.medicine.id} className="border-b border-slate-100 bg-white transition-colors hover:bg-slate-50/80">
                        <TableCell className="py-2.5 sm:py-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-slate-800 text-sm">{item.medicine.name}</p>
                              <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
                                {item.medicine.sku}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">{item.medicine.genericName || 'N/A'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold text-slate-900 py-2.5 sm:py-3">₵{item.medicine.price.toFixed(2)}</TableCell>
                        <TableCell className="py-2.5 sm:py-3">
                          <div className="flex flex-col gap-1">
                            <span className="font-bold text-slate-800 text-sm">{item.validStock} units</span>
                            {item.expiredStock > 0 && (
                              <span className="text-[10px] text-rose-500">({item.expiredStock} expired units excluded)</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 sm:py-3">
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                            <Layers className="h-3 w-3" /> {item.batchCount} lot(s)
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 py-2.5 sm:py-3">Min: {item.minStock} units</TableCell>
                        <TableCell className="py-2.5 sm:py-3">{statusBadge(item.status)}</TableCell>
                        <TableCell className="text-center py-2.5 sm:py-3">
                          <div className="flex items-center justify-center">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openManageLotsModal(item.medicine)}
                              className="h-8 px-2.5 text-xs gap-1.5 border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50/60 shadow-sm transition-all"
                              title="Adjust stock or restock lot"
                            >
                              <Pencil className="h-3.5 w-3.5 text-blue-600" />
                              <span className="font-medium">Adjust / Restock</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredInventory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-12 text-center text-slate-500">
                          No cold store products match the selected search or filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Pagination Footer ────────────────────────────────────────── */}
      {filteredInventory.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 sm:py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs sm:text-sm text-slate-600">
            Showing <span className="font-semibold text-slate-800">{startIndex + 1}</span>
            {' '}-<span className="font-semibold text-slate-800">{Math.min(startIndex + ITEMS_PER_PAGE, filteredInventory.length)}</span>
            {' '}of <span className="font-semibold text-slate-800">{filteredInventory.length}</span> products
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline" size="sm"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={safeCurrentPage === 1}
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-md p-0"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
              <Button
                key={page}
                variant={page === safeCurrentPage ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCurrentPage(page)}
                className={page === safeCurrentPage ? 'h-8 min-w-8 sm:h-9 sm:min-w-9 bg-blue-600 text-white hover:bg-blue-700' : 'h-8 min-w-8 sm:h-9 sm:min-w-9'}
              >
                {page}
              </Button>
            ))}
            <Button
              variant="outline" size="sm"
              onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={safeCurrentPage === totalPages}
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-md p-0"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Manage Lots / Adjust & Restock Modal ──────────────────────── */}
      <Dialog open={isManageLotsOpen} onOpenChange={setIsManageLotsOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-start justify-between gap-3 pr-6">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-base sm:text-lg font-bold text-slate-900">
                    {selectedMedicineForLots?.name}
                  </DialogTitle>
                  <span className="font-mono text-xs bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded">
                    {selectedMedicineForLots?.sku}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {selectedMedicineForLots?.genericName ? `${selectedMedicineForLots.genericName} • ` : ''}
                  Manage active lots, adjust carton counts, or receive fresh stock.
                </p>
              </div>
            </div>
            {/* Quick stats banner in modal */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 pt-2">
              <div className="rounded-lg bg-blue-50/70 border border-blue-100 px-3 py-2">
                <span className="text-[10px] uppercase font-bold text-blue-600 tracking-wider">Valid Stock</span>
                <p className="text-base sm:text-lg font-extrabold text-blue-900">{selectedMedValidStock} <span className="text-xs font-normal">cartons</span></p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Active Lots</span>
                <p className="text-base sm:text-lg font-extrabold text-slate-800">{lotsForSelectedMedicine.length} <span className="text-xs font-normal">lot(s)</span></p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 col-span-2 sm:col-span-1">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Reorder Min</span>
                <p className="text-base sm:text-lg font-extrabold text-slate-800">{selectedMedicineForLots?.minStockLevel || 10} <span className="text-xs font-normal">cartons</span></p>
              </div>
            </div>

            {/* Clean Segmented Navigation */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-xl border border-slate-200/80 mt-3">
              <button
                type="button"
                onClick={() => setModalTab('lots')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  modalTab === 'lots'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>Existing Lots &amp; Adjust ({lotsForSelectedMedicine.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setModalTab('restock')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  modalTab === 'restock'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5 text-blue-600" />
                <span>Receive / Restock Lot</span>
              </button>
            </div>
          </DialogHeader>

          {modalTab === 'lots' ? (
            <div className="space-y-3 py-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Cold Storage Lots ({lotsForSelectedMedicine.length})
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModalTab('restock')}
                  className="h-7 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Receive New Lot
                </Button>
              </div>

              {lotsForSelectedMedicine.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center bg-slate-50/50">
                  <Package className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                  <p className="text-sm font-semibold text-slate-700">No active stock lots found</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    This product currently has 0 cartons in stock. Click below to receive the first batch lot into cold storage.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => setModalTab('restock')}
                    className="mt-4 bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
                  >
                    <PlusCircle className="w-3.5 h-3.5" /> Receive First Lot
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {lotsForSelectedMedicine.map((batch) => {
                    const status = getLotStatus(batch.expiryDate)
                    const isEditing = editingBatchId === batch.id

                    return (
                      <div
                        key={batch.id}
                        className={`rounded-xl border transition-all ${
                          isEditing
                            ? 'border-blue-300 bg-blue-50/30 ring-1 ring-blue-300 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        } p-3.5`}
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-blue-800">Editing Lot Details</span>
                              <span className="text-[10px] text-slate-500">Lot ID: {batch.id.slice(0, 8)}...</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <div className="space-y-1">
                                <Label className="text-[11px] text-slate-600 font-semibold">Cartons in Lot (Quantity)</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  value={editQuantity}
                                  onChange={(e) => setEditQuantity(Number(e.target.value))}
                                  className="h-8.5 text-sm font-bold bg-white"
                                  autoFocus
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px] text-slate-600 font-semibold">Lot / Pallet / Batch #</Label>
                                <Input
                                  value={editBatchNumber}
                                  onChange={(e) => setEditBatchNumber(e.target.value)}
                                  className="h-8.5 text-xs bg-white"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px] text-slate-600 font-semibold">Best Before / Expiry</Label>
                                <Input
                                  type="date"
                                  value={editExpiryDate}
                                  onChange={(e) => setEditExpiryDate(e.target.value)}
                                  className="h-8.5 text-xs bg-white"
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={updateBatchMutation.isPending}
                                onClick={() => setEditingBatchId(null)}
                                className="h-8 text-xs text-slate-600"
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                disabled={updateBatchMutation.isPending}
                                onClick={() => handleSaveBatchEdit(batch.id)}
                                className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5 font-semibold"
                              >
                                {updateBatchMutation.isPending ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    Save Lot
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start sm:items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs flex-shrink-0 border border-blue-100">
                                <Layers className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono font-bold text-slate-800 text-xs">
                                    {batch.batchNumber}
                                  </span>
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.color}`}>
                                    {status.label}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3 text-slate-400" />
                                    Exp: {new Date(batch.expiryDate).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                              <div className="text-right">
                                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Cartons on Hand</span>
                                <span className="font-extrabold text-slate-900 text-sm">{batch.quantity} cartons</span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleStartEditBatch(batch)}
                                className="h-8 text-xs border-slate-200 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 gap-1.5"
                              >
                                <Edit2 className="w-3 h-3 text-blue-600" /> Adjust
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Restock Tab Form */
            <form onSubmit={handleModalRestock} className="space-y-4 py-3">
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs text-blue-800 flex items-center gap-2.5">
                <Package className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <span>
                  Receiving fresh inventory lot for <strong>{selectedMedicineForLots?.name}</strong> ({selectedMedicineForLots?.sku})
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Lot / Pallet / Batch # *</Label>
                  <Input
                    value={newLotNumber}
                    onChange={(e) => { setNewLotNumber(e.target.value); setNewLotError('') }}
                    placeholder="e.g. LOT-2024A / PLT-01"
                    className="h-9 text-xs"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Cartons Received *</Label>
                  <Input
                    type="number"
                    min="1"
                    value={newLotQuantity}
                    onChange={(e) => { setNewLotQuantity(e.target.value === '' ? '' : Number(e.target.value)); setNewLotError('') }}
                    placeholder="0"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Best Before / Expiry Date *</Label>
                  <Input
                    type="date"
                    value={newLotExpiry}
                    onChange={(e) => { setNewLotExpiry(e.target.value); setNewLotError('') }}
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              {newLotError && (
                <p className="text-xs text-red-500 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {newLotError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setModalTab('lots')}
                  className="h-8.5 text-xs text-slate-600"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createBatchMutation.isPending}
                  className="h-8.5 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5 font-semibold"
                >
                  {createBatchMutation.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Receiving...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="w-3.5 h-3.5" />
                      Receive &amp; Add Cartons
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

