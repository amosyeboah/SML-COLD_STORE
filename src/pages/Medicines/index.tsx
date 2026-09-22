import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusCircle, Search, Trash2, Edit2, Tags, Package, ChevronsLeft, ChevronsRight, Snowflake, Lock, AlertTriangle, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Medicine, Category } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'

const medSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  genericName: z.string().optional(),
  sku: z.string().min(1, 'Barcode/SKU is required'),
  categoryId: z.string().min(1, 'Category is required'),
  price: z.preprocess((v) => Number(v), z.number().min(0)),
  cost: z.preprocess((v) => Number(v), z.number().min(0)),
  minStockLevel: z.preprocess((v) => Number(v), z.number().min(1)),
})
type MedFormData = z.infer<typeof medSchema>

const ITEMS_PER_PAGE = 15

export default function Medicines() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const apiClient = typeof window !== 'undefined' && window.api ? window.api : api

  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [editingMed, setEditingMed] = useState<Medicine | null>(null)
  const [isMedOpen, setIsMedOpen] = useState(false)
  const [isCatOpen, setIsCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [productToDelete, setProductToDelete] = useState<Medicine | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data: medicines = [], isLoading: medsLoading } = useQuery<Medicine[]>({
    queryKey: ['medicines'],
    queryFn: () => apiClient.getMedicines(),
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => apiClient.getCategories(),
  })

  const { data: batches = [] } = useQuery<any[]>({
    queryKey: ['batches'],
    queryFn: () => apiClient.getBatches(),
  })

  const createMedMutation = useMutation({
    mutationFn: (data: MedFormData) => apiClient.createMedicine(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      setIsMedOpen(false)
    },
  })

  const updateMedMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: MedFormData }) => apiClient.updateMedicine(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      setEditingMed(null)
      setIsMedOpen(false)
    },
  })

  const deleteMedMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteMedicine(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      queryClient.invalidateQueries({ queryKey: ['batches'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setIsDeleteDialogOpen(false)
      setProductToDelete(null)
      setDeleteError(null)
    },
    onError: (err: any) => {
      setDeleteError(err?.message || 'Failed to delete product. Please check related stock records.')
    },
  })

  const createCatMutation = useMutation({
    mutationFn: (name: string) => apiClient.createCategory({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNewCatName('')
      setIsCatOpen(false)
    },
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<MedFormData>({
    resolver: zodResolver(medSchema),
  })

  const handleOpenCreate = () => {
    setEditingMed(null)
    reset({ name: '', genericName: '', sku: '', categoryId: '', price: 0, cost: 0, minStockLevel: 10 })
    setIsMedOpen(true)
  }

  const handleOpenEdit = (med: Medicine) => {
    setEditingMed(med)
    setValue('name', med.name)
    setValue('genericName', med.genericName || '')
    setValue('sku', med.sku)
    setValue('categoryId', med.categoryId)
    setValue('price', med.price)
    setValue('cost', med.cost)
    setValue('minStockLevel', med.minStockLevel)
    setIsMedOpen(true)
  }

  const onSubmit = (data: MedFormData) => {
    if (editingMed) {
      updateMedMutation.mutate({ id: editingMed.id, data })
    } else {
      createMedMutation.mutate(data)
    }
  }

  const filteredMedicines = medicines.filter((m) =>
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.genericName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.sku.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const totalPages = Math.max(1, Math.ceil(filteredMedicines.length / ITEMS_PER_PAGE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE
  const paginatedMedicines = filteredMedicines.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  const totalMedicines = medicines.length
  const totalCategories = categories.length
  const reorderFocus = medicines.filter((med) => med.minStockLevel >= 50).length

  const getMedStock = (med: Medicine) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const medBatches = batches.filter(
      (b: any) => (b.medicineId === med.id || b.medicine?.id === med.id) && b.quantity > 0 && new Date(b.expiryDate) >= today
    )
    const liveStock = medBatches.reduce((acc: number, b: any) => acc + b.quantity, 0)
    const activeBatchesCount = medBatches.length
    const stockTone =
      liveStock === 0
        ? 'bg-rose-50 text-rose-700 ring-rose-200'
        : liveStock <= med.minStockLevel
          ? 'bg-amber-50 text-amber-700 ring-amber-200'
          : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    return { liveStock, activeBatchesCount, stockTone }
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
                Cold store catalog
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-400/20 px-2.5 py-0.5 sm:py-1 text-[10px] font-medium text-emerald-100 ring-1 ring-inset ring-emerald-200/30">
                Inventory healthy
              </span>
            </div>
            <h2 className="text-lg sm:text-2xl font-bold">Products &amp; Stock</h2>
            <p className="max-w-2xl text-xs sm:text-sm text-blue-50/90 hidden sm:block landscape:block landscape:text-xs">Manage your frozen foods catalog with a clear view of carton pricing, categories, and reorder levels.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 flex-shrink-0">
            <div className="rounded-xl border border-white/10 bg-emerald-400/15 px-2.5 py-1.5 sm:px-3 sm:py-2 backdrop-blur">
              <p className="text-[9px] sm:text-[11px] uppercase tracking-[0.2em] text-emerald-100">Products</p>
              <p className="text-base sm:text-lg font-semibold">{totalMedicines}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-amber-400/15 px-2.5 py-1.5 sm:px-3 sm:py-2 backdrop-blur">
              <p className="text-[9px] sm:text-[11px] uppercase tracking-[0.2em] text-amber-100">Categories</p>
              <p className="text-base sm:text-lg font-semibold">{totalCategories}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-rose-400/15 px-2.5 py-1.5 sm:px-3 sm:py-2 backdrop-blur">
              <p className="text-[9px] sm:text-[11px] uppercase tracking-[0.2em] text-rose-100">Low Stock</p>
              <p className="text-base sm:text-lg font-semibold">{reorderFocus}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-slate-800">Product Directory</h3>
          <p className="text-xs sm:text-sm text-slate-500">Search quickly and keep your cold store catalog organized.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-emerald-500" /> In stock
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
            <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-amber-500" /> Low stock
          </span>

          {!canManage ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
              <Lock className="w-3.5 h-3.5 text-slate-400" /> Read-Only Catalog (Cashier)
            </span>
          ) : (
            <>
              <Dialog open={isCatOpen} onOpenChange={setIsCatOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-1.5 border-sky-200 bg-white text-sky-700 hover:bg-sky-50 h-8.5 sm:h-9 text-xs sm:text-sm">
                    <Tags className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Add Category
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add Product Category</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label>Category Name</Label>
                      <Input
                        placeholder="e.g. Poultry & Chicken"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                      />
                    </div>
                    <Button
                      onClick={() => createCatMutation.mutate(newCatName)}
                      disabled={!newCatName.trim()}
                      className="w-full text-white"
                      style={{ backgroundColor: '#2563eb' }}
                    >
                      Save Category
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Button onClick={handleOpenCreate} className="gap-1.5 text-white h-8.5 sm:h-9 text-xs sm:text-sm" style={{ backgroundColor: '#2563eb' }}>
                <PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Add Product
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Table Card ──────────────────────────────────────────────── */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Package className="w-4 h-4 text-sky-600" />
            Products Catalog
          </CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search by product name, cut, or SKU..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 border-slate-200 bg-slate-50"
            />
          </div>
        </CardHeader>
        <CardContent>
          {medsLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            </div>
          ) : (
            <>
              {/* ── Card layout: portrait tablet & small screens ── */}
              <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 landscape:grid-cols-2 md:grid-cols-2 gap-3 max-h-[calc(100vh-290px)] landscape:max-h-[calc(100vh-210px)] overflow-y-auto pr-0.5">
                {paginatedMedicines.length === 0 && (
                  <p className="col-span-full py-8 text-center text-sm text-slate-500">No products found matching the search criteria.</p>
                )}
                {paginatedMedicines.map((med) => {
                  const { liveStock, activeBatchesCount, stockTone } = getMedStock(med)
                  return (
                    <div key={med.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0">
                            <Package className="w-4 h-4 text-sky-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-sm truncate">{med.name}</p>
                            <p className="text-xs text-slate-400 truncate">{med.genericName || 'Standard cut'}</p>
                          </div>
                        </div>
                        {canManage && (
                          <div className="flex gap-1.5 flex-shrink-0">
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100"
                              onClick={() => handleOpenEdit(med)}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 rounded-md bg-red-50 text-red-600 hover:bg-red-100"
                              onClick={() => {
                                setProductToDelete(med)
                                setDeleteError(null)
                                setIsDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div>
                          <span className="text-slate-400">SKU</span>
                          <p className="font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 inline-block mt-0.5">{med.sku}</p>
                        </div>
                        <div>
                          <span className="text-slate-400">Category</span>
                          <p className="font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 inline-block mt-0.5">{med.category?.name || 'Uncategorized'}</p>
                        </div>
                        <div>
                          <span className="text-slate-400">Cost</span>
                          <p className="font-semibold text-slate-700">₵{med.cost.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-slate-400">Selling Price</span>
                          <p className="font-bold text-emerald-700">₵{med.price.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-slate-400">Live Stock</span>
                          <p className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${stockTone}`}>
                            {liveStock} cartons ({activeBatchesCount} lot{activeBatchesCount === 1 ? '' : 's'})
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Min Stock</span>
                          <p className="font-semibold text-slate-700">{med.minStockLevel}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* ── Full table: landscape tablet & desktop ── */}
              <div className="hidden lg:block max-h-[calc(100vh-320px)] landscape:max-h-[calc(100vh-220px)] overflow-y-auto overflow-x-auto rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50">
                      <TableHead className="text-slate-700">Product Name</TableHead>
                      <TableHead className="text-slate-700">Origin / Cut / Brand</TableHead>
                      <TableHead className="text-slate-700">Category</TableHead>
                      <TableHead className="text-right text-slate-700">Cost Price</TableHead>
                      <TableHead className="text-right text-slate-700">Selling Price</TableHead>
                      <TableHead className="text-right text-slate-700">Live Stock</TableHead>
                      <TableHead className="text-right text-slate-700">Min Stock</TableHead>
                      <TableHead className="text-center text-slate-700">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedMedicines.map((med) => {
                      const { liveStock, activeBatchesCount, stockTone } = getMedStock(med)
                      return (
                        <TableRow
                          key={med.id}
                          className="border-b border-slate-100 bg-white transition-colors hover:bg-gradient-to-r hover:from-blue-50 hover:via-white hover:to-indigo-50"
                        >
                          <TableCell className="py-2.5 sm:py-3">
                            <div className="font-semibold text-slate-800">{med.name}</div>
                            <span className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-600 mt-1">
                              {med.sku}
                            </span>
                          </TableCell>
                          <TableCell className="text-slate-500 py-2.5 sm:py-3">{med.genericName || 'N/A'}</TableCell>
                          <TableCell className="py-2.5 sm:py-3">
                            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                              {med.category?.name || 'Uncategorized'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right py-2.5 sm:py-3">
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                              ₵{med.cost.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right py-2.5 sm:py-3">
                            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                              ₵{med.price.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right py-2.5 sm:py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${stockTone}`}>
                              {liveStock} cartons ({activeBatchesCount} lot{activeBatchesCount === 1 ? '' : 's'})
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-slate-500 py-2.5 sm:py-3">{med.minStockLevel}</TableCell>
                          <TableCell className="py-2.5 sm:py-3">
                            {canManage ? (
                              <div className="flex justify-center gap-1.5">
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-8 w-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700"
                                  onClick={() => handleOpenEdit(med)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-8 w-8 rounded-md bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                  onClick={() => {
                                    setProductToDelete(med)
                                    setDeleteError(null)
                                    setIsDeleteDialogOpen(true)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex justify-center">
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                                  <Lock className="w-3 h-3" /> Locked
                                </span>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {filteredMedicines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-slate-500">
                          No medicines found matching the search criteria.
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

      {/* ── Pagination ─────────────────────────────────────────────── */}
      {filteredMedicines.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 sm:py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs sm:text-sm text-slate-600">
            Showing <span className="font-semibold text-slate-800">{filteredMedicines.length === 0 ? 0 : startIndex + 1}</span>
            {' '}-<span className="font-semibold text-slate-800">{Math.min(startIndex + ITEMS_PER_PAGE, filteredMedicines.length)}</span>
            {' '}of <span className="font-semibold text-slate-800">{filteredMedicines.length}</span> items
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

      {/* ── Add / Edit Dialog ──────────────────────────────────────── */}
      <Dialog open={isMedOpen} onOpenChange={setIsMedOpen}>
        <DialogContent className="max-w-xl w-[calc(100vw-2rem)] sm:w-full max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingMed ? 'Edit Product' : 'Add New Product'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Product Name</Label>
                <Input {...register('name')} placeholder="e.g. Hard Chicken 10kg Carton" />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Origin / Cut / Brand</Label>
                <Input {...register('genericName')} placeholder="e.g. Brazilian / Tyson / Dutch Mackerel" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>SKU / Barcode</Label>
                <Input {...register('sku')} placeholder="e.g. 8410293048512" />
                {errors.sku && <p className="text-xs text-red-500">{errors.sku.message}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Category</Label>
                <select
                  {...register('categoryId')}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Select a category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {errors.categoryId && <p className="text-xs text-red-500">{errors.categoryId.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Cost Price per Carton (₵)</Label>
                <Input type="number" step="0.01" {...register('cost')} />
                {errors.cost && <p className="text-xs text-red-500">{errors.cost.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Selling Price per Carton (₵)</Label>
                <Input type="number" step="0.01" {...register('price')} />
                {errors.price && <p className="text-xs text-red-500">{errors.price.message}</p>}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Minimum Stock Level (Cartons / Boxes)</Label>
                <Input type="number" {...register('minStockLevel')} />
                {errors.minStockLevel && <p className="text-xs text-red-500">{errors.minStockLevel.message}</p>}
              </div>
            </div>
            <Button type="submit" className="mt-4 w-full text-white" style={{ backgroundColor: '#2563eb' }}>
              {editingMed ? 'Update Product' : 'Save Product'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {/* ── Delete Confirmation Modal ───────────────────────────────────────── */}
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeleteDialogOpen(false)
            setDeleteError(null)
          }
        }}
      >
        <DialogContent className="max-w-md w-[calc(100vw-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Delete Product
            </DialogTitle>
          </DialogHeader>
          {productToDelete && (() => {
            const { liveStock, activeBatchesCount } = getMedStock(productToDelete)
            return (
              <div className="py-3 space-y-3">
                <p className="text-sm text-slate-600 leading-relaxed">
                  Are you sure you want to permanently delete{' '}
                  <strong className="text-slate-900 font-semibold">"{productToDelete.name}"</strong>?
                </p>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Barcode / SKU:</span>
                    <span className="font-mono font-semibold text-blue-700">{productToDelete.sku}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Category:</span>
                    <span className="font-medium text-slate-700">{productToDelete.category?.name || 'Uncategorized'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Current Stock:</span>
                    <span className="font-semibold text-slate-800">{liveStock} cartons</span>
                  </div>
                </div>

                {liveStock > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      Notice: Active Inventory Lots
                    </p>
                    <p>
                      This product currently has <strong className="font-bold">{liveStock} cartons</strong> across{' '}
                      <strong className="font-bold">{activeBatchesCount} lot{activeBatchesCount === 1 ? '' : 's'}</strong> in cold storage. Deleting this product will also remove its associated stock lots.
                    </p>
                  </div>
                )}

                {deleteError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{deleteError}</span>
                  </div>
                )}
              </div>
            )
          })()}
          <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteDialogOpen(false)
                setDeleteError(null)
              }}
              disabled={deleteMedMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMedMutation.isPending}
              onClick={() => {
                if (productToDelete) {
                  deleteMedMutation.mutate(productToDelete.id)
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              {deleteMedMutation.isPending ? 'Deleting...' : 'Delete Product'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
