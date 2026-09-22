import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '@/components/common/Sidebar'
import TopBar from '@/components/common/TopBar'

export default function AppLayout() {
  const { pathname } = useLocation()
  // POS and Reports have their own integrated headers — hide the shared one
  const hiddenTopBar = pathname === '/pos' || pathname === '/reports'

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden" style={{ marginLeft: '220px' }}>
        {!hiddenTopBar && <TopBar />}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
