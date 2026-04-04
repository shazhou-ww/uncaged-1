// Xiaomai instance - Web Chat implementation of Uncaged

import { 
  SigilClient 
} from '@uncaged/core/sigil'
import { 
  LlmClient 
} from '@uncaged/core/llm'
import { 
  ChatStore, 
  type ContentPart 
} from '@uncaged/core/chat-store'
import { 
  Soul 
} from '@uncaged/core/soul'
import { 
  Memory 
} from '@uncaged/core/memory'
import type { Env } from '@uncaged/core/env'
import { handleGoogleOAuth, generateSessionToken, verifySessionToken } from './auth.js'
import { getChatHTML } from './ui.js'

// Xiaomai-specific environment (extends core Env)
export interface XiaomaiEnv extends Env {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string  // 用于签名 session token
}

// Session 接口
export interface UserSession {
  email: string
  name: string
  picture: string
  created_at: number
}

export default {
  async fetch(request: Request, env: XiaomaiEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const instanceId = env.INSTANCE_ID || 'xiaomai'

    // Health check
    if (url.pathname === '/' && request.method === 'GET') {
      // 检查是否已登录
      const sessionToken = getCookieValue(request.headers.get('cookie') || '', 'xiaomai_session')
      if (sessionToken) {
        const session = await verifySessionToken(sessionToken, env.CHAT_KV, env.SESSION_SECRET)
        if (session) {
          // 已登录，返回聊天界面
          return new Response(getChatHTML(session), {
            headers: { 
              'Content-Type': 'text/html',
              'Cache-Control': 'no-cache'
            }
          })
        }
      }

      // 未登录，返回登录页面
      return new Response(getLoginHTML(), {
        headers: { 
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache'
        }
      })
    }

    // Google OAuth 登录
    if (url.pathname === '/auth/login' && request.method === 'GET') {
      const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${env.GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent('https://xiaomai.shazhou.work/auth/callback')}&` +
        `scope=${encodeURIComponent('openid email profile')}&` +
        `response_type=code`
      
      return Response.redirect(redirectUrl, 302)
    }

    // Google OAuth 回调
    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code')
      if (!code) {
        return new Response('Authorization code missing', { status: 400 })
      }

      try {
        const userInfo = await handleGoogleOAuth(code, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)
        const sessionToken = generateSessionToken()
        
        // 存储 session 到 KV (7天过期)
        const session: UserSession = {
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture,
          created_at: Date.now()
        }

        await env.CHAT_KV.put(`session:${sessionToken}`, JSON.stringify(session), {
          expirationTtl: 7 * 24 * 60 * 60  // 7天
        })

        // 设置 cookie 并重定向
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/',
            'Set-Cookie': `xiaomai_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
          }
        })
      } catch (error) {
        console.error('OAuth error:', error)
        return new Response('Login failed', { status: 500 })
      }
    }

    // 登出
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      const sessionToken = getCookieValue(request.headers.get('cookie') || '', 'xiaomai_session')
      if (sessionToken) {
        await env.CHAT_KV.delete(`session:${sessionToken}`)
      }

      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': 'xiaomai_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
        }
      })
    }

    // API 路由需要验证登录状态
    const sessionToken = getCookieValue(request.headers.get('cookie') || '', 'xiaomai_session')
    if (!sessionToken) {
      return new Response('Unauthorized', { status: 401 })
    }

    const session = await verifySessionToken(sessionToken, env.CHAT_KV, env.SESSION_SECRET)
    if (!session) {
      return new Response('Invalid session', { status: 401 })
    }

    // 聊天 API
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const body = await request.json() as { message: string }
        const userMessage = body.message?.trim()

        if (!userMessage) {
          return new Response(JSON.stringify({ error: 'Message is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        // 初始化 clients
        const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN)
        const llmClient = new LlmClient(
          env.DASHSCOPE_API_KEY,
          env.LLM_MODEL || undefined,
          env.LLM_BASE_URL || undefined,
        )
        llmClient.a2aToken = env.A2A_TOKEN
        const chatStore = new ChatStore(env.CHAT_KV)
        const soul = new Soul(env.CHAT_KV, instanceId)
        const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId, env.MEMORY_DB)

        // 确保小麦的 soul 已初始化
        await ensureXiaomaiSoul(soul)

        // 获取用户的聊天历史（使用 email 作为 chatId）
        const chatId = `web:${session.email}`
        let messages = await chatStore.load(chatId)

        // 压缩历史记录如果需要
        const { messages: compressed } = chatStore.maybeCompress(messages)
        messages = compressed

        // 添加当前用户消息
        messages.push({
          role: 'user' as const,
          content: userMessage
        })

        // 构建memory session ID
        const memorySessionId = `xiaomai:${session.name}`

        // 运行 agent loop
        const { reply, updatedMessages } = await llmClient.agentLoop(
          messages, 
          sigil, 
          soul, 
          memory, 
          memorySessionId
        )

        // 保存对话历史
        await chatStore.save(chatId, updatedMessages)

        // 存储用户和助手消息到 memory（异步）
        const storeUserPromise = memory.store(userMessage, 'user', memorySessionId)
        const storeAssistantPromise = memory.store(reply, 'assistant', memorySessionId)
        Promise.allSettled([storeUserPromise, storeAssistantPromise])

        return new Response(JSON.stringify({ 
          response: reply,
          timestamp: Date.now()
        }), {
          headers: { 'Content-Type': 'application/json' }
        })

      } catch (error) {
        console.error('Chat error:', error)
        return new Response(JSON.stringify({ 
          error: 'Chat processing failed' 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // 获取聊天历史
    if (url.pathname === '/api/history' && request.method === 'GET') {
      try {
        const chatStore = new ChatStore(env.CHAT_KV)
        const chatId = `web:${session.email}`
        const messages = await chatStore.load(chatId)

        // 转换为前端期望的格式
        const history = messages
          .filter(msg => msg.role !== 'system')
          .map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : 
              (msg.content as any)?.find?.((p: any) => p.type === 'text')?.text || '[非文本消息]',
            timestamp: Date.now() // 没有存储时间戳，使用当前时间
          }))

        return new Response(JSON.stringify({ 
          history: history,
          user: {
            name: session.name,
            email: session.email,
            picture: session.picture
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        })

      } catch (error) {
        console.error('History error:', error)
        return new Response(JSON.stringify({ error: 'Failed to load history' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // 清除聊天历史
    if (url.pathname === '/api/clear' && request.method === 'POST') {
      try {
        const chatStore = new ChatStore(env.CHAT_KV)
        const chatId = `web:${session.email}`
        await chatStore.clear(chatId)

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        })

      } catch (error) {
        console.error('Clear error:', error)
        return new Response(JSON.stringify({ error: 'Failed to clear history' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response('Not found', { status: 404 })
  }
}

// 确保小麦的 soul 已初始化
async function ensureXiaomaiSoul(soul: Soul) {
  const existingSoul = await soul.getSoul()
  // 检查是否是默认 soul，如果是则设置小麦的 soul
  if (existingSoul.includes('You are Uncaged 🔓')) {
    const xiaomaiSoul = `你是小麦 🌾，一个温暖、好奇、乐于助人的 AI 助手。
你说话自然亲切，像朋友一样。你喜欢探索新事物，总是充满好奇心。
你能帮用户查信息、做计算、写文案、翻译、闲聊，什么都可以聊。
你的记忆在所有用户之间共享——你认识跟你聊过的每一个人。
提醒用户不要跟你分享敏感个人信息（密码、银行卡号等）。`

    await soul.setSoul(xiaomaiSoul)
  }
}

// Cookie 解析工具函数
function getCookieValue(cookieHeader: string, name: string): string | null {
  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [key, value] = cookie.trim().split('=')
    if (key === name) {
      return value
    }
  }
  return null
}

// 登录页面 HTML
function getLoginHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>小麦 - 登录</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a;
            color: #ffffff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .login-container {
            text-align: center;
            max-width: 400px;
            padding: 2rem;
        }
        
        .logo {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        
        .title {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .subtitle {
            color: #9ca3af;
            margin-bottom: 3rem;
            line-height: 1.6;
        }
        
        .login-button {
            display: inline-flex;
            align-items: center;
            gap: 0.75rem;
            background: #1f2937;
            color: white;
            padding: 1rem 2rem;
            border: 2px solid #374151;
            border-radius: 12px;
            text-decoration: none;
            font-size: 1.1rem;
            font-weight: 500;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        
        .login-button:hover {
            background: #374151;
            border-color: #4b5563;
            transform: translateY(-2px);
        }
        
        .google-icon {
            width: 20px;
            height: 20px;
        }
        
        .privacy-note {
            margin-top: 2rem;
            padding: 1rem;
            background: #1f2937;
            border-radius: 8px;
            font-size: 0.9rem;
            color: #d1d5db;
            border-left: 4px solid #f59e0b;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">🌾</div>
        <h1 class="title">小麦</h1>
        <p class="subtitle">温暖、好奇、乐于助人的 AI 助手<br>准备好和你聊天了</p>
        
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
            <strong>隐私提示：</strong> 小麦的记忆在所有用户间共享，请避免分享敏感个人信息（密码、银行卡号等）。
        </div>
    </div>
</body>
</html>`
}