import { useState, useCallback, useRef, useEffect } from 'react'
import {
  sendMessage as apiSendMessage,
  sendMessageStream as apiSendMessageStream,
  loadHistory as apiLoadHistory,
  clearHistory as apiClearHistory,
  type ChatMessage,
  type StreamEvent,
} from '../lib/api'

interface ChatState {
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  sendMessage: (text: string) => Promise<void>
  loadHistory: () => Promise<void>
  clearHistory: () => Promise<void>
  addToolResult: (toolSlug: string, result: unknown, success: boolean) => void
}

export function useChat(basePath: string): ChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const basePathRef = useRef(basePath)
  basePathRef.current = basePath

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiLoadHistory(basePathRef.current)
      setMessages(data.history || [])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    // Add user message immediately
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setSending(true)

    // Create a placeholder assistant message for streaming
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, assistantMsg])

    try {
      await apiSendMessageStream(basePathRef.current, text, (event: StreamEvent) => {
        if (event.type === 'token') {
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            if (last.role !== 'assistant') {
              // New ReAct round: create a fresh assistant message
              return [...msgs, {
                role: 'assistant' as const,
                content: event.text,
                timestamp: Date.now(),
              }]
            }
            msgs[msgs.length - 1] = {
              ...last,
              content: (typeof last.content === 'string' ? last.content : '') + event.text,
            }
            return msgs
          })
        }
        if (event.type === 'tool_start') {
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            if (last.role !== 'assistant') {
              // New ReAct round: create a fresh assistant message for this tool_call
              return [...msgs, {
                role: 'assistant' as const,
                content: '',
                timestamp: Date.now(),
                tool_calls: [{
                  id: `tc_${Date.now()}`,
                  type: 'function' as const,
                  function: { name: event.name, arguments: event.arguments },
                }],
              }]
            }
            const existing = last.tool_calls || []
            msgs[msgs.length - 1] = {
              ...last,
              tool_calls: [...existing, {
                id: `tc_${Date.now()}`,
                type: 'function' as const,
                function: { name: event.name, arguments: event.arguments },
              }],
            }
            return [...msgs]
          })
        }
        if (event.type === 'tool_result') {
          // Add tool result message
          setMessages(prev => [...prev, {
            role: 'tool',
            content: event.content,
            tool_call_id: `tc_${Date.now()}`,
            timestamp: Date.now(),
          }])
        }
        if (event.type === 'error') {
          // Replace assistant message with error
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            if (last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: event.message }
            }
            return msgs
          })
        }
        // event.type === 'done' doesn't need special handling
      })
    } catch {
      setMessages(prev => {
        const msgs = [...prev]
        const last = msgs[msgs.length - 1]
        if (last.role === 'assistant' && !last.content) {
          msgs[msgs.length - 1] = { ...last, content: '抱歉，遇到了问题，请稍后重试 😥' }
        }
        return msgs
      })
    } finally {
      setSending(false)
    }
  }, [])

  const clearChat = useCallback(async () => {
    if (!window.confirm('确定要清空聊天记录吗？')) return
    try {
      await apiClearHistory(basePathRef.current)
      setMessages([])
    } catch {
      // silently fail
    }
  }, [])

  const addToolResult = useCallback(
    (toolSlug: string, result: unknown, success: boolean) => {
      const resultMsg: ChatMessage = {
        role: 'tool',
        content: JSON.stringify({
          _directInvoke: true,
          toolSlug,
          success,
          result,
        }),
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, resultMsg])
    },
    [],
  )

  // Load history on mount
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return {
    messages,
    loading,
    sending,
    sendMessage,
    loadHistory,
    clearHistory: clearChat,
    addToolResult,
  }
}
