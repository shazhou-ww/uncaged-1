import { useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

interface MagicLinkProps {
  onError: (msg: string) => void
}

export function MagicLink({ onError }: MagicLinkProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSend() {
    const trimmed = email.trim()
    if (!trimmed) {
      onError('请输入邮箱地址')
      return
    }

    setLoading(true)
    try {
      const r = await fetch('/auth/magic/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
        credentials: 'same-origin',
      })

      if (!r.ok) {
        const data = await r.json().catch(() => ({ error: '发送失败' }))
        onError(data.error || '发送失败')
        return
      }

      const data = await r.json()

      setSent(true)
    } catch {
      onError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center py-4 space-y-3">
        <div className="text-3xl">📧</div>
        <p className="text-text-2 text-sm">
          登录链接已发送到 <strong className="text-text">{email}</strong>
        </p>
        <p className="text-text-4 text-xs">请查看邮箱，点击链接完成登录（5 分钟有效）</p>
        <button
          onClick={() => { setSent(false); setEmail('') }}
          className="text-accent text-sm cursor-pointer bg-transparent border-none hover:underline"
        >
          使用其他邮箱
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Input
        type="email"
        placeholder="输入邮箱地址"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
        disabled={loading}
      />
      <Button
        variant="secondary"
        className="w-full"
        onClick={handleSend}
        disabled={loading || !email.trim()}
      >
        {loading ? '发送中…' : '📧 发送登录链接'}
      </Button>
    </div>
  )
}
