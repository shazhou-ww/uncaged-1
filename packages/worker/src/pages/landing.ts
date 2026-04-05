/**
 * Landing page — platform root when not authenticated
 */

export function getLandingPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Uncaged — Your AI Agent, Uncaged</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#0a0a0a;color:#fff;min-height:100vh;
      display:flex;align-items:center;justify-content:center;
      padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    }
    .landing{text-align:center;max-width:480px;padding:2rem}
    .logo{font-size:5rem;margin-bottom:1rem;animation:float 3s ease-in-out infinite}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    .title{
      font-size:2.5rem;font-weight:800;margin-bottom:0.5rem;
      background:linear-gradient(135deg,#fbbf24,#f59e0b,#d97706);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
    }
    .tagline{color:#9ca3af;font-size:1.1rem;margin-bottom:3rem}
    .features{
      text-align:left;margin-bottom:3rem;
      display:flex;flex-direction:column;gap:1rem;
    }
    .feature{
      display:flex;align-items:center;gap:0.75rem;
      background:#111;border:1px solid #1f2937;border-radius:12px;
      padding:1rem 1.25rem;transition:border-color .2s;
    }
    .feature:hover{border-color:#fbbf24}
    .feature-icon{font-size:1.5rem;flex-shrink:0}
    .feature-text{color:#d1d5db;font-size:0.95rem;line-height:1.4}
    .feature-text strong{color:#fff}
    .cta{
      display:inline-block;
      background:linear-gradient(135deg,#fbbf24,#f59e0b);
      color:#0a0a0a;font-weight:700;font-size:1.1rem;
      padding:1rem 2.5rem;border-radius:12px;
      text-decoration:none;transition:all .2s;
    }
    .cta:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(251,191,36,.3)}
    .footer{margin-top:3rem;color:#4b5563;font-size:0.8rem}
  </style>
</head>
<body>
  <div class="landing">
    <div class="logo">🔓</div>
    <h1 class="title">Uncaged</h1>
    <p class="tagline">Your AI Agent, Uncaged</p>
    <div class="features">
      <div class="feature">
        <div class="feature-icon">🤖</div>
        <div class="feature-text"><strong>多 Agent 托管</strong> — 部署你自己的 AI Agent，每个都有独立的灵魂和记忆</div>
      </div>
      <div class="feature">
        <div class="feature-icon">🔑</div>
        <div class="feature-text"><strong>Passkey 认证</strong> — 无密码登录，安全又便捷</div>
      </div>
      <div class="feature">
        <div class="feature-icon">📱</div>
        <div class="feature-text"><strong>PWA 支持</strong> — 添加到主屏幕，原生 App 体验</div>
      </div>
      <div class="feature">
        <div class="feature-icon">⚡</div>
        <div class="feature-text"><strong>边缘运行</strong> — 基于 Cloudflare Workers，全球加速</div>
      </div>
    </div>
    <a href="/auth/login" class="cta">登录</a>
    <div class="footer">Powered by Uncaged Platform</div>
  </div>
</body>
</html>`
}
