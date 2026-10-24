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
