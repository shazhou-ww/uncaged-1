/**
 * PWA Manifest generator — dynamic per-agent manifest.json
 */

export function getManifestJSON(
  ownerSlug: string,
  agentSlug: string,
  agentDisplayName?: string,
): string {
  const name = agentDisplayName || agentSlug
  return JSON.stringify({
    name: `${name} — Uncaged`,
    short_name: name,
    start_url: `/${ownerSlug}/${agentSlug}/`,
    scope: `/${ownerSlug}/${agentSlug}/`,
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#fbbf24',
    icons: [
      { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
}
