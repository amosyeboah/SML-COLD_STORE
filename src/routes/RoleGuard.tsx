import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

interface RoleGuardProps {
  allowedRoles: string[]
  children: JSX.Element
}

export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const user = useAuthStore((s) => s.user)
  const role = user?.role || 'CASHIER'

  if (!allowedRoles.includes(role)) {
    const fallback = role === 'CASHIER' ? '/pos' : '/dashboard'
    return <Navigate to={fallback} replace />
  }

  return children
}
