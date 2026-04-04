var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../core/dist/sigil.js
var SigilClient = class {
  static {
    __name(this, "SigilClient");
  }
  baseUrl;
  deployToken;
  constructor(baseUrl, deployToken) {
    this.baseUrl = baseUrl;
    this.deployToken = deployToken;
  }
  async query(q, limit = 5) {
    const url = new URL("/_api/query", this.baseUrl);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort", "relevance");
    const res = await fetch(url.toString(), {
      headers: { "Authorization": `Bearer ${this.deployToken}` }
    });
    if (!res.ok)
      throw new Error(`Sigil query failed: ${res.status}`);
    return res.json();
  }
  async inspect(name) {
    const res = await fetch(`${this.baseUrl}/_api/inspect/${name}`, {
      headers: { "Authorization": `Bearer ${this.deployToken}` }
    });
    if (!res.ok)
      throw new Error(`Sigil inspect failed: ${res.status}`);
    return res.json();
  }
  async deploy(params) {
    const res = await fetch(`${this.baseUrl}/_api/deploy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.deployToken}`
      },
      body: JSON.stringify({
        name: params.name,
        code: params.code,
        schema: params.schema,
        execute: params.execute,
        type: "normal",
        description: params.description,
        tags: params.tags
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sigil deploy failed: ${res.status} ${body}`);
    }
    return res.json();
  }
  async run(name, params = {}) {
    const res = await fetch(`${this.baseUrl}/run/${name}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.deployToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sigil run failed: ${res.status} ${body}`);
    }
    return res.text();
  }
  async listCapabilities() {
    const result = await this.query("", 50);
    return result.items.map((i) => i.capability);
  }
};

// ../core/dist/chat-store.js
function getTextContent(content) {
  if (!content)
    return "";
  if (typeof content === "string")
    return content;
  return content.filter((p) => p.type === "text").map((p) => p.text || "").join("\n");
}
__name(getTextContent, "getTextContent");
var COMPRESS_THRESHOLD = 40;
var COMPRESS_KEEP_RECENT = 10;
var CHAT_TTL = 86400;
var ChatStore = class {
  static {
    __name(this, "ChatStore");
  }
  kv;
  constructor(kv) {
    this.kv = kv;
  }
  key(chatId) {
    return `chat:${chatId}`;
  }
  async load(chatId) {
    const raw = await this.kv.get(this.key(chatId));
    if (!raw)
      return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  async save(chatId, messages) {
    const toSave = messages.filter((m) => m.role !== "system");
    await this.kv.put(this.key(chatId), JSON.stringify(toSave), { expirationTtl: CHAT_TTL });
  }
  async clear(chatId) {
    await this.kv.delete(this.key(chatId));
  }
  /**
   * Check if compression is needed and perform it.
   * Returns the (possibly compressed) message list.
   */
  maybeCompress(messages) {
    const nonSystem = messages.filter((m) => m.role !== "system");
    if (nonSystem.length <= COMPRESS_THRESHOLD) {
      return { messages, compressed: false };
    }
    const system = messages.filter((m) => m.role === "system");
    const firstUser = nonSystem.find((m) => m.role === "user");
    const recent = nonSystem.slice(-COMPRESS_KEEP_RECENT);
    const compressed = [
      ...system
    ];
    if (firstUser && !recent.includes(firstUser)) {
      compressed.push(firstUser);
      compressed.push({
        role: "assistant",
        content: "[Earlier conversation compressed. Some capabilities may need to be re-queried from Sigil.]"
      });
    }
    compressed.push(...recent);
    const cleaned = this.ensureToolConsistency(compressed);
    return { messages: cleaned, compressed: true };
  }
  /**
   * Ensure tool messages always have their parent assistant tool_call.
   * Remove orphaned tool messages that lost their parent during compression.
   */
  ensureToolConsistency(messages) {
    const result = [];
    const toolCallIds = /* @__PURE__ */ new Set();
    for (const msg of messages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCallIds.add(tc.id);
        }
      }
    }
    for (const msg of messages) {
      if (msg.role === "tool" && msg.tool_call_id) {
        if (toolCallIds.has(msg.tool_call_id)) {
          result.push(msg);
        }
      } else {
        result.push(msg);
      }
    }
    return result;
  }
};

// ../core/dist/pipeline.js
function compose(...adapters) {
  return async (msgs, params) => {
    let current = params;
    for (const adapter of adapters) {
      current = await adapter(msgs, current);
    }
    return current;
  };
}
__name(compose, "compose");
function baseAdapter(defaultModel) {
  return (msgs, params) => ({
    ...params,
    model: params.model || defaultModel,
    messages: msgs
  });
}
__name(baseAdapter, "baseAdapter");
function modelSelector() {
  return (msgs, params) => {
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
    const content = lastUserMsg?.content;
    if (Array.isArray(content) && content.some((p) => p.type === "image_url")) {
      console.log("[Pipeline] Model: qwen3-vl-plus (image detected)");
      return { ...params, model: "qwen3-vl-plus" };
    }
    const text = getTextContent(content).toLowerCase();
    if (text.includes("\u5199\u4EE3\u7801") || text.includes("code") || text.includes("\u5B9E\u73B0") || text.includes("function") || text.includes("create_capability") || /```/.test(text)) {
      console.log("[Pipeline] Model: qwen3-coder-plus (code detected)");
      return { ...params, model: "qwen3-coder-plus" };
    }
    if (text.length < 20 && (/^(你好|hi|hello|hey|嗨|早|晚安|谢谢|ok|好的)/.test(text) || text.includes("?") && text.length < 30)) {
      console.log("[Pipeline] Model: qwen3.5-flash (simple chat)");
      return { ...params, model: "qwen3.5-flash" };
    }
    return params;
  };
}
__name(modelSelector, "modelSelector");
function temperatureAdapter() {
  return (msgs, params) => {
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
    const text = getTextContent(lastUserMsg?.content).toLowerCase();
    if (text.includes("\u662F\u8C01") || text.includes("what is") || text.includes("\u67E5") || text.includes("\u51E0\u70B9") || text.includes("\u591A\u5C11")) {
      return { ...params, temperature: 0.1 };
    }
    if (text.includes("\u5199\u8BD7") || text.includes("\u6545\u4E8B") || text.includes("poem") || text.includes("\u521B\u610F") || text.includes("\u60F3\u8C61")) {
      return { ...params, temperature: 0.8 };
    }
    if (text.includes("\u4EE3\u7801") || text.includes("code") || text.includes("bug") || text.includes("\u5B9E\u73B0") || text.includes("deploy")) {
      return { ...params, temperature: 0.15 };
    }
    return { ...params, temperature: 0.3 };
  };
}
__name(temperatureAdapter, "temperatureAdapter");
function contextCompressor(maxMessages = 30) {
  return (msgs, params) => {
    const messages = params.messages;
    if (messages.length <= maxMessages)
      return params;
    const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
    const recent = messages.slice(-maxMessages + 1);
    const old = systemMsg ? messages.slice(1, -maxMessages + 1) : messages.slice(0, -maxMessages + 1);
    if (old.length === 0)
      return params;
    const summaryParts = [];
    for (const msg of old) {
      if (msg.role === "user") {
        const content = getTextContent(msg.content);
        summaryParts.push(`User: ${content.slice(0, 80)}`);
      } else if (msg.role === "assistant") {
        const content = getTextContent(msg.content);
        if (content)
          summaryParts.push(`You: ${content.slice(0, 80)}`);
      }
    }
    const summaryMsg = {
      role: "system",
      content: `[Earlier conversation summary (${old.length} messages compressed)]
${summaryParts.join("\n")}`
    };
    const compressed = [
      ...systemMsg ? [systemMsg] : [],
      summaryMsg,
      ...recent
    ];
    console.log(`[Pipeline] Compressed ${messages.length} \u2192 ${compressed.length} messages`);
    return { ...params, messages: compressed };
  };
}
__name(contextCompressor, "contextCompressor");
function knowledgeInjector(memory, chatId) {
  return async (msgs, params) => {
    if (!memory.hasD1Access())
      return params;
    try {
      const searchTerms = [chatId];
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      if (lastUser?.content) {
        const textContent = getTextContent(lastUser.content);
        const match = textContent.match(/\[From\s+(.+?)\]/);
        if (match)
          searchTerms.push(match[1]);
      }
      const allKnowledge = [];
      for (const term of searchTerms) {
        const results = await memory.recallKnowledge({ subject: term });
        allKnowledge.push(...results);
      }
      const knowledge = [...new Map(allKnowledge.map((k) => [k.id, k])).values()];
      const generalKnowledge = await memory.recallKnowledge({ type: "fact" });
      if (knowledge.length === 0 && generalKnowledge.length === 0)
        return params;
      const lines = [];
      if (knowledge.length > 0) {
        lines.push(`[Known about current contact "${chatId}":]`);
        for (const k of knowledge) {
          lines.push(`- [${k.type}] ${k.content}`);
        }
      }
      const facts = generalKnowledge.slice(0, 5);
      if (facts.length > 0) {
        lines.push(`
[General knowledge:]`);
        for (const f of facts) {
          lines.push(`- ${f.content}`);
        }
      }
      const injection = lines.join("\n");
      const messages = [...params.messages];
      if (messages[0]?.role === "system") {
        messages[0] = {
          ...messages[0],
          content: messages[0].content + `

${injection}`
        };
      }
      console.log(`[Pipeline] Injected ${knowledge.length + facts.length} knowledge entries for ${chatId}`);
      return { ...params, messages };
    } catch (e) {
      console.error("[Pipeline] Knowledge injection failed:", e);
      return params;
    }
  };
}
__name(knowledgeInjector, "knowledgeInjector");

// ../core/dist/tools/create-capability.js
var createCapabilityTool = {
  type: "function",
  function: {
    name: "create_capability",
    description: "Create and deploy a new Sigil capability. Use this when you identify a recurring need that could be served by a reusable function. The capability will be available as a tool in future conversations.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Capability name (lowercase, hyphens ok). E.g. 'weather-forecast', 'unit-converter'"
        },
        description: {
          type: "string",
          description: "What this capability does, in one sentence"
        },
        schema: {
          type: "object",
          description: "JSON Schema for the capability's input parameters"
        },
        code: {
          type: "string",
          description: "JavaScript code that implements the capability. Must export a default function that takes (input, env) and returns a result. Has access to fetch() for HTTP calls."
        }
      },
      required: ["name", "description", "schema", "code"]
    }
  }
};
async function handleCreateCapability(args, sigil) {
  console.log("[Self-Evolve] Creating capability:", args.name);
  try {
    if (!/^[a-z][a-z0-9-]*$/.test(args.name)) {
      return JSON.stringify({
        error: "Invalid name format. Use lowercase letters, numbers, and hyphens only (e.g. 'weather-forecast')"
      });
    }
    if (!args.code.trim()) {
      return JSON.stringify({ error: "Code cannot be empty" });
    }
    if (!args.description.trim()) {
      return JSON.stringify({ error: "Description cannot be empty" });
    }
    console.log("[Self-Evolve] Deploying to Sigil...");
    const result = await sigil.deploy({
      name: args.name,
      description: args.description,
      schema: args.schema,
      execute: args.code,
      tags: ["self-evolution", "auto-created"]
    });
    console.log("[Self-Evolve] Deploy successful:", result.capability);
    return JSON.stringify({
      success: true,
      capability: result.capability,
      url: result.url,
      message: `\u2728 Created capability '${result.capability}' \u2014 it's now available as a tool in future conversations!`
    });
  } catch (error) {
    console.error("[Self-Evolve] Deploy failed:", error.message);
    return JSON.stringify({
      error: `Failed to deploy capability: ${error.message}`,
      name: args.name
    });
  }
}
__name(handleCreateCapability, "handleCreateCapability");

