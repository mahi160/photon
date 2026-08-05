import { describe, expect, it } from 'vitest'
import { createSerialQueue } from './serialQueue'

describe('createSerialQueue', () => {
  it('runs tasks in call order even when later tasks resolve faster', async () => {
    const order: number[] = []
    const enqueue = createSerialQueue()
    const slow = enqueue(
      () => new Promise((resolve) => setTimeout(() => resolve(order.push(1)), 20))
    )
    const fast = enqueue(() => Promise.resolve(order.push(2)))
    await Promise.all([slow, fast])
    expect(order).toEqual([1, 2])
  })

  it('a rejected task does not wedge the queue for later tasks', async () => {
    const order: string[] = []
    const enqueue = createSerialQueue()
    await enqueue(() => Promise.reject(new Error('boom')))
    await enqueue(() => Promise.resolve(order.push('after failure')))
    expect(order).toEqual(['after failure'])
  })

  it('the returned promise resolves only once that task settles, not merely once queued', async () => {
    const enqueue = createSerialQueue()
    let resolved = false
    const p = enqueue(() =>
      new Promise((resolve) => setTimeout(resolve, 10)).then(() => (resolved = true))
    )
    expect(resolved).toBe(false)
    await p
    expect(resolved).toBe(true)
  })
})
