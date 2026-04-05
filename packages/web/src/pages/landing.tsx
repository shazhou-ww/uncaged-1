import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'

const features = [
  {
    icon: '🔑',
    title: '无密码认证',
    desc: '使用 Passkey 或 Google 账号，安全又方便',
  },
  {
    icon: '🧠',
    title: '智能对话',
    desc: 'AI Agent 拥有记忆、个性和工具调用能力',
  },
  {
    icon: '⚡',
    title: '极速部署',
    desc: '基于 Cloudflare Workers，全球边缘节点响应',
  },
  {
    icon: '🔓',
    title: '开放自由',
    desc: '每个人都可以创建和拥有自己的 AI Agent',
  },
]

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20">
        <div className="text-7xl mb-6">🔓</div>
        <h1 className="text-5xl sm:text-6xl font-extrabold mb-4">
          <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
            Uncaged
          </span>
        </h1>
        <p className="text-xl text-text-2 mb-2 max-w-lg">
          释放 AI 的全部潜力
        </p>
        <p className="text-text-3 mb-8 max-w-md">
          创建你自己的 AI Agent —— 拥有记忆、个性和无限能力
        </p>
        <Button size="lg" onClick={() => navigate('/auth/login')}>
          开始使用 →
        </Button>
      </section>

      {/* Features */}
      <section className="px-4 pb-20">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((f) => (
            <Card key={f.title}>
              <CardContent className="flex items-start gap-4">
                <span className="text-3xl flex-shrink-0">{f.icon}</span>
                <div>
                  <h3 className="font-bold text-lg mb-1">{f.title}</h3>
                  <p className="text-text-3 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center text-text-4 text-sm py-6 border-t border-border">
        Uncaged — AI without limits
      </footer>
    </div>
  )
}
