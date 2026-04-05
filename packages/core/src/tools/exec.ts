// exec tools — run commands on connected Runner clients via RunnerHub DO

type ToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const execTool: ToolDef = {
  type: 'function',
  function: {
    name: 'exec',
    description: "Execute a shell command on a connected Runner (owner's device). Use runner_list first to check available runners.",
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (optional)',
        },
        target: {
          type: 'string',
          description: 'Runner label to target (optional, auto-selects if omitted)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default 60, max 300)',
        },
      },
      required: ['command'],
    },
  },
}

export const runnerListTool: ToolDef = {
  type: 'function',
  function: {
    name: 'runner_list',
    description: 'List all connected Runners with their labels, tags, OS, and system info.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export interface ExecArgs {
  command: string
  cwd?: string
  target?: string
  timeout?: number
}

export async function handleExec(
  args: ExecArgs,
  runnerHub: DurableObjectStub,
): Promise<string> {
  const timeout = Math.min(args.timeout || 60, 300)
  const requestId = crypto.randomUUID()

  const response = await runnerHub.fetch('https://runner-hub/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: args.command,
      cwd: args.cwd,
      target: args.target,
      timeout,
      requestId,
    }),
  })

  if (!response.ok) {
    const error = await response.json() as { error: string }
    return JSON.stringify({ error: error.error || 'exec failed' })
  }

  const result = await response.json()
  return JSON.stringify(result)
}

export async function handleRunnerList(
  runnerHub: DurableObjectStub,
): Promise<string> {
  const response = await runnerHub.fetch('https://runner-hub/runners')
  if (!response.ok) {
    return JSON.stringify({ error: 'Failed to list runners', runners: [] })
  }
  const data = await response.json()
  return JSON.stringify(data)
}
