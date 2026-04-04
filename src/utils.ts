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