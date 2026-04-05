import { useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Spinner } from '../ui/spinner'
import { base64urlEncode, base64urlDecode } from '../../lib/webauthn'

interface PasskeyRegisterProps {
  onError: (msg: string) => void
  onSuccess: () => void
}

export function PasskeyRegister({ onError, onSuccess }: PasskeyRegisterProps) {
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister() {
    const name = displayName.trim()
    if (!name) {
      onError('请输入昵称')
      return
    }
    if (!window.PublicKeyCredential) {
      onError('当前浏览器不支持 Passkey')
      return
    }

    setLoading(true)
    try {
      // 1. Get registration options
      const optRes = await fetch('/auth/passkey/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      })
      if (!optRes.ok) {
        const err = await optRes.json().catch(() => ({}))
        throw new Error(err.error || '获取注册选项失败')
      }
      const options = await optRes.json()

      // 2. Build publicKey options
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64urlDecode(options.challenge),
        rp: options.rp,
        user: {
          id: base64urlDecode(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName,
        },
        pubKeyCredParams: options.pubKeyCredParams,
        authenticatorSelection: options.authenticatorSelection,
        timeout: options.timeout || 60000,
        attestation: options.attestation || 'none',
      }

      // 3. Create credential
      const attestation = (await navigator.credentials.create({
        publicKey: publicKeyOptions,
      })) as PublicKeyCredential

      const attestationResponse = attestation.response as AuthenticatorAttestationResponse

      // 4. Encode response
      const credential = {
        id: attestation.id,
        rawId: base64urlEncode(attestation.rawId),
        type: attestation.type,
        response: {
          attestationObject: base64urlEncode(attestationResponse.attestationObject),
          clientDataJSON: base64urlEncode(attestationResponse.clientDataJSON),
        },
      }

      // 5. Verify
      const verifyRes = await fetch('/auth/passkey/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}))
        throw new Error(err.error || '注册验证失败')
      }

      onSuccess()
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        onError('操作已取消')
      } else {
        onError((e as Error).message || '注册失败，请重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Input
        type="text"
        placeholder="你的昵称"
        maxLength={50}
        autoComplete="name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleRegister()
          }
        }}
      />
      <Button
        variant="default"
        className="w-full"
        onClick={handleRegister}
        disabled={loading}
      >
        {loading ? (
          <>
            <Spinner size="sm" /> 请稍候…
          </>
        ) : (
          '🔑 创建 Passkey 账号'
        )}
      </Button>
    </div>
  )
}
