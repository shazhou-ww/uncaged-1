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
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
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
    <div className="bg-surface border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex-shrink-0">
      <div className="flex gap-2 max-w-3xl mx-auto">
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
            'flex-1 bg-surface-2 border border-border rounded-[22px] px-4 py-2.5',
            'text-text placeholder:text-text-4 text-base resize-none',
            'outline-none transition-colors max-h-[120px] leading-relaxed',
            'focus:border-accent',
            'disabled:opacity-50',
          )}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className={cn(
            'w-[42px] h-[42px] rounded-full flex-shrink-0 self-end',
            'flex items-center justify-center text-lg',
            'bg-accent text-bg cursor-pointer transition-all duration-200',
            'hover:bg-accent-2 hover:scale-105',
            'disabled:bg-text-4 disabled:cursor-not-allowed disabled:scale-100',
          )}
        >
          ➤
        </button>
      </div>
    </div>
  )
}
