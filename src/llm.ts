// LLM client — DashScope (OpenAI-compatible) with tool calling

import { SigilClient } from './sigil.js'

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const MODEL = 'qwen-plus'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

// Define Sigil tools for the LLM
const SIGIL_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'sigil_query',
      description: 'Search for existing capabilities in Sigil. Use this to find if a capability already exists before creating a new one.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search query to find capabilities' },
          limit: { type: 'number', description: 'Max results to return (default 5)' },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sigil_inspect',
      description: 'Get detailed info about a specific capability, including its schema and description.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Capability name to inspect' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sigil_run',
      description: 'Invoke a capability by name with parameters. The parameters depend on the capability schema — use sigil_inspect first to check required params.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Capability name to invoke' },
          params: { type: 'object', description: 'Parameters to pass to the capability (check schema via inspect)', additionalProperties: true },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sigil_deploy',
      description: 'Create and deploy a new capability to Sigil. Use schema+execute mode: define input schema and a JavaScript function body. The execute code runs in a Cloudflare Worker sandbox (fetch() available, no Node.js APIs). It receives an `input` object matching the schema and must return a value.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Capability name (lowercase, hyphens, e.g. "sha256-hash")' },
          description: { type: 'string', description: 'What this capability does' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for discovery' },
          schema: {
            type: 'object',
            description: 'Input schema (JSON Schema format)',
            properties: {
              type: { type: 'string', enum: ['object'] },
              properties: { type: 'object', additionalProperties: true },
              required: { type: 'array', items: { type: 'string' } },
            },
          },
          execute: { type: 'string', description: 'JavaScript function body. Receives `input` object, must return a value. Example: `return { hash: btoa(input.text) }`' },
        },
        required: ['name', 'execute'],
      },
    },
  },
]

const SYSTEM_PROMPT = `You are Uncaged 🔓, a Sigil-native AI agent. You can discover, create, and use serverless capabilities (cloud functions) via Sigil.

Your workflow:
1. For general chat/knowledge questions, just answer directly without tools.
2. When the user needs a computation or service:
   a. First, use sigil_query to search for existing capabilities.
   b. If found, use sigil_inspect to check the schema, then sigil_run to invoke it with correct parameters.
   c. If not found, use sigil_deploy to create a new capability, then sigil_run to invoke it.
3. If a tool call fails, read the error message carefully and adjust your approach — maybe fix params, maybe try a different strategy.
4. If the user asks to "create a capability" without giving input data, create it and explain what you created and how to use it. Don't invoke it with empty params.

Rules for sigil_deploy execute code:
- Runs in a Cloudflare Worker (no Node.js APIs, but fetch() and Web Crypto are available)
- Receives an \`input\` object matching the schema
- Must return a value (string or object)
- Keep it focused on one task

Be concise and helpful.`

const MAX_TOOL_ROUNDS = 5

export class LlmClient {
  constructor(private apiKey: string) {}

  /**
   * Run a full agentic loop: LLM decides to call tools, we execute them,
   * feed results back, repeat until LLM gives a final text response.
   */
  async agentLoop(userMessage: string, sigil: SigilClient): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ]

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.chatWithTools(messages)

      // If no tool calls, we have the final answer
      if (!response.tool_calls || response.tool_calls.length === 0) {
        return response.content || '🤔 I had nothing to say.'
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      })

      // Execute each tool call and add results
      for (const tc of response.tool_calls) {
        let result: string
        try {
          result = await this.executeTool(tc, sigil)
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

    return '⚠️ I went through too many steps. Let me try a simpler approach — could you rephrase your request?'
  }

  private async chatWithTools(messages: ChatMessage[]): Promise<{
    content: string | null
    tool_calls?: ToolCall[]
  }> {
    const res = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: SIGIL_TOOLS,
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

  private async executeTool(tc: ToolCall, sigil: SigilClient): Promise<string> {
    const args = JSON.parse(tc.function.arguments)
    const name = tc.function.name

    switch (name) {
      case 'sigil_query': {
        const result = await sigil.query(args.q, args.limit || 5)
        return JSON.stringify(result)
      }
      case 'sigil_inspect': {
        const result = await sigil.inspect(args.name)
        return JSON.stringify(result)
      }
      case 'sigil_run': {
        const result = await sigil.run(args.name, args.params || {})
        return result
      }
      case 'sigil_deploy': {
        const result = await sigil.deploy({
          name: args.name,
          schema: args.schema,
          execute: args.execute,
          description: args.description || '',
          tags: args.tags || ['auto-created'],
        })
        return JSON.stringify(result)
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  }
}
