import { describe, expect, it } from 'vitest'
import { extractPostId } from '../campaigns/reddit-poster'

describe('extractPostId', () => {
  it('extracts post ID from standard reddit URL', () => {
    const url = 'https://www.reddit.com/r/DerechoMexicano/comments/abc123/my_post_title/'
    expect(extractPostId(url)).toBe('t3_abc123')
  })

  it('extracts post ID from old.reddit.com URL', () => {
    const url = 'https://old.reddit.com/r/mexico/comments/xyz789/some_title/'
    expect(extractPostId(url)).toBe('t3_xyz789')
  })

  it('returns null for non-Reddit URLs', () => {
    expect(extractPostId('https://example.com/not-reddit')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractPostId('')).toBeNull()
  })

  it('handles URL without trailing slash', () => {
    const url = 'https://www.reddit.com/r/MexicoFinanciero/comments/def456'
    expect(extractPostId(url)).toBe('t3_def456')
  })
})
