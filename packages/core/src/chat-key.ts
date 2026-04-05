/**
 * Unified key helpers for multi-tenant chat + memory.
 *
 * Current (legacy) formats:
 *   ChatStore key: "chat:{chatId}" where chatId is telegram numeric id, "web:email", or "api"
 *   Memory session tag (chat_id in D1/vectorize): "telegram:Scott" or "{instanceId}:{name}"
 *
 * Target (unified) formats:
 *   ChatStore key: "chat:{agentId}:{userId}"
 *   Memory session tag: "user:{userId}"
 *   instance_id: unchanged
 */

/** Build unified chat key: "{agentId}:{userId}" — ChatStore prepends "chat:" */
export function unifiedChatKey(agentId: string, userId: string): string {
  return `${agentId}:${userId}`
}

/** Build unified memory session tag: "user:{userId}" */
export function unifiedMemorySession(userId: string): string {
  return `user:${userId}`
}

/**
 * Parse legacy chat key to extract channel info.
 * Handles the chatId portion (without the "chat:" prefix that ChatStore adds).
 * Returns null if the format is unrecognized.
 */
export function parseLegacyChatKey(chatKey: string): {
  type: 'telegram' | 'web' | 'api' | 'unknown'
  externalId: string
} | null {
  if (/^\d+$/.test(chatKey)) return { type: 'telegram', externalId: chatKey }
  if (chatKey.startsWith('web:')) return { type: 'web', externalId: chatKey.slice(4) }
  if (chatKey === 'api') return { type: 'api', externalId: 'api' }
  return null
}

/**
 * Parse legacy memory session tag (chat_id field in D1 memories table).
 * Recognizes:
 *   "user:{id}"         → already unified
 *   "telegram:{name}"   → telegram channel legacy format
 *   "{instance}:{name}" → instance-scoped legacy format
 *   anything else       → null (unrecognized)
 */
export function parseLegacyMemorySession(session: string): {
  type: 'telegram' | 'instance' | 'unified' | 'unknown'
  name: string
} | null {
  if (session.startsWith('user:')) return { type: 'unified', name: session.slice(5) }
  if (session.startsWith('telegram:')) return { type: 'telegram', name: session.slice(9) }
  if (session.includes(':')) return { type: 'instance', name: session.split(':').slice(1).join(':') }
  return null
}
