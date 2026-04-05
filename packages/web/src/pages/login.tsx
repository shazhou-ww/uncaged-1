import { useState, useEffect } from 'react'
import { Card, CardHeader, CardContent } from '../components/ui/card'
import { PasskeyLogin } from '../components/auth/passkey-login'
import { PasskeyRegister } from '../components/auth/passkey-register'
import { GoogleLogin } from '../components/auth/google-login'

export function LoginPage() {
  const [view, setView] = useState<'login' | 'register'>('login')
  const [error, setError] = useState<string | null>(null)

  // Auto-redirect if already authenticated
  useEffect(() => {
    fetch('/auth/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) return
        if (data.agents?.length > 0) {
          window.location.href = `/${data.user.slug}/${data.agents[0].slug}/`
        }
      })
      .catch(() => {})
  }, [])

  function handleSuccess() {
    window.location.href = '/'
  }

  function handleError(msg: string) {
    setError(msg)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader className="text-center">
          <div className="text-5xl mb-2">🔓</div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
            Uncaged
          </h1>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Error */}
          {error && (
            <div className="bg-red-900/40 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300 text-center">
              {error}
            </div>
          )}

          {view === 'login' ? (
            <>
              <PasskeyLogin onError={handleError} onSuccess={handleSuccess} />
              <GoogleLogin />

              <div className="flex items-center gap-4 text-text-4 text-sm">
                <div className="flex-1 border-t border-border" />
                <span>或</span>
                <div className="flex-1 border-t border-border" />
              </div>

              <div className="text-center text-text-3 text-sm">
                没有账号？
                <button
                  onClick={() => {
                    setView('register')
                    setError(null)
                  }}
                  className="text-accent font-medium cursor-pointer hover:underline ml-1 bg-transparent border-none"
                >
                  注册
                </button>
              </div>
            </>
          ) : (
            <>
              <PasskeyRegister onError={handleError} onSuccess={handleSuccess} />
              <div className="text-center text-text-3 text-sm mt-4">
                已有账号？
                <button
                  onClick={() => {
                    setView('login')
                    setError(null)
                  }}
                  className="text-accent font-medium cursor-pointer hover:underline ml-1 bg-transparent border-none"
                >
                  登录
                </button>
              </div>
            </>
          )}

          <a
            href="/"
            className="block text-center text-text-4 text-sm hover:text-text-3 mt-4 no-underline"
          >
            ← 返回首页
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
