import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Button } from '../components/ui/button'

const features = [
  {
    icon: '🤖',
    title: '多 Agent 管理',
    desc: '一个账号，多个 AI 助手，各司其职',
  },
  {
    icon: '🔐',
    title: '安全认证',
    desc: 'Passkey 指纹登录，无密码，更安全',
  },
  {
    icon: '💬',
    title: '跨平台',
    desc: 'Telegram、Web、API 全覆盖',
  },
  {
    icon: '⚡',
    title: '边缘运行',
    desc: 'Cloudflare 全球加速，毫秒级响应',
  },
]

const wordVariants = {
  hidden: { opacity: 0, y: 20, filter: 'blur(8px)' },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { delay: 0.3 + i * 0.12, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay, duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(251,191,36,0.08) 0%, transparent 70%)',
          }}
          animate={{
            x: [0, 30, -20, 0],
            y: [0, -20, 30, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute top-1/3 -right-32 w-[400px] h-[400px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%)',
          }}
          animate={{
            x: [0, -25, 15, 0],
            y: [0, 25, -15, 0],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute -bottom-32 left-1/3 w-[350px] h-[350px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(251,191,36,0.05) 0%, transparent 70%)',
          }}
          animate={{
            x: [0, 20, -30, 0],
            y: [0, -30, 20, 0],
          }}
          transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24 relative z-10">
        <motion.div
          className="text-6xl mb-8"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          🔓
        </motion.div>

        <h1 className="font-display font-bold tracking-tight mb-3">
          {['Uncaged'].map((word, i) => (
            <motion.span
              key={word}
              className="inline-block text-6xl sm:text-7xl md:text-8xl bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent"
              variants={wordVariants}
              initial="hidden"
              animate="visible"
              custom={i}
            >
              {word}
            </motion.span>
          ))}
        </h1>

        <div className="font-display font-semibold text-2xl sm:text-3xl md:text-4xl tracking-tight mb-2 overflow-hidden">
          {['Your', 'AI', 'Agent,'].map((word, i) => (
            <motion.span
              key={word}
              className="inline-block mr-3 text-text"
              variants={wordVariants}
              initial="hidden"
              animate="visible"
              custom={i + 1}
            >
              {word}
            </motion.span>
          ))}
        </div>
        <div className="font-display font-semibold text-2xl sm:text-3xl md:text-4xl tracking-tight mb-6 overflow-hidden">
          <motion.span
            className="inline-block bg-gradient-to-r from-text to-text-2 bg-clip-text text-transparent"
            variants={wordVariants}
            initial="hidden"
            animate="visible"
            custom={4}
          >
            Unleashed.
          </motion.span>
        </div>

        <motion.p
          className="text-text-3 text-base sm:text-lg mb-10 max-w-md"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={1.0}
        >
          创建你的 AI Agent，无需代码，随处可用。
        </motion.p>

        <motion.div
          className="flex items-center gap-4"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={1.2}
        >
          <Button
            size="lg"
            className="glow-accent"
            onClick={() => navigate('/auth/login')}
          >
            开始使用
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="border border-border-2"
            onClick={() => {
              document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            了解更多
          </Button>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="px-4 pb-24 relative z-10">
        <motion.div
          className="max-w-4xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          <motion.h2
            className="font-display text-2xl sm:text-3xl font-bold text-center mb-12 text-text"
            variants={fadeUp}
            custom={0}
          >
            为什么选择{' '}
            <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
              Uncaged
            </span>
          </motion.h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                className="group rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] p-6 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.05]"
                variants={fadeUp}
                custom={0.1 + i * 0.1}
                whileHover={{
                  boxShadow: '0 0 30px rgba(251, 191, 36, 0.06)',
                }}
              >
                <div className="flex items-start gap-4">
                  <span className="text-3xl flex-shrink-0">{f.icon}</span>
                  <div>
                    <h3 className="font-display font-semibold text-lg mb-1.5 text-text">
                      {f.title}
                    </h3>
                    <p className="text-text-3 text-sm leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-24 relative z-10">
        <motion.div
          className="max-w-2xl mx-auto text-center rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] p-10 sm:p-14"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <h2 className="font-display text-2xl sm:text-3xl font-bold mb-3">
            准备好释放 AI 了吗？
          </h2>
          <p className="text-text-3 mb-8">
            免费开始，无需信用卡
          </p>
          <Button
            size="lg"
            className="glow-accent"
            onClick={() => navigate('/auth/login')}
          >
            免费创建账号 →
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="text-center text-text-4 text-sm py-8 border-t border-white/[0.04] relative z-10">
        <span className="font-display">Uncaged</span> — AI without limits
      </footer>
    </div>
  )
}
