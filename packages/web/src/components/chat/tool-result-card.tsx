import { motion } from 'motion/react'
import { cn } from '../../lib/utils'

interface ToolResultCardProps {
  toolSlug: string
  toolName?: string
  result: unknown
  success: boolean
  timestamp?: number
  onRetry?: () => void
}

function formatTime(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

export function ToolResultCard({
  toolSlug,
  toolName,
  result,
  success,
  timestamp,
  onRetry,
}: ToolResultCardProps) {
  const displayName = toolName || toolSlug

  return (
    <motion.div
      className={cn(
        'rounded-lg overflow-hidden border',
        success
          ? 'border-l-4 border-l-accent border-border'
          : 'border-l-4 border-l-danger border-border',
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02]">
        <span className="text-sm">{success ? '✅' : '❌'}</span>
        <span className="text-sm font-medium text-text">{displayName}</span>
        <span className={cn(
          'text-xs ml-auto',
          success ? 'text-accent' : 'text-danger',
        )}>
          {success ? '成功' : '失败'}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 bg-black/20 border-t border-white/[0.04]">
        <pre className="text-xs text-text-2 whitespace-pre-wrap break-all font-mono max-h-[200px] overflow-y-auto">
          {formatResult(result)}
        </pre>
      </div>

      {/* Footer */}
      <div className="flex items-center px-3 py-1.5 border-t border-white/[0.04] text-xs text-text-4">
        <span>由你直接调用 · {formatTime(timestamp)}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto text-accent hover:text-accent-2 cursor-pointer transition-colors duration-200"
          >
            再来一次
          </button>
        )}
      </div>
    </motion.div>
  )
}
