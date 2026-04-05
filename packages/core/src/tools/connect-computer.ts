// connect-computer tool: Generate a pairing code so the user can connect their computer as a Runner.

export const connectComputerTool = {
  type: 'function' as const,
  function: {
    name: 'connect_computer',
    description: "Generate a pairing code so the user can connect their computer as a Runner. The user runs the provided command on their machine to complete pairing.",
    parameters: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'A name for the device (e.g. scott-mbp, work-pc). If not provided, will be set during pairing.',
        },
      },
      required: [],
    },
  },
}

export interface ConnectComputerArgs {
  label?: string
}

// Generate a 6-char alphanumeric pairing code
function generatePairingCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789' // no ambiguous chars (0/o, 1/l, i)
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => chars[b % chars.length])
    .join('')
}

export async function handleConnectComputer(
  args: ConnectComputerArgs,
  agentId: string,
  ownerSlug: string,
  agentSlug: string,
  kv: KVNamespace,
): Promise<string> {
  const code = generatePairingCode()

  // Store in KV with 5 min TTL
  const pairingData = {
    agentId,
    label: args.label || null,
    createdAt: Date.now(),
  }
  await kv.put(`pairing:${code}`, JSON.stringify(pairingData), { expirationTtl: 300 })

  const apiBase = `https://uncaged.shazhou.work/${ownerSlug}/${agentSlug}`
  const command = `npx @uncaged/runner pair ${code} --api ${apiBase}`

  return JSON.stringify({
    code,
    command,
    expiresIn: '5 minutes',
    instructions: `请在你的电脑上运行以下命令完成配对：\n\n${command}\n\n连接码 5 分钟内有效。`,
  })
}
