import { useState, useEffect, useCallback } from 'react'
import { checkSession, logout as doLogout, type SessionData, type User } from '../lib/auth'

interface AuthState {
  loading: boolean
  user: User | null
  session: SessionData | null
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<SessionData | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await checkSession()
      setSession(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    loading,
    user: session?.user ?? null,
    session,
    logout: doLogout,
    refresh,
  }
}
