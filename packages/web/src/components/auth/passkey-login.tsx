import { useState } from 'react'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { base64urlEncode, base64urlDecode } from '../../lib/webauthn'

interface PasskeyLoginProps {
  onError: (msg: string) => void
  onSuccess: () => void
}

export function PasskeyLogin({ onError, onSuccess }: PasskeyLoginProps) {
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!window.PublicKeyCredential) {
      onError('当前浏览器不支持 Passkey')
      return
    }

    setLoading(true)
    try {
      // 1. Get challenge
      const optRes = await fetch('/auth/passkey/login/options', { method: 'POST' })
      if (!optRes.ok) {
        const err = await optRes.json().catch(() => ({}))
        throw new Error(err.error || '获取登录选项失败')
      }
      const options = await optRes.json()

      // 2. Call navigator.credentials.get
      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64urlDecode(options.challenge),
        rpId: options.rpId,
        userVerification: options.userVerification || 'preferred',
        timeout: options.timeout || 60000,
      }
      const assertion = (await navigator.credentials.get({
        publicKey: publicKeyOptions,
      })) as PublicKeyCredential

      const assertionResponse = assertion.response as AuthenticatorAssertionResponse

      // 3. Encode response
      const credential = {
        id: assertion.id,
        rawId: base64urlEncode(assertion.rawId),
        type: assertion.type,
        response: {
          authenticatorData: base64urlEncode(assertionResponse.authenticatorData),
          clientDataJSON: base64urlEncode(assertionResponse.clientDataJSON),
          signature: base64urlEncode(assertionResponse.signature),
          userHandle: assertionResponse.userHandle
            ? base64urlEncode(assertionResponse.userHandle)
            : undefined,
        },
      }

      // 4. Verify
      const verifyRes = await fetch('/auth/passkey/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}))
        throw new Error(err.error || '验证失败')
      }

      onSuccess()
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        onError('操作已取消')
      } else {
        onError((e as Error).message || '登录失败，请重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="default"
      className="w-full"
      onClick={handleLogin}
      disabled={loading}
    >
      {loading ? (
        <>
          <Spinner size="sm" /> 请稍候…
        </>
      ) : (
        '🔑 用 Passkey 登录'
      )}
    </Button>
  )
}
