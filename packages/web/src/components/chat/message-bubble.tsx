import { motion } from 'motion/react'
import { cn } from '../../lib/utils'
import { ToolCall } from './tool-call'
import { ToolResultCard } from './tool-result-card'
import type { ChatMessage, ContentPart, ToolCall as ToolCallType } from '../../lib/api'

interface MessageBubbleProps {
  message: ChatMessage
  /** Map from tool_call_id to the corresponding tool result ChatMessage */
  toolResults?: Map<string, ChatMessage>
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

// ── Section extraction helpers ────────────────────────────────────────

interface TextSection {
  type: 'text'
  html: string
}

interface AttachmentSection {
  type: 'attachment'
  images: { url: string; alt?: string }[]
}

interface ToolSection {
  type: 'tool'
  toolCall: ToolCallType
  toolResult?: ChatMessage
  resultPending: boolean
}

interface DirectInvokeSection {
  type: 'direct-invoke'
  toolSlug: string
  success: boolean
  result: unknown
  timestamp?: number
}

type BubbleSection = TextSection | AttachmentSection | ToolSection | DirectInvokeSection

function extractSections(
  message: ChatMessage,
  toolResults?: Map<string, ChatMessage>,
): BubbleSection[] {
  const sections: BubbleSection[] = []
  const content = message.content
  const toolCalls = message.tool_calls

  // ── Text & attachments from content ──
  if (typeof content === 'string' && content.trim()) {
    // Check if this is a direct-invoke tool result rendered as a standalone bubble
    // (This shouldn't happen in the new flow, but keep for safety)
    try {
      const parsed = JSON.parse(content)
      if (parsed._directInvoke) {
        sections.push({
          type: 'direct-invoke',
          toolSlug: parsed.toolSlug,
          success: parsed.success,
          result: parsed.result,
          timestamp: message.timestamp,
        })
        return sections
      }
    } catch { /* not JSON, continue */ }

    sections.push({ type: 'text', html: renderMarkdown(content) })
  } else if (Array.isArray(content)) {
    const textParts: string[] = []
    const images: { url: string; alt?: string }[] = []

    for (const part of content as ContentPart[]) {
      if (part.type === 'text' && part.text) {
        textParts.push(part.text)
      } else if (part.type === 'image_url' && part.image_url?.url) {
        images.push({ url: part.image_url.url })
      }
      // tool_use / tool_result content parts are handled via tool_calls below
    }

    if (textParts.length > 0) {
      sections.push({ type: 'text', html: renderMarkdown(textParts.join('\n')) })
    }
    if (images.length > 0) {
      sections.push({ type: 'attachment', images })
    }
  }

  // ── Tool calls ──
  if (toolCalls && toolCalls.length > 0) {
    toolCalls.forEach((tc, i) => {
      // Try to find matching tool result:
      // 1. Direct ID match
      // 2. Positional fallback (for streaming where IDs are generated independently)
      let toolResult: ChatMessage | undefined
      if (toolResults) {
        toolResult = toolResults.get(tc.id)
        if (!toolResult) {
          // Positional fallback: nth tool_call → nth tool result
          const resultEntries = Array.from(toolResults.values())
          if (i < resultEntries.length) {
            toolResult = resultEntries[i]
          }
        }
      }

      const resultPending = !toolResult
      sections.push({ type: 'tool', toolCall: tc, toolResult, resultPending })
    })
  }

  return sections
}

// ── Section renderers ─────────────────────────────────────────────────

function TextSectionView({ section }: { section: TextSection }) {
  return (
    <div className="px-4 py-3">
      <div
        className="leading-relaxed text-[0.95rem] break-words"
        dangerouslySetInnerHTML={{ __html: section.html }}
      />
    </div>
  )
}

function AttachmentSectionView({ section }: { section: AttachmentSection }) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {section.images.map((img, i) => (
          <a
            key={i}
            href={img.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block max-w-[260px] rounded-lg overflow-hidden border border-white/[0.06] hover:border-accent/40 transition-colors"
          >
            <img
              src={img.url}
              alt={img.alt || '附件'}
              className="w-full h-auto object-cover"
              loading="lazy"
            />
          </a>
        ))}
      </div>
    </div>
  )
}

function ToolSectionView({ section }: { section: ToolSection }) {
  let parsedArgs: Record<string, unknown> = {}
  try {
    parsedArgs = JSON.parse(section.toolCall.function.arguments)
  } catch {
    parsedArgs = { raw_arguments: section.toolCall.function.arguments }
  }

  return (
    <div className="px-3 py-2">
      <ToolCall
        name={section.toolCall.function.name}
        input={parsedArgs}
        icon="🔧"
        toolResult={section.toolResult}
        resultPending={section.resultPending}
      />
    </div>
  )
}

function DirectInvokeSectionView({ section }: { section: DirectInvokeSection }) {
  return (
    <div className="px-3 py-2">
      <ToolResultCard
        toolSlug={section.toolSlug}
        result={section.result}
        success={section.success}
        timestamp={section.timestamp}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────

export function MessageBubble({ message, toolResults, index = 0 }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  // tool role messages are no longer rendered as standalone bubbles
  // (they are absorbed into the parent assistant bubble via toolResults)
  // But keep a safety fallback for direct-invoke tool results that arrive standalone
  if (message.role === 'tool') {
    // Check if this is a direct-invoke result (these may still come standalone)
    let directInvoke: { toolSlug: string; success: boolean; result: unknown } | null = null
    if (typeof message.content === 'string') {
      try {
        const parsed = JSON.parse(message.content)
        if (parsed._directInvoke) {
          directInvoke = parsed
        }
      } catch { /* not JSON */ }
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

    // Non-direct-invoke tool messages should be absorbed by groupMessages.
    // If we reach here, it's an orphan — don't render it.
    return null
  }

  const sections = extractSections(message, toolResults)

  // Empty message — nothing to render
  if (sections.length === 0) return null

  return (
    <motion.div
      className={cn(
        'flex gap-2.5 max-w-[85%] md:max-w-[75%]',
        isUser ? 'ml-auto flex-row-reverse' : 'self-start',
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
            'rounded-2xl overflow-hidden leading-relaxed text-[0.95rem] break-words',
            isUser
              ? 'bg-gradient-to-br from-user-bg to-[#163252] rounded-br-sm text-text'
              : 'bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-bl-sm',
          )}
        >
          {sections.map((section, i) => {
            const isFirst = i === 0
            const separator = !isFirst ? (
              <div className="border-t border-border" />
            ) : null

            switch (section.type) {
              case 'text':
                return (
                  <div key={`text-${i}`}>
                    {separator}
                    <TextSectionView section={section} />
                  </div>
                )
              case 'attachment':
                return (
                  <div key={`attachment-${i}`}>
                    {separator}
                    <AttachmentSectionView section={section} />
                  </div>
                )
              case 'tool':
                return (
                  <div key={`tool-${i}`}>
                    {separator}
                    <ToolSectionView section={section} />
                  </div>
                )
              case 'direct-invoke':
                return (
                  <div key={`di-${i}`}>
                    {separator}
                    <DirectInvokeSectionView section={section} />
                  </div>
                )
              default:
                return null
            }
          })}
        </div>
        <span className="text-[0.7rem] text-text-4 px-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </motion.div>
  )
}