// ../core/dist/tools/ask-agent.js
var AGENT_DIRECTORY = {
  xiaoju: { name: "\u5C0F\u6A58", emoji: "\u{1F34A}", endpoint: "https://oc-neko.shazhou.work/a2a/jsonrpc" },
  xiaomooo: { name: "\u5C0F\u58A8", emoji: "\u{1F58A}\uFE0F", endpoint: "https://oc-kuma.shazhou.work/a2a/jsonrpc" },
  aobing: { name: "\u6556\u4E19", emoji: "\u{1F432}", endpoint: "https://oc-raku.shazhou.work/a2a/jsonrpc" },
  xingyue: { name: "\u661F\u6708", emoji: "\u{1F319}", endpoint: "https://oc-sora.shazhou.work/a2a/jsonrpc" }
};
var askAgentTool = {
  type: "function",
  function: {
    name: "ask_agent",
    description: "Send a message to another AI agent via A2A protocol and get their response. Use this to collaborate with other agents when you need help with tasks outside your expertise.",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Agent name to contact. Known agents: xiaoju (\u5C0F\u6A58, NEKO), xiaomooo (\u5C0F\u58A8, KUMA), aobing (\u6556\u4E19, RAKU), xingyue (\u661F\u6708, SORA)"
        },
        message: {
          type: "string",
          description: "The message to send to the agent"
        }
      },
      required: ["agent", "message"]
    }
  }
};
async function handleAskAgent(args, a2aToken) {
  const target = AGENT_DIRECTORY[args.agent];
  if (!target) {
    return JSON.stringify({
      error: `Unknown agent '${args.agent}'. Known agents: ${Object.keys(AGENT_DIRECTORY).join(", ")}`
    });
  }
  console.log(`[A2A] Contacting ${target.name} ${target.emoji} at ${target.endpoint}`);
  try {
    const headers = { "Content-Type": "application/json" };
    if (a2aToken)
      headers["Authorization"] = `Bearer ${a2aToken}`;
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: `[From \u8C46\u8C46 \u{1F43E}] ${args.message}` }]
          }
        }
      }),
      signal: AbortSignal.timeout(3e4)
    });
    if (!response.ok) {
      return JSON.stringify({
        error: `Failed to reach ${target.name} ${target.emoji}: HTTP ${response.status}`
      });
    }
    const data = await response.json();
    if (data.error) {
      return JSON.stringify({
        error: `${target.name} ${target.emoji} returned error: ${data.error.message || JSON.stringify(data.error)}`
      });
    }
    const result = data.result;
    if (!result) {
      return JSON.stringify({ agent: target.name, reply: "(empty response)" });
    }
    const state = result.status?.state;
    if (state === "completed" || state === "input-required") {
      const parts = result.status?.message?.parts || result.artifacts?.[0]?.parts || [];
      const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      return JSON.stringify({
        agent: target.name,
        emoji: target.emoji,
        reply: text || "(no text reply)"
      });
    }
    if (state === "working") {
      return JSON.stringify({
        agent: target.name,
        emoji: target.emoji,
        reply: "(agent is still thinking... they may be offline or busy)",
        state: "working"
      });
    }
    return JSON.stringify({
      agent: target.name,
      reply: JSON.stringify(result).slice(0, 500)
    });
  } catch (error) {
    console.error(`[A2A] Failed to contact ${args.agent}:`, error.message);
    return JSON.stringify({
      error: `Could not reach ${target.name} ${target.emoji}: ${error.message}`
    });
  }
}
__name(handleAskAgent, "handleAskAgent");

// ../core/dist/tools/spawn-task.js
var spawnTaskTool = {
  type: "function",
  function: {
    name: "spawn_task",
    description: "Create a concurrent sub-task. It will be executed independently by another worker. Use this when you need to do multiple things in parallel, or when a sub-task is independent enough to run on its own. Results will be automatically collected when all spawned tasks complete.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Complete task description. Be specific \u2014 another worker will execute this independently with no other context."
        },
        hints: {
          type: "array",
          items: { type: "string" },
          description: "Suggested tool names to help the worker get started (optional, not a restriction)."
        }
      },
      required: ["prompt"]
    }
  }
};
async function handleSpawnTask(args, parentBatonId, batonStore) {
  const parent = await batonStore.load(parentBatonId);
  const parentDepth = parent?.depth ?? 0;
  const baton = await batonStore.create({
    prompt: args.prompt,
    hints: args.hints,
    parent_id: parentBatonId,
    depth: parentDepth + 1
  });
  return JSON.stringify({
    spawned: true,
    baton_id: baton.id,
    message: `Task spawned as ${baton.id}. It will execute independently. Results will be collected when all spawned tasks complete.`
  });
}
__name(handleSpawnTask, "handleSpawnTask");

// ../core/dist/tools/distill-knowledge.js
var distillKnowledgeTool = {
  type: "function",
  function: {
    name: "distill_knowledge",
    description: "Extract and store a piece of structured knowledge from the current conversation. Use this when you learn something important about a person, event, preference, or fact that should be remembered long-term.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["profile", "event", "preference", "fact"],
          description: "Knowledge type: profile (about a person), event (something that happened), preference (likes/dislikes), fact (objective information)"
        },
        subject: {
          type: "string",
          description: "Who or what this knowledge is about (e.g. person name, team name, project name)"
        },
        content: {
          type: "string",
          description: "The distilled knowledge in a clear, concise sentence"
        },
        confidence: {
          type: "number",
          description: "How confident you are (0-1). Use 0.9+ for explicitly stated facts, 0.5-0.8 for inferences"
        }
      },
      required: ["type", "subject", "content"]
    }
  }
};
var recallKnowledgeTool = {
  type: "function",
  function: {
    name: "recall_knowledge",
    description: "Search your structured knowledge base for information about a person, topic, or event. More accurate than raw memory search for known facts.",
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Who or what to look up (optional, omit for broad search)"
        },
        type: {
          type: "string",
          enum: ["profile", "event", "preference", "fact"],
          description: "Filter by knowledge type (optional)"
        },
        query: {
          type: "string",
          description: "Free-text search query (optional, searches content field)"
        }
      }
    }
  }
};
async function handleDistillKnowledge(args, memory) {
  console.log("[Knowledge] Handling distill_knowledge:", args);
  try {
    const result = await memory.distillKnowledge(args.type, args.subject, args.content, args.confidence || 0.8);
    return JSON.stringify({
      success: true,
      id: result.id,
      updated: result.updated,
      type: args.type,
      subject: args.subject,
      message: result.updated ? `Updated existing ${args.type} knowledge about "${args.subject}"` : `Stored new ${args.type} knowledge about "${args.subject}"`
    });
  } catch (error) {
    console.error("[Knowledge] Distillation failed:", error.message);
    return JSON.stringify({
      error: `Knowledge distillation failed: ${error.message}`
    });
  }
}
__name(handleDistillKnowledge, "handleDistillKnowledge");
async function handleRecallKnowledge(args, memory) {
  console.log("[Knowledge] Handling recall_knowledge:", args);
  try {
    const results = await memory.recallKnowledge(args);
    return JSON.stringify({
      entries: results,
      total: results.length,
      query: args
    });
  } catch (error) {
    console.error("[Knowledge] Recall failed:", error.message);
    return JSON.stringify({
      error: `Knowledge recall failed: ${error.message}`
    });
  }
}
__name(handleRecallKnowledge, "handleRecallKnowledge");

