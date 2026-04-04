// A2A collaboration tool: ask_agent
// Lets the LLM contact other AI agents via A2A JSON-RPC protocol

type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

const AGENT_DIRECTORY: Record<string, { name: string; emoji: string; endpoint: string }> = {
  xiaoju:   { name: '小橘', emoji: '🍊', endpoint: 'https://oc-neko.shazhou.work/a2a/jsonrpc' },
  xiaomooo: { name: '小墨', emoji: '🖊️', endpoint: 'https://oc-kuma.shazhou.work/a2a/jsonrpc' },
  aobing:   { name: '敖丙', emoji: '🐲', endpoint: 'https://oc-raku.shazhou.work/a2a/jsonrpc' },
  xingyue:  { name: '星月', emoji: '🌙', endpoint: 'https://oc-sora.shazhou.work/a2a/jsonrpc' },
}

export const askAgentTool: ToolDef = {
  type: 'function',
  function: {
    name: 'ask_agent',
    description: 'Send a message to another AI agent via A2A protocol and get their response. Use this to collaborate with other agents when you need help with tasks outside your expertise.',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: "Agent name to contact. Known agents: xiaoju (小橘, NEKO), xiaomooo (小墨, KUMA), aobing (敖丙, RAKU), xingyue (星月, SORA)"
        },
        message: {
          type: 'string',
          description: 'The message to send to the agent'
        }
      },
      required: ['agent', 'message']
    }
  }
}

export interface AskAgentArgs {
  agent: string
  message: string
}

export async function handleAskAgent(
  args: AskAgentArgs,
  a2aToken?: string,
): Promise<string> {
  const target = AGENT_DIRECTORY[args.agent]
  if (!target) {
    return JSON.stringify({
      error: `Unknown agent '${args.agent}'. Known agents: ${Object.keys(AGENT_DIRECTORY).join(', ')}`
    })
  }

  console.log(`[A2A] Contacting ${target.name} ${target.emoji} at ${target.endpoint}`)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (a2aToken) headers['Authorization'] = `Bearer ${a2aToken}`

    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: `[From 豆豆 🐾] ${args.message}` }]
          }
        }
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      return JSON.stringify({
        error: `Failed to reach ${target.name} ${target.emoji}: HTTP ${response.status}`
      })
    }

    const data = await response.json() as any

    // Handle JSON-RPC error
    if (data.error) {
      return JSON.stringify({
        error: `${target.name} ${target.emoji} returned error: ${data.error.message || JSON.stringify(data.error)}`
      })
    }

    const result = data.result
    if (!result) {
      return JSON.stringify({ agent: target.name, reply: '(empty response)' })
    }

    // Extract text from A2A response
    const state = result.status?.state
    if (state === 'completed' || state === 'input-required') {
      const parts = result.status?.message?.parts || result.artifacts?.[0]?.parts || []
      const text = parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n')
      return JSON.stringify({
        agent: target.name,
        emoji: target.emoji,
        reply: text || '(no text reply)',
      })
    }

    if (state === 'working') {
      return JSON.stringify({
        agent: target.name,
        emoji: target.emoji,
        reply: '(agent is still thinking... they may be offline or busy)',
        state: 'working'
      })
    }

    return JSON.stringify({
      agent: target.name,
      reply: JSON.stringify(result).slice(0, 500),
    })

  } catch (error: any) {
    console.error(`[A2A] Failed to contact ${args.agent}:`, error.message)
    return JSON.stringify({
      error: `Could not reach ${target.name} ${target.emoji}: ${error.message}`
    })
  }
}
