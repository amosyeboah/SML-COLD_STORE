import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { format, startOfDay, startOfWeek, startOfMonth } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '@/services/api'

const ITEMS_PER_PAGE = 15

function getPaymentMethodColor(method: string) {
  const m = (method || '').toLowerCase()
  if (m.includes('split')) {
    return 'bg-purple-50 text-purple-700 ring-1 ring-purple-200'
  }
  if (m.includes('mobile') || m.includes('momo')) {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  }
  return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
}

export interface SalePaymentBreakdown {
  cash: number
  momo: number
  other: number
  isSplit: boolean
  displayLabel: string
}

export function getSaleBreakdown(sale: any): SalePaymentBreakdown {
  const total = Number(sale?.total) || 0

  // 1. If explicit payments array exists with items
  if (sale?.payments && Array.isArray(sale.payments) && sale.payments.length > 0) {
    let cash = 0
    let momo = 0
    let other = 0
    for (const p of sale.payments) {
      const method = (p.method || '').toUpperCase()
      const amt = Number(p.amount) || 0
      if (method.includes('MOBILE') || method.includes('MOMO')) {
        momo += amt
      } else if (method.includes('CASH')) {
        cash += amt
      } else {
        other += amt
      }
    }

    const isSplit =
      (sale.payments.length > 1 && ((cash > 0 && momo > 0) || (cash > 0 && other > 0) || (momo > 0 && other > 0))) ||
      (sale.paymentMethod || '').toUpperCase().includes('SPLIT')

    let displayLabel = 'CASH'
    if (isSplit) {
      displayLabel = `SPLIT (Cash ₵${cash.toFixed(2)} + MoMo ₵${momo.toFixed(2)}${other > 0 ? ` + Other ₵${other.toFixed(2)}` : ''})`
    } else if (momo > 0 && cash === 0) {
      displayLabel = 'MOMO'
    } else if (other > 0 && cash === 0 && momo === 0) {
      displayLabel = (sale.payments[0]?.method || 'OTHER').toUpperCase()
    }

    return { cash, momo, other, isSplit, displayLabel }
  }

  // 2. Parse paymentMethod string if encoded, e.g. "SPLIT:CASH=2700,MOBILE=300"
  const pm = (sale?.paymentMethod || 'CASH').toUpperCase()
  if (pm.startsWith('SPLIT:') || pm.includes('SPLIT')) {
    const cashMatch = pm.match(/CASH[=:]\s*([0-9.]+)/i)
    const mobileMatch = pm.match(/MOBILE[=:]\s*([0-9.]+)/i) || pm.match(/MOMO[=:]\s*([0-9.]+)/i)
    const c = cashMatch ? parseFloat(cashMatch[1]) : 0
    const m = mobileMatch ? parseFloat(mobileMatch[1]) : 0

    if (c > 0 || m > 0) {
      const remaining = Math.max(0, total - c - m)
      return {
        cash: c,
        momo: m,
        other: remaining,
        isSplit: true,
        displayLabel: `SPLIT (Cash ₵${c.toFixed(2)} + MoMo ₵${m.toFixed(2)}${remaining > 0 ? ` + Other ₵${remaining.toFixed(2)}` : ''})`,
      }
    }

    // SPLIT without specific numbers: split 50/50
    const half = Math.round((total / 2) * 100) / 100
    const otherHalf = Math.round((total - half) * 100) / 100
    return {
      cash: half,
      momo: otherHalf,
      other: 0,
      isSplit: true,
      displayLabel: `SPLIT (Cash ₵${half.toFixed(2)} + MoMo ₵${otherHalf.toFixed(2)})`,
    }
  }

  // 3. Direct Mobile / MoMo
  if (pm.includes('MOBILE') || pm.includes('MOMO')) {
    return { cash: 0, momo: total, other: 0, isSplit: false, displayLabel: 'MOMO' }
  }

  // 4. Other payment methods (Card / Bank)
  if (pm.includes('CARD') || pm.includes('BANK')) {
    return { cash: 0, momo: 0, other: total, isSplit: false, displayLabel: pm }
  }

  // 5. Default: Cash
  return { cash: total, momo: 0, other: 0, isSplit: false, displayLabel: 'CASH' }
}

