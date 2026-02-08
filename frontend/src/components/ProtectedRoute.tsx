import { Navigate, useLocation } from 'react-router-dom'
import { useChatStore } from '@/stores/useChatStore'

interface ProtectedRouteProps {
  children: React.ReactNode
}

/** 需登录才能访问，未登录时重定向到 /login */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isLoggedIn = useChatStore((s) => s.isLoggedIn())
  const location = useLocation()

  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
