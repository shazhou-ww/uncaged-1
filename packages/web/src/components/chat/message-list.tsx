import { useEffect, useRef } from 'react'
import { ScrollArea } from '../ui/scroll-area'
import { Spinner } from '../ui/spinner'
import { MessageBubble } from './message-bubble'
import { TypingIndicator } from './typing-indicator'
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  const messageGroups = groupMessages(messages)

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="flex flex-col gap-4">
        {messageGroups.map((group, groupIndex) => {
          if (group.type === 'tool-group') {
            // Render the assistant message and its tool results together
            return (
              <div key={groupIndex} className="flex flex-col gap-2">
                {group.messages.map((msg, msgIndex) => (
                  <MessageBubble
                    key={`${groupIndex}-${msgIndex}`}
                    message={msg}
                    index={groupIndex}
                  />
                ))}
              </div>
            )
          } else {
            // Single message
            return (
              <MessageBubble
                key={groupIndex}
                message={group.messages[0]}
                index={groupIndex}
              />
            )
          }
        })}
        {sending && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
