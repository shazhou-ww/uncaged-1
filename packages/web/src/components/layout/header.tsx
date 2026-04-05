import { cn } from '../../lib/utils'
import type { User } from '../../lib/auth'

interface HeaderProps {
  agentName: string
  user: User | null
  onLogout: () => void
  className?: string
}

export function Header({ agentName, user, onLogout, className }: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 backdrop-blur-xl bg-surface/80 border-b border-white/[0.05] px-4 py-3 flex items-center justify-between flex-shrink-0 z-20',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-2xl">🔓</span>
        <div className="w-px h-5 bg-white/[0.08]" />
        <span className="font-display text-lg font-semibold bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
          {agentName}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded-full px-2.5 py-1 pr-3">
            <div className="w-6 h-6 rounded-full bg-surface-3" />
            <span className="text-sm text-text-2 max-w-20 truncate hidden sm:inline">
              {user.displayName || user.slug || ''}
            </span>
          </div>
        )}
        <button
          onClick={onLogout}
          className="bg-transparent border border-white/[0.08] text-text-3 px-2.5 py-1.5 rounded-lg text-sm cursor-pointer transition-all duration-200 hover:border-danger/50 hover:text-danger"
        >
          登出
        </button>
      </div>
    </header>
  )
}
