// spawn_task — LLM tool for creating concurrent sub-tasks (Batons)
// Worker calls this to break down work into parallel sub-tasks.

import type { BatonStore } from '../baton.js'

export const spawnTaskTool = {
  type: 'function' as const,
  function: {
    name: 'spawn_task',
    description: 'Create a concurrent sub-task. It will be executed independently by another worker. Use this when you need to do multiple things in parallel, or when a sub-task is independent enough to run on its own. Results will be automatically collected when all spawned tasks complete.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Complete task description. Be specific — another worker will execute this independently with no other context.',
        },
        hints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Suggested tool names to help the worker get started (optional, not a restriction).',
        },
      },
      required: ['prompt'],
    },
  },
}

export interface SpawnTaskArgs {
  prompt: string
  hints?: string[]
}

export async function handleSpawnTask(
  args: SpawnTaskArgs,
  parentBatonId: string,
  batonStore: BatonStore,
): Promise<string> {
  const baton = await batonStore.create({
    prompt: args.prompt,
    hints: args.hints,
    parent_id: parentBatonId,
  })

  return JSON.stringify({
    spawned: true,
    baton_id: baton.id,
    message: `Task spawned as ${baton.id}. It will execute independently. Results will be collected when all spawned tasks complete.`,
  })
}
