/**
 * Convert ArrayBuffer to base64 string using chunked approach to avoid stack overflow.
 * Safe for large images unlike btoa(String.fromCharCode(...new Uint8Array(buffer))).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192 // Process 8KB chunks to avoid stack overflow
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  
  return btoa(binary)
}

/**
 * Upload image to DashScope Files API and return file:// reference URL.
 * Falls back to base64 data URI if upload fails.
 */
export async function uploadImageToDashScope(
  arrayBuffer: ArrayBuffer, 
  filename: string, 
  mimeType: string,
  apiKey: string
): Promise<string> {
  try {
    console.log(`[DashScope] Uploading ${filename} (${arrayBuffer.byteLength} bytes, ${mimeType})`)
    
    const formData = new FormData()
    formData.append('file', new Blob([arrayBuffer], { type: mimeType }), filename)
    formData.append('purpose', 'file-extract')
    
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DashScope upload failed: ${response.status} ${errorText}`)
    }
    
    const result = await response.json() as any
    if (result.id) {
      const fileUrl = `file://${result.id}`
      console.log(`[DashScope] Successfully uploaded: ${fileUrl}`)
      return fileUrl
    } else {
      throw new Error('DashScope response missing file ID')
    }
  } catch (error) {
    console.error('[DashScope] Upload failed, falling back to base64:', error)
    
    // Fallback to base64 data URI
    const base64 = arrayBufferToBase64(arrayBuffer)
    const dataUri = `data:${mimeType};base64,${base64}`
    console.log(`[DashScope] Fallback to base64 data URI (${arrayBuffer.byteLength} bytes)`)
    return dataUri
  }
}