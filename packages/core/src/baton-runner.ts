// Baton Runner — executes Batons via the agent loop
// This is the core of the Baton system: a stateless worker
// that picks up a Baton, runs an agentic loop, and reports results.

import type { Env } from './env.js'
import type { Baton, BatonEvent, BatonStore } from './baton.js'
import { LlmClient } from './llm.js'
import { SigilClient } from './sigil.js'
import { Soul } from './soul.js'
import { Memory } from './memory.js'

// Notification callback type
export type NotifyFn = (baton: Baton, result: string | null, error?: string) => Promise<void>

// ─── Queue Consumer ───

export async function handleBatonQueue(
  batch: MessageBatch<BatonEvent>,
  env: Env,
  batonStore: BatonStore,
  notifyFn?: NotifyFn,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const { baton_id, event, child_id } = msg.body
      console.log(`[Baton Queue] event=${event} baton=${baton_id} child=${child_id || 'n/a'}`)

      switch (event) {
        case 'created':
          await executeBaton(baton_id, env, batonStore, notifyFn)
          break

        case 'child_completed':
        case 'child_failed':
          await handleChildDone(baton_id, env, batonStore, notifyFn)
          break
      }

      msg.ack()
    } catch (e: any) {
      console.error(`[Baton Queue] Error processing event:`, e)
      msg.retry()
    }
  }
}

// ─── Execute a Baton ───

async function executeBaton(
  batonId: string,
  env: Env,
  batonStore: BatonStore,
  notifyFn?: NotifyFn,
): Promise<void> {
  const baton = await batonStore.load(batonId)
  if (!baton || baton.status !== 'pending') {
    console.log(`[Baton] Skip ${batonId}: ${baton ? baton.status : 'not found'}`)
    return
  }

  await batonStore.markRunning(batonId)

  // Build the worker agent — same capabilities as the main agent
  const sigil = new SigilClient(env.SIGIL_URL || '', env.SIGIL_DEPLOY_TOKEN || '')
  const soul = new Soul(env.CHAT_KV, env.INSTANCE_ID || 'default')
  const memory = new Memory(env.MEMORY_INDEX, env.AI, env.INSTANCE_ID || 'default', env.MEMORY_DB)
  const llm = new LlmClient(
    env.DASHSCOPE_API_KEY,
    env.LLM_MODEL || undefined,
    env.LLM_BASE_URL || undefined,
  )
  llm.a2aToken = env.A2A_TOKEN
  llm.batonStore = batonStore
  llm.currentBatonId = batonId

  // Run agent loop with the Baton's prompt
  const systemPrompt = buildBatonSystemPrompt(baton)
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: baton.prompt },
  ]

  try {
    const { reply } = await llm.agentLoop(messages, sigil, soul, memory, `baton:${baton.id}`)

    // Check if children were spawned during execution
    // (spawn_task tool calls batonStore.spawnChildren which sets status to 'spawned')
    const current = await batonStore.load(batonId)
    const children = await batonStore.loadChildren(batonId)

    if (children.length > 0) {
      // Children exist — this baton was broken down, wait for children
      // Ensure status is 'spawned' (might have been set by spawnChildren already)
      if (current && current.status !== 'spawned') {
        await batonStore.markSpawned(batonId)
      }
      console.log(`[Baton] ${batonId} has ${children.length} children, waiting for completion`)
    } else {
      await batonStore.complete(batonId, reply)
      if (notifyFn) await notifyFn(baton, reply)
    }
  } catch (e: any) {
    console.error(`[Baton] Execution failed for ${batonId}:`, e)
    await batonStore.fail(batonId, e.message || 'Unknown error')
    if (notifyFn) await notifyFn(baton, null, e.message)
  }
}

// ─── Handle child completion ───

async function handleChildDone(
  parentId: string,
  env: Env,
  batonStore: BatonStore,
  notifyFn?: NotifyFn,
): Promise<void> {
  const parent = await batonStore.load(parentId)
  if (!parent || parent.status !== 'spawned') {
    console.log(`[Baton] Skip child_done for ${parentId}: ${parent?.status || 'not found'}`)
    return
  }

  const children = await batonStore.loadChildren(parentId)
  const allDone = children.every(c => c.status === 'completed' || c.status === 'failed')

  if (!allDone) {
    const pending = children.filter(c => c.status !== 'completed' && c.status !== 'failed')
    console.log(`[Baton] ${parentId}: ${pending.length}/${children.length} children still running`)
    return
  }

  // All children done — resume parent with results
  console.log(`[Baton] ${parentId}: all ${children.length} children done, resuming`)

  const childSummary = children.map(c => {
    if (c.status === 'completed') {
      return `✅ Task: ${c.prompt.slice(0, 100)}\nResult: ${c.result}`
    } else {
      return `❌ Task: ${c.prompt.slice(0, 100)}\nError: ${c.error}`
    }
  }).join('\n\n')

  // Run a continuation: the parent re-enters the agent loop with child results
  const sigil = new SigilClient(env.SIGIL_URL || '', env.SIGIL_DEPLOY_TOKEN || '')
  const soul = new Soul(env.CHAT_KV, env.INSTANCE_ID || 'default')
  const memory = new Memory(env.MEMORY_INDEX, env.AI, env.INSTANCE_ID || 'default', env.MEMORY_DB)
  const llm = new LlmClient(
    env.DASHSCOPE_API_KEY,
    env.LLM_MODEL || undefined,
    env.LLM_BASE_URL || undefined,
  )
  llm.a2aToken = env.A2A_TOKEN
  llm.batonStore = batonStore
  llm.currentBatonId = parent.id

  const messages = [
    { role: 'system' as const, content: buildBatonSystemPrompt(parent) },
    { role: 'user' as const, content: parent.prompt },
    { role: 'assistant' as const, content: `I split this into ${children.length} parallel sub-tasks. Here are the results:` },
    { role: 'user' as const, content: `Sub-task results:\n\n${childSummary}\n\nPlease synthesize these results into a final, coherent answer.` },
  ]

  try {
    const { reply } = await llm.agentLoop(messages, sigil, soul, memory, `baton:${parent.id}`)
    await batonStore.complete(parent.id, reply)
    if (notifyFn) await notifyFn(parent, reply)
  } catch (e: any) {
    console.error(`[Baton] Continuation failed for ${parent.id}:`, e)
    await batonStore.fail(parent.id, e.message)
    if (notifyFn) await notifyFn(parent, null, e.message)
  }
}

// ─── System prompt for Baton workers ───

function buildBatonSystemPrompt(baton: Baton): string {
  const parts = [
    'You are a worker agent executing a specific task.',
    'Complete the task described in the user message.',
    'Be thorough but concise in your response.',
  ]

  if (baton.hints && baton.hints.length > 0) {
    parts.push(
      `\nSuggested tools to get started: ${baton.hints.join(', ')}`,
      'These are just suggestions — you can discover and use any other tools via sigil_query.',
    )
  }

  parts.push(
    '\nIf you need to do multiple independent things, you can use spawn_task to create parallel sub-tasks.',
    'Only use spawn_task if the sub-tasks are truly independent and would benefit from parallel execution.',
  )

  return parts.join('\n')
}