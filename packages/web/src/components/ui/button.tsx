import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const variants: Record<string, string> = {
  default:
    'bg-gradient-to-r from-accent to-accent-2 text-bg hover:shadow-lg hover:shadow-accent/30 hover:-translate-y-0.5',
  secondary:
    'bg-surface-2 text-text border border-border hover:bg-border hover:border-text-4',
  outline:
    'bg-transparent text-text border border-border hover:bg-surface-2',
  ghost:
    'bg-transparent text-text-2 hover:bg-surface-2 hover:text-text',
  danger:
    'bg-danger text-white hover:bg-red-700',
}

const sizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  default: 'px-5 py-2.5 text-base rounded-xl',
  lg: 'px-6 py-3 text-lg rounded-xl',
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
