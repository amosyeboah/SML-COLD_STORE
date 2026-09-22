import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  Filter,
  DollarSign,
  Package,
  KeyRound,
  Download,
  RefreshCw,
  AlertTriangle,
  Info,
  Calendar,
  Layers,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/services/api'
import type { AuditLog, AuditSeverity } from '@/types'

const ITEMS_PER_PAGE = 15

export default function AuditTrail() {
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)

  const apiClient = typeof window !== 'undefined' && window.api ? window.api : api

  const { data: logs = [], isLoading, isFetching, refetch } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs', categoryFilter, severityFilter],
    queryFn: () => apiClient.getAuditLogs({
      category: categoryFilter,
      severity: severityFilter,
    }),
  })

  // Filtered in-memory by search term
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchSearch =
        !searchTerm.trim() ||
        log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.username && log.username.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.userRole && log.userRole.toLowerCase().includes(searchTerm.toLowerCase()))

      return matchSearch
    })
  }, [logs, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / ITEMS_PER_PAGE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE
  const paginatedLogs = filteredLogs.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  // KPI calculations
  const totalCount = logs.length
  const criticalCount = logs.filter((l) => l.severity === 'CRITICAL' || l.severity === 'WARNING').length
  const priceChangesCount = logs.filter((l) => l.category === 'PRICING').length
  const highValueCount = logs.filter((l) => l.action === 'HIGH_VALUE_SALE').length

  const getSeverityBadge = (severity: AuditSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 ring-1 ring-inset ring-rose-200">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
            CRITICAL
          </span>
        )
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            WARNING
          </span>
        )
      case 'INFO':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            INFO
          </span>
        )
    }
  }

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'ADMIN':
        return <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">Admin</span>
      case 'MANAGER':
        return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Manager</span>
      case 'CASHIER':
        return <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">Cashier</span>
      default:
        return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">System</span>
    }
  }

  const getActionTag = (action: string, category: string) => {
    let color = 'bg-slate-100 text-slate-700 border-slate-200'
    if (category === 'PRICING') color = 'bg-amber-50 text-amber-800 border-amber-200'
    if (category === 'AUTH') color = 'bg-purple-50 text-purple-800 border-purple-200'
    if (category === 'SALES') color = 'bg-emerald-50 text-emerald-800 border-emerald-200'
    if (category === 'INVENTORY') color = 'bg-cyan-50 text-cyan-800 border-cyan-200'
    if (category === 'SYSTEM') color = 'bg-indigo-50 text-indigo-800 border-indigo-200'

    return (
      <span className={`inline-block font-mono text-[11px] font-semibold px-2 py-0.5 rounded border ${color}`}>
        {action}
      </span>
    )
  }

  const exportCSV = () => {
    const headers = ['Timestamp', 'Action', 'Category', 'Severity', 'Operator', 'Role', 'Details']
    const rows = filteredLogs.map((l) => [
      `"${new Date(l.createdAt).toLocaleString()}"`,
      `"${l.action}"`,
      `"${l.category}"`,
      `"${l.severity}"`,
      `"${l.username || 'System'}"`,
      `"${l.userRole || 'SYSTEM'}"`,
      `"${l.details.replace(/"/g, '""')}"`,
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sml_coldstore_audit_trail_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6 font-sans">
      {/* ── Top Header Banner ────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-200 p-6 text-white shadow-lg shadow-blue-500/10" style={{ backgroundColor: '#1e40af' }}>
        <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-400/20 blur-2xl" />
        <div className="absolute -bottom-12 left-10 h-32 w-32 rounded-full bg-indigo-400/20 blur-2xl" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-100">
                Loss Prevention &amp; Compliance
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-medium text-emerald-100 ring-1 ring-inset ring-emerald-200/30">
                High-Importance Activities Only
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2.5">
              <ShieldCheck className="w-7 h-7 text-cyan-300" />
              SML Cold Store Audit Trail
            </h2>
            <p className="max-w-2xl text-xs sm:text-sm text-blue-100/90 leading-relaxed">
              Tamper-evident log recording critical cold store operations: selling price &amp; cost updates, batch deletions,
              high-value customer invoices (≥ GH₵500), purchase restock orders, and staff account security.
            </p>
          </div>

          {/* Metric Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.15em] text-blue-100">Total Audited</p>
              <p className="text-lg font-semibold">{totalCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-rose-400/20 px-3 py-2 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.15em] text-rose-100">Warnings/Crit</p>
              <p className="text-lg font-semibold">{criticalCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-amber-400/20 px-3 py-2 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.15em] text-amber-100">Price Adjusts</p>
              <p className="text-lg font-semibold">{priceChangesCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-emerald-400/20 px-3 py-2 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-100">Sales ≥₵500</p>
              <p className="text-lg font-semibold">{highValueCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Toolbar & Filter Controls ─────────────────────────────────── */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search action, details, staff member..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setCurrentPage(1)
                }}
                className="border-slate-200 bg-slate-50 pl-9 text-sm"
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-semibold text-slate-600">Category:</span>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Categories</option>
                  <option value="PRICING">Pricing &amp; Cost</option>
                  <option value="INVENTORY">Inventory &amp; Batches</option>
                  <option value="SALES">High-Value Sales</option>
                  <option value="AUTH">Staff &amp; Authentication</option>
                  <option value="SYSTEM">System &amp; Backups</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-600">Severity:</span>
                <select
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Severities</option>
                  <option value="INFO">Info</option>
                  <option value="WARNING">Warning</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="gap-1.5 h-9 text-xs border-slate-200"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                className="gap-1.5 h-9 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
            </div>
          </div>

          {/* Table Container */}
          {isLoading ? (
            <div className="flex h-56 items-center justify-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            <div className="max-h-[calc(100vh-340px)] overflow-x-auto overflow-y-auto rounded-xl border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50">
                    <TableHead className="w-44 text-slate-700">Timestamp</TableHead>
                    <TableHead className="w-32 text-slate-700">Severity</TableHead>
                    <TableHead className="w-48 text-slate-700">Action / Category</TableHead>
                    <TableHead className="w-40 text-slate-700">Staff Operator</TableHead>
                    <TableHead className="text-slate-700">Activity Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedLogs.map((log) => (
                    <TableRow
                      key={log.id}
                      className="border-b border-slate-100 bg-white transition-colors hover:bg-gradient-to-r hover:from-blue-50/50 hover:via-white hover:to-indigo-50/50"
                    >
                      {/* Timestamp */}
                      <TableCell className="text-xs text-slate-600 font-mono py-3">
                        <div>{new Date(log.createdAt).toLocaleDateString()}</div>
                        <div className="text-[11px] text-slate-400">{new Date(log.createdAt).toLocaleTimeString()}</div>
                      </TableCell>

                      {/* Severity */}
                      <TableCell className="py-3">
                        {getSeverityBadge(log.severity)}
                      </TableCell>

                      {/* Action */}
                      <TableCell className="py-3 space-y-1">
                        <div>{getActionTag(log.action, log.category)}</div>
                        <div className="text-[10px] uppercase font-semibold text-slate-400">{log.category}</div>
                      </TableCell>

                      {/* Operator */}
                      <TableCell className="py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-slate-800">{log.username || 'System'}</span>
                          {getRoleBadge(log.userRole)}
                        </div>
                      </TableCell>

                      {/* Details */}
                      <TableCell className="py-3 text-xs text-slate-700">
                        <p className="font-medium text-slate-800 leading-relaxed">{log.details}</p>
                        {log.metadata && (
                          <div className="mt-1 text-[11px] font-mono text-slate-500 bg-slate-50 p-1.5 rounded border border-slate-150 inline-block max-w-full truncate">
                            {typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata)}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}

                  {paginatedLogs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center text-slate-500">
                        <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="font-semibold text-slate-700">No audit events match your filters</p>
                        <p className="text-xs text-slate-400 mt-1">Try clearing search filters or selecting &ldquo;All Categories&rdquo;.</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Pagination ─────────────────────────────────────────── */}
          {filteredLogs.length > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs sm:text-sm text-slate-600">
                Showing <span className="font-semibold text-slate-800">{startIndex + 1}</span>
                {' '}-<span className="font-semibold text-slate-800">{Math.min(startIndex + ITEMS_PER_PAGE, filteredLogs.length)}</span>
                {' '}of <span className="font-semibold text-slate-800">{filteredLogs.length}</span> audit logs
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
