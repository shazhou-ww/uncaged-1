import { useState, useCallback, useRef, useEffect } from 'react'
import {
  sendMessage as apiSendMessage,
  loadHistory as apiLoadHistory,
  clearHistory as apiClearHistory,
  type ChatMessage,
} from '../lib/api'

interface ChatState {
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  sendMessage: (text: string) => Promise<void>
  loadHistory: () => Promise<void>
  clearHistory: () => Promise<void>
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
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setSending(true)
    try {
      const data = await apiSendMessage(basePathRef.current, text)
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.response,
        timestamp: data.timestamp,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: '抱歉，遇到了问题，请稍后重试 😥',
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setSending(false)
    }
  }, [])

  const clearChat = useCallback(async () => {
    try {
      await apiClearHistory(basePathRef.current)
      setMessages([])
    } catch {
      // silently fail
    }
  }, [])

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
  }
}
