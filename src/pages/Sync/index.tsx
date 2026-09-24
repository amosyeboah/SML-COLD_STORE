import { useState, useEffect } from 'react'
import {
  Cloud,
  CloudOff,
  RefreshCw,
  Clock,
  Database,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ShieldCheck,
  Server,
  Key,
  Lock,
  ChevronRight,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  getSupabaseConfig,
  initBackendCloudConfig,
  checkCloudConnection,
  ConnectionCheckResult,
} from '@/services/sync/supabaseClient'
import {
  getPendingQueue,
  getLastSyncTime,
  getSyncHistory,
  flushSyncQueue,
  reconcileAllSalesWithCloud,
  subscribeToSyncState,
  SyncQueueItem,
  SyncSessionLog,
} from '@/services/sync/syncQueue'
import { fetchCloudSalesIfAvailable, syncAllCloudDataIfAvailable } from '@/services/api/mobileStorage'
import { queryClient } from '@/lib/queryClient'

export default function SyncPage() {
  const [isSyncing, setIsSyncing] = useState(false)
  const [pendingQueue, setPendingQueue] = useState<SyncQueueItem[]>(getPendingQueue())
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(getLastSyncTime())
  const [syncHistory, setSyncHistory] = useState<SyncSessionLog[]>(getSyncHistory())
  const [cloudStatus, setCloudStatus] = useState<ConnectionCheckResult>({
    connected: false,
    message: 'Testing connection...',
    latencyMs: 0,
  })
  const [isCheckingCloud, setIsCheckingCloud] = useState(false)

  // Cloud Endpoint (Backend Managed)
  const [configUrl, setConfigUrl] = useState('')
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    initBackendCloudConfig().then((cfg) => {
      setConfigUrl(cfg.url)
    })
    const currentConfig = getSupabaseConfig()
    setConfigUrl(currentConfig.url)

    // Check cloud health on mount
    runHealthCheck()

    // Subscribe to queue changes and workManager sync events
    const unsubscribe = subscribeToSyncState((state) => {
      setIsSyncing(state.isSyncing)
      setPendingQueue(getPendingQueue())
      setLastSyncTime(state.lastSyncTime)
      setSyncHistory(getSyncHistory())
    })

    return () => unsubscribe()
  }, [])

  const runHealthCheck = async () => {
    setIsCheckingCloud(true)
    try {
      const result = await checkCloudConnection()
      setCloudStatus(result)
    } finally {
      setIsCheckingCloud(false)
    }
  }

  const handleManualSync = async () => {
    setSyncFeedback(null)
    setIsSyncing(true)
    try {
      const res = await reconcileAllSalesWithCloud()
      await syncAllCloudDataIfAvailable().catch(() => { })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['batches'] })
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
      setSyncFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message,
      })
      setPendingQueue(getPendingQueue())
      setLastSyncTime(getLastSyncTime())
      setSyncHistory(getSyncHistory())
      runHealthCheck()
    } catch (err: any) {
      setSyncFeedback({
        type: 'error',
        message: err.message || 'Sync failed',
      })
    } finally {
      setIsSyncing(false)
    }
  }

  const formatTimestamp = (ts: string | null) => {
    if (!ts) return 'Never'
    try {
      const d = new Date(ts)
      return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    } catch {
      return ts
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6 font-sans">
      {/* ── Top Header Banner ────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-2xl border border-blue-200 p-6 text-white shadow-lg shadow-blue-500/10"
        style={{ backgroundColor: '#1e40af' }}
      >
        <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-400/20 blur-2xl" />
        <div className="absolute -bottom-12 left-10 h-32 w-32 rounded-full bg-indigo-400/20 blur-2xl" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-100">
                Offline-First Engine
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2.5">
              <Cloud className="w-7 h-7 text-cyan-300" />
              Cold Store Cloud Sync
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold shadow-md h-11 px-5 rounded-xl"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Status Feedback Alert ────────────────────────────────────── */}
      {syncFeedback && (
        <div
          className={`p-4 rounded-xl text-sm font-medium flex items-center gap-3 border ${syncFeedback.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
        >
          {syncFeedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span>{syncFeedback.message}</span>
        </div>
      )}

      {/* ── Status KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Cloud Connection */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cloud Status</p>
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${cloudStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`}
                />
                <h3 className="font-bold text-slate-800 text-base sm:text-lg">
                  {cloudStatus.connected ? 'Connected' : 'Offline / Local'}
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                {cloudStatus.connected ? `${cloudStatus.latencyMs}ms response` : cloudStatus.message}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              {cloudStatus.connected ? <Cloud className="w-5 h-5" /> : <CloudOff className="w-5 h-5" />}
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Last Sync Time */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Last Synced Date &amp; Time</p>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                {lastSyncTime ? formatTimestamp(lastSyncTime) : 'Never Synced'}
              </h3>
              <p className="text-xs text-slate-500">
                {lastSyncTime ? 'Transmitted to Portal' : 'No sync recorded yet'}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Pending Queue */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pending Sync Queue</p>
              <h3 className="font-bold text-slate-800 text-xl sm:text-2xl">{pendingQueue.length}</h3>
              <p className="text-xs text-slate-500">
                {pendingQueue.length === 0
                  ? 'All local records in sync'
                  : 'Items waiting for upload'}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Database className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Background WorkManager */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Auto-Sync WorkManager</p>
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-emerald-500" />
                <h3 className="font-bold text-slate-800 text-base sm:text-lg">Active</h3>
              </div>
              <p className="text-xs text-slate-500">Auto-flushes on reconnect &amp; 60s</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <RefreshCw className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Live Connection Diagnostics & Trigger Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 mb-6">


        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${cloudStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className="text-slate-600 font-medium">{cloudStatus.message}</span>
          {cloudStatus.connected && cloudStatus.latencyMs > 0 && (
            <span className="text-[11px] font-mono text-slate-400">({cloudStatus.latencyMs}ms)</span>
          )}
        </div>
      </div>

      {/* ── Pending Queue Details & Sync History ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Queue Items */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-500" />
              Pending Items Waiting for Upload ({pendingQueue.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingQueue.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-600">Sync queue is clean</p>
                <p className="text-[11px] text-slate-400 mt-0.5">All transactions and audits are up to date in the cloud.</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 text-xs">
                      <TableHead>Type</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Queued At</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingQueue.slice(0, 15).map((item) => (
                      <TableRow key={item.id} className="text-xs border-b border-slate-100">
                        <TableCell className="font-bold text-slate-700">{item.entity}</TableCell>
                        <TableCell>
                          <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{item.action}</span>
                        </TableCell>
                        <TableCell className="text-slate-500">{new Date(item.createdAt).toLocaleTimeString()}</TableCell>
                        <TableCell>
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                            {item.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sync History Sessions */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              Recent Sync Sessions History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {syncHistory.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-600">No past sync sessions</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Click &ldquo;Sync Now&rdquo; to test your first upload.</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 text-xs">
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncHistory.slice(0, 15).map((log) => (
                      <TableRow key={log.id} className="text-xs border-b border-slate-100">
                        <TableCell className="font-mono text-slate-600">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${log.status === 'SUCCESS'
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                              : log.status === 'PARTIAL'
                                ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                : 'bg-slate-100 text-slate-600'
                              }`}
                          >
                            {log.status}
                          </span>
                        </TableCell>
                        <TableCell className="font-semibold text-slate-700">{log.itemsSynced}</TableCell>
                        <TableCell className="text-slate-500">{log.durationMs}ms</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
