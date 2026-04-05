import { Collapsible } from '../ui/collapsible'
import { ToolResultCard } from './tool-result-card'
import type { ChatMessage } from '../../lib/api'

interface ToolCallProps {
  name: string
  input?: Record<string, unknown>
  result?: string
  icon?: string
  /** Associated tool result message (from grouped messages) */
  toolResult?: ChatMessage
  /** Whether a tool result is expected but hasn't arrived yet (streaming) */
  resultPending?: boolean
}

function formatArguments(input: Record<string, unknown>): React.ReactNode {
  if (!input || Object.keys(input).length === 0) {
    return <span className="text-text-4 italic">无参数</span>
  }

  const entries = Object.entries(input)
  
  // If simple object with few keys, show as key: value lines
  if (entries.length <= 3 && entries.every(([_, value]) => 
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  )) {
    return (
      <div className="space-y-1">
        {entries.map(([key, value]) => (
          <div key={key} className="text-[0.85rem]">
            <span className="text-text-3">{key}:</span>{' '}
            <span className="text-text-2">{String(value)}</span>
          </div>
        ))}
      </div>
    )
  }

  // Otherwise show raw JSON
  return (
    <pre className="text-[0.85rem] text-text-2 whitespace-pre-wrap break-all font-mono bg-black/20 p-2 rounded">
      {JSON.stringify(input, null, 2)}
    </pre>
  )
}

function formatResult(result: string): React.ReactNode {
  try {
    const parsed = JSON.parse(result)
    
    // Check for instructions field
    if (parsed.instructions && typeof parsed.instructions === 'string') {
      return (
        <div className="space-y-2">
          <div className="text-[0.9rem] text-text-2 leading-relaxed whitespace-pre-wrap">
            {parsed.instructions}
          </div>
          {Object.keys(parsed).length > 1 && (
            <details className="mt-3">
              <summary className="text-[0.8rem] text-text-4 cursor-pointer hover:text-text-3">
                查看原始响应
              </summary>
              <pre className="text-[0.75rem] text-text-3 font-mono bg-black/30 p-2 rounded mt-2 overflow-x-auto">
                {JSON.stringify(parsed, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )
    }
    
    // Check for error field
    if (parsed.error && typeof parsed.error === 'string') {
      return (
        <div className="space-y-2">
          <div className="text-[0.9rem] text-red-400 leading-relaxed whitespace-pre-wrap">
            ❌ {parsed.error}
          </div>
          {Object.keys(parsed).length > 1 && (
            <details className="mt-3">
              <summary className="text-[0.8rem] text-text-4 cursor-pointer hover:text-text-3">
                查看详细信息
              </summary>
              <pre className="text-[0.75rem] text-text-3 font-mono bg-black/30 p-2 rounded mt-2 overflow-x-auto">
                {JSON.stringify(parsed, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )
    }
    
    // For other cases, show raw JSON
    return (
      <pre className="text-[0.85rem] text-text-2 whitespace-pre-wrap break-all font-mono bg-black/20 p-2 rounded">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    )
  } catch {
    // Not valid JSON, show as text
    return (
      <div className="text-[0.85rem] text-text-2 whitespace-pre-wrap break-all">
        {result}
      </div>
    )
  }
}

/** Render the content from a tool result ChatMessage */
function renderToolResultContent(toolResult: ChatMessage): React.ReactNode {
  // Check if this is a direct-invoke result
  if (typeof toolResult.content === 'string') {
    try {
      const parsed = JSON.parse(toolResult.content)
      if (parsed._directInvoke) {
        return (
          <ToolResultCard
            toolSlug={parsed.toolSlug}
            result={parsed.result}
            success={parsed.success}
            timestamp={toolResult.timestamp}
          />
        )
      }
    } catch { /* not JSON, render normally */ }
  }

  const content = typeof toolResult.content === 'string'
    ? toolResult.content
    : JSON.stringify(toolResult.content, null, 2)
  
  return formatResult(content)
}

export function ToolCall({ name, input, result, icon = '🔧', toolResult, resultPending }: ToolCallProps) {
  const hasInput = input && Object.keys(input).length > 0
  const hasResult = result && result.trim().length > 0
  const hasToolResult = !!toolResult

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <Collapsible
        trigger={
          <span className="text-[0.85rem] text-text-3 hover:text-text-2 transition-colors block">
            {icon} {name}
            {resultPending && (
              <span className="ml-2 inline-flex items-center gap-1 text-text-4">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="text-[0.75rem]">运行中…</span>
              </span>
            )}
          </span>
        }
      >
        <div className="border-t border-border px-3 py-3 space-y-3">
          {hasInput && (
            <div>
              <div className="text-[0.75rem] text-text-4 mb-2 font-medium">参数</div>
              {formatArguments(input!)}
            </div>
          )}
          
          {hasResult && (
            <div>
              {hasInput && <div className="text-[0.75rem] text-text-4 mb-2 font-medium">结果</div>}
              {formatResult(result!)}
            </div>
          )}

          {hasToolResult && (
            <div>
              <div className="text-[0.75rem] text-text-4 mb-2 font-medium">结果</div>
              {renderToolResultContent(toolResult!)}
            </div>
          )}
          
          {!hasInput && !hasResult && !hasToolResult && !resultPending && (
            <span className="text-text-4 italic text-[0.85rem]">无内容</span>
          )}

          {resultPending && !hasToolResult && (
            <div className="flex items-center gap-2 text-text-4 text-[0.85rem]">
              <span className="inline-block w-4 h-4 border-2 border-text-4 border-t-accent rounded-full animate-spin" />
              等待结果…
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  )
}
