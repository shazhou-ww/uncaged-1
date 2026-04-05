import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'overflow-y-auto',
        '[&::-webkit-scrollbar]:w-1.5',
        '[&::-webkit-scrollbar-track]:bg-transparent',
        '[&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full',
        '[&::-webkit-scrollbar-thumb]:hover:bg-text-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)
ScrollArea.displayName = 'ScrollArea'
