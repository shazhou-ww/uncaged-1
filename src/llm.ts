// LLM client — DashScope (OpenAI-compatible) with dynamic tool loading
// Soul (personality) + Memory (long-term knowledge) + Sigil (capabilities)

import { SigilClient } from './sigil.js'
import { Soul } from './soul.js'
import { Memory } from './memory.js'
import type { ChatMessage, ToolCall } from './chat-store.js'

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const MODEL = 'qwen-plus'

interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

// ─── Static tools: always available ───

const SIGIL_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'sigil_query',
      description: 'Search for capabilities in Sigil. Returns matching capabilities with their schemas. Use this to discover what tools are available before trying to use them.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search query to find capabilities' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sigil_deploy',
      description: 'Create and deploy a new capability to Sigil. Define input schema and JavaScript function body. The code runs in a Cloudflare Worker (fetch() and Web Crypto available, no Node.js). Receives `input` object, must return a value. After deploying, the capability becomes available as a tool automatically.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Capability name (lowercase, hyphens, e.g. "sha256-hash")' },
          description: { type: 'string', description: 'What this capability does' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for discovery' },
          schema: {
            type: 'object',
            description: 'Input schema (JSON Schema format) for the capability',
            properties: {
              type: { type: 'string', enum: ['object'] },
              properties: { type: 'object', additionalProperties: true },
              required: { type: 'array', items: { type: 'string' } },
            },
          },
          execute: { type: 'string', description: 'JavaScript function body. Receives `input` object, must return a value. Example: `const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.text)); return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("")`' },
        },
        required: ['name', 'execute'],
      },
    },
  },
]

const MEMORY_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'memory_search',
      description: 'Semantically search your long-term memory. Every conversation message is automatically stored — this searches across all past conversations by meaning. Returns the most relevant messages with surrounding context. Use at the start of conversations to recall what you know about the user.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for (semantic similarity)' },
          top_k: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_recall',
      description: 'Recall messages from a specific time period. Use for questions like "what did we talk about yesterday?" or "what happened last week?". Returns messages sorted by time.',
      parameters: {
        type: 'object',
        properties: {
          start_time: { type: 'string', description: 'Start of time range (ISO 8601, e.g. "2026-04-03T00:00:00Z")' },
          end_time: { type: 'string', description: 'End of time range (ISO 8601, e.g. "2026-04-03T23:59:59Z")' },
          limit: { type: 'number', description: 'Max messages (default 20)' },
        },
        required: ['start_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_forget',
      description: 'Remove a specific memory entry by ID. Use when asked to forget something.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory entry ID to remove' },
        },
        required: ['id'],
      },
    },
  },
]

const STATIC_TOOLS: ToolDef[] = [...SIGIL_TOOLS, ...MEMORY_TOOLS]

// ─── Dynamic tools: derived from chat history ───

interface CapabilityInfo {
  capability: string
  description?: string
  schema?: {
    type?: string
    properties?: Record<string, any>
    required?: string[]
  }
}

/**
 * Scan chat history for sigil_query results and sigil_deploy calls.
 * Extract capability info to generate dynamic tool definitions.
 *
 * tools = f(chat_history):
 * - sigil_query results → cap_* tools appear
 * - context compression drops results → cap_* tools disappear
 * - re-query → tools reappear (page fault)
 */
function extractCapabilitiesFromHistory(messages: ChatMessage[]): CapabilityInfo[] {
  const caps = new Map<string, CapabilityInfo>()

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.content) {
      try {
        const data = JSON.parse(msg.content)
        if (data.items && Array.isArray(data.items)) {
          for (const item of data.items) {
            if (item.capability) {
              caps.set(item.capability, {
                capability: item.capability,
                description: item.description,
                schema: item.schema,
              })
            }
          }
        }
      } catch { /* not a query result */ }
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === 'sigil_deploy') {
          try {
            const args = JSON.parse(tc.function.arguments)
            if (args.name) {
              caps.set(args.name, {
                capability: args.name,
                description: args.description,
                schema: args.schema,
              })
            }
          } catch { /* ignore */ }
        }
      }
    }
  }

  return Array.from(caps.values())
}

