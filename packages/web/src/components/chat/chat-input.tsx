import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import { cn } from '../../lib/utils'
import { searchCapabilities, invokeToolDirect, type ToolSearchResult } from '../../lib/api'
import { ToolSearchOverlay } from './tool-search-overlay'
import { SchemaForm } from './schema-form'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  ownerPath: string
  basePath: string
  addToolResult: (toolSlug: string, result: unknown, success: boolean) => void
}

export function ChatInput({
  onSend,
  disabled,
  ownerPath,
  basePath,
  addToolResult,
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<'chat' | 'form'>('chat')
  const [searchResults, setSearchResults] = useState<ToolSearchResult[]>([])
  const [showOverlay, setShowOverlay] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedTool, setSelectedTool] = useState<ToolSearchResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    setShowOverlay(false)
    setSearchResults([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend])

  const dismissOverlay = useCallback(() => {
    setShowOverlay(false)
    setSearchResults([])
    setActiveIndex(0)
  }, [])

  const selectTool = useCallback((tool: ToolSearchResult) => {
    setSelectedTool(tool)
    setMode('form')
    setShowOverlay(false)
    setSearchResults([])
    setValue('')
    setActiveIndex(0)
  }, [])

  const cancelForm = useCallback(() => {
    setMode('chat')
    setSelectedTool(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const handleFormSubmit = useCallback(
    async (args: Record<string, unknown>) => {
      if (!selectedTool) return
      setSubmitting(true)
      try {
        const toolBasePath = `/${ownerPath.replace(/^\//, '')}/${selectedTool.agentSlug}`
        const data = await invokeToolDirect(toolBasePath, selectedTool.slug, args)
        addToolResult(selectedTool.slug, data.result ?? data.error, data.success)
      } catch (err) {
        addToolResult(selectedTool.slug, String(err), false)
      } finally {
        setSubmitting(false)
        cancelForm()
      }
    },
    [selectedTool, ownerPath, addToolResult, cancelForm],
  )

  // Debounced search
  const doSearch = useCallback(
    (query: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      if (query.length < 2) {
        dismissOverlay()
        return
      }
      searchTimer.current = setTimeout(async () => {
        try {
          const results = await searchCapabilities(ownerPath, query)
          setSearchResults(results)
          setShowOverlay(results.length > 0)
          setActiveIndex(0)
        } catch {
          dismissOverlay()
        }
      }, 300)
    },
    [ownerPath, dismissOverlay],
  )

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  const handleChange = useCallback(
    (text: string) => {
      setValue(text)
      doSearch(text.startsWith('/') ? text.slice(1) : text)
    },
    [doSearch],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Overlay navigation
      if (showOverlay && searchResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIndex(i => (i + 1) % searchResults.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex(i => (i - 1 + searchResults.length) % searchResults.length)
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          selectTool(searchResults[activeIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          dismissOverlay()
          return
        }
      }

      // Normal chat
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [showOverlay, searchResults, activeIndex, selectTool, dismissOverlay, handleSend],
  )

  // Form mode
  if (mode === 'form' && selectedTool) {
    return (
      <div className="bg-surface/80 backdrop-blur-xl border-t border-white/[0.05] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          <SchemaForm
            tool={selectedTool}
            onSubmit={handleFormSubmit}
            onCancel={cancelForm}
            submitting={submitting}
          />
        </div>
      </div>
    )
  }

  // Chat mode
  return (
    <div className="bg-surface/80 backdrop-blur-xl border-t border-white/[0.05] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex-shrink-0 relative">
      <div className="flex gap-2 max-w-3xl mx-auto items-end relative">
        <ToolSearchOverlay
          results={searchResults}
          visible={showOverlay}
          activeIndex={activeIndex}
          onSelect={selectTool}
          onDismiss={dismissOverlay}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            handleChange(e.target.value)
            autoResize()
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息… 或搜索工具"
          maxLength={4000}
          rows={1}
          disabled={disabled}
          className={cn(
            'flex-1 bg-surface-2 rounded-[22px] px-4 py-2.5',
            'font-sans text-text placeholder:text-text-4 text-base resize-none',
            'outline-none border-none max-h-[120px] leading-relaxed overflow-hidden',
            'ring-1 ring-white/[0.06] transition-shadow duration-300',
            'focus:ring-1 focus:ring-accent/60 focus:shadow-[0_0_12px_var(--color-accent-glow)]',
            'disabled:opacity-50',
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
