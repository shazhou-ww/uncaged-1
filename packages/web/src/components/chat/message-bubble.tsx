import { cn } from '../../lib/utils'
import { ToolCall } from './tool-call'
import type { ChatMessage, ContentPart } from '../../lib/api'

interface MessageBubbleProps {
  message: ChatMessage
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
    return `<pre class="bg-black/60 rounded-lg p-3 overflow-x-auto my-2 text-sm"><code>${code.trim()}</code></pre>`
  })
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1.5 py-0.5 rounded text-[0.88em]">$1</code>')
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="text-accent underline">$1</a>',
  )
  // Newlines
  html = html.replace(/\n/g, '<br>')
  return html
}

function renderContent(content: string | ContentPart[]): JSX.Element {
  if (typeof content === 'string') {
    return <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
  }

  if (Array.isArray(content)) {
    return (
      <>
        {content.map((part, i) => {
          if (part.type === 'text' && part.text) {
            return (
              <div
                key={i}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
              />
            )
          }
          if (part.type === 'tool_use') {
            return (
              <ToolCall
                key={i}
                name={part.name || 'tool'}
                input={part.input}
              />
            )
          }
          if (part.type === 'tool_result') {
            return (
              <ToolCall
                key={i}
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
          return null
        })}
      </>
    )
  }

  return <></>
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div
      className={cn(
        'flex gap-2 max-w-[85%] animate-[fadeIn_0.2s_ease-out] md:max-w-[75%]',
        isUser ? 'self-end flex-row-reverse' : 'self-start',
      )}
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xl bg-surface-2">
        {isUser ? '👤' : '🔓'}
      </div>

      {/* Body */}
      <div className={cn('flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 leading-relaxed text-[0.95rem] break-words',
            isUser
              ? 'bg-user-bg rounded-br-sm'
              : 'bg-surface-2 border border-border rounded-bl-sm',
          )}
        >
          {isUser ? (
            <span>{typeof message.content === 'string' ? message.content : ''}</span>
          ) : (
            renderContent(message.content)
          )}
        </div>
        <span className="text-[0.7rem] text-text-4 px-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  )
}
