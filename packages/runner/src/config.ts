import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CONFIG_DIR = path.join(os.homedir(), '.uncaged')
const CONFIG_FILE = path.join(CONFIG_DIR, 'runner.json')

export interface RunnerConfig {
  url: string   // WebSocket URL
  token: string // Permanent token
  label: string // Device label
}

export function loadConfig(): RunnerConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    return JSON.parse(raw) as RunnerConfig
  } catch {
    return null
  }
}

export function saveConfig(config: RunnerConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8')
  // Restrict permissions (owner-only)
  fs.chmodSync(CONFIG_FILE, 0o600)
}

export function getConfigPath(): string {
  return CONFIG_FILE
}
