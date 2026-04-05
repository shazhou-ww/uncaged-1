export function formatDateSeparator(timestamp?: number): string {
  if (!timestamp) return '未知时间'
  
  const now = new Date()
  const messageDate = new Date(timestamp * 1000) // Convert from seconds to milliseconds
  
  // Reset time to 00:00:00 for accurate day comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  const msgDate = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate())
  
  if (msgDate.getTime() === today.getTime()) {
    return '今天'
  } else if (msgDate.getTime() === yesterday.getTime()) {
    return '昨天'
  } else {
    // Format as YYYY-MM-DD
    return messageDate.toISOString().split('T')[0]
  }
}

export function shouldShowDateSeparator(
  currentMessage: { timestamp?: number },
  previousMessage: { timestamp?: number } | undefined
): boolean {
  if (!previousMessage || !currentMessage.timestamp || !previousMessage.timestamp) {
    return false
  }
  
  const currentDate = new Date(currentMessage.timestamp * 1000)
  const previousDate = new Date(previousMessage.timestamp * 1000)
  
  // Check if they're on different days
  return currentDate.toDateString() !== previousDate.toDateString()
}