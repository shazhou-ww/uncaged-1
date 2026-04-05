export interface User {
  id: string
  displayName: string
  slug: string | null
  createdAt: number
}

export interface SessionData {
  user: User
  credentials: Array<{ type: string; externalId: string; createdAt: number }>
  agents?: Array<{ id: string; slug: string; displayName: string }>
}

export async function checkSession(): Promise<SessionData | null> {
  try {
    const r = await fetch('/auth/session', { credentials: 'same-origin' })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export async function refreshToken(): Promise<boolean> {
  try {
    const r = await fetch('/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    return r.ok
  } catch {
    return false
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  window.location.href = '/auth/login'
}

export async function authedFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  opts.credentials = 'same-origin'
  const r = await fetch(url, opts)
  if (r.status === 401) {
    const refreshed = await refreshToken()
    if (refreshed) return fetch(url, opts)
    window.location.href = '/auth/login'
  }
  return r
}
