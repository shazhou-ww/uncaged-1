// Google OAuth 认证逻辑

import { XiaomaiEnv, UserSession } from './index.js'

export interface GoogleUserInfo {
  email: string
  name: string
  picture: string
  sub: string
}

// 处理 Google OAuth 回调
export async function handleGoogleOAuth(
  code: string, 
  clientId: string, 
  clientSecret: string
): Promise<GoogleUserInfo> {
  // Step 1: 用授权码换取访问令牌
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: 'https://xiaomai.shazhou.work/auth/callback',
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Token exchange failed: ${error}`)
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string
    id_token: string
    expires_in: number
    scope: string
    token_type: string
  }

  // Step 2: 使用访问令牌获取用户信息
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  })

  if (!userResponse.ok) {
    const error = await userResponse.text()
    throw new Error(`User info fetch failed: ${error}`)
  }

  const userInfo = await userResponse.json() as GoogleUserInfo

  // 验证必要字段
  if (!userInfo.email || !userInfo.name) {
    throw new Error('Missing required user information')
  }

  return userInfo
}

// 生成会话令牌
export function generateSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

// 验证会话令牌
export async function verifySessionToken(
  token: string, 
  kv: KVNamespace, 
  secret: string
): Promise<UserSession | null> {
  try {
    const sessionData = await kv.get(`session:${token}`)
    if (!sessionData) {
      return null
    }

    const session = JSON.parse(sessionData) as UserSession
    
    // 检查 session 是否过期（7天）
    const now = Date.now()
    const sessionAge = now - session.created_at
    const maxAge = 7 * 24 * 60 * 60 * 1000  // 7天（毫秒）
    
    if (sessionAge > maxAge) {
      // Session 过期，删除
      await kv.delete(`session:${token}`)
      return null
    }

    return session
  } catch (error) {
    console.error('Session verification error:', error)
    return null
  }
}

// 签名会话令牌（可选，增强安全性）
export async function signSessionToken(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token + secret)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

// 验证签名的会话令牌（可选）
export async function verifySignedSessionToken(
  token: string, 
  signature: string, 
  secret: string
): Promise<boolean> {
  const expectedSignature = await signSessionToken(token, secret)
  return expectedSignature === signature
}