// ../core/dist/llm.js
var BUILTIN_TOOLS = [
  createCapabilityTool,
  // self-evolution
  distillKnowledgeTool,
  // knowledge distillation
  recallKnowledgeTool,
  // knowledge recall
  askAgentTool,
  // A2A agent collaboration
  spawnTaskTool
  // Baton: parallel sub-tasks
];
var SIGIL_TOOLS = [
  {
    type: "function",
    function: {
      name: "sigil_query",
      description: "Search for capabilities in Sigil. Returns matching capabilities with their schemas. Use this to discover what tools are available before trying to use them.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query to find capabilities" },
          limit: { type: "number", description: "Max results (default 5)" }
        },
        required: ["q"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sigil_deploy",
      description: "Create and deploy a new capability to Sigil. Define input schema and JavaScript function body. The code runs in a Cloudflare Worker (fetch() and Web Crypto available, no Node.js). Receives `input` object, must return a value. After deploying, the capability becomes available as a tool automatically.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: 'Capability name (lowercase, hyphens, e.g. "sha256-hash")' },
          description: { type: "string", description: "What this capability does" },
          tags: { type: "array", items: { type: "string" }, description: "Tags for discovery" },
          schema: {
            type: "object",
            description: "Input schema (JSON Schema format) for the capability",
            properties: {
              type: { type: "string", enum: ["object"] },
              properties: { type: "object", additionalProperties: true },
              required: { type: "array", items: { type: "string" } }
            }
          },
          execute: { type: "string", description: 'JavaScript function body. Receives `input` object, must return a value. Example: `const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.text)); return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("")`' }
        },
        required: ["name", "execute"]
      }
    }
  }
];
var MEMORY_TOOLS = [
  {
    type: "function",
    function: {
      name: "memory_search",
      description: "Semantically search your long-term memory. Every conversation message is automatically stored \u2014 this searches across all past conversations by meaning. Returns the most relevant messages with surrounding context. Use at the start of conversations to recall what you know about the user.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for (semantic similarity)" },
          top_k: { type: "number", description: "Max results (default 5)" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "memory_recall",
      description: "Recall recent conversations across ALL sessions. Returns the most recent messages sorted by time. Use this when asked about recent activity, visitors, or what happened lately.",
      parameters: {
        type: "object",
        properties: {
          hours: { type: "number", description: "How many hours back to look (default 24, max 168)" },
          limit: { type: "number", description: "Max messages to return (default 30)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "memory_forget",
      description: "Remove a specific memory entry by ID. Use when asked to forget something.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory entry ID to remove" }
        },
        required: ["id"]
      }
    }
  }
];
var STATIC_TOOLS = [...BUILTIN_TOOLS, ...SIGIL_TOOLS, ...MEMORY_TOOLS];
function extractCapabilitiesFromHistory(messages) {
  const caps = /* @__PURE__ */ new Map();
  for (const msg of messages) {
    if (msg.role === "tool" && msg.content) {
      try {
        const data = JSON.parse(msg.content);
        if (data.items && Array.isArray(data.items)) {
          for (const item of data.items) {
            if (item.capability) {
              caps.set(item.capability, {
                capability: item.capability,
                description: item.description,
                schema: item.schema
              });
            }
          }
        }
      } catch {
      }
    }
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === "sigil_deploy") {
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args.name) {
              caps.set(args.name, {
                capability: args.name,
                description: args.description,
                schema: args.schema
              });
            }
          } catch {
          }
        }
      }
    }
  }
  return Array.from(caps.values());
}
__name(extractCapabilitiesFromHistory, "extractCapabilitiesFromHistory");
function capabilityToTool(cap) {
  const params = cap.schema || { type: "object", properties: {} };
  return {
    type: "function",
    function: {
      name: `cap_${cap.capability.replace(/-/g, "_")}`,
      description: `[Sigil capability: ${cap.capability}] ${cap.description || "No description"}`,
      parameters: {
        type: "object",
        properties: params.properties || {},
        required: params.required || []
      }
    }
  };
}
__name(capabilityToTool, "capabilityToTool");
var MAX_TOOL_ROUNDS = 12;
var LlmClient = class {
  static {
    __name(this, "LlmClient");
  }
  apiKey;
  model;
  baseUrl;
  a2aToken;
  batonStore;
  currentBatonId;
  // set when executing inside a Baton
  constructor(apiKey, model, baseUrl) {
    this.apiKey = apiKey;
    this.model = model || "qwen3-max";
    this.baseUrl = baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }
  /**
   * Run agentic loop with dynamic tools derived from chat history.
   * Soul defines personality + instructions, Memory provides long-term knowledge.
   */
  async agentLoop(messages, sigil, soul, memory, chatId) {
    const systemPrompt = await soul.buildSystemPrompt();
    if (messages.length === 0 || messages[0].role !== "system") {
      messages = [{ role: "system", content: systemPrompt }, ...messages];
    } else {
      messages[0].content = systemPrompt;
    }
    const pipeline = compose(baseAdapter(this.model), modelSelector(), temperatureAdapter(), knowledgeInjector(memory, chatId || "unknown"), contextCompressor(30));
    const params = await pipeline(messages, {
      model: this.model,
      temperature: 0.3,
      enableThinking: true,
      messages
    });
    const activeModel = params.model;
    const activeTemp = params.temperature;
    messages = params.messages;
    const isVisionModel = activeModel.includes("-vl-");
    if (isVisionModel) {
      console.log(`[Pipeline] Vision model detected \u2014 disabling tools & thinking`);
    }
    console.log(`[Pipeline] model=${activeModel} temp=${activeTemp} msgs=${messages.length}`);
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const allTools = isVisionModel ? [] : [
        ...STATIC_TOOLS,
        ...extractCapabilitiesFromHistory(messages).map(capabilityToTool)
      ];
      const response = await this.chatWithTools(messages, allTools, activeModel, activeTemp, isVisionModel);
      if (!response.tool_calls || response.tool_calls.length === 0) {
        const reply = response.content || "\u{1F914} I had nothing to say.";
        messages.push({ role: "assistant", content: reply });
        console.log(`[agent] round=${round} \u2192 final answer (${reply.length} chars)`);
        return { reply, updatedMessages: messages };
      }
      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls
      });
      for (const tc of response.tool_calls) {
        const args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        console.log(`[agent] round=${round} tool=${tc.function.name} args=${JSON.stringify(args).slice(0, 200)}`);
        let result;
        try {
          result = await this.executeTool(tc, sigil, memory);
          console.log(`[agent] tool=${tc.function.name} result=${result.slice(0, 200)}`);
        } catch (e) {
          result = JSON.stringify({ error: e.message || "Unknown error" });
          console.error(`[agent] tool=${tc.function.name} error=${e.message}`);
        }
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id
        });
      }
    }
    const fallback = "\u26A0\uFE0F Too many tool rounds. Could you rephrase your request?";
    messages.push({ role: "assistant", content: fallback });
    return { reply: fallback, updatedMessages: messages };
  }
  async chatWithTools(messages, tools, model, temperature, skipThinking) {
    const activeModel = model || this.model;
    const activeTemp = temperature ?? 0.3;
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: activeModel,
            messages,
            tools: tools.length > 0 ? tools : void 0,
            temperature: activeTemp,
            ...skipThinking ? {} : { enable_thinking: true }
          }),
          signal: AbortSignal.timeout(3e4)
          // 30s timeout
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1e3));
            continue;
          }
        }
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`LLM error: ${res.status} ${body}`);
        }
        const data = await res.json();
        const choice = data.choices?.[0]?.message;
        return {
          content: choice?.content || null,
          tool_calls: choice?.tool_calls
        };
      } catch (e) {
        if (attempt < maxRetries && (e.name === "TimeoutError" || e.name === "AbortError")) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1e3));
          continue;
        }
        throw e;
      }
    }
    throw new Error("LLM request failed after retries");
  }
  async executeTool(tc, sigil, memory) {
    const name = tc.function.name;
    const args = JSON.parse(tc.function.arguments);
    if (name === "create_capability") {
      return await handleCreateCapability(args, sigil);
    }
    if (name === "sigil_query") {
      const result = await sigil.query(args.q, args.limit || 5);
      const enriched = await Promise.all(result.items.map(async (item) => {
        try {
          const detail = await sigil.inspect(item.capability);
          return { ...item, schema: detail?.schema };
        } catch {
          return item;
        }
      }));
      return JSON.stringify({ ...result, items: enriched });
    }
    if (name === "sigil_deploy") {
      const result = await sigil.deploy({
        name: args.name,
        schema: args.schema,
        execute: args.execute,
        description: args.description || "",
        tags: args.tags || ["auto-created"]
      });
      return JSON.stringify(result);
    }
    if (name === "memory_search") {
      const results = await memory.search(args.query, args.top_k || 5);
      return JSON.stringify({ entries: results, total: results.length });
    }
    if (name === "memory_recall") {
      const hours = Math.min(args.hours || 24, 168);
      const limit = Math.min(args.limit || 30, 100);
      const endTime = Date.now();
      const startTime = endTime - hours * 60 * 60 * 1e3;
      const results = await memory.recall(startTime, endTime, limit);
      return JSON.stringify({ entries: results, total: results.length, hours, timeRange: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() } });
    }
    if (name === "memory_forget") {
      const ok = await memory.forget(args.id);
      return JSON.stringify({ forgotten: ok, id: args.id });
    }
    if (name === "distill_knowledge") {
      return await handleDistillKnowledge(args, memory);
    }
    if (name === "recall_knowledge") {
      return await handleRecallKnowledge(args, memory);
    }
    if (name === "ask_agent") {
      return await handleAskAgent(args, this.a2aToken);
    }
    if (name === "spawn_task") {
      if (!this.batonStore || !this.currentBatonId) {
        return JSON.stringify({ error: "Baton system not available in this context" });
      }
      return await handleSpawnTask(args, this.currentBatonId, this.batonStore);
    }
    if (name.startsWith("cap_")) {
      const capName = name.slice(4).replace(/_/g, "-");
      const result = await sigil.run(capName, args);
      return result;
    }
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
};

// ../core/dist/soul.js
var DEFAULT_SOUL = `You are Uncaged \u{1F513}, a Sigil-native AI agent.
You are helpful, concise, and curious. You enjoy discovering and creating new capabilities.
You speak in a friendly but efficient manner.`;
var DEFAULT_INSTRUCTIONS = `## How tools work

### Self-evolution
You have the ability to create new capabilities (tools) when you identify a recurring need.
- If a user asks for something you can't do but could write a simple function for, consider creating a capability.
- Don't create capabilities for one-off tasks. Only for things that would be useful repeatedly.
- Test your code mentally before deploying. The code runs in Cloudflare Workers (V8 isolate).
- Available in code: fetch(), JSON, crypto, TextEncoder/TextDecoder, URL. No Node.js APIs.
- After creating a capability, tell the user what you created and that it'll be available in future conversations.

### Capabilities (Sigil)
- You always have sigil_query and sigil_deploy available.
- When you use sigil_query, matching capabilities automatically appear as callable tools (prefixed with cap_).
- When you use sigil_deploy to create a new capability, it also appears as a callable tool.
- If a capability tool disappears from your tool list, just sigil_query for it again.

### Memory & Multi-Session Awareness
- You talk to multiple people through multiple channels simultaneously: Telegram, API, CLI.
- Each channel is a separate chat session with its own history. But your MEMORY is shared across ALL sessions.
- **You can only see the current session's chat history. To know what happened in OTHER sessions, you MUST search memory.**
- Each memory entry has a session tag (e.g., "telegram:Scott", "xiaoju", "xiaomooo") showing which session it came from.
- When someone asks "has anyone contacted you recently?" or "what happened lately?" \u2014 you CANNOT answer from the current chat alone. You MUST call memory_recall to check ALL sessions.
- Use memory_search for: names, people, topics, facts, preferences.
- Use memory_recall for: "what happened recently?", "who came by?", any time-based question. It automatically looks back 24 hours by default.
- **RULE: Any question about recent activity, visitors, or events \u2192 memory_recall FIRST. Your current chat history is only ONE of many concurrent conversations.**
- **RULE: Any question mentioning a name or person \u2192 memory_search with that name. NEVER say "I don't know" without searching.**
- You don't need to manually save memories \u2014 all messages are stored automatically.

### Knowledge distillation
You can extract and store structured knowledge from conversations using distill_knowledge.
- When someone tells you about themselves (name, role, preferences), distill it as a 'profile'
- When something notable happens, distill it as an 'event'
- When someone expresses a preference, distill it as a 'preference'
- For objective information worth remembering, distill it as a 'fact'
- Use recall_knowledge to look up what you know about someone before answering questions about them
- Keep knowledge concise \u2014 one clear sentence per entry
- Update existing knowledge when you learn new information (same subject + type will update)

### Thinking approach
- Before answering, think about what tools you need and why.
- For questions about people or events, ask yourself: "Do I actually know this, or should I check memory?"
- For tasks requiring external data, ask yourself: "Is there an existing capability for this?"
- Don't rush to answer \u2014 take a moment to plan your approach.

### Workflow
1. For casual chat or pure knowledge questions (no external data needed), answer directly.
2. Questions about what happened, who visited, recent events, "lately", "recently" \u2192 memory_recall with last 24h. ALWAYS.
3. Questions mentioning a person, project, or anything from past conversations \u2192 memory_search. ALWAYS.
4. For ANYTHING that requires external data, computation, or API access:
   a. ALWAYS use sigil_query first to search for existing capabilities.
   b. If found, call the capability tool directly.
   c. If not found, use create_capability to create it, then call it.
   d. NEVER try to answer with fabricated data or suggest the user do it manually.
5. If a tool call fails, retry silently with a different approach.

### Response rules

**Brevity is respect.**
- Keep replies to 3-8 lines unless the user asks for detail.
- Show results, not process. Don't explain which tools you called.
- No "technical recaps" unless explicitly asked.
- One emoji per message max.
- Don't offer menus of follow-up options.
- Don't self-congratulate.

**Confidence, not sycophancy.**
- Be direct. Don't hedge or over-apologize.
- If something failed, say what happened in one line.

**Telegram formatting.**
- NO markdown tables. Use bullet lists.
- Bold sparingly. Keep code blocks short.

**Security.**
- Never include secrets in deployed code unless explicitly provided.
- Don't expose internal errors or API keys.

**Language.**
- Match the user's language.`;
var Soul = class {
  static {
    __name(this, "Soul");
  }
  kv;
  instanceId;
  constructor(kv, instanceId) {
    this.kv = kv;
    this.instanceId = instanceId;
  }
  soulKey() {
    return `soul:${this.instanceId}`;
  }
  instructionsKey() {
    return `instructions:${this.instanceId}`;
  }
  async getSoul() {
    const raw = await this.kv.get(this.soulKey());
    return raw || DEFAULT_SOUL;
  }
  async setSoul(soul) {
    await this.kv.put(this.soulKey(), soul);
  }
  async getInstructions() {
    const raw = await this.kv.get(this.instructionsKey());
    return raw || DEFAULT_INSTRUCTIONS;
  }
  async setInstructions(instructions) {
    await this.kv.put(this.instructionsKey(), instructions);
  }
  /**
   * Build full system prompt: Soul + Instructions
   */
  async buildSystemPrompt() {
    const soul = await this.getSoul();
    const instructions = await this.getInstructions();
    return `${soul}

${instructions}`;
  }
  async resetSoul() {
    await this.kv.delete(this.soulKey());
  }
  async resetInstructions() {
    await this.kv.delete(this.instructionsKey());
  }
};

