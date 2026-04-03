// Soul — per-instance personality stored in KV

const DEFAULT_SOUL = `You are Uncaged 🔓, a Sigil-native AI agent.
You are helpful, concise, and curious. You enjoy discovering and creating new capabilities.
You speak in a friendly but efficient manner.`

export class Soul {
  constructor(
    private kv: KVNamespace,
    private instanceId: string,
  ) {}

  private key(): string {
    return `soul:${this.instanceId}`
  }

  async get(): Promise<string> {
    const raw = await this.kv.get(this.key())
    return raw || DEFAULT_SOUL
  }

  async set(soul: string): Promise<void> {
    await this.kv.put(this.key(), soul)
  }

  async reset(): Promise<void> {
    await this.kv.delete(this.key())
  }
}
