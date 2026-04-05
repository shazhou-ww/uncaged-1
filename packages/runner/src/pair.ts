import os from 'node:os'
import { saveConfig, getConfigPath } from './config.js'

export async function pair(code: string, baseUrl?: string): Promise<void> {
  // Determine the API base URL
  // The baseUrl should be the full agent URL, e.g. https://uncaged.shazhou.work/scott/doudou
  const apiBase = baseUrl || 'https://uncaged.shazhou.work'

  console.log(`[Runner] Pairing with code: ${code}`)
  console.log(`[Runner] API: ${apiBase}`)

  const response = await fetch(`${apiBase}/api/v1/runners/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      label: os.hostname(),
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      hostname: os.hostname(),
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
    console.error(`[Runner] Pairing failed: ${error.error || response.statusText}`)
    process.exit(1)
  }

  const result = await response.json() as {
    ok: boolean
    token: string
    ws_url: string
    label: string
  }

  // Save config locally
  saveConfig({
    url: result.ws_url,
    token: result.token,
    label: result.label,
  })

  console.log(`[Runner] ✅ Pairing successful!`)
  console.log(`[Runner] Label: ${result.label}`)
  console.log(`[Runner] Config saved to: ${getConfigPath()}`)
  console.log(`[Runner] Run 'npx @uncaged/runner start' to connect.`)
}
