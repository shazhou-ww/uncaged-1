/**
 * Uncaged Health Monitor Worker
 * Runs every 5 minutes to check Uncaged AI Agent health
 */

interface Env {
  HEALTH_KV: KVNamespace;
  UNCAGED_URL: string;
  OC_STATUS_URL: string;
  SIGIL_DEPLOY_TOKEN?: string;
  OC_STATUS_TOKEN?: string;
}

interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  count?: number;
}

interface HealthReport {
  timestamp: number;
  status: 'healthy' | 'degraded' | 'down';
  checks: {
    liveness: CheckResult;
    chat: CheckResult;
    memory: CheckResult;
  };
  version?: string;
}

async function measureLatency<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now();
  const result = await fn();
  const latency = Date.now() - start;
  return [result, latency];
}

async function checkLiveness(env: Env): Promise<CheckResult> {
  try {
    const [response, latency] = await measureLatency(() =>
      fetch(env.UNCAGED_URL, {
        method: 'GET',
        headers: env.SIGIL_DEPLOY_TOKEN
          ? { Authorization: `Bearer ${env.SIGIL_DEPLOY_TOKEN}` }
          : {},
      })
    );

    if (!response.ok) {
      return { ok: false, latencyMs: latency, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as any;
    return {
      ok: data.status === 'ok',
      latencyMs: latency,
      error: data.status !== 'ok' ? 'status is not ok' : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkChat(env: Env): Promise<CheckResult> {
  try {
    const [response, latency] = await measureLatency(() =>
      fetch(`${env.UNCAGED_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.SIGIL_DEPLOY_TOKEN
            ? { Authorization: `Bearer ${env.SIGIL_DEPLOY_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          message: 'ping',
          chat_id: 'health-check',
        }),
        signal: AbortSignal.timeout(15000),
      })
    );

    if (!response.ok) {
      return { ok: false, latencyMs: latency, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as any;
    const hasReply = data.reply && typeof data.reply === 'string' && data.reply.length > 0;

    return {
      ok: hasReply,
      latencyMs: latency,
      error: !hasReply ? 'no reply in response' : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkMemory(env: Env): Promise<CheckResult> {
  try {
    const [response, latency] = await measureLatency(() =>
      fetch(`${env.UNCAGED_URL}/memory?q=test`, {
        method: 'GET',
        headers: env.SIGIL_DEPLOY_TOKEN
          ? { Authorization: `Bearer ${env.SIGIL_DEPLOY_TOKEN}` }
          : {},
        signal: AbortSignal.timeout(10000),
      })
    );

    if (!response.ok) {
      return { ok: false, latencyMs: latency, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as any;
    const count = Array.isArray(data.results) ? data.results.length : 0;

    return {
      ok: true,
      latencyMs: latency,
      count,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runHealthChecks(env: Env): Promise<HealthReport> {
  const timestamp = Date.now();

  // Run all checks in parallel
  const [liveness, chat, memory] = await Promise.all([
    checkLiveness(env),
    checkChat(env),
    checkMemory(env),
  ]);

  // Determine overall status
  const allOk = liveness.ok && chat.ok && memory.ok;
  const anyOk = liveness.ok || chat.ok || memory.ok;
  const status: HealthReport['status'] = allOk
    ? 'healthy'
    : anyOk
    ? 'degraded'
    : 'down';

  return {
    timestamp,
    status,
    checks: { liveness, chat, memory },
  };
}

async function pushHeartbeat(env: Env, report: HealthReport): Promise<void> {
  try {
    const message =
      report.status === 'healthy'
        ? 'All checks passed'
        : Object.entries(report.checks)
            .filter(([_, check]) => !check.ok)
            .map(([name, check]) => `${name}: ${check.error || 'failed'}`)
            .join(', ');

    await fetch(`${env.OC_STATUS_URL}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.OC_STATUS_TOKEN
          ? { Authorization: `Bearer ${env.OC_STATUS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        agent: 'uncaged-health',
        status: report.status,
        message,
      }),
    });
  } catch (error) {
    console.error('Failed to push heartbeat:', error);
  }
}

async function handleScheduled(env: Env): Promise<void> {
  const report = await runHealthChecks(env);

  // Store in KV
  await Promise.all([
    env.HEALTH_KV.put('health:latest', JSON.stringify(report)),
    env.HEALTH_KV.put(`health:${report.timestamp}`, JSON.stringify(report), {
      expirationTtl: 7 * 24 * 60 * 60, // 7 days
    }),
  ]);

  // Push heartbeat to oc-status
  await pushHeartbeat(env, report);

  console.log(`Health check completed: ${report.status}`, report);
}

async function handleHealthRequest(env: Env): Promise<Response> {
  const latest = await env.HEALTH_KV.get('health:latest');
  if (!latest) {
    return Response.json({ error: 'No health data available' }, { status: 503 });
  }
  return Response.json(JSON.parse(latest));
}

async function handleHistoryRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const hours = parseInt(url.searchParams.get('hours') || '24', 10);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const list = await env.HEALTH_KV.list({ prefix: 'health:' });
  const keys = list.keys
    .map((k) => k.name)
    .filter((name) => {
      if (name === 'health:latest') return false;
      const timestamp = parseInt(name.replace('health:', ''), 10);
      return !isNaN(timestamp) && timestamp >= cutoff;
    })
    .sort((a, b) => {
      const tsA = parseInt(a.replace('health:', ''), 10);
      const tsB = parseInt(b.replace('health:', ''), 10);
      return tsB - tsA; // newest first
    });

  const reports = await Promise.all(
    keys.map(async (key) => {
      const data = await env.HEALTH_KV.get(key);
      return data ? JSON.parse(data) : null;
    })
  );

  return Response.json(reports.filter((r) => r !== null));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return handleHealthRequest(env);
    }

    if (url.pathname === '/health/history') {
      return handleHistoryRequest(request, env);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
