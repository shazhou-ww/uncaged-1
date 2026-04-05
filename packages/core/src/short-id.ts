/**
 * Short ID Generation — Uncaged Phase 2
 * 
 * Generates nanoid-style short IDs for users and agents:
 * - u_a8k3mf9x for users
 * - a_p2n7bq4w for agents
 * 
 * 8 chars, lowercase alphanumeric, collision-resistant
 */

/**
 * Generate a short ID with prefix
 * @param prefix - 'u' for users, 'a' for agents
 * @returns Short ID string (e.g., "u_a8k3mf9x", "a_p2n7bq4w")
 */
export function generateShortId(prefix: 'u' | 'a'): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => chars[b % chars.length])
    .join('')
  return `${prefix}_${id}`
}