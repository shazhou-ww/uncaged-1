import { describe, it, expect } from 'vitest'
import { getTextContent } from './chat-store.js'

describe('getTextContent', () => {
  it('should return empty string for null/undefined', () => {
    expect(getTextContent(null)).toBe('')
    expect(getTextContent(undefined)).toBe('')
  })

  it('should return string content as-is', () => {
    expect(getTextContent('Hello world')).toBe('Hello world')
    expect(getTextContent('')).toBe('')
  })

  it('should extract text from ContentPart array', () => {
    const content = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'image_url' as const, image_url: { url: 'test.jpg' } },
      { type: 'text' as const, text: 'World' }
    ]
    expect(getTextContent(content)).toBe('Hello\nWorld')
  })

  it('should handle empty ContentPart array', () => {
    expect(getTextContent([])).toBe('')
  })

  it('should handle ContentPart array with no text parts', () => {
    const content = [
      { type: 'image_url' as const, image_url: { url: 'test.jpg' } }
    ]
    expect(getTextContent(content)).toBe('')
  })

  it('should handle ContentPart array with empty text', () => {
    const content = [
      { type: 'text' as const, text: '' },
      { type: 'text' as const, text: undefined },
      { type: 'text' as const }
    ]
    expect(getTextContent(content)).toBe('\n\n')
  })
})