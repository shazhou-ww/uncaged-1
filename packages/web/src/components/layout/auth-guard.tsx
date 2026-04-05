import { type ReactNode } from 'react'
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
    window.location.href = '/auth/login'
    return (
      <div className="fixed inset-0 bg-bg flex items-center justify-center z-50">
        <Spinner size="lg" />
      </div>
    )
  }

  return <>{children({ user, logout })}</>
}
