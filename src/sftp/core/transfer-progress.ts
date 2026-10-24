let _lastProgressAt = 0

export function markTransferProgress(): void {
  _lastProgressAt = Date.now()
}

export function getTransferProgressAgeMs(): number {
  if (_lastProgressAt === 0) return Number.POSITIVE_INFINITY
  return Date.now() - _lastProgressAt
}

export function resetTransferProgressClock(): void {
  _lastProgressAt = 0
}