function capabilityToTool(cap: CapabilityInfo): ToolDef {
  const params = cap.schema || { type: 'object', properties: {} }
  return {
    type: 'function',
    function: {
      name: `cap_${cap.capability.replace(/-/g, '_')}`,
      description: `[Sigil capability: ${cap.capability}] ${cap.description || 'No description'}`,
      parameters: {
        type: 'object',
        properties: params.properties || {},
        required: params.required || [],
      },
    },
  }
}

// ─── Agent loop ───

const MAX_TOOL_ROUNDS = 6

export class LlmClient {
  constructor(private apiKey: string) {}

  /**
   * Run agentic loop with dynamic tools derived from chat history.
   * Soul defines personality + instructions, Memory provides long-term knowledge.
   */
  async agentLoop(
    messages: ChatMessage[],
    sigil: SigilClient,
    soul: Soul,
    memory: Memory,
  ): Promise<{ reply: string; updatedMessages: ChatMessage[] }> {

    // Build system prompt from Soul + Instructions
    const systemPrompt = await soul.buildSystemPrompt()

    // Ensure system prompt is first
    if (messages.length === 0 || messages[0].role !== 'system') {
      messages = [{ role: 'system', content: systemPrompt }, ...messages]
    } else {
      messages[0].content = systemPrompt
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Derive dynamic tools from chat history
      const dynamicCaps = extractCapabilitiesFromHistory(messages)
      const dynamicTools = dynamicCaps.map(capabilityToTool)
      const allTools = [...STATIC_TOOLS, ...dynamicTools]

      const response = await this.chatWithTools(messages, allTools)

      // No tool calls → final answer
      if (!response.tool_calls || response.tool_calls.length === 0) {
        const reply = response.content || '🤔 I had nothing to say.'
        messages.push({ role: 'assistant', content: reply })
        return { reply, updatedMessages: messages }
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      })

      // Execute each tool call
      for (const tc of response.tool_calls) {
        let result: string
        try {
          result = await this.executeTool(tc, sigil, memory)
        } catch (e: any) {
          result = JSON.stringify({ error: e.message || 'Unknown error' })
        }
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        })
      }
    }

    const fallback = '⚠️ Too many tool rounds. Could you rephrase your request?'
    messages.push({ role: 'assistant', content: fallback })
    return { reply: fallback, updatedMessages: messages }
  }

  private async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
  ): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const res = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: 0.3,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`LLM error: ${res.status} ${body}`)
    }

    const data: any = await res.json()
    const choice = data.choices?.[0]?.message
    return {
      content: choice?.content || null,
      tool_calls: choice?.tool_calls,
    }
  }

  private async executeTool(tc: ToolCall, sigil: SigilClient, memory: Memory): Promise<string> {
    const name = tc.function.name
    const args = JSON.parse(tc.function.arguments)

    // ── Sigil tools ──
    if (name === 'sigil_query') {
      const result = await sigil.query(args.q, args.limit || 5)
      // Enrich with schema from inspect
      const enriched = await Promise.all(
        result.items.map(async (item) => {
          try {
            const detail = await sigil.inspect(item.capability)
            return { ...item, schema: detail?.schema }
          } catch {
            return item
          }
        })
      )
      return JSON.stringify({ ...result, items: enriched })
    }

    if (name === 'sigil_deploy') {
      const result = await sigil.deploy({
        name: args.name,
        schema: args.schema,
        execute: args.execute,
        description: args.description || '',
        tags: args.tags || ['auto-created'],
      })
      return JSON.stringify(result)
    }

    // ── Memory tools ──
    if (name === 'memory_search') {
      const results = await memory.search(args.query, args.top_k || 5)
      return JSON.stringify({ entries: results, total: results.length })
    }

    if (name === 'memory_recall') {
      const startTime = new Date(args.start_time).getTime()
      const endTime = args.end_time ? new Date(args.end_time).getTime() : Date.now()
      const results = await memory.recall(startTime, endTime, args.limit || 20)
      return JSON.stringify({ entries: results, total: results.length })
    }

    if (name === 'memory_forget') {
      const ok = await memory.forget(args.id)
      return JSON.stringify({ forgotten: ok, id: args.id })
    }

    // ── Dynamic capability tools ──
    if (name.startsWith('cap_')) {
      const capName = name.slice(4).replace(/_/g, '-')
      const result = await sigil.run(capName, args)
      return result
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
