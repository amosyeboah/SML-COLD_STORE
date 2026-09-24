import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/routes'
import { Providers } from './providers'
import { subscribeToCloudSales, subscribeToCloudProducts, subscribeToCloudBatches } from '@/services/sync/supabaseClient'
import { queryClient } from '@/lib/queryClient'
import { syncAllCloudDataIfAvailable, fetchCloudSalesIfAvailable, fetchCloudProductsIfAvailable, fetchCloudBatchesIfAvailable } from '@/services/api/mobileStorage'

export default function App() {
  useEffect(() => {
    // 1. Initial warm up of all cloud data (catalog, inventory, sales) into local storage
    syncAllCloudDataIfAvailable().catch(() => {})

    // 2. Real-time subscription to cloud_sales table
    const unsubscribeSales = subscribeToCloudSales(async (payload) => {
      console.log('📡 [Supabase Realtime] Cloud sales update:', payload.eventType)
      await fetchCloudSalesIfAvailable().catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
    })

    // 3. Real-time subscription to cloud_products table
    const unsubscribeProducts = subscribeToCloudProducts(async (payload) => {
      console.log('📡 [Supabase Realtime] Cloud products update:', payload.eventType)
      await fetchCloudProductsIfAvailable().catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    })

    // 4. Real-time subscription to cloud_batches table
    const unsubscribeBatches = subscribeToCloudBatches(async (payload) => {
      console.log('📡 [Supabase Realtime] Cloud batches update:', payload.eventType)
      await fetchCloudBatchesIfAvailable().catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['batches'] })
      queryClient.invalidateQueries({ queryKey: ['medicines'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    })

    return () => {
      unsubscribeSales()
      unsubscribeProducts()
      unsubscribeBatches()
    }
  }, [])

  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}

