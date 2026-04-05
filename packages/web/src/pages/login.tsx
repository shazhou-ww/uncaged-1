import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
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
        redirectToAgent(data)
      })
      .catch(() => {})
  }, [])

  function redirectToAgent(data: { user: { slug?: string }; agents?: Array<{ slug: string }> }) {
    if (data.agents?.length && data.user.slug) {
      window.location.href = `/${data.user.slug}/${data.agents[0].slug}/`
    } else {
      window.location.href = '/'
    }
  }

  async function handleSuccess() {
    try {
      const r = await fetch('/auth/session', { credentials: 'same-origin' })
      if (r.ok) {
        const data = await r.json()
        redirectToAgent(data)
        return
      }
    } catch {}
    window.location.href = '/'
  }

  function handleError(msg: string) {
    setError(msg)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(251,191,36,0.06) 0%, transparent 70%)',
          }}
        />
      </div>

      <motion.div
        className="w-full max-w-[420px] relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08]">
          <CardHeader className="text-center">
            <motion.div
              className="text-5xl mb-3"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              🔓
            </motion.div>
            <h1 className="font-display text-3xl font-bold bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
              Uncaged
            </h1>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  className="bg-red-900/30 border border-red-800/50 rounded-xl px-4 py-3 text-sm text-red-300 text-center"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {view === 'login' ? (
                <motion.div
                  key="login"
                  className="space-y-4"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  <PasskeyLogin onError={handleError} onSuccess={handleSuccess} />
                  <GoogleLogin />

                  <div className="flex items-center gap-4 text-text-4 text-sm mt-2">
                    <div className="flex-1 border-t border-white/[0.06]" />
                    <span>没有账号？</span>
                    <div className="flex-1 border-t border-white/[0.06]" />
                  </div>

                  <div className="text-center">
                    <button
                      onClick={() => {
                        setView('register')
                        setError(null)
                      }}
                      className="text-accent font-medium cursor-pointer hover:underline bg-transparent border-none text-sm transition-colors duration-200 hover:text-accent-2"
                    >
                      创建账号
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="register"
                  className="space-y-4"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <PasskeyRegister onError={handleError} onSuccess={handleSuccess} />
                  <div className="text-center text-text-3 text-sm mt-4">
                    已有账号？
                    <button
                      onClick={() => {
                        setView('login')
                        setError(null)
                      }}
                      className="text-accent font-medium cursor-pointer hover:underline ml-1 bg-transparent border-none transition-colors duration-200 hover:text-accent-2"
                    >
                      登录
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <a
              href="/"
              className="block text-center text-text-4 text-sm hover:text-text-3 mt-4 no-underline transition-colors duration-200"
            >
              ← 返回首页
            </a>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
