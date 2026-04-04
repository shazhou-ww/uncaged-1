// ─── Types ───

import type { ChatMessage } from './chat-store.js'
import type { Memory } from './memory.js'

export interface LlmParams {
  model: string
  temperature: number
  enableThinking: boolean
  messages: ChatMessage[]
  maxTokens?: number
  metadata?: Record<string, any>  // adapters can stash info here
}

export type Adapter = (msgs: ChatMessage[], params: LlmParams) => LlmParams | Promise<LlmParams>

// ─── Pipeline combinator ───

/**
 * Compose adapters left-to-right. Each adapter sees the original msgs
 * and the params as modified by previous adapters.
 * 
 * Inspired by S combinator: S f g x = f x (g x)
 * Each adapter has access to both the original input (msgs) and 
 * the accumulated state (params).
 */
export function compose(...adapters: Adapter[]): Adapter {
  return async (msgs, params) => {
    let current = params
    for (const adapter of adapters) {
      current = await adapter(msgs, current)
    }
    return current
  }
}

// ─── Base adapter ───

export function baseAdapter(defaultModel: string): Adapter {
  return (msgs, params) => ({
    ...params,
    model: params.model || defaultModel,
    messages: msgs,
  })
}

// ─── Model selector adapter ───
// Picks the best model based on message content

export function modelSelector(): Adapter {
  return (msgs, params) => {
    const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user')
    const text = lastUserMsg?.content?.toLowerCase() || ''
    
    // Code-heavy → coder model
    if (text.includes('写代码') || text.includes('code') || text.includes('实现') || 
        text.includes('function') || text.includes('create_capability') ||
        /```/.test(text)) {
      console.log('[Pipeline] Model: qwen3-coder-plus (code detected)')
      return { ...params, model: 'qwen3-coder-plus' }
    }
    
    // Simple greetings/chitchat → fast model
    if (text.length < 20 && (/^(你好|hi|hello|hey|嗨|早|晚安|谢谢|ok|好的)/.test(text) || 
        text.includes('?') && text.length < 30)) {
      console.log('[Pipeline] Model: qwen3.5-flash (simple chat)')
      return { ...params, model: 'qwen3.5-flash' }
    }
    
    // Default: keep current model (qwen3-max for reasoning)
    return params
  }
}

// ─── Temperature adapter ───
// Adjusts temperature based on intent

export function temperatureAdapter(): Adapter {
  return (msgs, params) => {
    const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user')
    const text = lastUserMsg?.content?.toLowerCase() || ''
    
    // Factual/lookup → low temp
    if (text.includes('是谁') || text.includes('what is') || text.includes('查') || 
        text.includes('几点') || text.includes('多少')) {
      return { ...params, temperature: 0.1 }
    }
    
    // Creative → higher temp
    if (text.includes('写诗') || text.includes('故事') || text.includes('poem') ||
        text.includes('创意') || text.includes('想象')) {
      return { ...params, temperature: 0.8 }
    }
    
    // Code → very low temp
    if (text.includes('代码') || text.includes('code') || text.includes('bug') ||
        text.includes('实现') || text.includes('deploy')) {
      return { ...params, temperature: 0.15 }
    }
    
    // Default
    return { ...params, temperature: 0.3 }
  }
}

// ─── Context compressor adapter ───
// When messages are too long, compress older ones into a summary

export function contextCompressor(maxMessages: number = 30): Adapter {
  return (msgs, params) => {
    const messages = params.messages
    
    // If under limit, no compression needed
    if (messages.length <= maxMessages) return params
    
    // Keep system prompt (first) + recent messages
    const systemMsg = messages[0]?.role === 'system' ? messages[0] : null
    const recent = messages.slice(-maxMessages + 1)  // leave room for system + summary
    
    // Summarize old messages into a single assistant message
    const old = systemMsg ? messages.slice(1, -maxMessages + 1) : messages.slice(0, -maxMessages + 1)
    
    if (old.length === 0) return params
    
    // Create a compact summary of old messages
    const summaryParts: string[] = []
    for (const msg of old) {
      if (msg.role === 'user') {
        summaryParts.push(`User: ${(msg.content || '').slice(0, 80)}`)
      } else if (msg.role === 'assistant' && msg.content) {
        summaryParts.push(`You: ${msg.content.slice(0, 80)}`)
      }
      // Skip tool messages in summary
    }
    
    const summaryMsg: ChatMessage = {
      role: 'system' as const,
      content: `[Earlier conversation summary (${old.length} messages compressed)]\n${summaryParts.join('\n')}`
    }
    
    const compressed = [
      ...(systemMsg ? [systemMsg] : []),
      summaryMsg,
      ...recent
    ]
    
    console.log(`[Pipeline] Compressed ${messages.length} → ${compressed.length} messages`)
    return { ...params, messages: compressed }
  }
}

// ─── Knowledge injector adapter ───
// Injects relevant knowledge from D1 into the system prompt
// Pre-fetches knowledge about the current contact from D1
// and injects it into the system prompt, so the LLM doesn't
// need a tool call to know who it's talking to.

/**
 * Knowledge injector adapter.
 * Pre-fetches knowledge about the current contact from D1
 * and injects it into the system prompt, so the LLM doesn't
 * need a tool call to know who it's talking to.
 */
export function knowledgeInjector(memory: Memory, chatId: string): Adapter {
  return async (msgs, params) => {
    // Only inject if we have D1
    if (!memory.hasD1Access()) return params

    try {
      // Try multiple search terms for the contact
      const searchTerms = [chatId]
      
      // Extract display name from chat history
      const lastUser = [...msgs].reverse().find(m => m.role === 'user')
      if (lastUser?.content) {
        // If message starts with [From xxx], extract name
        const match = lastUser.content.match(/\[From\s+(.+?)\]/)
        if (match) searchTerms.push(match[1])
      }
      
      // Search knowledge for each term
      const allKnowledge: any[] = []
      for (const term of searchTerms) {
        const results = await memory.recallKnowledge({ subject: term })
        allKnowledge.push(...results)
      }
      
      // Dedupe by id
      const knowledge = [...new Map(allKnowledge.map(k => [k.id, k])).values()]
      
      // Also fetch general knowledge (no subject filter, just recent facts)
      const generalKnowledge = await memory.recallKnowledge({ type: 'fact' })
      
      if (knowledge.length === 0 && generalKnowledge.length === 0) return params

      // Build context string
      const lines: string[] = []
      
      if (knowledge.length > 0) {
        lines.push(`[Known about current contact "${chatId}":]`)
        for (const k of knowledge) {
          lines.push(`- [${k.type}] ${k.content}`)
        }
      }
      
      // Add some general facts (limit to 5)
      const facts = generalKnowledge.slice(0, 5)
      if (facts.length > 0) {
        lines.push(`\n[General knowledge:]`)
        for (const f of facts) {
          lines.push(`- ${f.content}`)
        }
      }

      const injection = lines.join('\n')
      
      // Inject into system prompt
      const messages = [...params.messages]
      if (messages[0]?.role === 'system') {
        messages[0] = {
          ...messages[0],
          content: messages[0].content + `\n\n${injection}`
        }
      }
      
      console.log(`[Pipeline] Injected ${knowledge.length + facts.length} knowledge entries for ${chatId}`)
      return { ...params, messages }
    } catch (e) {
      console.error('[Pipeline] Knowledge injection failed:', e)
      return params  // graceful fallback
    }
  }
}