/**
 * Health Dashboard — inline HTML served by the health worker
 */

export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🔓 Uncaged Health Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117; color: #e6edf3;
    min-height: 100vh; padding: 24px;
  }
  .header {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 24px; padding-bottom: 16px;
    border-bottom: 1px solid #30363d;
  }
  .header h1 { font-size: 22px; font-weight: 600; }
  .header .badge {
    padding: 4px 12px; border-radius: 12px;
    font-size: 13px; font-weight: 600; text-transform: uppercase;
  }
  .badge.healthy { background: #1a7f37; color: #fff; }
  .badge.degraded { background: #9a6700; color: #fff; }
  .badge.down { background: #cf222e; color: #fff; }
  .badge.loading { background: #30363d; color: #8b949e; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 20px; position: relative; overflow: hidden;
  }
  .card .indicator {
    position: absolute; top: 0; left: 0; right: 0; height: 3px;
  }
  .card .indicator.ok { background: #3fb950; }
  .card .indicator.fail { background: #f85149; }
  .card .indicator.unknown { background: #484f58; }
  .card h3 { font-size: 14px; color: #8b949e; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .card .detail { font-size: 13px; color: #8b949e; }
  .card .error { font-size: 12px; color: #f85149; margin-top: 8px; word-break: break-all; }

  .section { margin-bottom: 24px; }
  .section h2 { font-size: 16px; margin-bottom: 12px; color: #8b949e; }

  .timeline {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 16px; overflow-x: auto;
  }
  .timeline-row { display: flex; gap: 3px; margin-bottom: 8px; align-items: center; }
  .timeline-label { width: 70px; font-size: 12px; color: #8b949e; flex-shrink: 0; }
  .timeline-cells { display: flex; gap: 2px; flex-wrap: nowrap; }
  .timeline-cell {
    width: 14px; height: 14px; border-radius: 2px;
    cursor: pointer; position: relative;
  }
  .timeline-cell.healthy { background: #238636; }
  .timeline-cell.degraded { background: #9a6700; }
  .timeline-cell.down { background: #cf222e; }
  .timeline-cell.empty { background: #21262d; }
  .timeline-cell:hover { opacity: 0.8; }

  .tooltip {
    display: none; position: fixed;
    background: #2d333b; border: 1px solid #444c56; border-radius: 6px;
    padding: 8px 12px; font-size: 12px; z-index: 100;
    pointer-events: none; max-width: 300px;
  }
  .tooltip.visible { display: block; }

  .log-table {
    width: 100%; border-collapse: collapse;
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    overflow: hidden;
  }
  .log-table th, .log-table td { padding: 10px 14px; text-align: left; font-size: 13px; }
  .log-table th { background: #1c2129; color: #8b949e; font-weight: 600; border-bottom: 1px solid #30363d; }
  .log-table tr:not(:last-child) td { border-bottom: 1px solid #21262d; }
  .log-table .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status-dot.healthy { background: #3fb950; }
  .status-dot.degraded { background: #d29922; }
  .status-dot.down { background: #f85149; }

  .meta { font-size: 12px; color: #484f58; text-align: center; margin-top: 24px; }
  .refresh-btn {
    background: #21262d; border: 1px solid #30363d; color: #8b949e;
    padding: 6px 14px; border-radius: 6px; cursor: pointer;
    font-size: 13px; margin-left: 12px;
  }
  .refresh-btn:hover { background: #30363d; color: #e6edf3; }

  @media (max-width: 600px) {
    body { padding: 12px; }
    .cards { grid-template-columns: 1fr; }
    .header h1 { font-size: 18px; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>🔓 Uncaged Health</h1>
  <span class="badge loading" id="statusBadge">Loading...</span>
  <button class="refresh-btn" onclick="loadAll()">⟳ Refresh</button>
</div>

<div class="cards" id="cards">
  <div class="card"><div class="indicator unknown"></div><h3>Liveness</h3><div class="value">—</div></div>
  <div class="card"><div class="indicator unknown"></div><h3>Chat</h3><div class="value">—</div></div>
  <div class="card"><div class="indicator unknown"></div><h3>Memory</h3><div class="value">—</div></div>
</div>

<div class="section">
  <h2>📊 Last 24 Hours</h2>
  <div class="timeline" id="timeline"><div style="color:#484f58">Loading timeline...</div></div>
</div>

<div class="section">
  <h2>📋 Recent Checks</h2>
  <table class="log-table" id="logTable">
    <thead><tr><th>Time</th><th>Status</th><th>Liveness</th><th>Chat</th><th>Memory</th></tr></thead>
    <tbody id="logBody"><tr><td colspan="5" style="color:#484f58">Loading...</td></tr></tbody>
  </table>
</div>

<div class="tooltip" id="tooltip"></div>
<div class="meta" id="meta"></div>

<script>
const badge = document.getElementById('statusBadge');
const cards = document.getElementById('cards');
const logBody = document.getElementById('logBody');
const timeline = document.getElementById('timeline');
const tooltip = document.getElementById('tooltip');
const meta = document.getElementById('meta');

function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function fmtMs(ms) { return ms > 0 ? ms + 'ms' : '—'; }

function renderCard(name, check) {
  const ok = check?.ok;
  const cls = ok === true ? 'ok' : ok === false ? 'fail' : 'unknown';
  let detail = fmtMs(check?.latencyMs || 0);
  if (check?.count !== undefined) detail += ' · ' + check.count + ' entries';
  let err = check?.error ? '<div class="error">⚠ ' + check.error + '</div>' : '';
  return '<div class="card"><div class="indicator ' + cls + '"></div>'
    + '<h3>' + name + '</h3>'
    + '<div class="value" style="color:' + (ok ? '#3fb950' : ok === false ? '#f85149' : '#8b949e') + '">'
    + (ok ? '✓ OK' : ok === false ? '✗ FAIL' : '—') + '</div>'
    + '<div class="detail">' + detail + '</div>' + err + '</div>';
}

async function loadLatest() {
  try {
    const res = await fetch('/health');
    if (!res.ok) throw new Error('No data');
    const r = await res.json();
    badge.textContent = r.status.toUpperCase();
    badge.className = 'badge ' + r.status;
    cards.innerHTML = renderCard('Liveness', r.checks.liveness)
      + renderCard('Chat', r.checks.chat)
      + renderCard('Memory', r.checks.memory);
    meta.textContent = 'Last check: ' + fmtTime(r.timestamp) + ' · Auto-refresh every 60s';
  } catch {
    badge.textContent = 'NO DATA';
    badge.className = 'badge loading';
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/health/history?hours=24');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.length) { timeline.innerHTML = '<div style="color:#484f58">No history yet</div>'; return; }

    // Timeline: one row per check dimension
    const dims = ['liveness', 'chat', 'memory'];
    let html = '';
    for (const dim of dims) {
      html += '<div class="timeline-row"><span class="timeline-label">' + dim + '</span><div class="timeline-cells">';
      for (const r of data.slice(0, 48)) {
        const c = r.checks?.[dim];
        const cls = c ? (c.ok ? 'healthy' : 'down') : 'empty';
        const tip = fmtTime(r.timestamp) + ' · ' + dim + ': ' + (c?.ok ? 'OK' : c?.error || 'fail') + ' · ' + fmtMs(c?.latencyMs || 0);
        html += '<div class="timeline-cell ' + cls + '" data-tip="' + tip.replace(/"/g,'&quot;') + '"></div>';
      }
      html += '</div></div>';
    }
    timeline.innerHTML = html;

    // Log table (newest first, max 20)
    logBody.innerHTML = data.slice(0, 20).map(r => {
      const t = fmtTime(r.timestamp);
      const dot = '<span class="status-dot ' + r.status + '"></span>';
      const ck = (c) => c?.ok ? '<span style="color:#3fb950">' + fmtMs(c.latencyMs) + '</span>'
        : '<span style="color:#f85149">' + (c?.error || 'fail') + '</span>';
      return '<tr><td>' + t + '</td><td>' + dot + r.status + '</td>'
        + '<td>' + ck(r.checks?.liveness) + '</td>'
        + '<td>' + ck(r.checks?.chat) + '</td>'
        + '<td>' + ck(r.checks?.memory) + '</td></tr>';
    }).join('');

    // Tooltip on hover
    timeline.querySelectorAll('.timeline-cell[data-tip]').forEach(el => {
      el.addEventListener('mouseenter', e => {
        tooltip.textContent = el.dataset.tip;
        tooltip.style.left = e.clientX + 12 + 'px';
        tooltip.style.top = e.clientY + 12 + 'px';
        tooltip.classList.add('visible');
      });
      el.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
    });
  } catch {
    timeline.innerHTML = '<div style="color:#484f58">Failed to load history</div>';
  }
}

function loadAll() { loadLatest(); loadHistory(); }
loadAll();
setInterval(loadLatest, 60000);
setInterval(loadHistory, 300000);
</script>
</body>
</html>`;
}
