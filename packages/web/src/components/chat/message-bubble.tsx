import { motion } from 'motion/react'
import { cn } from '../../lib/utils'
import { ToolCall } from './tool-call'
import { ToolResultCard } from './tool-result-card'
import type { ChatMessage, ContentPart, ToolCall as ToolCallType } from '../../lib/api'

interface MessageBubbleProps {
  message: ChatMessage
  index?: number
}

function formatTime(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Render simple markdown: bold, italic, code, code blocks, links, newlines */
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
    return `<pre class="bg-black/40 border border-white/[0.06] rounded-lg p-3 overflow-x-auto my-2 text-sm font-mono"><code>${code.trim()}</code></pre>`
  })
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-white/[0.08] px-1.5 py-0.5 rounded text-[0.88em] font-mono">$1</code>')
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="text-accent hover:text-accent-2 underline transition-colors duration-200">$1</a>',
  )
  // Newlines
  html = html.replace(/\n/g, '<br>')
  return html
}

function renderContent(content: string | ContentPart[], toolCalls?: ToolCallType[]): JSX.Element {
  const elements: JSX.Element[] = []
  
  // Render main content
  if (typeof content === 'string') {
    elements.push(
      <div key="content" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
    )
  } else if (Array.isArray(content)) {
    content.forEach((part, i) => {
      if (part.type === 'text' && part.text) {
        elements.push(
          <div
            key={`text-${i}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
          />
        )
      } else if (part.type === 'tool_use') {
        elements.push(
          <ToolCall
            key={`tool-use-${i}`}
            name={part.name || 'tool'}
            input={part.input}
          />
        )
      } else if (part.type === 'tool_result') {
        elements.push(
          <ToolCall
            key={`tool-result-${i}`}
            name="结果"
            result={
              typeof part.content === 'string'
                ? part.content
                : JSON.stringify(part.content, null, 2)
            }
            icon="📋"
          />
        )
      }
    })
  }
  
  // Render tool calls if present
  if (toolCalls && toolCalls.length > 0) {
    toolCalls.forEach((toolCall, i) => {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments)
      } catch {
        parsedArgs = { arguments: toolCall.function.arguments }
      }
      
      elements.push(
        <ToolCall
          key={`tool-call-${i}`}
          name={toolCall.function.name}
          input={parsedArgs}
          icon="🔧"
        />
      )
    })
  }
  
  return <>{elements}</>
}

export function MessageBubble({ message, index = 0 }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  // Tool messages should be rendered differently
  if (isTool) {
    // Check if this is a direct-invoke result
    let directInvoke: { toolSlug: string; success: boolean; result: unknown } | null = null
    if (typeof message.content === 'string') {
      try {
        const parsed = JSON.parse(message.content)
        if (parsed._directInvoke) {
          directInvoke = parsed
        }
      } catch { /* not JSON, render normally */ }
    }

    if (directInvoke) {
      return (
        <motion.div
          className="flex gap-2.5 max-w-[85%] md:max-w-[75%] self-start"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.4,
            delay: Math.min(index * 0.05, 0.3),
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
        >
          <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xl bg-white/[0.05] border border-white/[0.06]">
            🔧
          </div>
          <div className="flex flex-col gap-0.5 items-start flex-1">
            <ToolResultCard
              toolSlug={directInvoke.toolSlug}
              result={directInvoke.result}
              success={directInvoke.success}
              timestamp={message.timestamp}
            />
          </div>
        </motion.div>
      )
    }

    return (
      <motion.div
        className="flex gap-2.5 max-w-[85%] md:max-w-[75%] self-start"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.4,
          delay: Math.min(index * 0.05, 0.3),
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      >
        <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xl bg-white/[0.05] border border-white/[0.06]">
          📋
        </div>
        <div className="flex flex-col gap-0.5 items-start flex-1">
          <ToolCall
            name="工具结果"
            result={typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)}
            icon="📋"
          />
          <span className="text-[0.7rem] text-text-4 px-1">
            {formatTime(message.timestamp)}
          </span>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className={cn(
        'flex gap-2.5 max-w-[85%] md:max-w-[75%]',
        isUser ? 'self-end flex-row-reverse' : 'self-start',
      )}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: Math.min(index * 0.05, 0.3),
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xl',
        isUser ? 'bg-user-bg/30' : 'bg-white/[0.05] border border-white/[0.06]',
      )}>
        {isUser ? '👤' : '🔓'}
      </div>

      {/* Body */}
      <div className={cn('flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 leading-relaxed text-[0.95rem] break-words',
            isUser
              ? 'bg-gradient-to-br from-user-bg to-[#163252] rounded-br-sm text-text'
              : 'bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-bl-sm',
          )}
        >
          {isUser ? (
            <span>{typeof message.content === 'string' ? message.content : ''}</span>
          ) : (
            renderContent(message.content, message.tool_calls)
          )}
        </div>
        <span className="text-[0.7rem] text-text-4 px-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </motion.div>
  )
}