export default function SalesHistory() {
  const [searchTerm, setSearchTerm] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('ALL')
  const [dateFilter, setDateFilter] = useState('WEEK')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedSale, setSelectedSale] = useState<any>(null)
  const queryClient = useQueryClient()

  const apiClient = typeof window !== 'undefined' && window.api ? window.api : api

  const { data: sales = [], isLoading } = useQuery<any[]>({
    queryKey: ['sales'],
    queryFn: () => apiClient.getSales(),
  })

  const refundMutation = useMutation({
    mutationFn: async (id: string) => {
      if (typeof window !== 'undefined' && (window as any).api?.refundSale) {
        return await (window as any).api.refundSale(id)
      }
      if (typeof window !== 'undefined' && (window as any).electron?.ipcRenderer?.invoke) {
        try {
          return await (window as any).electron.ipcRenderer.invoke('sales:refund', id)
        } catch {
          // fallback to api
        }
      }
      return await api.refundSale(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['batches'] })
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      toast.success('Transaction refunded successfully. Stock has been returned.')
      setSelectedSale(null)
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to refund transaction')
    }
  })

  const filteredSales = sales.filter((s) => {
    const term = searchTerm.toLowerCase()
    const invoiceId = `INV-${(s.id || '').slice(0, 8).toUpperCase()}`
    const customerName = s.customer?.name || s.customerName || 'Walk-in Customer'
    const matchesSearch = invoiceId.toLowerCase().includes(term) || customerName.toLowerCase().includes(term)

    const breakdown = getSaleBreakdown(s)
    let matchesFilter = true
    if (paymentFilter === 'CASH') {
      matchesFilter = breakdown.cash > 0
    } else if (paymentFilter === 'MOBILE') {
      matchesFilter = breakdown.momo > 0
    }

    let matchesDate = true
    const rawDate = s.date || s.created_at || s.createdAt
    const saleDate = rawDate ? new Date(rawDate) : new Date()
    const today = new Date()
    if (dateFilter === 'TODAY') {
      matchesDate = saleDate >= startOfDay(today)
    } else if (dateFilter === 'WEEK') {
      matchesDate = saleDate >= startOfWeek(today, { weekStartsOn: 1 })
    } else if (dateFilter === 'MONTH') {
      matchesDate = saleDate >= startOfMonth(today)
    } else if (dateFilter === 'CUSTOM') {
      if (customStartDate) matchesDate = matchesDate && saleDate >= new Date(customStartDate)
      if (customEndDate) {
        const endDate = new Date(customEndDate)
        endDate.setHours(23, 59, 59, 999)
        matchesDate = matchesDate && saleDate <= endDate
      }
    }

    return matchesSearch && matchesFilter && matchesDate
  })

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / ITEMS_PER_PAGE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE
  const paginatedSales = filteredSales.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  const totalRevenue = filteredSales.reduce((sum, s) => sum + (Number(s.total) || 0), 0)
  const cashRevenue = filteredSales.reduce((sum, s) => sum + getSaleBreakdown(s).cash, 0)
  const momoRevenue = filteredSales.reduce((sum, s) => sum + getSaleBreakdown(s).momo, 0)
  const otherRevenue = filteredSales.reduce((sum, s) => sum + getSaleBreakdown(s).other, 0)

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 font-sans bg-slate-50">
      <div className="relative overflow-hidden rounded-2xl border border-indigo-200 p-6 text-white shadow-lg shadow-indigo-500/10" style={{ backgroundColor: '#4f46e5' }}>
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan-300/20 blur-2xl" />
        <div className="absolute -bottom-12 left-10 h-28 w-28 rounded-full bg-violet-300/20 blur-2xl" />
        <div className="absolute right-14 top-10 h-20 w-20 rounded-full border border-white/20 bg-white/5" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-100">
                Sales Ledger
              </span>
            </div>
            <h2 className="text-2xl font-bold">Sales History</h2>
            <p className="max-w-2xl text-sm text-indigo-50/90">View all past transactions, search by invoice or customer.</p>
          </div>
          <div className={`grid grid-cols-2 ${otherRevenue > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/20 to-white/5 px-4 py-3 backdrop-blur shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.2em] text-indigo-100 font-medium">Transactions</p>
              <p className="text-2xl font-bold text-white mt-1">{filteredSales.length}</p>
            </div>
            <div className="rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/30 to-emerald-400/10 px-4 py-3 backdrop-blur shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-100 font-medium">Total Sales</p>
              <p className="text-2xl font-bold text-emerald-50 mt-1">₵{totalRevenue.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-gradient-to-br from-amber-500/30 to-amber-400/10 px-4 py-3 backdrop-blur shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.2em] text-amber-100 font-medium">Cash Sales</p>
              <p className="text-2xl font-bold text-amber-50 mt-1">₵{cashRevenue.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-sky-400/20 bg-gradient-to-br from-sky-500/30 to-sky-400/10 px-4 py-3 backdrop-blur shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.2em] text-sky-100 font-medium">MoMo Sales</p>
              <p className="text-2xl font-bold text-sky-50 mt-1">₵{momoRevenue.toFixed(2)}</p>
            </div>
            {otherRevenue > 0 && (
              <div className="rounded-xl border border-purple-400/20 bg-gradient-to-br from-purple-500/30 to-purple-400/10 px-4 py-3 backdrop-blur shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.2em] text-purple-100 font-medium">Other Sales</p>
                <p className="text-2xl font-bold text-purple-50 mt-1">₵{otherRevenue.toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Transactions</h2>
              <p className="text-sm text-slate-500">Search and review past sales.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                {dateFilter === 'CUSTOM' ? (
                  <div className="flex items-center gap-1">
                    <Input 
                      type="date" 
                      value={customStartDate} 
                      onChange={(e) => setCustomStartDate(e.target.value)} 
                      className="h-8 text-xs px-2 w-32 border-slate-200"
                    />
                    <span className="text-slate-400">-</span>
                    <Input 
                      type="date" 
                      value={customEndDate} 
                      onChange={(e) => setCustomEndDate(e.target.value)} 
                      className="h-8 text-xs px-2 w-32 border-slate-200"
                    />
                    <Button variant="ghost" size="sm" onClick={() => { setDateFilter('WEEK'); setCustomStartDate(''); setCustomEndDate(''); }} className="text-red-500 hover:text-red-700 h-8 px-2 font-bold">✕</Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDateFilter('CUSTOM'); setCurrentPage(1); }}
                    className="text-slate-600 hover:bg-slate-200"
                  >
                    Custom Date
                  </Button>
                )}
                <Button
                  variant={dateFilter === 'TODAY' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setDateFilter('TODAY'); setCurrentPage(1); }}
                  className={dateFilter === 'TODAY' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-slate-600'}
                >
                  Today
                </Button>
                <Button
                  variant={dateFilter === 'WEEK' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setDateFilter('WEEK'); setCurrentPage(1); }}
                  className={dateFilter === 'WEEK' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-slate-600'}
                >
                  This Week
                </Button>
                <Button
                  variant={dateFilter === 'MONTH' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setDateFilter('MONTH'); setCurrentPage(1); }}
                  className={dateFilter === 'MONTH' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-slate-600'}
                >
                  This Month
                </Button>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                <Button
                  variant={paymentFilter === 'ALL' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setPaymentFilter('ALL'); setCurrentPage(1); }}
                  className={paymentFilter === 'ALL' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-slate-600'}
                >
                  All Methods
                </Button>
                <Button
                  variant={paymentFilter === 'CASH' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setPaymentFilter('CASH'); setCurrentPage(1); }}
                  className={paymentFilter === 'CASH' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-slate-600'}
                >
                  Cash
                </Button>
                <Button
                  variant={paymentFilter === 'MOBILE' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setPaymentFilter('MOBILE'); setCurrentPage(1); }}
                  className={paymentFilter === 'MOBILE' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-slate-600'}
                >
                  Mobile
                </Button>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search invoice or customer..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="border-slate-200 bg-slate-50 pl-9"
                />
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            </div>
          ) : (
            <div className="max-h-[min(60vh,560px)] overflow-x-auto overflow-y-auto rounded-xl border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-indigo-100 via-purple-50 to-pink-50">
                    <TableHead className="text-slate-700">Invoice</TableHead>
                    <TableHead className="text-slate-700">Date & Time</TableHead>
                    <TableHead className="text-slate-700">Customer</TableHead>
                    <TableHead className="text-slate-700">Items</TableHead>
                    <TableHead className="text-slate-700">Total</TableHead>
                    <TableHead className="text-slate-700">Payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSales.map((sale) => (
                    <TableRow 
                      key={sale.id} 
                      className="border-b border-slate-100 bg-white transition-colors hover:bg-indigo-50 cursor-pointer"
                      onClick={() => setSelectedSale(sale)}
                    >
                      <TableCell className="font-semibold text-slate-800">
                        INV-{sale.id.slice(0, 8).toUpperCase()}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {format(new Date(sale.date), 'dd MMM yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="font-medium text-slate-700">
                        {sale.customer?.name || 'Walk-in Customer'}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {sale.items?.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0) || 0} units
                      </TableCell>
                      <TableCell className="font-semibold text-slate-800">
                        ₵{Number(sale.total).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const bd = getSaleBreakdown(sale)
                          return (
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${getPaymentMethodColor(sale.paymentMethod)}`}
                              title={bd.displayLabel}
                            >
                              {bd.isSplit ? (
                                <span>SPLIT (₵{bd.cash.toFixed(0)}C / ₵{bd.momo.toFixed(0)}M)</span>
                              ) : (
                                bd.displayLabel
                              )}
                            </span>
                          )
                        })()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {paginatedSales.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                        No transactions found matching the search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {filteredSales.length > 0 && (
            <div className="mt-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                Showing <span className="font-semibold text-slate-800">{startIndex + 1}</span>
                {' '}-<span className="font-semibold text-slate-800">{Math.min(startIndex + ITEMS_PER_PAGE, filteredSales.length)}</span>
                {' '}of <span className="font-semibold text-slate-800">{filteredSales.length}</span> transactions
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
                    className={page === safeCurrentPage ? 'h-8 min-w-8 bg-indigo-600 text-white hover:bg-indigo-700' : 'h-8 min-w-8'}
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

      <Dialog open={!!selectedSale} onOpenChange={(open) => !open && setSelectedSale(null)}>
        <DialogContent className="max-w-3xl font-sans">
          <DialogHeader>
            <DialogTitle className="text-xl text-slate-800">Transaction Details</DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-6 mt-2">
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                  <p className="text-slate-500 mb-1">Invoice ID</p>
                  <p className="font-bold text-indigo-700">INV-{selectedSale.id.slice(0, 8).toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-slate-500 mb-1">Date & Time</p>
                  <p className="font-semibold text-slate-800">{format(new Date(selectedSale.date), 'dd MMM yyyy HH:mm')}</p>
                </div>
                <div>
                  <p className="text-slate-500 mb-1">Customer</p>
                  <p className="font-semibold text-slate-800">{selectedSale.customer?.name || 'Walk-in Customer'}</p>
                </div>
                <div>
                  <p className="text-slate-500 mb-1">Payment Method</p>
                  <p className="font-semibold text-slate-800">
                    {(() => {
                      const bd = getSaleBreakdown(selectedSale)
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${getPaymentMethodColor(selectedSale.paymentMethod)}`}>
                          {bd.isSplit ? 'SPLIT' : bd.displayLabel}
                        </span>
                      )
                    })()}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-800 mb-3 border-b pb-2">Items Purchased</h3>
                <div className="max-h-[250px] overflow-y-auto rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="text-slate-700">Item</TableHead>
                        <TableHead className="text-center text-slate-700">Qty</TableHead>
                        <TableHead className="text-right text-slate-700">Price</TableHead>
                        <TableHead className="text-right text-slate-700">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedSale.items?.map((item: any, i: number) => (
                        <TableRow key={i}>
                              <TableCell className="font-medium text-slate-800">
                                {item.medicine?.name || item.product_name || item.name || 'Unknown Item'}
                              </TableCell>
                              <TableCell className="text-center text-slate-600">{item.quantity}</TableCell>
                              <TableCell className="text-right text-slate-600">
                                ₵{Number(item.price ?? item.unit_price ?? item.medicine?.price ?? 0).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-slate-800">
                                ₵{(Number(item.subtotal ?? ((item.price ?? item.unit_price ?? item.medicine?.price ?? 0) * (item.quantity || 0)))).toFixed(2)}
                              </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex justify-end border-t pt-4">
                <div className="w-72 space-y-3">
                  <div className="flex justify-between text-xl font-bold text-slate-800">
                    <span>Total:</span>
                    <span className="text-indigo-600">₵{Number(selectedSale.total).toFixed(2)}</span>
                  </div>
                  {(() => {
                    const bd = getSaleBreakdown(selectedSale)
                    if (!bd.isSplit && (!selectedSale.payments || selectedSale.payments.length <= 1)) return null

                    const paymentEntries =
                      selectedSale.payments && selectedSale.payments.length > 0
                        ? selectedSale.payments.filter((p: any) => Number(p.amount) > 0)
                        : [
                            ...(bd.cash > 0 ? [{ method: 'CASH', amount: bd.cash }] : []),
                            ...(bd.momo > 0 ? [{ method: 'MOBILE', amount: bd.momo }] : []),
                            ...(bd.other > 0 ? [{ method: 'OTHER', amount: bd.other }] : []),
                          ]

                    return (
                      <div className="mt-4 text-sm text-slate-600 border-t pt-3 space-y-2">
                        <p className="font-medium text-slate-800 mb-1 uppercase tracking-wider text-xs">Split Breakdown</p>
                        {paymentEntries.map((p: any, i: number) => {
                          const mUpper = (p.method || '').toUpperCase()
                          const isCash = mUpper.includes('CASH')
                          const isMob = mUpper.includes('MOBILE') || mUpper.includes('MOMO')
                          const label = isMob ? 'Mobile Money (MoMo)' : isCash ? 'Cash' : p.method
                          return (
                            <div key={i} className="flex justify-between items-center">
                              <span className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${isCash ? 'bg-emerald-500' : isMob ? 'bg-amber-500' : 'bg-slate-500'}`}></span>
                                {label}
                              </span>
                              <span className="font-bold text-slate-800">₵{Number(p.amount).toFixed(2)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              </div>

              <DialogFooter className="border-t pt-4 sm:justify-between">
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    if (confirm('Are you sure you want to refund this transaction? This will return items to stock and delete the transaction.')) {
                      refundMutation.mutate(selectedSale.id)
                    }
                  }}
                  disabled={refundMutation.isPending}
                >
                  {refundMutation.isPending ? 'Refunding...' : 'Refund Transaction'}
                </Button>
                <Button variant="outline" onClick={() => setSelectedSale(null)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
