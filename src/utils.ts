/**
 * Convert ArrayBuffer to base64 string using chunked approach to avoid stack overflow.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

/**
 * Store image in KV and return a public URL that DashScope can access.
 * DashScope VL models can only access HTTP URLs (not file://, not base64 data URI).
 * We store the image in our own KV and serve it via /image/:id endpoint.
 */
export async function storeImageForVL(
  arrayBuffer: ArrayBuffer,
  mimeType: string,
  kv: KVNamespace,
  publicBaseUrl: string,
): Promise<string> {
  const id = crypto.randomUUID().slice(0, 12)
  
  console.log(`[Multimodal] Storing image ${id} (${arrayBuffer.byteLength} bytes, ${mimeType})`)
  
  // Store image data + metadata in KV with 1 hour TTL
  await Promise.all([
    kv.put(`img:${id}`, arrayBuffer, { expirationTtl: 3600 }),
    kv.put(`img:${id}:meta`, mimeType, { expirationTtl: 3600 }),
  ])
  
  const publicUrl = `${publicBaseUrl}/image/${id}`
  console.log(`[Multimodal] Image stored: ${publicUrl}`)
  return publicUrl
}
