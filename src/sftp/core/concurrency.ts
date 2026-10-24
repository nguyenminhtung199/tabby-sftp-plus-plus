/** Shares a bounded number of in-flight operations across one directory transfer. */
export class ConcurrencyLimiter {
  private _active = 0
  private readonly _waiters: Array<() => void> = []

  constructor(private readonly _limit: number) {}

  async acquire(): Promise<void> {
    if (this._active < this._limit) {
      this._active++
      return
    }

    // release() hands an occupied slot directly to the next waiter.
    await new Promise<void>(resolve => this._waiters.push(resolve))
  }

  release(): void {
    const next = this._waiters.shift()
    if (next) {
      next()
    } else {
      this._active--
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

export function clampDirConcurrency(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return 3
  return Math.min(10, Math.max(1, Math.round(v)))
}

/** Preserve all-settled ordering without allocating one pending promise per file. */
export async function mapSettledConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0, completed = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      try { results[index] = { status: 'fulfilled', value: await fn(items[index], index) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
      if (++completed % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }
  const workers = Math.min(items.length, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 8))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

export async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = await mapSettledConcurrent(items, limit, fn)
  return results.map(result => { if (result.status === 'rejected') throw result.reason; return result.value })
}
