import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusCircle, Search, Phone, Mail, Eye, Edit2, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Supplier } from '@/types'

const supplierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Supplier name is required'),
  contact: z.string().optional(),
  email: z.string().email('Invalid email address').or(z.literal('')),
  address: z.string().optional(),
})
type SupplierFormData = z.infer<typeof supplierSchema>

const ITEMS_PER_PAGE = 15

export default function Suppliers() {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => window.api.getSuppliers(),
  })

  const createSupplierMutation = useMutation({
    mutationFn: (data: SupplierFormData) => window.api.createSupplier(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      closeModal()
    },
  })

  const updateSupplierMutation = useMutation({
    mutationFn: (data: SupplierFormData) => window.api.updateSupplier(data.id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      closeModal()
    },
  })

  const deleteSupplierMutation = useMutation({
    mutationFn: (id: string) => window.api.deleteSupplier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setIsDeleteDialogOpen(false)
      setSupplierToDelete(null)
    },
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
  })

  const onSubmit = (data: SupplierFormData) => {
    if (editingSupplier) {
      updateSupplierMutation.mutate(data)
    } else {
      createSupplierMutation.mutate(data)
    }
  }

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier)
    setValue('id', supplier.id)
    setValue('name', supplier.name)
    setValue('contact', supplier.contact || '')
    setValue('email', supplier.email || '')
    setValue('address', supplier.address || '')
    setIsOpen(true)
  }

  const closeModal = () => {
    setIsOpen(false)
    setEditingSupplier(null)
    reset()
  }

  const openDeleteModal = (supplier: Supplier) => {
    setSupplierToDelete(supplier)
    setIsDeleteDialogOpen(true)
  }

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.email && s.email.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / ITEMS_PER_PAGE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE
  const paginatedSuppliers = filteredSuppliers.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  const totalSuppliers = suppliers.length
  const totalPayable = suppliers.reduce((sum, s) => sum + (s.totalPayable || 0), 0)
  const thisMonthPurchases = suppliers.reduce((sum, s) => sum + (s.thisMonthPurchases || 0), 0)

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
      case 'overdue':
        return 'bg-red-50 text-red-700 ring-1 ring-red-200'
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200'
      default:
        return 'bg-gray-50 text-gray-700 ring-1 ring-gray-200'
    }
  }

  const getStatusDot = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-emerald-500'
      case 'overdue':
        return 'bg-red-500'
      case 'pending':
        return 'bg-yellow-500'
      default:
        return 'bg-gray-500'
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 font-sans">
      <div className="relative overflow-hidden rounded-2xl border border-blue-200 p-6 text-white shadow-lg shadow-blue-500/10" style={{ backgroundColor: '#2563eb' }}>
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan-300/20 blur-2xl" />
        <div className="absolute -bottom-12 left-10 h-28 w-28 rounded-full bg-violet-300/20 blur-2xl" />
        <div className="absolute right-14 top-10 h-20 w-20 rounded-full border border-white/20 bg-white/5" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-100">
                Supplier network
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-medium text-emerald-100 ring-1 ring-inset ring-emerald-200/30">
                Active vendors
              </span>
            </div>
            <h2 className="text-2xl font-bold">Suppliers</h2>
            <p className="max-w-2xl text-sm text-blue-50/90">Track vendor relationships, outstanding balances, and monthly purchases in one place.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.2em] text-blue-100">Suppliers</p>
              <p className="text-lg font-semibold">{totalSuppliers}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-emerald-400/15 px-3 py-2 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-100">Payable</p>
              <p className="text-lg font-semibold">${totalPayable.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-amber-400/15 px-3 py-2 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.2em] text-amber-100">Purchases</p>
              <p className="text-lg font-semibold">${thisMonthPurchases.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Vendor registry</h2>
              <p className="text-sm text-slate-500">Monitor your supplier base and payment status.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search suppliers..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="border-slate-200 bg-slate-50 pl-9"
                />
              </div>
              <Button
                onClick={() => {
                  reset()
                  setEditingSupplier(null)
                  setIsOpen(true)
                }}
                className="gap-2 text-white"
                style={{ backgroundColor: '#2563eb' }}
              >
                <PlusCircle className="w-4 h-4" /> Add Supplier
              </Button>
            </div>
          </div>

          <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Supplier Name</Label>
                  <Input {...register('name')} placeholder="e.g. Apex Biotech" />
                  {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Contact Number</Label>
                  <Input {...register('contact')} placeholder="e.g. +1 555-0100" />
                </div>

                <div className="space-y-1.5">
                  <Label>Email Address</Label>
                  <Input {...register('email')} placeholder="e.g. info@apexbiotech.com" />
                  {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Business Address</Label>
                  <Input {...register('address')} placeholder="e.g. 50 Pharma Road, NJ" />
                </div>

                <Button type="submit" className="mt-4 w-full text-white" style={{ backgroundColor: '#2563eb' }}>
                  {editingSupplier ? 'Update Supplier' : 'Save Supplier'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Deletion</DialogTitle>
              </DialogHeader>
              <div className="py-4">
                <p className="text-gray-600">Are you sure you want to delete supplier <strong>{supplierToDelete?.name}</strong>? This action cannot be undone.</p>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={() => deleteSupplierMutation.mutate(supplierToDelete?.id as string)}>Delete</Button>
              </div>
            </DialogContent>
          </Dialog>

          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            </div>
          ) : (
            <div className="max-h-[min(60vh,560px)] overflow-x-auto overflow-y-auto rounded-xl border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50">
                    <TableHead className="text-slate-700">Supplier</TableHead>
                    <TableHead className="text-slate-700">Phone</TableHead>
                    <TableHead className="text-slate-700">Email</TableHead>
                    <TableHead className="text-slate-700">Total Payable</TableHead>
                    <TableHead className="text-slate-700">Status</TableHead>
                    <TableHead className="text-center text-slate-700">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSuppliers.map((sup) => (
                    <TableRow key={sup.id} className="border-b border-slate-100 bg-white transition-colors hover:bg-gradient-to-r hover:from-blue-50 hover:via-white hover:to-indigo-50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-sm font-semibold text-white">
                            {getInitials(sup.name)}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-800">{sup.name}</div>
                            <div className="text-xs text-slate-500">Vendor profile</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-700">{sup.contact || 'N/A'}</TableCell>
                      <TableCell className="text-slate-700">{sup.email || 'N/A'}</TableCell>
                      <TableCell className="font-semibold text-slate-800">${(sup.totalPayable || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(sup.status || 'active')}`}>
                          <span className={`h-2 w-2 rounded-full ${getStatusDot(sup.status || 'active')}`} />
                          {sup.status || 'Active'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-center gap-1.5">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700" onClick={() => openEditModal(sup)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => openDeleteModal(sup)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {paginatedSuppliers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                        No suppliers found matching the search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {filteredSuppliers.length > 0 && (
            <div className="mt-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Showing <span className="font-semibold text-slate-800">{startIndex + 1}</span>
                {' '}-<span className="font-semibold text-slate-800">{Math.min(startIndex + ITEMS_PER_PAGE, filteredSuppliers.length)}</span>
                {' '}of <span className="font-semibold text-slate-800">{filteredSuppliers.length}</span> suppliers
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={safeCurrentPage === 1}
                  className="h-8 w-8 rounded-md p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <Button
                    key={page}
                    variant={page === safeCurrentPage ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className={page === safeCurrentPage ? 'h-8 min-w-8 bg-blue-600 text-white hover:bg-blue-700' : 'h-8 min-w-8'}
                  >
                    {page}
                  </Button>
                ))}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={safeCurrentPage === totalPages}
                  className="h-8 w-8 rounded-md p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
