import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '../../lib/utils'
import type { ToolSearchResult } from '../../lib/api'

interface ToolSearchOverlayProps {
  results: ToolSearchResult[]
  visible: boolean
  activeIndex: number
  onSelect: (tool: ToolSearchResult) => void
  onDismiss: () => void
}

export function ToolSearchOverlay({
  results,
  visible,
  activeIndex,
  onSelect,
  onDismiss,
}: ToolSearchOverlayProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const active = listRef.current.children[activeIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute bottom-full left-0 right-0 mb-2 max-w-3xl mx-auto z-50"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div
            className={cn(
              'bg-surface-2 border border-border rounded-lg shadow-xl overflow-hidden',
              'max-h-[240px] overflow-y-auto',
            )}
            ref={listRef}
          >
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-text-4 text-sm">
                没有找到匹配的工具
              </div>
            ) : (
              results.map((tool, i) => (
                <button
                  key={`${tool.agentSlug}-${tool.slug}`}
                  type="button"
                  onClick={() => onSelect(tool)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer',
                    'transition-colors duration-150',
                    i === activeIndex
                      ? 'bg-accent-glow'
                      : 'hover:bg-white/[0.04]',
                    i !== results.length - 1 && 'border-b border-white/[0.04]',
                  )}
                >
                  <span className="text-lg flex-shrink-0">{tool.icon || '🔧'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-accent truncate">
                      {tool.name}
                      <span className="text-text-4 font-normal ml-1.5 text-xs">
                        @{tool.agentSlug}
                      </span>
                    </div>
                    <div className="text-xs text-text-3 truncate">
                      {tool.description}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
