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
        'bg-surface border-b border-border px-4 py-3 flex items-center justify-between flex-shrink-0 z-10',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl">🔓</span>
        <span className="text-lg font-bold bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
          {agentName}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-1.5 bg-surface-2 rounded-full px-2.5 py-1 pr-3">
            <div className="w-6 h-6 rounded-full bg-border" />
            <span className="text-sm text-text-2 max-w-20 truncate hidden sm:inline">
              {user.displayName || user.slug || ''}
            </span>
          </div>
        )}
        <button
          onClick={onLogout}
          className="bg-transparent border border-border text-text-3 px-2.5 py-1.5 rounded-lg text-sm cursor-pointer transition-all duration-200 hover:border-danger hover:text-danger"
        >
          登出
        </button>
      </div>
    </header>
  )
}
