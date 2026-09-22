import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import {
  Filter,
  Download,
  ShoppingCart,
  DollarSign,
  Zap,
  Activity,
  ChevronRight,
  AlertCircle,
  Calendar,
  BarChart3,
  ShoppingBag,
  Package,
  TrendingUp,
  Receipt,
  Clock,
  CreditCard,
  Users,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/utils'
import { reportsService } from '@/services/reports'
import type { ReportsData } from '@/types'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts'

const reportTypes = [
  { id: 'sales', label: 'Sales Report', icon: BarChart3 },
  { id: 'purchase', label: 'Purchase Report', icon: ShoppingBag },
  { id: 'inventory', label: 'Inventory Report', icon: Package },
  { id: 'profit', label: 'Profit & Loss', icon: TrendingUp },
  { id: 'tax', label: 'Tax Report', icon: Receipt },
  { id: 'expiry', label: 'Expiry Report', icon: Clock },
  { id: 'top-selling', label: 'Top Selling', icon: Package },
  { id: 'payment', label: 'Payment Report', icon: CreditCard },
  { id: 'customer', label: 'Customer Report', icon: Users },
]

const shortcuts = ['Today', 'This Week', 'This Month', 'This Year', 'Custom Range']

const MED_COLORS = [
  'from-blue-400 to-blue-600',
  'from-emerald-400 to-emerald-600',
  'from-purple-400 to-purple-600',
  'from-orange-400 to-orange-600',
  'from-cyan-400 to-cyan-600',
]

function getShortcutRange(shortcut: string): { start: string; end: string } {
  const today = new Date()
  switch (shortcut) {
    case 'Today':
      return { start: format(today, 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') }
    case 'This Week':
      return {
        start: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        end: format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      }
    case 'This Month':
      return {
        start: format(startOfMonth(today), 'yyyy-MM-dd'),
        end: format(endOfMonth(today), 'yyyy-MM-dd'),
      }
    case 'This Year':
      return {
        start: format(startOfYear(today), 'yyyy-MM-dd'),
        end: format(endOfYear(today), 'yyyy-MM-dd'),
      }
    default:
      return {
        start: format(startOfMonth(today), 'yyyy-MM-dd'),
        end: format(endOfMonth(today), 'yyyy-MM-dd'),
      }
  }
}

function formatCurrency(value: number) {
  return `₵${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTrend(value: number) {
  const sign = value >= 0 ? '↑' : '↓'
  return `${sign} ${Math.abs(value).toFixed(1)}%`
}

function formatDateRangeLabel(start: string, end: string) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  return `${format(startDate, 'dd MMM yyyy')} - ${format(endDate, 'dd MMM yyyy')}`
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v, i) => ({ i, v }))
  if (chartData.length === 0) {
    return <div className="h-9" />
  }
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={chartData}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function SalesOverviewTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-xl">
        <p className="text-slate-300">{label}</p>
        <p className="font-bold">{formatCurrency(payload[0].value)}</p>
      </div>
    )
  }
  return null
}

function getPaymentMethodColor(method: string) {
  switch (method.toLowerCase()) {
    case 'cash':
      return 'bg-emerald-50 text-emerald-700'
    case 'mobile money':
      return 'bg-amber-50 text-amber-700'
    case 'card':
      return 'bg-blue-50 text-blue-700'
    case 'bank transfer':
      return 'bg-purple-50 text-purple-700'
    default:
      return 'bg-gray-50 text-gray-700'
  }
}

function buildKpiCards(data: ReportsData) {
  const { kpis } = data
  return [
    {
      title: 'Total Sales',
      value: formatCurrency(kpis.totalSales),
      trend: formatTrend(kpis.salesTrend),
      icon: ShoppingCart,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      sparkColor: '#3b82f6',
      sparkData: kpis.salesSparkline,
    },
    {
      title: 'Total Purchases',
      value: formatCurrency(kpis.totalPurchases),
      trend: formatTrend(kpis.purchasesTrend),
      icon: ShoppingBag,
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      sparkColor: '#22c55e',
      sparkData: kpis.purchasesSparkline,
    },
    {
      title: 'Gross Profit',
      value: formatCurrency(kpis.grossProfit),
      trend: formatTrend(kpis.profitTrend),
      icon: DollarSign,
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      sparkColor: '#f59e0b',
      sparkData: kpis.profitSparkline,
    },
    {
      title: 'Transactions',
      value: String(kpis.transactions),
      trend: formatTrend(kpis.transactionsTrend),
      icon: Zap,
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
      sparkColor: '#a855f7',
      sparkData: kpis.transactionsSparkline,
    },
    {
      title: 'Avg. Daily Sales',
      value: formatCurrency(kpis.avgDailySales),
      trend: formatTrend(kpis.avgDailyTrend),
      icon: Activity,
      iconBg: 'bg-cyan-100',
      iconColor: 'text-cyan-600',
      sparkColor: '#06b6d4',
      sparkData: kpis.avgDailySparkline,
    },
  ]
}

function getChartConfig(activeReport: string) {
  switch (activeReport) {
    case 'purchase':
      return { key: 'purchases' as const, label: 'Purchases Overview', color: '#22c55e', gradientId: 'reportsPurchasesGradient' }
    case 'profit':
    case 'tax':
      return { key: 'profit' as const, label: 'Profit Overview', color: '#f59e0b', gradientId: 'reportsProfitGradient' }
    default:
      return { key: 'sales' as const, label: 'Sales Overview', color: '#6366f1', gradientId: 'reportsSalesGradient' }
  }
}

function shouldShowSection(activeReport: string, section: string) {
  if (activeReport === 'sales') return true
  const map: Record<string, string[]> = {
    purchase: ['kpis', 'chart', 'purchases', 'payment'],
    inventory: ['kpis', 'expiry'],
    profit: ['kpis', 'chart'],
    tax: ['kpis', 'chart'],
    expiry: ['expiry'],
    'top-selling': ['topMedicines'],
    payment: ['kpis', 'payment'],
    customer: ['transactions'],
  }
  return map[activeReport]?.includes(section) ?? true
}

export default function Reports() {
  const defaultRange = getShortcutRange('This Month')
  const [activeReport, setActiveReport] = useState('sales')
  const [activeShortcut, setActiveShortcut] = useState('This Month')
  const [startDate, setStartDate] = useState(defaultRange.start)
  const [endDate, setEndDate] = useState(defaultRange.end)
  const [customOpen, setCustomOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(startDate)
  const [draftEnd, setDraftEnd] = useState(endDate)

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['reports', startDate, endDate],
    queryFn: () => reportsService.getData(startDate, endDate),
  })

  const exportMutation = useMutation({
    mutationFn: () => reportsService.exportExcel(startDate, endDate),
    onSuccess: (result) => {
      if (!result.success) return
      alert(`Report exported to ${result.path}`)
    },
    onError: () => alert('Failed to export report.'),
  })

  const kpiCards = useMemo(() => (data ? buildKpiCards(data) : []), [data])
  const chartConfig = getChartConfig(activeReport)
  const dateRangeLabel = formatDateRangeLabel(startDate, endDate)
  const totalPayment = data?.paymentBreakdown.reduce((sum, item) => sum + item.value, 0) ?? 0

  const applyShortcut = (shortcut: string) => {
    if (shortcut === 'Custom Range') {
      setDraftStart(startDate)
      setDraftEnd(endDate)
      setCustomOpen(true)
      return
    }
    const range = getShortcutRange(shortcut)
    setActiveShortcut(shortcut)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  const applyCustomRange = () => {
    if (!draftStart || !draftEnd || draftStart > draftEnd) return
    setStartDate(draftStart)
    setEndDate(draftEnd)
    setActiveShortcut('Custom Range')
    setCustomOpen(false)
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#f4f6fb]">
      <aside className="flex w-[220px] flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Reports</p>
          <nav className="space-y-0.5">
            {reportTypes.map((item) => {
              const Icon = item.icon
              const isActive = activeReport === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveReport(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  )}
                >
                  <Icon className={cn('h-4 w-4 flex-shrink-0', isActive ? 'text-indigo-600' : 'text-slate-400')} />
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </nav>

          <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Shortcuts</p>
          <div className="space-y-1">
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut}
                onClick={() => applyShortcut(shortcut)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  activeShortcut === shortcut
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                )}
              >
                <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                {shortcut}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Dashboard <span className="text-slate-400">&gt;</span> Reports
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
                <Calendar className="h-4 w-4 text-slate-400" />
                {dateRangeLabel}
                {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
              </div>
              <Button variant="outline" className="gap-2 border-slate-200 bg-white text-slate-700" onClick={() => refetch()}>
                <Filter className="h-4 w-4" />
                Refresh
              </Button>
              <Button
                className="gap-2 text-white"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)' }}
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending || !data}
              >
                {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export Report
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
          ) : !data ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
              Unable to load report data.
            </div>
          ) : (
            <>
              {shouldShowSection(activeReport, 'kpis') && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  {kpiCards.map((card) => {
                    const Icon = card.icon
                    return (
                      <div key={card.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-2 flex items-start justify-between">
                          <div>
                            <p className="text-xs font-medium text-slate-500">{card.title}</p>
                            <p className="mt-1 text-xl font-bold text-slate-900">{card.value}</p>
                          </div>
                          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', card.iconBg)}>
                            <Icon className={cn('h-4 w-4', card.iconColor)} />
                          </div>
                        </div>
                        <p className="mb-1 text-xs font-semibold text-emerald-600">{card.trend} vs last period</p>
                        <Sparkline data={card.sparkData} color={card.sparkColor} />
                      </div>
                    )
                  })}
                </div>
              )}

              {(shouldShowSection(activeReport, 'chart') || shouldShowSection(activeReport, 'payment')) && (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  {shouldShowSection(activeReport, 'chart') && (
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-base font-bold text-slate-900">{chartConfig.label}</h3>
                        <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                          Daily
                        </span>
                      </div>
                      <div className="h-[260px]">
                        {data.salesOverview.length === 0 ? (
                          <div className="flex h-full items-center justify-center text-sm text-slate-400">
                            No data for the selected period.
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.salesOverview} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                              <defs>
                                <linearGradient id={chartConfig.gradientId} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor={chartConfig.color} stopOpacity={0.25} />
                                  <stop offset="95%" stopColor={chartConfig.color} stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                              <YAxis
                                tick={{ fontSize: 11, fill: '#94a3b8' }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v) => `₵${v}`}
                              />
                              <Tooltip content={<SalesOverviewTooltip />} />
                              <Area
                                type="monotone"
                                dataKey={chartConfig.key}
                                stroke={chartConfig.color}
                                strokeWidth={2.5}
                                fill={`url(#${chartConfig.gradientId})`}
                                dot={{ r: 4, fill: chartConfig.color, strokeWidth: 2, stroke: '#fff' }}
                                activeDot={{ r: 6, fill: chartConfig.color, stroke: '#fff', strokeWidth: 2 }}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                      {activeReport === 'tax' && (
                        <p className="mt-3 text-sm text-slate-500">
                          Estimated tax (15%): <span className="font-semibold text-slate-800">{formatCurrency(data.kpis.grossProfit * 0.15)}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {shouldShowSection(activeReport, 'payment') && (
                    <div className={cn('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', !shouldShowSection(activeReport, 'chart') && 'lg:col-span-3')}>
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-base font-bold text-slate-900">Sales by Payment Method</h3>
                        <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                          Selected Period
                        </span>
                      </div>
                      {data.paymentBreakdown.length === 0 ? (
                        <div className="flex h-40 items-center justify-center text-sm text-slate-400">
                          No payment data for this period.
                        </div>
                      ) : (
                        <div className="flex items-center gap-4">
                          <div className="relative flex-shrink-0" style={{ width: 130, height: 130 }}>
                            <PieChart width={130} height={130}>
                              <Pie
                                data={data.paymentBreakdown}
                                cx={60}
                                cy={60}
                                innerRadius={38}
                                outerRadius={58}
                                dataKey="value"
                                strokeWidth={2}
                                stroke="#fff"
                              >
                                {data.paymentBreakdown.map((entry) => (
                                  <Cell key={entry.name} fill={entry.color} />
                                ))}
                              </Pie>
                            </PieChart>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                              <p className="text-[10px] font-medium text-slate-400">Total</p>
                              <p className="text-sm font-bold text-slate-900">{formatCurrency(totalPayment)}</p>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            {data.paymentBreakdown.map((item) => (
                              <div key={item.name} className="flex items-center justify-between gap-2 text-xs">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: item.color }} />
                                  <span className="truncate text-slate-600">{item.name}</span>
                                </div>
                                <span className="flex-shrink-0 font-semibold text-slate-800">
                                  {formatCurrency(item.value)} {item.percent.toFixed(1)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {shouldShowSection(activeReport, 'purchases') && data.purchases.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 text-base font-bold text-slate-900">Purchase Orders</h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Date</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.purchases.map((purchase) => (
                          <TableRow key={purchase.id}>
                            <TableCell>{format(new Date(purchase.date), 'dd MMM yyyy HH:mm')}</TableCell>
                            <TableCell className="font-medium">{purchase.supplier}</TableCell>
                            <TableCell className="font-semibold">{formatCurrency(purchase.total)}</TableCell>
                            <TableCell>{purchase.status}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {(shouldShowSection(activeReport, 'topMedicines') ||
                shouldShowSection(activeReport, 'transactions') ||
                shouldShowSection(activeReport, 'expiry')) && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                  {shouldShowSection(activeReport, 'topMedicines') && (
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-base font-bold text-slate-900">Top Selling Products</h3>
                        <button className="flex items-center gap-0.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                          View all <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {data.topMedicines.length === 0 ? (
                        <p className="py-8 text-center text-sm text-slate-400">No sales in this period.</p>
                      ) : (
                        <div className="space-y-3">
                          {data.topMedicines.map((med, idx) => (
                            <div key={med.name} className="flex items-center gap-3">
                              <span className="w-4 flex-shrink-0 text-center text-xs font-bold text-slate-400">{idx + 1}</span>
                              <div
                                className={cn(
                                  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white',
                                  MED_COLORS[idx % MED_COLORS.length]
                                )}
                              >
                                <Package className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-800">{med.name}</p>
                                <p className="text-xs text-slate-400">{med.qty.toLocaleString()} units sold</p>
                              </div>
                              <span className="flex-shrink-0 text-sm font-bold text-slate-900">{formatCurrency(med.revenue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {shouldShowSection(activeReport, 'transactions') && (
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-base font-bold text-slate-900">Recent Transactions</h3>
                        <button className="flex items-center gap-0.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                          View all <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {data.recentTransactions.length === 0 ? (
                        <p className="py-8 text-center text-sm text-slate-400">No transactions in this period.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-b border-slate-100 hover:bg-transparent">
                                <TableHead className="h-8 px-2 text-xs font-semibold text-slate-500">Invoice</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-semibold text-slate-500">Customer</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-semibold text-slate-500">Amount</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-semibold text-slate-500">Payment</TableHead>
                                <TableHead className="h-8 px-2 text-xs font-semibold text-slate-500">Time</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.recentTransactions.map((txn) => (
                                <TableRow key={txn.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                  <TableCell className="px-2 py-2 text-xs font-semibold text-slate-800">{txn.id}</TableCell>
                                  <TableCell className="max-w-[90px] truncate px-2 py-2 text-xs text-slate-600">
                                    {txn.customer}
                                  </TableCell>
                                  <TableCell className="px-2 py-2 text-xs font-semibold text-slate-800">
                                    {formatCurrency(txn.amount)}
                                  </TableCell>
                                  <TableCell className="px-2 py-2">
                                    <span
                                      className={cn(
                                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                        getPaymentMethodColor(txn.payment)
                                      )}
                                    >
                                      {txn.payment}
                                    </span>
                                  </TableCell>
                                  <TableCell className="px-2 py-2 text-xs text-slate-500">{txn.time}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}

                  {shouldShowSection(activeReport, 'expiry') && (
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-base font-bold text-slate-900">Stock Expiry Alert</h3>
                        <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">View all</button>
                      </div>
                      {data.expiringBatches.length === 0 ? (
                        <p className="py-8 text-center text-sm text-slate-400">No batches expiring soon.</p>
                      ) : (
                        <div className="space-y-2.5">
                          {data.expiringBatches.map((med) => (
                            <div
                              key={med.batch}
                              className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50/60 p-3"
                            >
                              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-slate-800">{med.name}</p>
                                <p className="text-xs text-slate-500">Batch: {med.batch}</p>
                                <p className="text-xs font-semibold text-red-600">
                                  {med.days <= 0 ? 'Expired' : `Expires in ${med.days} days`}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <p className="pb-2 text-center text-xs text-slate-400">
            All reports are based on the selected date range. Data is updated in real-time.
          </p>
        </div>
      </div>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom Date Range</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
            </div>
            <Button
              className="w-full bg-indigo-600 text-white hover:bg-indigo-700"
              onClick={applyCustomRange}
              disabled={!draftStart || !draftEnd || draftStart > draftEnd}
            >
              Apply Range
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
