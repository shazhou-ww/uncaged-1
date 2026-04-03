// Sigil API client

export interface DeployParams {
  name: string
  code?: string
  schema?: any
  execute?: string
  description?: string
  tags?: string[]
}

export interface QueryResult {
  items: Array<{
    capability: string
    description?: string
    tags?: string[]
    type: string
  }>
  total: number
}

export class SigilClient {
  constructor(
    private baseUrl: string,
    private deployToken: string,
  ) {}

  async query(q: string, limit = 5): Promise<QueryResult> {
    const url = new URL('/_api/query', this.baseUrl)
    url.searchParams.set('q', q)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('sort', 'relevance')

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`Sigil query failed: ${res.status}`)
    return res.json()
  }

  async inspect(name: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/_api/inspect/${name}`)
    if (!res.ok) throw new Error(`Sigil inspect failed: ${res.status}`)
    return res.json()
  }

  async deploy(params: DeployParams): Promise<any> {
    const res = await fetch(`${this.baseUrl}/_api/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deployToken}`,
      },
      body: JSON.stringify({
        name: params.name,
        code: params.code,
        schema: params.schema,
        execute: params.execute,
        type: 'normal',
        description: params.description,
        tags: params.tags,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Sigil deploy failed: ${res.status} ${body}`)
    }
    return res.json()
  }

  async run(name: string, params: Record<string, any> = {}): Promise<string> {
    const url = new URL(`/run/${name}`, this.baseUrl)

    // GET with query params for simple invocations
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }

    const res = await fetch(url.toString())
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Sigil run failed: ${res.status} ${body}`)
    }
    return res.text()
  }

  async listCapabilities(): Promise<string[]> {
    const result = await this.query('', 50)
    return result.items.map(i => i.capability)
  }
}