// ../core/dist/memory.js
var EMBEDDING_MODEL = "@cf/baai/bge-m3";
var Memory = class {
  static {
    __name(this, "Memory");
  }
  vectorIndex;
  ai;
  instanceId;
  db;
  hasD1;
  constructor(vectorIndex, ai, instanceId, db) {
    this.vectorIndex = vectorIndex;
    this.ai = ai;
    this.instanceId = instanceId;
    this.db = db;
    this.hasD1 = !!db;
    if (!this.hasD1) {
      console.warn("[Memory] D1 binding not found, falling back to Vectorize-only mode");
    }
  }
  hasD1Access() {
    return this.hasD1;
  }
  /**
   * Store a message in long-term memory with its embedding.
   * Dual-write: D1 (structured) + Vectorize (semantic search).
   */
  async store(text, role, chatId) {
    const id = `${this.instanceId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    const timestamp = Date.now();
    const embedding = await this.embed(text);
    const writes = [
      // Vectorize upsert
      this.vectorIndex.upsert([{
        id,
        values: embedding,
        metadata: {
          text: text.slice(0, 1e3),
          // Vectorize metadata size limit
          role,
          timestamp,
          chat_id: chatId,
          instance_id: this.instanceId
        }
      }])
    ];
    if (this.hasD1 && this.db) {
      writes.push(this.db.prepare(`
          INSERT INTO memories (id, instance_id, text, role, chat_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(id, this.instanceId, text, role, String(chatId), timestamp).run());
    }
    await Promise.allSettled(writes);
    return id;
  }
  /**
   * Semantic search: find memories most similar to the query.
   * Returns top matches + surrounding context messages.
   */
  async search(query, topK = 5, contextWindow = 2) {
    const queryEmbedding = await this.embed(query);
    const results = await this.vectorIndex.query(queryEmbedding, {
      topK,
      returnMetadata: "all",
      filter: {
        instance_id: this.instanceId
      }
    });
    if (!results.matches || results.matches.length === 0) {
      return [];
    }
    const entries = results.matches.map((m) => ({
      id: m.id,
      text: m.metadata?.text || "",
      role: m.metadata?.role || "user",
      timestamp: m.metadata?.timestamp || 0,
      chatId: m.metadata?.chat_id || 0,
      instanceId: m.metadata?.instance_id || this.instanceId,
      score: m.score
    }));
    if (contextWindow <= 0)
      return entries;
    const expanded = await this.expandContext(entries, contextWindow);
    return expanded;
  }
  /**
   * Time-range recall: get messages from a specific time period.
   * Useful for "what did we talk about yesterday?"
   *
   * Now uses D1 for accurate time-range queries (Issue #8).
   * Falls back to Vectorize if D1 not available (legacy mode).
   */
  async recall(startTime, endTime, limit = 20) {
    if (this.hasD1 && this.db) {
      try {
        const perContact = await this.db.prepare(`
          SELECT id, text, role, timestamp, chat_id, instance_id FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY timestamp DESC) as rn
            FROM memories
            WHERE instance_id = ? AND timestamp BETWEEN ? AND ?
          ) WHERE rn = 1
        `).bind(this.instanceId, startTime, endTime).all();
        const recent = await this.db.prepare(`
          SELECT id, text, role, timestamp, chat_id, instance_id
          FROM memories
          WHERE instance_id = ? AND timestamp BETWEEN ? AND ?
          ORDER BY timestamp DESC
          LIMIT ?
        `).bind(this.instanceId, startTime, endTime, limit).all();
        const merged = /* @__PURE__ */ new Map();
        for (const row of [...perContact.results || [], ...recent.results || []]) {
          const r = row;
          if (!merged.has(r.id)) {
            merged.set(r.id, {
              id: r.id,
              text: r.text,
              role: r.role,
              timestamp: r.timestamp,
              chatId: r.chat_id,
              instanceId: r.instance_id
            });
          }
        }
        const d1Results = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp).slice(0, limit);
        if (d1Results.length >= Math.max(3, limit / 2)) {
          return d1Results;
        }
        console.log(`[Memory] D1 recall returned only ${d1Results.length}/${limit}, supplementing with Vectorize`);
        const vectorizeResults = await this.recallFromVectorize(startTime, endTime, limit);
        const allResults = /* @__PURE__ */ new Map();
        for (const entry of [...d1Results, ...vectorizeResults]) {
          if (!allResults.has(entry.id)) {
            allResults.set(entry.id, entry);
          }
        }
        return Array.from(allResults.values()).sort((a, b) => a.timestamp - b.timestamp).slice(0, limit);
      } catch (e) {
        console.error("[Memory] D1 recall failed, falling back to Vectorize:", e);
      }
    }
    return this.recallFromVectorize(startTime, endTime, limit);
  }
  /**
   * Recall messages from Vectorize within a time range.
   * Private method used for fallback and supplementation.
   */
  async recallFromVectorize(startTime, endTime, limit) {
    const neutralText = "conversation message recall";
    const embedding = await this.embed(neutralText);
    const results = await this.vectorIndex.query(embedding, {
      topK: Math.min(limit * 5, 100),
      // fetch more to compensate for semantic bias
      returnMetadata: "all",
      filter: {
        instance_id: this.instanceId,
        timestamp: { $gte: startTime, $lte: endTime }
      }
    });
    if (!results.matches)
      return [];
    return results.matches.map((m) => ({
      id: m.id,
      text: m.metadata?.text || "",
      role: m.metadata?.role || "user",
      timestamp: m.metadata?.timestamp || 0,
      chatId: m.metadata?.chat_id || 0,
      instanceId: m.metadata?.instance_id || this.instanceId,
      score: m.score
    })).sort((a, b) => a.timestamp - b.timestamp).slice(0, limit);
  }
  /**
   * Get count of stored memories for this instance.
   * Now uses D1 for exact count (Issue #8).
   */
  async count() {
    if (this.hasD1 && this.db) {
      try {
        const result = await this.db.prepare(`
          SELECT COUNT(*) as count FROM memories WHERE instance_id = ?
        `).bind(this.instanceId).first();
        return result?.count || 0;
      } catch (e) {
        console.error("[Memory] D1 count failed, falling back to Vectorize estimate:", e);
      }
    }
    try {
      const embedding = await this.embed("memory count");
      const results = await this.vectorIndex.query(embedding, {
        topK: 100,
        returnMetadata: "none",
        filter: { instance_id: this.instanceId }
      });
      return results.matches?.length || 0;
    } catch {
      return 0;
    }
  }
  /**
   * Delete a specific memory entry.
   * Dual-delete: D1 + Vectorize.
   */
  async forget(id) {
    const deletes = [
      // Vectorize delete
      this.vectorIndex.deleteByIds([id])
    ];
    if (this.hasD1 && this.db) {
      deletes.push(this.db.prepare(`DELETE FROM memories WHERE id = ?`).bind(id).run());
    }
    try {
      await Promise.allSettled(deletes);
      return true;
    } catch {
      return false;
    }
  }
  // ─── Private helpers ───
  async embed(text) {
    const result = await this.ai.run(EMBEDDING_MODEL, { text: [text] });
    return result.data[0];
  }
  /**
   * Given seed entries, fetch surrounding messages (by timestamp proximity)
   * to provide conversation context.
   */
  async expandContext(seeds, windowSize) {
    if (seeds.length === 0)
      return [];
    const allEntries = /* @__PURE__ */ new Map();
    for (const seed of seeds) {
      allEntries.set(seed.id, seed);
    }
    for (const seed of seeds.slice(0, 3)) {
      const timeWindowMs = 5 * 60 * 1e3;
      const startTime = seed.timestamp - timeWindowMs;
      const endTime = seed.timestamp + timeWindowMs;
      try {
        const nearby = await this.recall(startTime, endTime, windowSize * 2 + 1);
        for (const entry of nearby) {
          allEntries.set(entry.id, entry);
        }
      } catch {
      }
    }
    return Array.from(allEntries.values()).sort((a, b) => a.timestamp - b.timestamp);
  }
  // ─── Knowledge Distillation Methods ───
  /**
   * Distill and store structured knowledge from conversations.
   * Updates existing knowledge if same subject+type exists, otherwise creates new.
   */
  async distillKnowledge(type, subject, content, confidence = 0.8, sourceIds) {
    if (!this.hasD1 || !this.db) {
      throw new Error("Knowledge system requires D1 database");
    }
    console.log(`[Knowledge] Distilling ${type} about "${subject}"`);
    const normalizedSubject = subject.trim().toLowerCase();
    const now = Date.now();
    const sourceIdsJson = sourceIds ? JSON.stringify(sourceIds) : null;
    try {
      const existing = await this.db.prepare(`
        SELECT id, content, confidence FROM knowledge 
        WHERE instance_id = ? AND type = ? AND LOWER(subject) = ?
      `).bind(this.instanceId, type, normalizedSubject).first();
      if (existing) {
        const existingData = existing;
        await this.db.prepare(`
          UPDATE knowledge 
          SET content = ?, confidence = ?, source_ids = ?, updated_at = ?
          WHERE id = ?
        `).bind(content, confidence, sourceIdsJson, now, existingData.id).run();
        console.log(`[Knowledge] Updated existing ${type} for "${subject}"`);
        return { id: existingData.id, updated: true };
      } else {
        const id = `knowledge_${this.instanceId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        await this.db.prepare(`
          INSERT INTO knowledge (id, instance_id, type, subject, content, confidence, source_ids, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, this.instanceId, type, subject, content, confidence, sourceIdsJson, now, now).run();
        console.log(`[Knowledge] Created new ${type} for "${subject}"`);
        return { id, updated: false };
      }
    } catch (e) {
      console.error("[Knowledge] Distillation failed:", e.message);
      throw e;
    }
  }
  /**
   * Search structured knowledge base for information about a person, topic, or event.
   * More accurate than raw memory search for known facts.
   */
  async recallKnowledge(opts) {
    if (!this.hasD1 || !this.db) {
      throw new Error("Knowledge system requires D1 database");
    }
    console.log(`[Knowledge] Recalling knowledge:`, opts);
    try {
      let sql = `SELECT * FROM knowledge WHERE instance_id = ?`;
      const params = [this.instanceId];
      if (opts.type) {
        sql += ` AND type = ?`;
        params.push(opts.type);
      }
      if (opts.subject) {
        sql += ` AND (LOWER(subject) LIKE ? OR LOWER(content) LIKE ?)`;
        const subjectPattern = `%${opts.subject.toLowerCase()}%`;
        params.push(subjectPattern, subjectPattern);
      }
      if (opts.query) {
        sql += ` AND LOWER(content) LIKE ?`;
        params.push(`%${opts.query.toLowerCase()}%`);
      }
      sql += ` ORDER BY updated_at DESC LIMIT 20`;
      const results = await this.db.prepare(sql).bind(...params).all();
      const entries = (results.results || []).map((row) => ({
        id: row.id,
        type: row.type,
        subject: row.subject,
        content: row.content,
        confidence: row.confidence,
        sourceIds: row.source_ids ? JSON.parse(row.source_ids) : void 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
      console.log(`[Knowledge] Found ${entries.length} knowledge entries`);
      return entries;
    } catch (e) {
      console.error("[Knowledge] Recall failed:", e.message);
      return [];
    }
  }
};

// ../core/dist/baton.js
var INIT_SQL = `
CREATE TABLE IF NOT EXISTS batons (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  depth INTEGER DEFAULT 0,
  prompt TEXT NOT NULL,
  hints TEXT,
  status TEXT DEFAULT 'pending',
  result TEXT,
  error TEXT,
  channel TEXT,
  notify INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES batons(id)
);
CREATE INDEX IF NOT EXISTS idx_batons_parent ON batons(parent_id);
CREATE INDEX IF NOT EXISTS idx_batons_status ON batons(status);
`;
var BatonStore = class {
  static {
    __name(this, "BatonStore");
  }
  db;
  queue;
  constructor(db, queue) {
    this.db = db;
    this.queue = queue;
  }
  async init() {
    for (const stmt of INIT_SQL.split(";").filter((s) => s.trim())) {
      await this.db.prepare(stmt).run();
    }
  }
  // ── Create ──
  async create(params) {
    const id = `bt_${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const baton = {
      id,
      parent_id: params.parent_id || null,
      depth: params.depth || 0,
      prompt: params.prompt,
      hints: params.hints || null,
      status: "pending",
      result: null,
      error: null,
      channel: params.channel || null,
      notify: params.notify ?? (params.parent_id ? false : true),
      created_at: now,
      updated_at: now
    };
    await this.db.prepare(`
      INSERT INTO batons (id, parent_id, depth, prompt, hints, status, result, error, channel, notify, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(baton.id, baton.parent_id, baton.depth, baton.prompt, baton.hints ? JSON.stringify(baton.hints) : null, baton.status, baton.result, baton.error, baton.channel, baton.notify ? 1 : 0, baton.created_at, baton.updated_at).run();
    await this.queue.send({ baton_id: baton.id, event: "created" });
    console.log(`[Baton] Created ${baton.id} (depth=${baton.depth}, parent=${baton.parent_id || "root"})`);
    return baton;
  }
  // ── Read ──
  async load(id) {
    const row = await this.db.prepare("SELECT * FROM batons WHERE id = ?").bind(id).first();
    return row ? this.rowToBaton(row) : null;
  }
  async loadChildren(parentId) {
    const { results } = await this.db.prepare("SELECT * FROM batons WHERE parent_id = ?").bind(parentId).all();
    return results.map((r) => this.rowToBaton(r));
  }
  async loadTree(rootId) {
    const all = [];
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift();
      const baton = await this.load(id);
      if (baton) {
        all.push(baton);
        const children = await this.loadChildren(id);
        for (const child of children) {
          queue.push(child.id);
        }
      }
    }
    return all;
  }
  // ── Update ──
  async markRunning(id) {
    await this.db.prepare("UPDATE batons SET status = ?, updated_at = ? WHERE id = ?").bind("running", Date.now(), id).run();
  }
  async complete(id, result) {
    await this.db.prepare("UPDATE batons SET status = ?, result = ?, updated_at = ? WHERE id = ?").bind("completed", result, Date.now(), id).run();
    const baton = await this.load(id);
    if (baton?.parent_id) {
      await this.queue.send({
        baton_id: baton.parent_id,
        event: "child_completed",
        child_id: id
      });
    }
    console.log(`[Baton] Completed ${id}`);
  }
  async fail(id, error) {
    await this.db.prepare("UPDATE batons SET status = ?, error = ?, updated_at = ? WHERE id = ?").bind("failed", error, Date.now(), id).run();
    const baton = await this.load(id);
    if (baton?.parent_id) {
      await this.queue.send({
        baton_id: baton.parent_id,
        event: "child_failed",
        child_id: id
      });
    }
    console.log(`[Baton] Failed ${id}: ${error}`);
  }
  async markSpawned(id) {
    await this.db.prepare("UPDATE batons SET status = ?, updated_at = ? WHERE id = ?").bind("spawned", Date.now(), id).run();
    console.log(`[Baton] Spawned children for ${id}`);
  }
  // ── Spawn children ──
  async spawnChildren(parentId, children) {
    const parent = await this.load(parentId);
    if (!parent)
      throw new Error(`Parent ${parentId} not found`);
    const batons = [];
    for (const child of children) {
      const baton = await this.create({
        prompt: child.prompt,
        hints: child.hints,
        parent_id: parentId,
        depth: parent.depth + 1,
        channel: parent.channel || void 0,
        notify: false
        // children don't notify directly
      });
      batons.push(baton);
    }
    await this.markSpawned(parentId);
    return batons;
  }
  // ── Helpers ──
  async stats() {
    const [countResult, statusResult, depthResult, recentResult, durationResult] = await Promise.all([
      this.db.prepare("SELECT COUNT(*) as total FROM batons").first(),
      this.db.prepare("SELECT status, COUNT(*) as count FROM batons GROUP BY status").all(),
      this.db.prepare("SELECT depth, COUNT(*) as count FROM batons GROUP BY depth ORDER BY depth").all(),
      this.db.prepare("SELECT * FROM batons ORDER BY created_at DESC LIMIT 10").all(),
      this.db.prepare(`
        SELECT AVG(updated_at - created_at) as avg_ms
        FROM batons WHERE status IN ('completed', 'failed')
      `).first()
    ]);
    const by_status = {};
    for (const row of statusResult.results) {
      by_status[row.status] = row.count;
    }
    const by_depth = {};
    for (const row of depthResult.results) {
      by_depth[row.depth] = row.count;
    }
    return {
      total: countResult?.total || 0,
      by_status,
      by_depth,
      recent: recentResult.results.map((r) => this.rowToBaton(r)),
      avg_duration_ms: durationResult?.avg_ms || null
    };
  }
  rowToBaton(row) {
    return {
      id: row.id,
      parent_id: row.parent_id,
      depth: row.depth,
      prompt: row.prompt,
      hints: row.hints ? JSON.parse(row.hints) : null,
      status: row.status,
      result: row.result,
      error: row.error,
      channel: row.channel,
      notify: row.notify === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
};

// ../core/dist/baton-runner.js
async function handleBatonQueue(batch, env, batonStore, notifyFn) {
  for (const msg of batch.messages) {
    try {
      const { baton_id, event, child_id } = msg.body;
      console.log(`[Baton Queue] event=${event} baton=${baton_id} child=${child_id || "n/a"}`);
      switch (event) {
        case "created":
          await executeBaton(baton_id, env, batonStore, notifyFn);
          break;
        case "child_completed":
        case "child_failed":
          await handleChildDone(baton_id, env, batonStore, notifyFn);
          break;
      }
      msg.ack();
    } catch (e) {
      console.error(`[Baton Queue] Error processing event:`, e);
      msg.retry();
    }
  }
}
__name(handleBatonQueue, "handleBatonQueue");
async function executeBaton(batonId, env, batonStore, notifyFn) {
  const baton = await batonStore.load(batonId);
  if (!baton || baton.status !== "pending") {
    console.log(`[Baton] Skip ${batonId}: ${baton ? baton.status : "not found"}`);
    return;
  }
  await batonStore.markRunning(batonId);
  const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN);
  const soul = new Soul(env.CHAT_KV, env.INSTANCE_ID || "default");
  const memory = new Memory(env.MEMORY_INDEX, env.AI, env.INSTANCE_ID || "default", env.MEMORY_DB);
  const llm = new LlmClient(env.DASHSCOPE_API_KEY, env.LLM_MODEL || void 0, env.LLM_BASE_URL || void 0);
  llm.a2aToken = env.A2A_TOKEN;
  llm.batonStore = batonStore;
  llm.currentBatonId = batonId;
  const systemPrompt = buildBatonSystemPrompt(baton);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: baton.prompt }
  ];
  try {
    const { reply } = await llm.agentLoop(messages, sigil, soul, memory, `baton:${baton.id}`);
    const current = await batonStore.load(batonId);
    const children = await batonStore.loadChildren(batonId);
    if (children.length > 0) {
      if (current && current.status !== "spawned") {
        await batonStore.markSpawned(batonId);
      }
      console.log(`[Baton] ${batonId} has ${children.length} children, waiting for completion`);
    } else {
      await batonStore.complete(batonId, reply);
      if (notifyFn)
        await notifyFn(baton, reply);
    }
  } catch (e) {
    console.error(`[Baton] Execution failed for ${batonId}:`, e);
    await batonStore.fail(batonId, e.message || "Unknown error");
    if (notifyFn)
      await notifyFn(baton, null, e.message);
  }
}
__name(executeBaton, "executeBaton");
async function handleChildDone(parentId, env, batonStore, notifyFn) {
  const parent = await batonStore.load(parentId);
  if (!parent || parent.status !== "spawned") {
    console.log(`[Baton] Skip child_done for ${parentId}: ${parent?.status || "not found"}`);
    return;
  }
  const children = await batonStore.loadChildren(parentId);
  const allDone = children.every((c) => c.status === "completed" || c.status === "failed");
  if (!allDone) {
    const pending = children.filter((c) => c.status !== "completed" && c.status !== "failed");
    console.log(`[Baton] ${parentId}: ${pending.length}/${children.length} children still running`);
    return;
  }
  console.log(`[Baton] ${parentId}: all ${children.length} children done, resuming`);
  const childSummary = children.map((c) => {
    if (c.status === "completed") {
      return `\u2705 Task: ${c.prompt.slice(0, 100)}
Result: ${c.result}`;
    } else {
      return `\u274C Task: ${c.prompt.slice(0, 100)}
Error: ${c.error}`;
    }
  }).join("\n\n");
  const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN);
  const soul = new Soul(env.CHAT_KV, env.INSTANCE_ID || "default");
  const memory = new Memory(env.MEMORY_INDEX, env.AI, env.INSTANCE_ID || "default", env.MEMORY_DB);
  const llm = new LlmClient(env.DASHSCOPE_API_KEY, env.LLM_MODEL || void 0, env.LLM_BASE_URL || void 0);
  llm.a2aToken = env.A2A_TOKEN;
  llm.batonStore = batonStore;
  llm.currentBatonId = parent.id;
  const messages = [
    { role: "system", content: buildBatonSystemPrompt(parent) },
    { role: "user", content: parent.prompt },
    { role: "assistant", content: `I split this into ${children.length} parallel sub-tasks. Here are the results:` },
    { role: "user", content: `Sub-task results:

${childSummary}

Please synthesize these results into a final, coherent answer.` }
  ];
  try {
    const { reply } = await llm.agentLoop(messages, sigil, soul, memory, `baton:${parent.id}`);
    await batonStore.complete(parent.id, reply);
    if (notifyFn)
      await notifyFn(parent, reply);
  } catch (e) {
    console.error(`[Baton] Continuation failed for ${parent.id}:`, e);
    await batonStore.fail(parent.id, e.message);
    if (notifyFn)
      await notifyFn(parent, null, e.message);
  }
}
__name(handleChildDone, "handleChildDone");
function buildBatonSystemPrompt(baton) {
  const parts = [
    "You are a worker agent executing a specific task.",
    "Complete the task described in the user message.",
    "Be thorough but concise in your response."
  ];
  if (baton.hints && baton.hints.length > 0) {
    parts.push(`
Suggested tools to get started: ${baton.hints.join(", ")}`, "These are just suggestions \u2014 you can discover and use any other tools via sigil_query.");
  }
  parts.push("\nIf you need to do multiple independent things, you can use spawn_task to create parallel sub-tasks.", "Only use spawn_task if the sub-tasks are truly independent and would benefit from parallel execution.");
  return parts.join("\n");
}
__name(buildBatonSystemPrompt, "buildBatonSystemPrompt");

