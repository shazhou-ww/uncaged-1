import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import { cn } from '../../lib/utils'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    
    // Use smaller max-height on mobile (< 768px)
    const isMobile = window.innerWidth < 768
    const maxHeight = isMobile ? 80 : 120
    
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [])

  const handleSend = useCallback(() => {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="bg-surface/80 backdrop-blur-xl border-t border-white/[0.05] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex-shrink-0">
      <div className="flex gap-2 max-w-3xl mx-auto items-end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autoResize()
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息…"
          maxLength={4000}
          rows={1}
          disabled={disabled}
          className={cn(
            'flex-1 bg-surface-2 rounded-[22px] px-4 py-2.5',
            'font-sans text-text placeholder:text-text-4 text-base resize-none',
            'outline-none border-none leading-relaxed overflow-hidden transition-all duration-200',
            'ring-1 ring-white/[0.06] transition-shadow duration-300',
            'focus:ring-1 focus:ring-accent/60 focus:shadow-[0_0_12px_var(--color-accent-glow)]',
            'disabled:opacity-50',
            // Mobile-specific max-height
            'max-h-[80px] md:max-h-[120px]',
          )}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className={cn(
            'w-[42px] h-[42px] rounded-full flex-shrink-0',
            'flex items-center justify-center text-lg',
            'bg-gradient-to-r from-accent to-accent-2 text-bg cursor-pointer transition-all duration-200',
            'hover:shadow-[0_0_20px_var(--color-accent-glow)] hover:scale-105',
            'disabled:bg-text-4 disabled:from-text-4 disabled:to-text-4 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none',
          )}
        >
          ➤
        </button>
      </div>
    </div>
  )
}
