import type { FolderTransferCtx } from './panel-types'
import type { FolderTransferPort } from './transfer-types'

export function folderPhase(folder: FolderTransferPort, ctx: FolderTransferCtx, phase: string, item = ''): void {
  if (ctx.t) ctx.t.phase = phase === 'checking' && ctx.liveBytes?.size ? 'transferring' : phase
  folder.updateProgress(ctx, Math.max(ctx.t?.bytesDone || 0, (ctx.skippedBytes || 0) + ctx.bytesDone + liveFolderBytes(ctx)), item, ctx.itemDone)
}

function liveFolderBytes(ctx: FolderTransferCtx): number {
  let total = 0
  for (const bytes of ctx.liveBytes?.values() || []) total += bytes
  return total
}

/** Shared per-folder byte accounting, including concurrently running files. */
export function folderFileProgress(folder: FolderTransferPort, ctx: FolderTransferCtx | undefined, key: string, name: string, size: number) {
  if (!ctx) return { report: (_bytes: number) => {}, finish: (_ok: boolean) => {} }
  const live = ctx.liveBytes ||= new Map<string, number>()
  live.set(key, 0)
  folderPhase(folder, ctx, 'transferring', name)
  const publish = () => folder.updateProgress(ctx, (ctx.skippedBytes || 0) + ctx.bytesDone + liveFolderBytes(ctx), name, ctx.itemDone, size)
  const reporter = {
    report(bytes: number) {
      live.set(key, Math.max(live.get(key) || 0, Math.min(size, Math.max(0, bytes))))
      const now = Date.now()
      if (now - (ctx.lastLiveReportAt || 0) < 250) return
      ctx.lastLiveReportAt = now; publish()
    },
    finish(ok: boolean) {
      live.delete(key)
      if (ok) { ctx.bytesDone += size; ctx.itemDone++ }
      publish()
    },
  }
  Object.assign(reporter.report, { cancelRef: ctx.t?._taskCancelRef })
  return reporter
}

export function folderSkipped(folder: FolderTransferPort, ctx: FolderTransferCtx, name: string, size: number): void {
  ctx.skippedBytes = (ctx.skippedBytes || 0) + size; ctx.itemDone++
  folder.updateProgress(ctx, (ctx.skippedBytes || 0) + ctx.bytesDone + liveFolderBytes(ctx), name, ctx.itemDone, size)
}

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
