// Core Env interface - shared across all instances

export interface Env {
  DASHSCOPE_API_KEY: string
  LLM_MODEL: string
  LLM_BASE_URL: string
  SIGIL_DEPLOY_TOKEN: string
  SIGIL_URL: string
  INSTANCE_ID: string
  CHAT_KV: KVNamespace
  MEMORY_INDEX: VectorizeIndex
  MEMORY_DB?: D1Database // Optional: structured memory storage (Issue #8)
  BATON_DB?: D1Database  // Baton task relay storage
  BATON_QUEUE?: Queue<import('./baton.js').BatonEvent>  // Baton event queue
  A2A_TOKEN?: string     // Optional: A2A auth token for agent collaboration
  AI: any
  DEBUG_ENABLED?: string
}