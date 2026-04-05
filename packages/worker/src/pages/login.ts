/**
 * Login page — Passkey + Google OAuth authentication
 *
 * Handles WebAuthn credential creation/assertion with proper
 * base64url ↔ ArrayBuffer conversion for navigator.credentials API.
 */

export function getLoginPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>登录 — Uncaged</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#0a0a0a;color:#fff;min-height:100vh;
      display:flex;align-items:center;justify-content:center;
      padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    }
    .card{
      width:100%;max-width:400px;padding:2.5rem 2rem;
      background:#111;border:1px solid #1f2937;border-radius:16px;
      margin:1rem;
    }
    .logo{text-align:center;font-size:3.5rem;margin-bottom:0.5rem}
    .title{
      text-align:center;font-size:1.8rem;font-weight:800;margin-bottom:2rem;
      background:linear-gradient(135deg,#fbbf24,#f59e0b);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
    }
    .btn{
      display:flex;align-items:center;justify-content:center;gap:0.75rem;
      width:100%;padding:0.9rem 1.5rem;border-radius:12px;
      font-size:1rem;font-weight:600;cursor:pointer;
      border:none;transition:all .2s;text-decoration:none;
    }
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .btn-primary{
      background:linear-gradient(135deg,#fbbf24,#f59e0b);
      color:#0a0a0a;margin-bottom:0.75rem;
    }
    .btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 16px rgba(251,191,36,.3)}
    .btn-secondary{
      background:#1f2937;color:#fff;border:1px solid #374151;
      margin-bottom:1.5rem;
    }
    .btn-secondary:hover:not(:disabled){background:#374151;border-color:#4b5563}
    .divider{
      display:flex;align-items:center;gap:1rem;
      margin-bottom:1.5rem;color:#4b5563;font-size:0.85rem;
    }
    .divider::before,.divider::after{content:'';flex:1;border-top:1px solid #1f2937}
    .toggle-link{
      text-align:center;color:#9ca3af;font-size:0.9rem;
    }
    .toggle-link a{
      color:#fbbf24;text-decoration:none;font-weight:500;cursor:pointer;
    }
    .toggle-link a:hover{text-decoration:underline}
    .register-form{display:none;margin-top:1.5rem}
    .register-form.visible{display:block}
    .input{
      width:100%;padding:0.75rem 1rem;border-radius:10px;
      background:#1f2937;border:1px solid #374151;color:#fff;
      font-size:1rem;outline:none;margin-bottom:1rem;
      transition:border-color .2s;
    }
    .input:focus{border-color:#fbbf24}
    .input::placeholder{color:#6b7280}
    .error{
      display:none;background:#7f1d1d;border:1px solid #991b1b;
      border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;
      font-size:0.9rem;color:#fca5a5;text-align:center;
    }
    .error.visible{display:block}
    .spinner{
      display:inline-block;width:18px;height:18px;
      border:2px solid transparent;border-top-color:currentColor;border-radius:50%;
      animation:spin .6s linear infinite;
    }
    @keyframes spin{to{transform:rotate(360deg)}}
    .back-link{
      display:block;text-align:center;margin-top:1.5rem;
      color:#6b7280;font-size:0.85rem;text-decoration:none;
    }
    .back-link:hover{color:#9ca3af}
    .google-icon{width:20px;height:20px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔓</div>
    <h1 class="title">Uncaged</h1>

    <div id="error" class="error"></div>

    <!-- Login view -->
    <div id="loginView">
      <button class="btn btn-primary" id="passkeyLoginBtn" onclick="loginWithPasskey()">
        🔑 用 Passkey 登录
      </button>
      <a href="/auth/google/login" class="btn btn-secondary">
        <svg class="google-icon" viewBox="0 0 24 24">
          <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        用 Google 登录
      </a>
      <div class="toggle-link">
        没有账号？<a onclick="showRegister()">注册</a>
      </div>
    </div>

    <!-- Register view -->
    <div id="registerView" class="register-form">
      <input type="text" class="input" id="displayNameInput" placeholder="你的昵称" maxlength="50" autocomplete="name" />
      <button class="btn btn-primary" id="passkeyRegisterBtn" onclick="registerPasskey()">
        🔑 创建 Passkey 账号
      </button>
      <div class="toggle-link" style="margin-top:1rem">
        已有账号？<a onclick="showLogin()">登录</a>
      </div>
    </div>

    <a href="/" class="back-link">← 返回首页</a>
  </div>

  <script>
    // ─── Base64url helpers ───
    function base64urlEncode(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }
    function base64urlDecode(str) {
      const padded = str + '='.repeat((4 - str.length % 4) % 4);
      const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }

    // ─── UI helpers ───
    function showError(msg) {
      const el = document.getElementById('error');
      el.textContent = msg;
      el.classList.add('visible');
    }
    function hideError() {
      document.getElementById('error').classList.remove('visible');
    }
    function setLoading(btnId, loading, label) {
      const btn = document.getElementById(btnId);
      btn.disabled = loading;
      if (loading) {
        btn.dataset.originalLabel = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> 请稍候…';
      } else {
        btn.innerHTML = btn.dataset.originalLabel || label || '确定';
      }
    }
    function showRegister() {
      document.getElementById('loginView').style.display = 'none';
      document.getElementById('registerView').classList.add('visible');
      hideError();
      document.getElementById('displayNameInput').focus();
    }
    function showLogin() {
      document.getElementById('registerView').classList.remove('visible');
      document.getElementById('loginView').style.display = 'block';
      hideError();
    }

    function storeTokens(tokens) {
      localStorage.setItem('uncaged_access_token', tokens.accessToken);
      localStorage.setItem('uncaged_refresh_token', tokens.refreshToken);
    }

    // ─── Passkey Login ───
    async function loginWithPasskey() {
      hideError();
      if (!window.PublicKeyCredential) {
        showError('当前浏览器不支持 Passkey');
        return;
      }
      setLoading('passkeyLoginBtn', true);
      try {
        // 1. Get challenge from server
        const optRes = await fetch('/auth/passkey/login/options', { method: 'POST' });
        if (!optRes.ok) {
          const err = await optRes.json().catch(() => ({}));
          throw new Error(err.error || '获取登录选项失败');
        }
        const options = await optRes.json();

        // 2. Call navigator.credentials.get
        const publicKeyOptions = {
          challenge: base64urlDecode(options.challenge),
          rpId: options.rpId,
          userVerification: options.userVerification || 'preferred',
          timeout: options.timeout || 60000,
        };
        const assertion = await navigator.credentials.get({ publicKey: publicKeyOptions });

        // 3. Encode response for server
        const credential = {
          id: assertion.id,
          rawId: base64urlEncode(assertion.rawId),
          type: assertion.type,
          response: {
            authenticatorData: base64urlEncode(assertion.response.authenticatorData),
            clientDataJSON: base64urlEncode(assertion.response.clientDataJSON),
            signature: base64urlEncode(assertion.response.signature),
            userHandle: assertion.response.userHandle
              ? base64urlEncode(assertion.response.userHandle)
              : undefined,
          },
        };

        // 4. Verify with server
        const verifyRes = await fetch('/auth/passkey/login/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential }),
        });
        if (!verifyRes.ok) {
          const err = await verifyRes.json().catch(() => ({}));
          throw new Error(err.error || '验证失败');
        }
        const result = await verifyRes.json();

        // 5. Store tokens and redirect
        storeTokens(result.tokens);
        window.location.href = '/';
      } catch (e) {
        if (e.name === 'NotAllowedError') {
          showError('操作已取消');
        } else {
          showError(e.message || '登录失败，请重试');
        }
      } finally {
        setLoading('passkeyLoginBtn', false, '🔑 用 Passkey 登录');
      }
    }

    // ─── Passkey Register ───
    async function registerPasskey() {
      hideError();
      const displayName = document.getElementById('displayNameInput').value.trim();
      if (!displayName) {
        showError('请输入昵称');
        document.getElementById('displayNameInput').focus();
        return;
      }
      if (!window.PublicKeyCredential) {
        showError('当前浏览器不支持 Passkey');
        return;
      }
      setLoading('passkeyRegisterBtn', true);
      try {
        // 1. Get registration options from server
        const optRes = await fetch('/auth/passkey/register/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName }),
        });
        if (!optRes.ok) {
          const err = await optRes.json().catch(() => ({}));
          throw new Error(err.error || '获取注册选项失败');
        }
        const options = await optRes.json();

        // 2. Build publicKey options — decode base64url to ArrayBuffer
        const publicKeyOptions = {
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
        };

        // 3. Create credential
        const attestation = await navigator.credentials.create({ publicKey: publicKeyOptions });

        // 4. Encode response for server
        const credential = {
          id: attestation.id,
          rawId: base64urlEncode(attestation.rawId),
          type: attestation.type,
          response: {
            attestationObject: base64urlEncode(attestation.response.attestationObject),
            clientDataJSON: base64urlEncode(attestation.response.clientDataJSON),
          },
        };

        // 5. Verify with server
        const verifyRes = await fetch('/auth/passkey/register/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential }),
        });
        if (!verifyRes.ok) {
          const err = await verifyRes.json().catch(() => ({}));
          throw new Error(err.error || '注册验证失败');
        }
        const result = await verifyRes.json();

        // 6. Store tokens and redirect
        storeTokens(result.tokens);
        window.location.href = '/';
      } catch (e) {
        if (e.name === 'NotAllowedError') {
          showError('操作已取消');
        } else {
          showError(e.message || '注册失败，请重试');
        }
      } finally {
        setLoading('passkeyRegisterBtn', false, '🔑 创建 Passkey 账号');
      }
    }

    // ─── Auto-redirect if already logged in ───
    (function() {
      const token = localStorage.getItem('uncaged_access_token');
      if (token) {
        // Quick check — if token exists, try session
        fetch('/auth/session', {
          headers: { 'Authorization': 'Bearer ' + token },
        }).then(r => {
          if (r.ok) window.location.href = '/';
        }).catch(() => {});
      }
    })();

    // Enter key on displayName input triggers register
    document.getElementById('displayNameInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); registerPasskey(); }
    });
  </script>
</body>
</html>`
}
