import { describe, expect, it } from 'vitest'
import { NoopCacheManager } from '../noop-cache-manager'

describe('NoopCacheManager', () => {
  const cache = new NoopCacheManager()

  it('always misses on get', async () => {
    await cache.set('billing', 'cust_1', { plan: 'pro' }, 60)
    expect(await cache.get('billing', 'cust_1')).toBeNull()
  })

  it('always misses on getStale', async () => {
    await cache.set('billing', 'cust_1', { plan: 'pro' }, 60)
    expect(await cache.getStale('billing', 'cust_1')).toBeNull()
  })

  it('resolves invalidate / invalidatePattern without throwing', async () => {
    await expect(cache.invalidate('billing', 'cust_1')).resolves.toBeUndefined()
    await expect(cache.invalidatePattern('billing')).resolves.toBeUndefined()
  })
})
