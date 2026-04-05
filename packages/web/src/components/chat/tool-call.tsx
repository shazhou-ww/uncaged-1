import { Collapsible } from '../ui/collapsible'

interface ToolCallProps {
  name: string
  input?: Record<string, unknown>
  result?: string
  icon?: string
}

export function ToolCall({ name, input, result, icon = '🔧' }: ToolCallProps) {
  const content = result || (input ? JSON.stringify(input, null, 2) : '{}')

  return (
    <div className="border border-border rounded-lg my-2 overflow-hidden">
      <Collapsible
        trigger={
          <span className="text-[0.85rem] text-text-3 hover:text-text-2 transition-colors px-3 py-2 block">
            {icon} {name}
          </span>
        }
      >
        <div className="border-t border-border px-3 py-2 text-[0.85rem] text-text-2 whitespace-pre-wrap break-all font-mono bg-black/20">
          {content}
        </div>
      </Collapsible>
    </div>
  )
}
