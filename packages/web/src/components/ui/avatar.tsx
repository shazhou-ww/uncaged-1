import { cn } from '../../lib/utils'

interface AvatarProps {
  src?: string | null
  fallback: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses: Record<string, string> = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-base',
}

export function Avatar({ src, fallback, className, size = 'md' }: AvatarProps) {
  const initials = fallback
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className={cn(
        'rounded-full flex-shrink-0 flex items-center justify-center',
        'bg-surface-2 text-text-3 font-medium overflow-hidden',
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        <img src={src} alt={fallback} className="w-full h-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  )
}
