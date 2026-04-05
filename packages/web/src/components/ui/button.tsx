import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const variants: Record<string, string> = {
  default:
    'bg-gradient-to-r from-accent to-accent-2 text-bg font-display hover:shadow-[0_0_20px_var(--color-accent-glow)] hover:-translate-y-0.5',
  secondary:
    'bg-surface-2 text-text border border-border font-display hover:bg-surface-3 hover:border-border-2',
  outline:
    'bg-transparent text-text border border-border font-display hover:bg-white/[0.04] hover:border-border-2',
  ghost:
    'bg-transparent text-text-2 font-display hover:bg-white/[0.04] hover:text-text',
  danger:
    'bg-danger text-white font-display hover:bg-red-700',
}

const sizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  default: 'px-5 py-2.5 text-base rounded-xl',
  lg: 'px-7 py-3 text-lg rounded-xl',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-semibold cursor-pointer transition-all duration-200',
          variants[variant],
          sizes[size],
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
        disabled={disabled}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
