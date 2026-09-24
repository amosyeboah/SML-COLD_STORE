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
  ExternalLink,
  ChevronRight,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  getSupabaseConfig,
  saveSupabaseConfig,
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

  // Supabase Config Form
  const [configUrl, setConfigUrl] = useState('')
  const [configKey, setConfigKey] = useState('')
  const [configSaved, setConfigSaved] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    const currentConfig = getSupabaseConfig()
    setConfigUrl(currentConfig.url)
    setConfigKey(currentConfig.anonKey)

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

  const handleSaveConfig = () => {
    saveSupabaseConfig({
      url: configUrl.trim(),
      anonKey: configKey.trim(),
    })
    setConfigSaved(true)
    setTimeout(() => setConfigSaved(false), 3000)
    runHealthCheck()
  }

  const handleManualSync = async () => {
    setSyncFeedback(null)
    setIsSyncing(true)
    try {
      const res = await reconcileAllSalesWithCloud()
      await syncAllCloudDataIfAvailable().catch(() => {})
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
              <span className="inline-flex items-center rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-medium text-emerald-100 ring-1 ring-inset ring-emerald-200/30">
                WorkManager + Supabase
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2.5">
              <Cloud className="w-7 h-7 text-cyan-300" />
              Cold Store Cloud Sync &amp; UK Owner Bridge
            </h2>
            <p className="max-w-2xl text-xs sm:text-sm text-blue-100/90 leading-relaxed">
              Sales, carton stock updates, and audit logs are saved locally first. When internet connectivity is detected,
              the background WorkManager flushes the queue to Supabase PostgreSQL, giving the owner in the UK live remote access.
            </p>
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
          className={`p-4 rounded-xl text-sm font-medium flex items-center gap-3 border ${
            syncFeedback.type === 'success'
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
                  className={`h-3 w-3 rounded-full ${
                    cloudStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
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
                {lastSyncTime ? 'Transmitted to UK Portal' : 'No sync recorded yet'}
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

      {/* ── Configuration & Manual Sync Controls ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Supabase Cloud Credentials */}
        <Card className="lg:col-span-2 border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-600" />
              Supabase PostgreSQL Credentials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-500 leading-relaxed">
              Connect to your Supabase cloud project. Ensure you have executed the schema script{' '}
              <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-700 font-mono">supabase/schema.sql</code> in your
              Supabase SQL Editor to initialize the tables.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Supabase Project URL</Label>
              <Input
                placeholder="https://your-project.supabase.co"
                value={configUrl}
                onChange={(e) => setConfigUrl(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Supabase Anon Key</Label>
              <Input
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={configKey}
                onChange={(e) => setConfigKey(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveConfig}
                  className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs h-9"
                >
                  Save Configuration
                </Button>
                <Button
                  variant="outline"
                  onClick={runHealthCheck}
                  disabled={isCheckingCloud}
                  className="gap-1.5 text-xs h-9"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingCloud ? 'animate-spin' : ''}`} />
                  Test Connection
                </Button>
              </div>

              {configSaved && (
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Settings saved!
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right 1 Col: Remote Access & Supabase Cloud Web Address */}
        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-slate-50 to-blue-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-blue-600" />
              Remote Access Web Addresses
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>Owner:</strong> Sofiyat Opeyemi Yusuf<br />
              <strong>UK Contact:</strong> +447999007775 / sorphygold@yahoo.com<br />
              <strong>Destination:</strong> Supabase PostgreSQL Cloud
            </p>

            {/* Supabase Cloud Studio Web Address */}
            <div className="p-3 bg-white rounded-xl border border-blue-100 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">Supabase Cloud Studio URL:</span>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded">Remote</span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate bg-slate-50 p-1.5 rounded border border-slate-100">
                {configUrl
                  ? `https://supabase.com/dashboard/project/${configUrl.replace('https://', '').replace('.supabase.co', '')}/editor`
                  : 'Configure Supabase URL on left'}
              </p>
              {configUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="w-full gap-1.5 border-blue-200 bg-blue-50/50 text-blue-700 hover:bg-blue-100 text-xs h-8 mt-1"
                >
                  <a
                    href={`https://supabase.com/dashboard/project/${configUrl.replace('https://', '').replace('.supabase.co', '')}/editor`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Supabase Cloud Studio <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </Button>
              )}
            </div>

            {/* Quick 3-step setup guide */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5 text-xs text-slate-600">
              <p className="font-bold text-slate-800">Quick 3-Step Remote Setup:</p>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-500">
                <li>Create a project at <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-blue-600 underline">supabase.com</a>.</li>
                <li>Run <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-700 font-mono font-semibold">supabase/schema.sql</code> in SQL Editor.</li>
                <li>Paste Project URL &amp; Anon Key on the left, then click Save &amp; Test.</li>
              </ol>
            </div>
          </CardContent>
        </Card>
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
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              log.status === 'SUCCESS'
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
