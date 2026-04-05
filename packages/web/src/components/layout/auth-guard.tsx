import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/use-auth'
import { Spinner } from '../ui/spinner'

interface AuthGuardProps {
  children: (props: { user: NonNullable<ReturnType<typeof useAuth>['user']>; logout: () => Promise<void> }) => ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { loading, user, logout } = useAuth()

  if (loading) {
    return (
      <div className="fixed inset-0 bg-bg flex items-center justify-center z-50">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />
  }

  return <>{children({ user, logout })}</>
}