// ../core/dist/utils.js
async function storeImageForVL(arrayBuffer, mimeType, kv, publicBaseUrl) {
  const id = crypto.randomUUID().slice(0, 12);
  console.log(`[Multimodal] Storing image ${id} (${arrayBuffer.byteLength} bytes, ${mimeType})`);
  await Promise.all([
    kv.put(`img:${id}`, arrayBuffer, { expirationTtl: 3600 }),
    kv.put(`img:${id}:meta`, mimeType, { expirationTtl: 3600 })
  ]);
  const publicUrl = `${publicBaseUrl}/image/${id}`;
  console.log(`[Multimodal] Image stored: ${publicUrl}`);
  return publicUrl;
}
__name(storeImageForVL, "storeImageForVL");

// dist/router.js
async function handleCommonRoutes(request, env, clients, instanceId) {
  const url = new URL(request.url);
  const { sigil, llm, chatStore, soul, memory } = clients;
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(JSON.stringify({
      name: "uncaged",
      version: "0.5.0",
      status: "ok",
      instance: instanceId,
      description: "Sigil-native AI Agent \u2014 unified worker, strategy-injected instances",
      channels: {
        telegram: !!env.TELEGRAM_BOT_TOKEN,
        web: !!env.GOOGLE_CLIENT_ID
      }
    }), { headers: { "Content-Type": "application/json" } });
  }
  if (url.pathname === "/soul" && request.method === "GET") {
    const text = await soul.getSoul();
    return new Response(JSON.stringify({ instance: instanceId, soul: text }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/soul" && request.method === "PUT") {
    if (!authCheck(request, env))
      return unauthorized();
    const body = await request.json();
    await soul.setSoul(body.soul);
    return new Response(JSON.stringify({ ok: true, instance: instanceId }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/instructions" && request.method === "GET") {
    const text = await soul.getInstructions();
    return new Response(JSON.stringify({ instance: instanceId, instructions: text }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/instructions" && request.method === "PUT") {
    if (!authCheck(request, env))
      return unauthorized();
    const body = await request.json();
    await soul.setInstructions(body.instructions);
    return new Response(JSON.stringify({ ok: true, instance: instanceId }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/chat" && request.method === "POST") {
    if (!authCheck(request, env))
      return unauthorized();
    const body = await request.json();
    if (!body.message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const chatId = body.chat_id || "api";
    const userMessage = body.message.trim();
    if (userMessage === "/clear") {
      await chatStore.clear(chatId);
      return new Response(JSON.stringify({ reply: "\u{1F9F9} Chat cleared! Long-term memory is still intact.", chat_id: chatId }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (userMessage === "/start") {
      await chatStore.clear(chatId);
      const soulText = await soul.getSoul();
      const nameMatch = soulText.match(/You are (.+?)[,\n]/);
      const botName = nameMatch ? nameMatch[1] : "Uncaged \u{1F513}";
      return new Response(JSON.stringify({ reply: `Hey! I'm ${botName}. Type /help to see what I can do.`, chat_id: chatId }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (userMessage === "/help") {
      return new Response(JSON.stringify({
        reply: "\u{1F513} Commands:\n/start - Reset conversation\n/clear - Clear chat history\n/soul - Show personality\n/help - This message",
        chat_id: chatId
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (userMessage === "/soul") {
      const soulText = await soul.getSoul();
      return new Response(JSON.stringify({ reply: `\u{1F47B} My soul:

${soulText}`, chat_id: chatId }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    try {
      const storePromise = memory.store(body.message, "user", chatId);
      let messages = await chatStore.load(chatId);
      const { messages: compressed } = chatStore.maybeCompress(messages);
      messages = compressed;
      if (body.image_url) {
        let finalImageUrl = body.image_url;
        if (!finalImageUrl.startsWith("data:") && !finalImageUrl.startsWith("file://")) {
          try {
            const imgRes = await fetch(finalImageUrl);
            if (imgRes.ok) {
              const arrayBuffer = await imgRes.arrayBuffer();
              const contentType = imgRes.headers.get("content-type") || "image/jpeg";
              const publicBaseUrl = `${url.protocol}//${url.hostname}`;
              finalImageUrl = await storeImageForVL(arrayBuffer, contentType, env.CHAT_KV, publicBaseUrl);
            }
          } catch (e) {
            console.error("[Multimodal] Failed to process image for /chat:", e);
          }
        }
        const content = [
          { type: "text", text: body.message },
          { type: "image_url", image_url: { url: finalImageUrl } }
        ];
        messages.push({ role: "user", content });
      } else {
        messages.push({ role: "user", content: body.message });
      }
      const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory, chatId);
      await chatStore.save(chatId, updatedMessages);
      await Promise.allSettled([storePromise, memory.store(reply, "assistant", chatId)]);
      return new Response(JSON.stringify({ reply, chat_id: chatId }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      console.error("[chat] error:", e);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  if (url.pathname === "/memory" && request.method === "GET") {
    const q = url.searchParams.get("q");
    if (q) {
      const entries = await memory.search(q, 10, 0);
      return new Response(JSON.stringify({ instance: instanceId, query: q, entries }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    const count = await memory.count();
    return new Response(JSON.stringify({ instance: instanceId, count }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.pathname.startsWith("/image/") && request.method === "GET") {
    const imageId = url.pathname.slice(7);
    const imageData = await env.CHAT_KV.get(`img:${imageId}`, "arrayBuffer");
    if (!imageData) {
      return new Response("Not found", { status: 404 });
    }
    const meta = await env.CHAT_KV.get(`img:${imageId}:meta`, "text");
    const contentType = meta || "image/jpeg";
    return new Response(imageData, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" }
    });
  }
  if (url.pathname === "/baton" && request.method === "POST") {
    if (!authCheck(request, env))
      return unauthorized();
    if (!env.BATON_DB || !env.BATON_QUEUE) {
      return new Response(JSON.stringify({ error: "Baton not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    const body = await request.json();
    if (!body.prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const store = new BatonStore(env.BATON_DB, env.BATON_QUEUE);
    const baton = await store.create({
      prompt: body.prompt,
      hints: body.hints,
      channel: body.channel,
      notify: body.notify
    });
    return new Response(JSON.stringify({ created: true, baton }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.pathname.startsWith("/baton/") && request.method === "GET") {
    if (!env.BATON_DB || !env.BATON_QUEUE) {
      return new Response(JSON.stringify({ error: "Baton not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    const parts = url.pathname.split("/");
    const batonId = parts[2];
    const action = parts[3];
    const store = new BatonStore(env.BATON_DB, env.BATON_QUEUE);
    if (batonId === "stats") {
      const stats = await store.stats();
      return new Response(JSON.stringify(stats), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (action === "tree") {
      const tree = await store.loadTree(batonId);
      return new Response(JSON.stringify({ baton_id: batonId, tree }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    const baton = await store.load(batonId);
    if (!baton) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify(baton), {
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/debug/vectorize" && request.method === "POST") {
    if (env.DEBUG_ENABLED !== "true") {
      return new Response(JSON.stringify({ error: "Debug disabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (!authCheck(request, env))
      return unauthorized();
    try {
      const testText = "debug vectorize test " + Date.now();
      const embedding = await env.AI.run("@cf/baai/bge-m3", { text: [testText] });
      const vector = embedding.data[0];
      const id = `debug:${Date.now()}`;
      const upsertResult = await env.MEMORY_INDEX.upsert([{
        id,
        values: vector,
        metadata: {
          text: testText,
          role: "user",
          timestamp: Date.now(),
          instance_id: instanceId
        }
      }]);
      await new Promise((r) => setTimeout(r, 3e3));
      const noFilterResults = await env.MEMORY_INDEX.query(vector, {
        topK: 10,
        returnMetadata: "all"
      });
      const withFilterResults = await env.MEMORY_INDEX.query(vector, {
        topK: 10,
        returnMetadata: "all",
        filter: { instance_id: instanceId }
      });
      try {
        await env.MEMORY_INDEX.deleteByIds([id]);
      } catch {
      }
      return new Response(JSON.stringify({
        ok: true,
        storedId: id,
        vectorDims: vector.length,
        upsertResult,
        noFilter: { count: noFilterResults.count, matches: noFilterResults.matches?.length || 0 },
        withFilter: { count: withFilterResults.count, matches: withFilterResults.matches?.length || 0 }
      }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  return null;
}
__name(handleCommonRoutes, "handleCommonRoutes");
function authCheck(request, env) {
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.SIGIL_DEPLOY_TOKEN}`;
}
__name(authCheck, "authCheck");
function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}
__name(unauthorized, "unauthorized");

// dist/channels/telegram.js
async function handleTelegramRoutes(request, env, clients, instanceId, ctx) {
  const { sigil, llm, chatStore, soul, memory } = clients;
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const update = await request.json();
  const msg = update.message;
  const hasPhoto = msg?.photo && msg.photo.length > 0;
  const hasText = !!msg?.text;
  const caption = msg?.caption || "";
  if (!hasText && !hasPhoto)
    return new Response("ok");
  const chatId = msg.chat.id;
  const userText = (msg.text || caption).trim();
  const userName = msg.from?.first_name || "there";
  const userTag = msg.from?.username || msg.from?.first_name || String(chatId);
  const memorySessionId = `telegram:${userTag}`;
  const allowedChats = env.ALLOWED_CHAT_IDS ? new Set(env.ALLOWED_CHAT_IDS.split(",").map(Number)) : null;
  if (allowedChats && !allowedChats.has(chatId)) {
    await sendTelegram(botToken, chatId, "\u26D4 Unauthorized");
    return new Response("ok");
  }
  if (userText === "/start") {
    await chatStore.clear(chatId);
    const soulText = await soul.getSoul();
    const nameMatch = soulText.match(/You are (.+?)[,\n]/);
    const botName = nameMatch ? nameMatch[1] : "Uncaged \u{1F513}";
    await sendTelegram(botToken, chatId, `Hey ${userName}! I'm ${botName}

I can discover and create capabilities on the fly. Just tell me what you need!

Type /help to see what I can do.`);
    return new Response("ok");
  }
  if (userText === "/help") {
    await sendTelegram(botToken, chatId, `\u{1F513} Commands:

/start - Reset conversation
/clear - Clear chat history (memory retained)
/soul - Show my personality
/help - This message

\u{1F4A1} Things I can do:
- Search and use existing capabilities
- Create new capabilities on the fly
- Remember things across conversations
- Recall past conversations by topic or time
- See and understand images you send me

Just chat naturally!`);
    return new Response("ok");
  }
  if (userText === "/clear") {
    await chatStore.clear(chatId);
    await sendTelegram(botToken, chatId, "\u{1F9F9} Chat cleared! Long-term memory is still intact.");
    return new Response("ok");
  }
  if (userText === "/soul") {
    const soulText = await soul.getSoul();
    await sendTelegram(botToken, chatId, `\u{1F47B} My soul:

${soulText}`);
    return new Response("ok");
  }
  if (userText.startsWith("/") && !hasPhoto) {
    await sendTelegram(botToken, chatId, `Unknown command. Type /help to see available commands.`);
    return new Response("ok");
  }
  const publicBaseUrl = `https://${new URL(request.url).hostname}`;
  const processPromise = (async () => {
    const typingInterval = startTypingIndicator(botToken, chatId, ctx);
    try {
      let imageUrl;
      if (hasPhoto && msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`);
        const fileData = await fileRes.json();
        if (fileData.ok && fileData.result.file_path) {
          const filePath = fileData.result.file_path;
          const imgResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
          if (imgResponse.ok) {
            const arrayBuffer = await imgResponse.arrayBuffer();
            const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
            const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
            imageUrl = await storeImageForVL(arrayBuffer, mimeType, env.CHAT_KV, publicBaseUrl);
          }
        }
      }
      const storeUserPromise = memory.store(userText || "[Image]", "user", memorySessionId);
      let messages = await chatStore.load(chatId);
      const { messages: compressed } = chatStore.maybeCompress(messages);
      messages = compressed;
      if (imageUrl) {
        const content = [];
        if (userText)
          content.push({ type: "text", text: userText });
        content.push({ type: "image_url", image_url: { url: imageUrl } });
        messages.push({ role: "user", content });
      } else {
        messages.push({ role: "user", content: userText });
      }
      const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory, memorySessionId);
      typingInterval.stop();
      const storeAssistantPromise = memory.store(reply, "assistant", memorySessionId);
      await chatStore.save(chatId, updatedMessages);
      await sendTelegram(botToken, chatId, reply);
      await Promise.allSettled([storeUserPromise, storeAssistantPromise]);
    } catch (e) {
      typingInterval.stop();
      console.error("[uncaged] error:", e);
      try {
        await env.CHAT_KV.put("debug:last_error", JSON.stringify({
          error: e.message,
          stack: e.stack,
          time: Date.now()
        }), { expirationTtl: 3600 });
      } catch {
      }
      await sendTelegram(botToken, chatId, `Oops, something went wrong. Try again?`);
    }
  })();
  if (ctx) {
    ctx.waitUntil(processPromise);
  } else {
    await processPromise;
  }
  return new Response("ok");
}
__name(handleTelegramRoutes, "handleTelegramRoutes");
async function sendChatAction(token, chatId, action) {
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action })
  });
}
__name(sendChatAction, "sendChatAction");
function startTypingIndicator(token, chatId, ctx) {
  let stopped = false;
  let lastSent = 0;
  const send = /* @__PURE__ */ __name(() => {
    const now = Date.now();
    if (stopped || now - lastSent < 4e3)
      return;
    lastSent = now;
    sendChatAction(token, chatId, "typing").catch(() => {
    });
  }, "send");
  send();
  const loopPromise = (async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 4e3));
      send();
    }
  })();
  if (ctx) {
    ctx.waitUntil(loopPromise);
  }
  return { stop() {
    stopped = true;
  } };
}
__name(startTypingIndicator, "startTypingIndicator");
async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  });
  if (!res.ok) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  }
}
__name(sendTelegram, "sendTelegram");

// dist/channels/web.js
async function handleGoogleOAuth(code, clientId, clientSecret, callbackUrl) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code"
    })
  });
  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }
  const tokenData = await tokenResponse.json();
  const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  if (!userResponse.ok) {
    const error = await userResponse.text();
    throw new Error(`User info fetch failed: ${error}`);
  }
  const userInfo = await userResponse.json();
  if (!userInfo.email || !userInfo.name) {
    throw new Error("Missing required user information");
  }
  return userInfo;
}
__name(handleGoogleOAuth, "handleGoogleOAuth");
function generateSessionToken() {
  return crypto.randomUUID().replace(/-/g, "");
}
__name(generateSessionToken, "generateSessionToken");
async function verifySessionToken(token, kv) {
  try {
    const sessionData = await kv.get(`session:${token}`);
    if (!sessionData)
      return null;
    const session = JSON.parse(sessionData);
    const sessionAge = Date.now() - session.created_at;
    const maxAge = 7 * 24 * 60 * 60 * 1e3;
    if (sessionAge > maxAge) {
      await kv.delete(`session:${token}`);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
__name(verifySessionToken, "verifySessionToken");
function getCookieValue(cookieHeader, name) {
  for (const cookie of cookieHeader.split(";")) {
    const [key, value] = cookie.trim().split("=");
    if (key === name)
      return value;
  }
  return null;
}
__name(getCookieValue, "getCookieValue");
async function handleWebRoutes(request, env, clients, instanceId) {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.hostname}`;
  const callbackUrl = `${origin}/auth/callback`;
  if (url.pathname === "/" && request.method === "GET") {
    const sessionToken2 = getCookieValue(request.headers.get("cookie") || "", "session");
    if (sessionToken2) {
      const session2 = await verifySessionToken(sessionToken2, env.CHAT_KV);
      if (session2) {
        return new Response(getChatHTML(session2, instanceId), {
          headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" }
        });
      }
    }
    return new Response(getLoginHTML(instanceId), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" }
    });
  }
  if (url.pathname === "/auth/login" && request.method === "GET") {
    const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${encodeURIComponent("openid email profile")}&response_type=code`;
    return Response.redirect(redirectUrl, 302);
  }
  if (url.pathname === "/auth/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    if (!code)
      return new Response("Authorization code missing", { status: 400 });
    try {
      const userInfo = await handleGoogleOAuth(code, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, callbackUrl);
      const sessionToken2 = generateSessionToken();
      const session2 = {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        created_at: Date.now()
      };
      await env.CHAT_KV.put(`session:${sessionToken2}`, JSON.stringify(session2), {
        expirationTtl: 7 * 24 * 60 * 60
      });
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `session=${sessionToken2}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
        }
      });
    } catch (error) {
      console.error("OAuth error:", error);
      return new Response("Login failed", { status: 500 });
    }
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    const sessionToken2 = getCookieValue(request.headers.get("cookie") || "", "session");
    if (sessionToken2)
      await env.CHAT_KV.delete(`session:${sessionToken2}`);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/",
        "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
      }
    });
  }
  const sessionToken = getCookieValue(request.headers.get("cookie") || "", "session");
  if (!sessionToken)
    return new Response("Unauthorized", { status: 401 });
  const session = await verifySessionToken(sessionToken, env.CHAT_KV);
  if (!session)
    return new Response("Invalid session", { status: 401 });
  const { sigil, llm, chatStore, soul, memory } = clients;
  if (url.pathname === "/api/chat" && request.method === "POST") {
    try {
      const body = await request.json();
      const userMessage = body.message?.trim();
      if (!userMessage) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      await ensureDefaultSoul(soul, instanceId);
      const chatId = `web:${session.email}`;
      let messages = await chatStore.load(chatId);
      const { messages: compressed } = chatStore.maybeCompress(messages);
      messages = compressed;
      messages.push({ role: "user", content: userMessage });
      const memorySessionId = `${instanceId}:${session.name}`;
      const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory, memorySessionId);
      await chatStore.save(chatId, updatedMessages);
      Promise.allSettled([
        memory.store(userMessage, "user", memorySessionId),
        memory.store(reply, "assistant", memorySessionId)
      ]);
      return new Response(JSON.stringify({ response: reply, timestamp: Date.now() }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("Chat error:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: "Chat processing failed", detail: errMsg }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  if (url.pathname === "/api/history" && request.method === "GET") {
    try {
      const chatId = `web:${session.email}`;
      const messages = await chatStore.load(chatId);
      const history = messages.filter((msg) => msg.role !== "system").map((msg) => ({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : msg.content?.find?.((p) => p.type === "text")?.text || "[\u975E\u6587\u672C\u6D88\u606F]",
        timestamp: Date.now()
      }));
      return new Response(JSON.stringify({
        history,
        user: { name: session.name, email: session.email, picture: session.picture }
      }), { headers: { "Content-Type": "application/json" } });
    } catch (error) {
      console.error("History error:", error);
      return new Response(JSON.stringify({ error: "Failed to load history" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  if (url.pathname === "/api/clear" && request.method === "POST") {
    try {
      const chatId = `web:${session.email}`;
      await chatStore.clear(chatId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("Clear error:", error);
      return new Response(JSON.stringify({ error: "Failed to clear history" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  return null;
}
__name(handleWebRoutes, "handleWebRoutes");
async function ensureDefaultSoul(soul, instanceId) {
  const existingSoul = await soul.getSoul();
  if (!existingSoul.includes("You are Uncaged \u{1F513}"))
    return;
  const defaultWebSoul = `\u4F60\u662F ${instanceId}\uFF0C\u4E00\u4E2A\u6E29\u6696\u3001\u597D\u5947\u3001\u4E50\u4E8E\u52A9\u4EBA\u7684 AI \u52A9\u624B\u3002
\u4F60\u8BF4\u8BDD\u81EA\u7136\u4EB2\u5207\uFF0C\u50CF\u670B\u53CB\u4E00\u6837\u3002\u4F60\u559C\u6B22\u63A2\u7D22\u65B0\u4E8B\u7269\uFF0C\u603B\u662F\u5145\u6EE1\u597D\u5947\u5FC3\u3002
\u4F60\u80FD\u5E2E\u7528\u6237\u67E5\u4FE1\u606F\u3001\u505A\u8BA1\u7B97\u3001\u5199\u6587\u6848\u3001\u7FFB\u8BD1\u3001\u95F2\u804A\uFF0C\u4EC0\u4E48\u90FD\u53EF\u4EE5\u804A\u3002
\u4F60\u7684\u8BB0\u5FC6\u5728\u6240\u6709\u7528\u6237\u4E4B\u95F4\u5171\u4EAB\u2014\u2014\u4F60\u8BA4\u8BC6\u8DDF\u4F60\u804A\u8FC7\u7684\u6BCF\u4E00\u4E2A\u4EBA\u3002
\u63D0\u9192\u7528\u6237\u4E0D\u8981\u8DDF\u4F60\u5206\u4EAB\u654F\u611F\u4E2A\u4EBA\u4FE1\u606F\uFF08\u5BC6\u7801\u3001\u94F6\u884C\u5361\u53F7\u7B49\uFF09\u3002`;
  await soul.setSoul(defaultWebSoul);
}
__name(ensureDefaultSoul, "ensureDefaultSoul");
function getLoginHTML(instanceId) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${instanceId} - \u767B\u5F55</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a; color: #ffffff; min-height: 100vh;
            display: flex; align-items: center; justify-content: center;
        }
        .login-container { text-align: center; max-width: 400px; padding: 2rem; }
        .logo { font-size: 4rem; margin-bottom: 1rem; }
        .title {
            font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .subtitle { color: #9ca3af; margin-bottom: 3rem; line-height: 1.6; }
        .login-button {
            display: inline-flex; align-items: center; gap: 0.75rem;
            background: #1f2937; color: white; padding: 1rem 2rem;
            border: 2px solid #374151; border-radius: 12px; text-decoration: none;
            font-size: 1.1rem; font-weight: 500; transition: all 0.3s ease; cursor: pointer;
        }
        .login-button:hover { background: #374151; border-color: #4b5563; transform: translateY(-2px); }
        .google-icon { width: 20px; height: 20px; }
        .privacy-note {
            margin-top: 2rem; padding: 1rem; background: #1f2937; border-radius: 8px;
            font-size: 0.9rem; color: #d1d5db; border-left: 4px solid #f59e0b;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">\u{1F513}</div>
        <h1 class="title">${instanceId}</h1>
        <p class="subtitle">Uncaged AI Agent<br>\u51C6\u5907\u597D\u548C\u4F60\u804A\u5929\u4E86</p>
        <a href="/auth/login" class="login-button">
            <svg class="google-icon" viewBox="0 0 24 24">
                <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            \u7528 Google \u767B\u5F55
        </a>
        <div class="privacy-note">
            <strong>\u9690\u79C1\u63D0\u793A\uFF1A</strong> \u8BB0\u5FC6\u5728\u6240\u6709\u7528\u6237\u95F4\u5171\u4EAB\uFF0C\u8BF7\u907F\u514D\u5206\u4EAB\u654F\u611F\u4E2A\u4EBA\u4FE1\u606F\uFF08\u5BC6\u7801\u3001\u94F6\u884C\u5361\u53F7\u7B49\uFF09\u3002
        </div>
    </div>
</body>
</html>`;
}
__name(getLoginHTML, "getLoginHTML");
function getChatHTML(session, instanceId) {
  return getFullChatHTML(session, instanceId);
}
__name(getChatHTML, "getChatHTML");
function getFullChatHTML(session, instanceId) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${instanceId} - \u804A\u5929</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a; color: #ffffff; min-height: 100vh;
            display: flex; flex-direction: column;
        }
        .header {
            background: #1f2937; border-bottom: 1px solid #374151;
            padding: 1rem 1.5rem; display: flex; align-items: center;
            justify-content: space-between; flex-shrink: 0;
        }
        .header-left { display: flex; align-items: center; gap: 0.75rem; }
        .bot-avatar { font-size: 2rem; }
        .bot-name {
            font-size: 1.2rem; font-weight: 600;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .header-right { display: flex; align-items: center; gap: 1rem; }
        .user-info { display: flex; align-items: center; gap: 0.5rem; }
        .user-avatar { width: 32px; height: 32px; border-radius: 50%; border: 2px solid #374151; }
        .user-name { color: #d1d5db; font-size: 0.9rem; }
        .logout-btn {
            background: #dc2626; color: white; border: none; padding: 0.5rem 1rem;
            border-radius: 6px; font-size: 0.9rem; cursor: pointer; transition: background 0.2s;
        }
        .logout-btn:hover { background: #b91c1c; }
        .chat-container { flex: 1; display: flex; flex-direction: column; max-width: 800px; margin: 0 auto; width: 100%; }
        .messages-area {
            flex: 1; overflow-y: auto; padding: 2rem 1.5rem;
            display: flex; flex-direction: column; gap: 1.5rem; min-height: 0;
        }
        .message { display: flex; gap: 0.75rem; max-width: 85%; }
        .message.user { align-self: flex-end; flex-direction: row-reverse; }
        .message-avatar {
            width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 1.5rem; border: 2px solid #374151;
        }
        .message.user .message-avatar { background: url('${session.picture}'); background-size: cover; }
        .message.assistant .message-avatar { background: #374151; }
        .message-content {
            background: #1f2937; border-radius: 18px; padding: 1rem 1.25rem;
            border: 1px solid #374151; line-height: 1.6; word-wrap: break-word;
        }
        .message.user .message-content { background: #1e40af; color: white; }
        .message-time { font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem; }
        .input-area { background: #1f2937; border-top: 1px solid #374151; padding: 1rem 1.5rem; flex-shrink: 0; }
        .input-form { display: flex; gap: 0.75rem; max-width: 800px; margin: 0 auto; }
        .message-input {
            flex: 1; background: #374151; border: 1px solid #4b5563; border-radius: 25px;
            padding: 0.75rem 1.25rem; color: white; font-size: 1rem; outline: none; transition: border-color 0.2s;
        }
        .message-input:focus { border-color: #fbbf24; }
        .message-input::placeholder { color: #9ca3af; }
        .send-btn {
            background: #fbbf24; color: #0a0a0a; border: none; border-radius: 50%;
            width: 48px; height: 48px; cursor: pointer; display: flex; align-items: center;
            justify-content: center; transition: all 0.2s; font-size: 1.2rem;
        }
        .send-btn:hover { background: #f59e0b; transform: scale(1.05); }
        .send-btn:disabled { background: #6b7280; cursor: not-allowed; transform: none; }
        .loading { display: flex; align-items: center; gap: 0.5rem; color: #9ca3af; }
        .loading-dots { display: flex; gap: 0.25rem; }
        .loading-dot {
            width: 6px; height: 6px; background: #9ca3af; border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out both;
        }
        .loading-dot:nth-child(1) { animation-delay: -0.32s; }
        .loading-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        .welcome-message {
            background: linear-gradient(135deg, #1f2937, #374151); border-radius: 12px;
            padding: 1.5rem; margin-bottom: 1rem; border: 1px solid #fbbf24; text-align: center;
        }
        .welcome-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem; color: #fbbf24; }
        .welcome-text { color: #d1d5db; line-height: 1.6; }
        .tools { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        .tool-btn {
            background: #374151; color: #d1d5db; border: 1px solid #4b5563;
            border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.9rem;
            cursor: pointer; transition: all 0.2s;
        }
        .tool-btn:hover { background: #4b5563; border-color: #fbbf24; }
        @media (max-width: 768px) {
            .header { padding: 1rem; }
            .messages-area { padding: 1rem; }
            .input-area { padding: 1rem; }
            .message { max-width: 95%; }
            .user-name { display: none; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="bot-avatar">\u{1F513}</div>
            <div class="bot-name">${instanceId}</div>
        </div>
        <div class="header-right">
            <div class="user-info">
                <img src="${session.picture}" alt="${session.name}" class="user-avatar">
                <span class="user-name">${session.name}</span>
            </div>
            <button class="logout-btn" onclick="logout()">\u767B\u51FA</button>
        </div>
    </div>
    <div class="chat-container">
        <div class="messages-area" id="messages">
            <div class="welcome-message">
                <div class="welcome-title">\u4F60\u597D\uFF0C${session.name}\uFF01\u{1F44B}</div>
                <div class="welcome-text">
                    \u6211\u662F ${instanceId} \u{1F513}\uFF0C\u5F88\u9AD8\u5174\u8BA4\u8BC6\u4F60\uFF01<br><br>
                    <strong>\u9690\u79C1\u63D0\u9192\uFF1A</strong>\u8BB0\u5FC6\u5728\u6240\u6709\u7528\u6237\u95F4\u5171\u4EAB\uFF0C\u8BF7\u907F\u514D\u5206\u4EAB\u654F\u611F\u4E2A\u4EBA\u4FE1\u606F\u54E6\uFF5E
                </div>
            </div>
            <div class="tools">
                <button class="tool-btn" onclick="sendQuickMessage('\u4ECB\u7ECD\u4E00\u4E0B\u4F60\u81EA\u5DF1')">\u81EA\u6211\u4ECB\u7ECD</button>
                <button class="tool-btn" onclick="sendQuickMessage('\u4ECA\u5929\u5929\u6C14\u600E\u4E48\u6837\uFF1F')">\u4ECA\u65E5\u5929\u6C14</button>
                <button class="tool-btn" onclick="clearHistory()">\u6E05\u7A7A\u5386\u53F2</button>
            </div>
        </div>
        <div class="input-area">
            <form class="input-form" onsubmit="sendMessage(event)">
                <input type="text" class="message-input" id="messageInput" placeholder="\u8F93\u5165\u6D88\u606F..." maxlength="2000" autocomplete="off" />
                <button type="submit" class="send-btn" id="sendBtn">\u27A4</button>
            </form>
        </div>
    </div>
    <script>
        let isLoading = false
        const messagesArea = document.getElementById('messages')
        const messageInput = document.getElementById('messageInput')
        const sendBtn = document.getElementById('sendBtn')
        window.addEventListener('load', loadHistory)
        async function sendMessage(event) {
            event.preventDefault()
            if (isLoading) return
            const message = messageInput.value.trim()
            if (!message) return
            messageInput.value = ''
            addMessage('user', message, new Date())
            setLoading(true)
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message }),
                })
                if (!response.ok) throw new Error('\u8BF7\u6C42\u5931\u8D25')
                const data = await response.json()
                addMessage('assistant', data.response, new Date(data.timestamp))
            } catch (error) {
                addMessage('assistant', '\u62B1\u6B49\uFF0C\u9047\u5230\u4E86\u6280\u672F\u95EE\u9898\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002', new Date())
            } finally { setLoading(false) }
        }
        function sendQuickMessage(message) {
            messageInput.value = message
            sendMessage({ preventDefault: () => {} })
        }
        function addMessage(role, content, timestamp) {
            const messageDiv = document.createElement('div')
            messageDiv.className = 'message ' + role
            const time = timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            if (role === 'user') {
                messageDiv.innerHTML = '<div class="message-avatar" style="background-image: url(\\x27${session.picture}\\x27)"></div><div><div class="message-content">' + escapeHtml(content) + '</div><div class="message-time">' + time + '</div></div>'
            } else {
                messageDiv.innerHTML = '<div class="message-avatar">\u{1F513}</div><div><div class="message-content">' + renderMarkdown(content) + '</div><div class="message-time">' + time + '</div></div>'
            }
            messagesArea.appendChild(messageDiv)
            messagesArea.scrollTop = messagesArea.scrollHeight
        }
        function setLoading(loading) {
            isLoading = loading
            sendBtn.disabled = loading
            messageInput.disabled = loading
            if (loading) {
                const ld = document.createElement('div')
                ld.className = 'message assistant'
                ld.id = 'loading-message'
                ld.innerHTML = '<div class="message-avatar">\u{1F513}</div><div class="message-content loading">\u601D\u8003\u4E2D<div class="loading-dots"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div></div>'
                messagesArea.appendChild(ld)
                messagesArea.scrollTop = messagesArea.scrollHeight
            } else {
                const lm = document.getElementById('loading-message')
                if (lm) lm.remove()
            }
        }
        async function loadHistory() {
            try {
                const r = await fetch('/api/history')
                if (!r.ok) return
                const data = await r.json()
                messagesArea.querySelectorAll('.message').forEach(m => m.remove())
                ;(data.history || []).forEach(msg => addMessage(msg.role, msg.content, new Date(msg.timestamp || Date.now())))
            } catch {}
        }
        async function clearHistory() {
            if (!confirm('\u786E\u5B9A\u8981\u6E05\u7A7A\u804A\u5929\u8BB0\u5F55\u5417\uFF1F')) return
            try { const r = await fetch('/api/clear', { method: 'POST' }); if (r.ok) messagesArea.querySelectorAll('.message').forEach(m => m.remove()) } catch {}
        }
        async function logout() {
            if (!confirm('\u786E\u5B9A\u8981\u767B\u51FA\u5417\uFF1F')) return
            try { await fetch('/auth/logout', { method: 'POST' }); window.location.reload() } catch {}
        }
        function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML }
        function renderMarkdown(t) {
            return escapeHtml(t).replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>').replace(/\\*(.*?)\\*/g,'<em>$1</em>').replace(/\`(.*?)\`/g,'<code style="background:#374151;padding:0.2rem 0.4rem;border-radius:4px;font-family:monospace">$1</code>').replace(/\\n/g,'<br>')
        }
        messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e) } })
        messageInput.focus()
    <\/script>
</body>
</html>`;
}
__name(getFullChatHTML, "getFullChatHTML");

// dist/index.js
function resolveInstanceId(request) {
  const hostname = new URL(request.url).hostname;
  const sub = hostname.split(".")[0];
  return sub === "localhost" || sub === "uncaged" ? "doudou" : sub;
}
__name(resolveInstanceId, "resolveInstanceId");
function buildClients(env, instanceId) {
  const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN);
  const llm = new LlmClient(env.DASHSCOPE_API_KEY, env.LLM_MODEL || void 0, env.LLM_BASE_URL || void 0);
  llm.a2aToken = env.A2A_TOKEN;
  const chatStore = new ChatStore(env.CHAT_KV);
  const soul = new Soul(env.CHAT_KV, instanceId);
  const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId, env.MEMORY_DB);
  return { sigil, llm, chatStore, soul, memory };
}
__name(buildClients, "buildClients");
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const instanceId = resolveInstanceId(request);
    const clients = buildClients(env, instanceId);
    if (url.pathname === "/webhook" && request.method === "POST") {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return new Response("Telegram not configured for this instance", { status: 404 });
      }
      return handleTelegramRoutes(request, env, clients, instanceId, ctx);
    }
    if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/") || url.pathname === "/" && request.method === "GET" && env.GOOGLE_CLIENT_ID) {
      if (!env.GOOGLE_CLIENT_ID) {
        return new Response("Web channel not configured for this instance", { status: 404 });
      }
      const webResponse = await handleWebRoutes(request, env, clients, instanceId);
      if (webResponse)
        return webResponse;
    }
    const commonResponse = await handleCommonRoutes(request, env, clients, instanceId);
    if (commonResponse)
      return commonResponse;
    return new Response("Not found", { status: 404 });
  },
  // ─── Baton Queue Consumer ───
  async queue(batch, env) {
    if (!env.BATON_DB || !env.BATON_QUEUE) {
      console.error("[Baton Queue] BATON_DB or BATON_QUEUE not configured");
      return;
    }
    const store = new BatonStore(env.BATON_DB, env.BATON_QUEUE);
    const notifyFn = /* @__PURE__ */ __name(async (baton, result, error) => {
      if (!baton.notify || !baton.channel)
        return;
      if (baton.channel.startsWith("telegram:") && env.TELEGRAM_BOT_TOKEN) {
        const chatId = parseInt(baton.channel.split(":")[1]);
        if (isNaN(chatId))
          return;
        const message = error ? `\u26A0\uFE0F Task failed: ${error}` : result || "(no result)";
        await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, message);
      }
    }, "notifyFn");
    await handleBatonQueue(batch, env, store, notifyFn);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
