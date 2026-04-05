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

interface MessageGroup {
  messages: ChatMessage[]
  type: 'single' | 'tool-group'
}

function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let i = 0
  
  while (i < messages.length) {
    const message = messages[i]
    
    // Check if this is an assistant message with tool_calls
    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      // Start a tool group
      const toolGroup: ChatMessage[] = [message]
      i++
      
      // Collect following tool messages that belong to this group
      while (i < messages.length && messages[i].role === 'tool') {
        toolGroup.push(messages[i])
        i++
      }
      
      groups.push({ messages: toolGroup, type: 'tool-group' })
    } else {
      // Single message
      groups.push({ messages: [message], type: 'single' })
      i++
    }
  }
  
  return groups
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

  const messageGroups = groupMessages(messages)

  return (
    <div className="flex-1 relative">
      <ScrollArea className="h-full px-4 py-4" ref={scrollAreaRef}>
        <div className="flex flex-col gap-4 max-w-3xl mx-auto">
          {messageGroups.map((group, groupIndex) => {
            const firstMessage = group.messages[0]
            const previousGroup = groupIndex > 0 ? messageGroups[groupIndex - 1] : undefined
            const previousMessage = previousGroup?.messages[0]
            
            return (
              <div key={groupIndex}>
                {/* Date separator */}
                {shouldShowDateSeparator(firstMessage, previousMessage) && (
                  <div className="flex items-center gap-2 py-2 my-2">
                    <div className="flex-1 h-px bg-white/10"></div>
                    <span className="text-xs text-text-4 px-2 bg-surface rounded-full">
                      {formatDateSeparator(firstMessage.timestamp)}
                    </span>
                    <div className="flex-1 h-px bg-white/10"></div>
                  </div>
                )}
                
                {/* Message group */}
                {group.type === 'tool-group' ? (
                  <div className="flex flex-col gap-2">
                    {group.messages.map((msg, msgIndex) => (
                      <MessageBubble
                        key={`${groupIndex}-${msgIndex}`}
                        message={msg}
                        index={groupIndex}
                      />
                    ))}
                  </div>
                ) : (
                  <MessageBubble
                    key={groupIndex}
                    message={group.messages[0]}
                    index={groupIndex}
                  />
                )}
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
