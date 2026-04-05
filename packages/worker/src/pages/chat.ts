/**
 * Chat page — JWT-authenticated chat UI for a specific agent
 *
 * Auth flow:
 *  1. Check localStorage for uncaged_access_token
 *  2. Verify via /auth/session → get user info
 *  3. If expired → POST /auth/refresh with refresh token
 *  4. If refresh fails → redirect to /auth/login
 *
 * Messages are sent to /:owner/:agent/api/chat
 */

export function getChatPageHTML(
  agentSlug: string,
  ownerSlug: string,
  agentDisplayName?: string,
): string {
  const displayName = agentDisplayName || agentSlug
  const basePath = `/${ownerSlug}/${agentSlug}`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${displayName} — Uncaged</title>
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="${displayName}">
  <meta name="theme-color" content="#fbbf24">
  <link rel="manifest" href="${basePath}/manifest.json">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{
      --bg:#0a0a0a;--surface:#111;--surface2:#1f2937;--border:#374151;
      --text:#fff;--text2:#d1d5db;--text3:#9ca3af;--text4:#6b7280;
      --accent:#fbbf24;--accent2:#f59e0b;--user-bg:#1e40af;--danger:#dc2626;
      --safe-top:env(safe-area-inset-top);--safe-bottom:env(safe-area-inset-bottom);
    }
    html,body{height:100%}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:var(--bg);color:var(--text);
      display:flex;flex-direction:column;height:100%;
      padding-top:var(--safe-top);
    }

    /* ─── Header ─── */
    .header{
      background:var(--surface);border-bottom:1px solid var(--border);
      padding:0.75rem 1rem;display:flex;align-items:center;
      justify-content:space-between;flex-shrink:0;z-index:10;
    }
    .header-left{display:flex;align-items:center;gap:0.5rem}
    .agent-icon{font-size:1.5rem}
    .agent-name{
      font-size:1.1rem;font-weight:700;
      background:linear-gradient(135deg,var(--accent),var(--accent2));
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
    }
    .header-right{display:flex;align-items:center;gap:0.75rem}
    .user-chip{
      display:flex;align-items:center;gap:0.4rem;
      background:var(--surface2);border-radius:20px;padding:0.3rem 0.6rem 0.3rem 0.3rem;
    }
    .user-avatar{width:24px;height:24px;border-radius:50%;background:var(--border)}
    .user-display{font-size:0.8rem;color:var(--text2);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .logout-btn{
      background:none;border:1px solid var(--border);color:var(--text3);
      padding:0.35rem 0.6rem;border-radius:8px;font-size:0.8rem;
      cursor:pointer;transition:all .2s;
    }
    .logout-btn:hover{border-color:var(--danger);color:var(--danger)}

    /* ─── Messages ─── */
    .messages{
      flex:1;overflow-y:auto;padding:1rem;
      display:flex;flex-direction:column;gap:1rem;
      -webkit-overflow-scrolling:touch;
    }
    .msg{display:flex;gap:0.5rem;max-width:85%;animation:fadeIn .2s}
    @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
    .msg.user{align-self:flex-end;flex-direction:row-reverse}
    .msg-avatar{
      width:32px;height:32px;border-radius:50%;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      font-size:1.2rem;background:var(--surface2);
    }
    .msg-body{display:flex;flex-direction:column;gap:0.2rem}
    .msg.user .msg-body{align-items:flex-end}
    .msg-bubble{
      border-radius:16px;padding:0.7rem 1rem;
      line-height:1.6;word-break:break-word;
      font-size:0.95rem;
    }
    .msg.user .msg-bubble{background:var(--user-bg);border-bottom-right-radius:4px}
    .msg.assistant .msg-bubble{background:var(--surface2);border:1px solid var(--border);border-bottom-left-radius:4px}
    .msg-time{font-size:0.7rem;color:var(--text4);padding:0 0.25rem}
    .msg-bubble code{
      background:rgba(255,255,255,.1);padding:0.15rem 0.35rem;
      border-radius:4px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:0.88em;
    }
    .msg-bubble pre{
      background:#000;padding:0.75rem;border-radius:8px;
      overflow-x:auto;margin:0.5rem 0;font-size:0.85rem;
    }
    .msg-bubble pre code{background:none;padding:0}
    .msg-bubble a{color:var(--accent);text-decoration:underline}
    .msg-bubble strong{font-weight:700}
    .msg-bubble em{font-style:italic}

    /* Tool call collapsible */
    .tool-call{
      border:1px solid var(--border);border-radius:8px;margin:0.5rem 0;
      overflow:hidden;
    }
    .tool-call-header{
      background:var(--surface);padding:0.5rem 0.75rem;
      cursor:pointer;display:flex;align-items:center;gap:0.5rem;
      font-size:0.85rem;color:var(--text3);user-select:none;
    }
    .tool-call-header:hover{background:var(--surface2)}
    .tool-call-arrow{transition:transform .2s;font-size:0.7rem}
    .tool-call.open .tool-call-arrow{transform:rotate(90deg)}
    .tool-call-body{
      display:none;padding:0.5rem 0.75rem;border-top:1px solid var(--border);
      font-size:0.85rem;color:var(--text2);white-space:pre-wrap;word-break:break-all;
    }
    .tool-call.open .tool-call-body{display:block}

    /* ─── Loading indicator ─── */
    .typing{display:flex;align-items:center;gap:0.4rem;padding:0.7rem 1rem}
    .typing-dot{
      width:6px;height:6px;background:var(--text3);border-radius:50%;
      animation:bounce 1.4s infinite ease-in-out both;
    }
    .typing-dot:nth-child(1){animation-delay:-0.32s}
    .typing-dot:nth-child(2){animation-delay:-0.16s}
    @keyframes bounce{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}

    /* ─── Input ─── */
    .input-area{
      background:var(--surface);border-top:1px solid var(--border);
      padding:0.75rem 1rem;padding-bottom:calc(0.75rem + var(--safe-bottom));
      flex-shrink:0;
    }
    .input-row{display:flex;gap:0.5rem;max-width:800px;margin:0 auto}
    .msg-input{
      flex:1;background:var(--surface2);border:1px solid var(--border);
      border-radius:22px;padding:0.65rem 1rem;color:var(--text);
      font-size:1rem;outline:none;resize:none;
      max-height:120px;line-height:1.4;
      transition:border-color .2s;
    }
    .msg-input:focus{border-color:var(--accent)}
    .msg-input::placeholder{color:var(--text4)}
    .send-btn{
      width:42px;height:42px;border-radius:50%;border:none;
      background:var(--accent);color:var(--bg);
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      font-size:1.1rem;transition:all .2s;flex-shrink:0;align-self:flex-end;
    }
    .send-btn:hover:not(:disabled){background:var(--accent2);transform:scale(1.05)}
    .send-btn:disabled{background:var(--text4);cursor:not-allowed;transform:none}

    /* ─── Auth overlay ─── */
    .auth-overlay{
      position:fixed;inset:0;background:var(--bg);
      display:flex;align-items:center;justify-content:center;
      z-index:100;
    }
    .auth-overlay .spinner{
      width:32px;height:32px;border:3px solid var(--border);
      border-top-color:var(--accent);border-radius:50%;
      animation:spin .7s linear infinite;
    }
    @keyframes spin{to{transform:rotate(360deg)}}
    .auth-overlay.hidden{display:none}

    @media(max-width:600px){
      .msg{max-width:92%}
      .user-display{display:none}
    }
  </style>
</head>
<body>
  <!-- Auth loading overlay -->
  <div class="auth-overlay" id="authOverlay">
    <div class="spinner"></div>
  </div>

  <div class="header">
    <div class="header-left">
      <span class="agent-icon">🔓</span>
      <span class="agent-name">${displayName}</span>
    </div>
    <div class="header-right">
      <div class="user-chip" id="userChip" style="display:none">
        <div class="user-avatar" id="userAvatar"></div>
        <span class="user-display" id="userDisplay"></span>
      </div>
      <button class="logout-btn" onclick="logout()">登出</button>
    </div>
  </div>

  <div class="messages" id="messages"></div>

  <div class="input-area">
    <div class="input-row">
      <textarea class="msg-input" id="msgInput" rows="1" placeholder="输入消息…" maxlength="4000"></textarea>
      <button class="send-btn" id="sendBtn" onclick="sendMessage()">➤</button>
    </div>
  </div>

  <script>
    const BASE = ${JSON.stringify(basePath)};
    const AGENT_NAME = ${JSON.stringify(displayName)};
    let accessToken = null;
    let refreshTokenStr = null;
    let isLoading = false;
    const messagesEl = document.getElementById('messages');
    const msgInput = document.getElementById('msgInput');
    const sendBtn = document.getElementById('sendBtn');
    const authOverlay = document.getElementById('authOverlay');

    // ─── Auth ───
    async function initAuth() {
      accessToken = localStorage.getItem('uncaged_access_token');
      refreshTokenStr = localStorage.getItem('uncaged_refresh_token');
      if (!accessToken) return redirectLogin();
      const ok = await checkSession();
      if (!ok) return redirectLogin();
      authOverlay.classList.add('hidden');
      loadHistory();
    }

    async function checkSession() {
      try {
        const r = await fetch('/auth/session', {
          headers: { 'Authorization': 'Bearer ' + accessToken },
        });
        if (r.ok) {
          const data = await r.json();
          setUserInfo(data.user);
          return true;
        }
        if (r.status === 401) return await tryRefresh();
        return false;
      } catch { return false; }
    }

    async function tryRefresh() {
      if (!refreshTokenStr) return false;
      try {
        const r = await fetch('/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refreshTokenStr }),
        });
        if (!r.ok) return false;
        const data = await r.json();
        accessToken = data.accessToken;
        localStorage.setItem('uncaged_access_token', accessToken);
        return await checkSession();
      } catch { return false; }
    }

    function setUserInfo(user) {
      const chip = document.getElementById('userChip');
      const avatar = document.getElementById('userAvatar');
      const display = document.getElementById('userDisplay');
      display.textContent = user.displayName || user.slug || '';
      chip.style.display = 'flex';
    }

    function redirectLogin() {
      localStorage.removeItem('uncaged_access_token');
      localStorage.removeItem('uncaged_refresh_token');
      window.location.href = '/auth/login';
    }

    async function logout() {
      try {
        await fetch('/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refreshTokenStr }),
        });
      } catch {}
      localStorage.removeItem('uncaged_access_token');
      localStorage.removeItem('uncaged_refresh_token');
      window.location.href = '/auth/login';
    }

    // ─── Authed fetch ───
    async function authedFetch(url, opts = {}) {
      opts.headers = opts.headers || {};
      opts.headers['Authorization'] = 'Bearer ' + accessToken;
      let r = await fetch(url, opts);
      if (r.status === 401) {
        const refreshed = await tryRefresh();
        if (!refreshed) { redirectLogin(); throw new Error('auth'); }
        opts.headers['Authorization'] = 'Bearer ' + accessToken;
        r = await fetch(url, opts);
      }
      return r;
    }

    // ─── Messages ───
    function scrollBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function timeStr(d) {
      return new Date(d).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' });
    }

    function escapeHtml(s) {
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    }

    function renderMarkdown(text) {
      let html = escapeHtml(text);
      // Code blocks
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, code) {
        return '<pre><code>' + code.trim() + '</code></pre>';
      });
      // Inline code
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      // Bold
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // Italic
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      // Links
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      // Newlines
      html = html.replace(/\\n/g, '<br>');
      return html;
    }

    function renderContent(content) {
      if (typeof content === 'string') return renderMarkdown(content);
      // Array of content parts
      if (Array.isArray(content)) {
        return content.map(function(part) {
          if (part.type === 'text') return renderMarkdown(part.text || '');
          if (part.type === 'tool_use') {
            return '<div class="tool-call" onclick="this.classList.toggle(\\'open\\')">' +
              '<div class="tool-call-header"><span class="tool-call-arrow">▶</span>🔧 ' +
              escapeHtml(part.name || 'tool') + '</div>' +
              '<div class="tool-call-body">' + escapeHtml(JSON.stringify(part.input, null, 2)) + '</div></div>';
          }
          if (part.type === 'tool_result') {
            return '<div class="tool-call" onclick="this.classList.toggle(\\'open\\')">' +
              '<div class="tool-call-header"><span class="tool-call-arrow">▶</span>📋 结果</div>' +
              '<div class="tool-call-body">' + escapeHtml(typeof part.content === 'string' ? part.content : JSON.stringify(part.content, null, 2)) + '</div></div>';
          }
          return '';
        }).join('');
      }
      return '';
    }

    function addMessage(role, content, ts) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      const t = timeStr(ts || Date.now());
      if (role === 'user') {
        div.innerHTML =
          '<div class="msg-avatar">👤</div>' +
          '<div class="msg-body"><div class="msg-bubble">' + escapeHtml(content) + '</div>' +
          '<div class="msg-time">' + t + '</div></div>';
      } else {
        div.innerHTML =
          '<div class="msg-avatar">🔓</div>' +
          '<div class="msg-body"><div class="msg-bubble">' + renderContent(content) + '</div>' +
          '<div class="msg-time">' + t + '</div></div>';
      }
      messagesEl.appendChild(div);
      scrollBottom();
    }

    function showTyping() {
      const div = document.createElement('div');
      div.className = 'msg assistant';
      div.id = 'typing';
      div.innerHTML =
        '<div class="msg-avatar">🔓</div>' +
        '<div class="msg-body"><div class="msg-bubble"><div class="typing">' +
        '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>' +
        '</div></div></div>';
      messagesEl.appendChild(div);
      scrollBottom();
    }

    function hideTyping() {
      const el = document.getElementById('typing');
      if (el) el.remove();
    }

    // ─── Send ───
    async function sendMessage() {
      if (isLoading) return;
      const text = msgInput.value.trim();
      if (!text) return;
      msgInput.value = '';
      autoResize();
      addMessage('user', text);
      isLoading = true;
      sendBtn.disabled = true;
      msgInput.disabled = true;
      showTyping();
      try {
        const r = await authedFetch(BASE + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        hideTyping();
        if (!r.ok) throw new Error('请求失败');
        const data = await r.json();
        addMessage('assistant', data.response, data.timestamp);
      } catch (e) {
        hideTyping();
        if (e.message !== 'auth') {
          addMessage('assistant', '抱歉，遇到了问题，请稍后重试 😥');
        }
      } finally {
        isLoading = false;
        sendBtn.disabled = false;
        msgInput.disabled = false;
        msgInput.focus();
      }
    }

    // ─── Load history ───
    async function loadHistory() {
      try {
        const r = await authedFetch(BASE + '/api/history');
        if (!r.ok) return;
        const data = await r.json();
        (data.history || []).forEach(function(msg) {
          addMessage(msg.role, msg.content, msg.timestamp || Date.now());
        });
      } catch {}
    }

    // ─── Auto-resize textarea ───
    function autoResize() {
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
    }
    msgInput.addEventListener('input', autoResize);
    msgInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // ─── Init ───
    initAuth();
  </script>
</body>
</html>`
}
