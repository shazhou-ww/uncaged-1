import { Collapsible } from '../ui/collapsible'

interface ToolCallProps {
  name: string
  input?: Record<string, unknown>
  result?: string
  icon?: string
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

export function ToolCall({ name, input, result, icon = '🔧' }: ToolCallProps) {
  const hasInput = input && Object.keys(input).length > 0
  const hasResult = result && result.trim().length > 0

  return (
    <div className="border border-border rounded-lg my-2 overflow-hidden">
      <Collapsible
        trigger={
          <span className="text-[0.85rem] text-text-3 hover:text-text-2 transition-colors px-3 py-2 block">
            {icon} {name}
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
          
          {!hasInput && !hasResult && (
            <span className="text-text-4 italic text-[0.85rem]">无内容</span>
          )}
        </div>
      </Collapsible>
    </div>
  )
}
