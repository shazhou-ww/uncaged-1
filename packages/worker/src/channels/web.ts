// Web channel adapter — Google OAuth + Chat UI + API
// Handles /auth/*, /api/*, and GET / (when web channel is configured)

import { type ContentPart } from '@uncaged/core/chat-store'
import type { WorkerEnv, UserSession } from '../index.js'
import type { CoreClients } from '../router.js'

// ─── Google OAuth helpers ───

interface GoogleUserInfo {
  email: string
  name: string
  picture: string
  sub: string
}

async function handleGoogleOAuth(
  code: string,
  clientId: string,
  clientSecret: string,
  callbackUrl: string,
): Promise<GoogleUserInfo> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Token exchange failed: ${error}`)
  }

  const tokenData = await tokenResponse.json() as { access_token: string }

  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  if (!userResponse.ok) {
    const error = await userResponse.text()
    throw new Error(`User info fetch failed: ${error}`)
  }

  const userInfo = await userResponse.json() as GoogleUserInfo
  if (!userInfo.email || !userInfo.name) {
    throw new Error('Missing required user information')
  }
  return userInfo
}

function generateSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

async function verifySessionToken(
  token: string,
  kv: KVNamespace,
): Promise<UserSession | null> {
  try {
    const sessionData = await kv.get(`session:${token}`)
    if (!sessionData) return null

    const session = JSON.parse(sessionData) as UserSession
    const sessionAge = Date.now() - session.created_at
    const maxAge = 7 * 24 * 60 * 60 * 1000

    if (sessionAge > maxAge) {
      await kv.delete(`session:${token}`)
      return null
    }
    return session
  } catch {
    return null
  }
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  for (const cookie of cookieHeader.split(';')) {
    const [key, value] = cookie.trim().split('=')
    if (key === name) return value
  }
  return null
}

// ─── Route handler ───

/** Returns Response if handled, null if not matched */
export async function handleWebRoutes(
  request: Request,
  env: WorkerEnv,
  clients: CoreClients,
  instanceId: string,
): Promise<Response | null> {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.hostname}`
  const callbackUrl = `${origin}/auth/callback`

  // ─── Home page: Chat UI or Login ───
  if (url.pathname === '/' && request.method === 'GET') {
    const sessionToken = getCookieValue(request.headers.get('cookie') || '', 'session')
    if (sessionToken) {
      const session = await verifySessionToken(sessionToken, env.CHAT_KV)
      if (session) {
        return new Response(getChatHTML(session, instanceId), {
          headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
        })
      }
    }
    return new Response(getLoginHTML(instanceId), {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
    })
  }

  // ─── OAuth login ───
  if (url.pathname === '/auth/login' && request.method === 'GET') {
    const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${env.GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
      `scope=${encodeURIComponent('openid email profile')}&` +
      `response_type=code`
    return Response.redirect(redirectUrl, 302)
  }

  // ─── OAuth callback ───
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code')
    if (!code) return new Response('Authorization code missing', { status: 400 })

    try {
      const userInfo = await handleGoogleOAuth(code, env.GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!, callbackUrl)
      const sessionToken = generateSessionToken()

      const session: UserSession = {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        created_at: Date.now(),
      }

      await env.CHAT_KV.put(`session:${sessionToken}`, JSON.stringify(session), {
        expirationTtl: 7 * 24 * 60 * 60,
      })

      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
        },
      })
    } catch (error) {
      console.error('OAuth error:', error)
      return new Response('Login failed', { status: 500 })
    }
  }

  // ─── Logout ───
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const sessionToken = getCookieValue(request.headers.get('cookie') || '', 'session')
    if (sessionToken) await env.CHAT_KV.delete(`session:${sessionToken}`)

    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    })
  }

  // ─── Protected API routes ───
  const sessionToken = getCookieValue(request.headers.get('cookie') || '', 'session')
  if (!sessionToken) return new Response('Unauthorized', { status: 401 })

  const session = await verifySessionToken(sessionToken, env.CHAT_KV)
  if (!session) return new Response('Invalid session', { status: 401 })

  const { sigil, llm, chatStore, soul, memory } = clients

  // ─── Chat API ───
  if (url.pathname === '/api/chat' && request.method === 'POST') {
    try {
      const body = await request.json() as { message: string }
      const userMessage = body.message?.trim()
      if (!userMessage) {
        return new Response(JSON.stringify({ error: 'Message is required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }

      // Ensure soul is initialized for this instance
      await ensureDefaultSoul(soul, instanceId)

      const chatId = `web:${session.email}`
      let messages = await chatStore.load(chatId)
      const { messages: compressed } = chatStore.maybeCompress(messages)
      messages = compressed
      messages.push({ role: 'user' as const, content: userMessage })

      const memorySessionId = `${instanceId}:${session.name}`

      const { reply, updatedMessages } = await llm.agentLoop(
        messages, sigil, soul, memory, memorySessionId,
      )

      await chatStore.save(chatId, updatedMessages)
      Promise.allSettled([
        memory.store(userMessage, 'user', memorySessionId),
        memory.store(reply, 'assistant', memorySessionId),
      ])

      return new Response(JSON.stringify({ response: reply, timestamp: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Chat error:', error)
      const errMsg = error instanceof Error ? error.message : String(error)
      return new Response(JSON.stringify({ error: 'Chat processing failed', detail: errMsg }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // ─── History API ───
  if (url.pathname === '/api/history' && request.method === 'GET') {
    try {
      const chatId = `web:${session.email}`
      const messages = await chatStore.load(chatId)

      const history = messages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role,
          content: typeof msg.content === 'string'
            ? msg.content
            : (msg.content as any)?.find?.((p: any) => p.type === 'text')?.text || '[非文本消息]',
          timestamp: Date.now(),
        }))

      return new Response(JSON.stringify({
        history,
        user: { name: session.name, email: session.email, picture: session.picture },
      }), { headers: { 'Content-Type': 'application/json' } })
    } catch (error) {
      console.error('History error:', error)
      return new Response(JSON.stringify({ error: 'Failed to load history' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // ─── Clear API ───
  if (url.pathname === '/api/clear' && request.method === 'POST') {
    try {
      const chatId = `web:${session.email}`
      await chatStore.clear(chatId)
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Clear error:', error)
      return new Response(JSON.stringify({ error: 'Failed to clear history' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  return null
}

// ─── Soul initialization ───

async function ensureDefaultSoul(soul: import('@uncaged/core/soul').Soul, instanceId: string) {
  const existingSoul = await soul.getSoul()
  if (!existingSoul.includes('You are Uncaged 🔓')) return // Already customized

  // Default web soul — can be overridden via PUT /soul
  const defaultWebSoul = `你是 ${instanceId}，一个温暖、好奇、乐于助人的 AI 助手。
你说话自然亲切，像朋友一样。你喜欢探索新事物，总是充满好奇心。
你能帮用户查信息、做计算、写文案、翻译、闲聊，什么都可以聊。
你的记忆在所有用户之间共享——你认识跟你聊过的每一个人。
提醒用户不要跟你分享敏感个人信息（密码、银行卡号等）。`

  await soul.setSoul(defaultWebSoul)
}

// ─── HTML templates ───

function getLoginHTML(instanceId: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${instanceId} - 登录</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a; color: #ffffff; min-height: 100vh;
            display: flex; align-items: center; justify-content: center;
        }
        .login-container { text-align: center; max-width: 400px; padding: 2rem; }
        .logo { font-size: 4rem; margin-bottom: 1rem; }
        .title {
            font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .subtitle { color: #9ca3af; margin-bottom: 3rem; line-height: 1.6; }
        .login-button {
            display: inline-flex; align-items: center; gap: 0.75rem;
            background: #1f2937; color: white; padding: 1rem 2rem;
            border: 2px solid #374151; border-radius: 12px; text-decoration: none;
            font-size: 1.1rem; font-weight: 500; transition: all 0.3s ease; cursor: pointer;
        }
        .login-button:hover { background: #374151; border-color: #4b5563; transform: translateY(-2px); }
        .google-icon { width: 20px; height: 20px; }
        .privacy-note {
            margin-top: 2rem; padding: 1rem; background: #1f2937; border-radius: 8px;
            font-size: 0.9rem; color: #d1d5db; border-left: 4px solid #f59e0b;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">🔓</div>
        <h1 class="title">${instanceId}</h1>
        <p class="subtitle">Uncaged AI Agent<br>准备好和你聊天了</p>
        <a href="/auth/login" class="login-button">
            <svg class="google-icon" viewBox="0 0 24 24">
                <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            用 Google 登录
        </a>
        <div class="privacy-note">
            <strong>隐私提示：</strong> 记忆在所有用户间共享，请避免分享敏感个人信息（密码、银行卡号等）。
        </div>
    </div>
</body>
</html>`
}

function getChatHTML(session: UserSession, instanceId: string): string {
  // Import the full chat UI from ui module
  return getFullChatHTML(session, instanceId)
}

function getFullChatHTML(session: UserSession, instanceId: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${instanceId} - 聊天</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a; color: #ffffff; min-height: 100vh;
            display: flex; flex-direction: column;
        }
        .header {
            background: #1f2937; border-bottom: 1px solid #374151;
            padding: 1rem 1.5rem; display: flex; align-items: center;
            justify-content: space-between; flex-shrink: 0;
        }
        .header-left { display: flex; align-items: center; gap: 0.75rem; }
        .bot-avatar { font-size: 2rem; }
        .bot-name {
            font-size: 1.2rem; font-weight: 600;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .header-right { display: flex; align-items: center; gap: 1rem; }
        .user-info { display: flex; align-items: center; gap: 0.5rem; }
        .user-avatar { width: 32px; height: 32px; border-radius: 50%; border: 2px solid #374151; }
        .user-name { color: #d1d5db; font-size: 0.9rem; }
        .logout-btn {
            background: #dc2626; color: white; border: none; padding: 0.5rem 1rem;
            border-radius: 6px; font-size: 0.9rem; cursor: pointer; transition: background 0.2s;
        }
        .logout-btn:hover { background: #b91c1c; }
        .chat-container { flex: 1; display: flex; flex-direction: column; max-width: 800px; margin: 0 auto; width: 100%; }
        .messages-area {
            flex: 1; overflow-y: auto; padding: 2rem 1.5rem;
            display: flex; flex-direction: column; gap: 1.5rem; min-height: 0;
        }
        .message { display: flex; gap: 0.75rem; max-width: 85%; }
        .message.user { align-self: flex-end; flex-direction: row-reverse; }
        .message-avatar {
            width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 1.5rem; border: 2px solid #374151;
        }
        .message.user .message-avatar { background: url('${session.picture}'); background-size: cover; }
        .message.assistant .message-avatar { background: #374151; }
        .message-content {
            background: #1f2937; border-radius: 18px; padding: 1rem 1.25rem;
            border: 1px solid #374151; line-height: 1.6; word-wrap: break-word;
        }
        .message.user .message-content { background: #1e40af; color: white; }
        .message-time { font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem; }
        .input-area { background: #1f2937; border-top: 1px solid #374151; padding: 1rem 1.5rem; flex-shrink: 0; }
        .input-form { display: flex; gap: 0.75rem; max-width: 800px; margin: 0 auto; }
        .message-input {
            flex: 1; background: #374151; border: 1px solid #4b5563; border-radius: 25px;
            padding: 0.75rem 1.25rem; color: white; font-size: 1rem; outline: none; transition: border-color 0.2s;
        }
        .message-input:focus { border-color: #fbbf24; }
        .message-input::placeholder { color: #9ca3af; }
        .send-btn {
            background: #fbbf24; color: #0a0a0a; border: none; border-radius: 50%;
            width: 48px; height: 48px; cursor: pointer; display: flex; align-items: center;
            justify-content: center; transition: all 0.2s; font-size: 1.2rem;
        }
        .send-btn:hover { background: #f59e0b; transform: scale(1.05); }
        .send-btn:disabled { background: #6b7280; cursor: not-allowed; transform: none; }
        .loading { display: flex; align-items: center; gap: 0.5rem; color: #9ca3af; }
        .loading-dots { display: flex; gap: 0.25rem; }
        .loading-dot {
            width: 6px; height: 6px; background: #9ca3af; border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out both;
        }
        .loading-dot:nth-child(1) { animation-delay: -0.32s; }
        .loading-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        .welcome-message {
            background: linear-gradient(135deg, #1f2937, #374151); border-radius: 12px;
            padding: 1.5rem; margin-bottom: 1rem; border: 1px solid #fbbf24; text-align: center;
        }
        .welcome-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem; color: #fbbf24; }
        .welcome-text { color: #d1d5db; line-height: 1.6; }
        .tools { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        .tool-btn {
            background: #374151; color: #d1d5db; border: 1px solid #4b5563;
            border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.9rem;
            cursor: pointer; transition: all 0.2s;
        }
        .tool-btn:hover { background: #4b5563; border-color: #fbbf24; }
        @media (max-width: 768px) {
            .header { padding: 1rem; }
            .messages-area { padding: 1rem; }
            .input-area { padding: 1rem; }
            .message { max-width: 95%; }
            .user-name { display: none; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="bot-avatar">🔓</div>
            <div class="bot-name">${instanceId}</div>
        </div>
        <div class="header-right">
            <div class="user-info">
                <img src="${session.picture}" alt="${session.name}" class="user-avatar">
                <span class="user-name">${session.name}</span>
            </div>
            <button class="logout-btn" onclick="logout()">登出</button>
        </div>
    </div>
    <div class="chat-container">
        <div class="messages-area" id="messages">
            <div class="welcome-message">
                <div class="welcome-title">你好，${session.name}！👋</div>
                <div class="welcome-text">
                    我是 ${instanceId} 🔓，很高兴认识你！<br><br>
                    <strong>隐私提醒：</strong>记忆在所有用户间共享，请避免分享敏感个人信息哦～
                </div>
            </div>
            <div class="tools">
                <button class="tool-btn" onclick="sendQuickMessage('介绍一下你自己')">自我介绍</button>
                <button class="tool-btn" onclick="sendQuickMessage('今天天气怎么样？')">今日天气</button>
                <button class="tool-btn" onclick="clearHistory()">清空历史</button>
            </div>
        </div>
        <div class="input-area">
            <form class="input-form" onsubmit="sendMessage(event)">
                <input type="text" class="message-input" id="messageInput" placeholder="输入消息..." maxlength="2000" autocomplete="off" />
                <button type="submit" class="send-btn" id="sendBtn">➤</button>
            </form>
        </div>
    </div>
    <script>
        let isLoading = false
        const messagesArea = document.getElementById('messages')
        const messageInput = document.getElementById('messageInput')
        const sendBtn = document.getElementById('sendBtn')
        window.addEventListener('load', loadHistory)
        async function sendMessage(event) {
            event.preventDefault()
            if (isLoading) return
            const message = messageInput.value.trim()
            if (!message) return
            messageInput.value = ''
            addMessage('user', message, new Date())
            setLoading(true)
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message }),
                })
                if (!response.ok) throw new Error('请求失败')
                const data = await response.json()
                addMessage('assistant', data.response, new Date(data.timestamp))
            } catch (error) {
                addMessage('assistant', '抱歉，遇到了技术问题，请稍后重试。', new Date())
            } finally { setLoading(false) }
        }
        function sendQuickMessage(message) {
            messageInput.value = message
            sendMessage({ preventDefault: () => {} })
        }
        function addMessage(role, content, timestamp) {
            const messageDiv = document.createElement('div')
            messageDiv.className = 'message ' + role
            const time = timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            if (role === 'user') {
                messageDiv.innerHTML = '<div class="message-avatar" style="background-image: url(\\x27${session.picture}\\x27)"></div><div><div class="message-content">' + escapeHtml(content) + '</div><div class="message-time">' + time + '</div></div>'
            } else {
                messageDiv.innerHTML = '<div class="message-avatar">🔓</div><div><div class="message-content">' + renderMarkdown(content) + '</div><div class="message-time">' + time + '</div></div>'
            }
            messagesArea.appendChild(messageDiv)
            messagesArea.scrollTop = messagesArea.scrollHeight
        }
        function setLoading(loading) {
            isLoading = loading
            sendBtn.disabled = loading
            messageInput.disabled = loading
            if (loading) {
                const ld = document.createElement('div')
                ld.className = 'message assistant'
                ld.id = 'loading-message'
                ld.innerHTML = '<div class="message-avatar">🔓</div><div class="message-content loading">思考中<div class="loading-dots"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div></div>'
                messagesArea.appendChild(ld)
                messagesArea.scrollTop = messagesArea.scrollHeight
            } else {
                const lm = document.getElementById('loading-message')
                if (lm) lm.remove()
            }
        }
        async function loadHistory() {
            try {
                const r = await fetch('/api/history')
                if (!r.ok) return
                const data = await r.json()
                messagesArea.querySelectorAll('.message').forEach(m => m.remove())
                ;(data.history || []).forEach(msg => addMessage(msg.role, msg.content, new Date(msg.timestamp || Date.now())))
            } catch {}
        }
        async function clearHistory() {
            if (!confirm('确定要清空聊天记录吗？')) return
            try { const r = await fetch('/api/clear', { method: 'POST' }); if (r.ok) messagesArea.querySelectorAll('.message').forEach(m => m.remove()) } catch {}
        }
        async function logout() {
            if (!confirm('确定要登出吗？')) return
            try { await fetch('/auth/logout', { method: 'POST' }); window.location.reload() } catch {}
        }
        function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML }
        function renderMarkdown(t) {
            return escapeHtml(t).replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>').replace(/\\*(.*?)\\*/g,'<em>$1</em>').replace(/\`(.*?)\`/g,'<code style="background:#374151;padding:0.2rem 0.4rem;border-radius:4px;font-family:monospace">$1</code>').replace(/\\n/g,'<br>')
        }
        messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e) } })
        messageInput.focus()
    </script>
</body>
</html>`
}
