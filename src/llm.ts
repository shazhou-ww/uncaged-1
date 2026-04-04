// LLM client — DashScope (OpenAI-compatible) with dynamic tool loading
// Soul (personality) + Memory (long-term knowledge) + Sigil (capabilities)

import { SigilClient } from './sigil.js'
import { Soul } from './soul.js'
import { Memory } from './memory.js'
import type { ChatMessage, ToolCall } from './chat-store.js'
import { 
  compose, 
  baseAdapter, 
  modelSelector, 
  temperatureAdapter, 
  knowledgeInjector,
  contextCompressor 
} from './pipeline.js'
import { createCapabilityTool, handleCreateCapability, type CreateCapabilityArgs } from './tools/create-capability.js'
import { askAgentTool, handleAskAgent, type AskAgentArgs } from './tools/ask-agent.js'
import { 
  distillKnowledgeTool, 
  recallKnowledgeTool,
  handleDistillKnowledge,
  handleRecallKnowledge,
  type DistillKnowledgeArgs,
  type RecallKnowledgeArgs
} from './tools/distill-knowledge.js'

interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

// ─── Built-in tools: always available ───

const BUILTIN_TOOLS: ToolDef[] = [
  createCapabilityTool,  // self-evolution
  distillKnowledgeTool,  // knowledge distillation
  recallKnowledgeTool,   // knowledge recall
  askAgentTool,          // A2A agent collaboration
]

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
      description: 'Recall recent conversations across ALL sessions. Returns the most recent messages sorted by time. Use this when asked about recent activity, visitors, or what happened lately.',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'How many hours back to look (default 24, max 168)' },
          limit: { type: 'number', description: 'Max messages to return (default 30)' },
        },
        required: [],
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

const STATIC_TOOLS: ToolDef[] = [...BUILTIN_TOOLS, ...SIGIL_TOOLS, ...MEMORY_TOOLS]

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
        // Tool messages are always strings
        const data = JSON.parse(msg.content as string)
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

const MAX_TOOL_ROUNDS = 12

export class LlmClient {
  private model: string
  private baseUrl: string
  public a2aToken?: string

  constructor(
    private apiKey: string,
    model?: string,
    baseUrl?: string,
  ) {
    this.model = model || 'qwen3-max'
    this.baseUrl = baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  }

  /**
   * Run agentic loop with dynamic tools derived from chat history.
   * Soul defines personality + instructions, Memory provides long-term knowledge.
   */
  async agentLoop(
    messages: ChatMessage[],
    sigil: SigilClient,
    soul: Soul,
    memory: Memory,
    chatId?: string,
  ): Promise<{ reply: string; updatedMessages: ChatMessage[] }> {

    // Build system prompt from Soul + Instructions
    const systemPrompt = await soul.buildSystemPrompt()

    // Ensure system prompt is first
    if (messages.length === 0 || messages[0].role !== 'system') {
      messages = [{ role: 'system', content: systemPrompt }, ...messages]
    } else {
      messages[0].content = systemPrompt
    }

    // ── Apply pipeline ──
    const pipeline = compose(
      baseAdapter(this.model),
      modelSelector(),
      temperatureAdapter(),
      knowledgeInjector(memory, chatId || 'unknown'),
      contextCompressor(30),
    )
    
    const params = await pipeline(messages, {
      model: this.model,
      temperature: 0.3,
      enableThinking: true,
      messages,
    })
    
    // Use pipeline-determined params
    const activeModel = params.model
    const activeTemp = params.temperature
    messages = params.messages  // possibly compressed
    
    console.log(`[Pipeline] model=${activeModel} temp=${activeTemp} msgs=${messages.length}`)

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Derive dynamic tools from chat history
      const dynamicCaps = extractCapabilitiesFromHistory(messages)
      const dynamicTools = dynamicCaps.map(capabilityToTool)
      const allTools = [...STATIC_TOOLS, ...dynamicTools]

      const response = await this.chatWithTools(messages, allTools, activeModel, activeTemp)

      // No tool calls → final answer
      if (!response.tool_calls || response.tool_calls.length === 0) {
        const reply = response.content || '🤔 I had nothing to say.'
        messages.push({ role: 'assistant', content: reply })
        console.log(`[agent] round=${round} → final answer (${reply.length} chars)`)
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
        const args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments
        console.log(`[agent] round=${round} tool=${tc.function.name} args=${JSON.stringify(args).slice(0, 200)}`)
        let result: string
        try {
          result = await this.executeTool(tc, sigil, memory)
          console.log(`[agent] tool=${tc.function.name} result=${result.slice(0, 200)}`)
        } catch (e: any) {
          result = JSON.stringify({ error: e.message || 'Unknown error' })
          console.error(`[agent] tool=${tc.function.name} error=${e.message}`)
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
    model?: string,
    temperature?: number,
  ): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    // Use provided params or fall back to instance defaults
    const activeModel = model || this.model
    const activeTemp = temperature ?? 0.3
    
    const maxRetries = 2
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: activeModel,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: activeTemp,
            enable_thinking: true,
          }),
          signal: AbortSignal.timeout(30000),  // 30s timeout
        })

        // Retry on 429 or 5xx
        if (res.status === 429 || res.status >= 500) {
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
            continue
          }
        }

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
      } catch (e: any) {
        if (attempt < maxRetries && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
          continue
        }
        throw e
      }
    }

    throw new Error('LLM request failed after retries')
  }

  private async executeTool(tc: ToolCall, sigil: SigilClient, memory: Memory): Promise<string> {
    const name = tc.function.name
    const args = JSON.parse(tc.function.arguments)

    // ── Built-in tools ──
    if (name === 'create_capability') {
      return await handleCreateCapability(args as CreateCapabilityArgs, sigil)
    }

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
      const hours = Math.min(args.hours || 24, 168)  // default 24h, max 7 days
      const limit = Math.min(args.limit || 30, 100)
      const endTime = Date.now()
      const startTime = endTime - hours * 60 * 60 * 1000
      const results = await memory.recall(startTime, endTime, limit)
      return JSON.stringify({ entries: results, total: results.length, hours, timeRange: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() } })
    }

    if (name === 'memory_forget') {
      const ok = await memory.forget(args.id)
      return JSON.stringify({ forgotten: ok, id: args.id })
    }

    // ── Knowledge tools ──
    if (name === 'distill_knowledge') {
      return await handleDistillKnowledge(args as DistillKnowledgeArgs, memory)
    }

    if (name === 'recall_knowledge') {
      return await handleRecallKnowledge(args as RecallKnowledgeArgs, memory)
    }

    // ── A2A collaboration ──
    if (name === 'ask_agent') {
      return await handleAskAgent(args as AskAgentArgs, this.a2aToken)
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
