import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/routes'
import { Providers } from './providers'
import { subscribeToCloudSales } from '@/services/sync/supabaseClient'
import { queryClient } from '@/lib/queryClient'
import { fetchCloudSalesIfAvailable } from '@/services/api/mobileStorage'

export default function App() {
  useEffect(() => {
    // 1. Initial warm up of cloud sales into local storage
    fetchCloudSalesIfAvailable().catch(() => {})

    // 2. Real-time subscription to cloud_sales table
    const unsubscribe = subscribeToCloudSales(async (payload) => {
      console.log('📡 [Supabase Realtime] Cloud sales update:', payload.eventType)
      await fetchCloudSalesIfAvailable().catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}

