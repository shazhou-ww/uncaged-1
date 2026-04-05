import { useEffect, useRef } from 'react'
import { ScrollArea } from '../ui/scroll-area'
import { Spinner } from '../ui/spinner'
import { MessageBubble } from './message-bubble'
import { TypingIndicator } from './typing-indicator'
import { useScrollToBottom } from '../../hooks/use-scroll-to-bottom'
import { formatDateSeparator, shouldShowDateSeparator } from '../../lib/date-utils'
import { cn } from '../../lib/utils'
import type { ChatMessage } from '../../lib/api'

interface MessageListProps {
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
}

/** A renderable entry: one message with optional tool results attached */
interface MessageEntry {
  message: ChatMessage
  /** tool_call_id → tool result ChatMessage */
  toolResults?: Map<string, ChatMessage>
}

/**
 * Build the list of renderable entries.
 * - Assistant messages with tool_calls absorb subsequent tool-role messages.
 * - Direct-invoke tool results (standalone) are kept as their own entries.
 * - Plain tool-role messages that were absorbed are skipped.
 */
function buildEntries(messages: ChatMessage[]): MessageEntry[] {
  const entries: MessageEntry[] = []
  // Track which message indices are consumed as tool results
  const consumed = new Set<number>()

  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) continue

    const msg = messages[i]

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Absorb subsequent tool-role messages
      const toolResults = new Map<string, ChatMessage>()
      let j = i + 1

      while (j < messages.length && messages[j].role === 'tool') {
        const toolMsg = messages[j]

        // Skip direct-invoke results — they stay standalone
        let isDirectInvoke = false
        if (typeof toolMsg.content === 'string') {
          try {
            const parsed = JSON.parse(toolMsg.content)
            if (parsed._directInvoke) isDirectInvoke = true
          } catch { /* not JSON */ }
        }

        if (isDirectInvoke) {
          // Don't consume — will be its own entry
          break
        }

        // Match by tool_call_id
        if (toolMsg.tool_call_id) {
          toolResults.set(toolMsg.tool_call_id, toolMsg)
        }
        consumed.add(j)
        j++
      }

      entries.push({
        message: msg,
        toolResults: toolResults.size > 0 ? toolResults : undefined,
      })
    } else if (msg.role === 'tool') {
      // Standalone tool message (direct-invoke or orphan)
      entries.push({ message: msg })
    } else {
      // user, assistant (no tool_calls), system
      entries.push({ message: msg })
    }
  }

  return entries
}

export function MessageList({ messages, loading, sending }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { 
    showScrollButton, 
    scrollToBottom, 
    scrollAreaRef, 
    unreadCount, 
    setUnreadCount 
  } = useScrollToBottom()

  // Auto-scroll to bottom for new messages when at bottom
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    const { scrollTop, scrollHeight, clientHeight } = scrollArea
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= 10

    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      // User is scrolled up, increment unread count for new messages
      setUnreadCount(prev => prev + 1)
    }
  }, [messages, sending, setUnreadCount])

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  const entries = buildEntries(messages)

  return (
    <div className="flex-1 relative">
      <ScrollArea className="h-full px-4 py-4" ref={scrollAreaRef}>
        <div className="flex flex-col gap-4 max-w-3xl mx-auto">
          {entries.map((entry, entryIndex) => {
            const previousEntry = entryIndex > 0 ? entries[entryIndex - 1] : undefined
            
            return (
              <div key={entryIndex}>
                {/* Date separator */}
                {shouldShowDateSeparator(entry.message, previousEntry?.message) && (
                  <div className="flex items-center gap-2 py-2 my-2">
                    <div className="flex-1 h-px bg-white/10"></div>
                    <span className="text-xs text-text-4 px-2 bg-surface rounded-full">
                      {formatDateSeparator(entry.message.timestamp)}
                    </span>
                    <div className="flex-1 h-px bg-white/10"></div>
                  </div>
                )}
                
                <MessageBubble
                  message={entry.message}
                  toolResults={entry.toolResults}
                  index={entryIndex}
                />
              </div>
            )
          })}
          {sending && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className={cn(
            'fixed bottom-20 right-6 z-10',
            'w-12 h-12 rounded-full bg-accent shadow-lg',
            'flex items-center justify-center text-bg',
            'hover:scale-105 transition-all duration-200',
            'hover:shadow-[0_0_20px_var(--color-accent-glow)]'
          )}
        >
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
          >
            <path d="m18 9-6 6-6-6" />
          </svg>
          {unreadCount > 0 && (
            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </div>
          )}
        </button>
      )}
      
      {/* TODO: Pull-to-refresh for history - requires pagination API */}
    </div>
  )
}
