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

  return (
    <ScrollArea className="flex-1 p-4">
      <div className="flex flex-col gap-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {sending && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
