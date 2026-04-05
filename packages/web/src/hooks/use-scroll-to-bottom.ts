import { useEffect, useState, useRef, useCallback } from 'react'

interface UseScrollToBottomOptions {
  threshold?: number // Distance from bottom to show button (default: 200)
}

interface UseScrollToBottomReturn {
  showScrollButton: boolean
  scrollToBottom: () => void
  scrollAreaRef: React.RefObject<HTMLDivElement | null>
  unreadCount: number
  setUnreadCount: React.Dispatch<React.SetStateAction<number>>
}

export function useScrollToBottom({ 
  threshold = 200 
}: UseScrollToBottomOptions = {}): UseScrollToBottomReturn {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const checkScrollPosition = useCallback(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    const { scrollTop, scrollHeight, clientHeight } = scrollArea
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    const newIsAtBottom = distanceFromBottom <= 10 // Small threshold for "at bottom"
    
    setIsAtBottom(newIsAtBottom)
    setShowScrollButton(distanceFromBottom > threshold)
    
    // If user scrolled to bottom, clear unread count
    if (newIsAtBottom && unreadCount > 0) {
      setUnreadCount(0)
    }
  }, [threshold, unreadCount])

  const scrollToBottom = useCallback(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    scrollArea.scrollTo({
      top: scrollArea.scrollHeight,
      behavior: 'smooth'
    })
    setUnreadCount(0)
  }, [])

  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    scrollArea.addEventListener('scroll', checkScrollPosition)
    return () => scrollArea.removeEventListener('scroll', checkScrollPosition)
  }, [checkScrollPosition])

  return {
    showScrollButton,
    scrollToBottom,
    scrollAreaRef,
    unreadCount,
    setUnreadCount,
  }
}