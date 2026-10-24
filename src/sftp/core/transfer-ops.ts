import * as path from 'path'

import { type Stats } from 'fs'

import { type FolderTransferCtx } from './panel-types'

import { type SFTPFile } from '../../services/sftp.service'

import { safeEntryName } from './path-utils'

import { parseRemoteMtime } from './conflict'

import { ConcurrencyLimiter, clampDirConcurrency } from './concurrency'

import { errText } from './transfer-adapters'

import { type DownloadOnePort, type FolderTransferPort, type RemoteDirStatsPort, type SftpDirEntry, type TarChannelPort, type TarChannelResult, type TransferUseCasePorts, type LocalTransferFsPort, type SftpTransferPort, type TransferExecutionPort } from './transfer-types'

import { log } from '../../services/sftp-logger'

function entryMtimeToMs(e: { modified?: Date | number | string | null; mtime?: number | null; attrs?: { mtime?: number; modified?: Date | number | string } }): number {
  return entryMtimeToMsOrUndefined(e) ?? Date.now()
}

const EPOCH_THRESHOLD_MS = 86400000

const FOLDER_LIVE_PROGRESS_MS = 350

function isEpoch1970(ms: number): boolean {
  return !Number.isFinite(ms) || ms < EPOCH_THRESHOLD_MS
}

function entryMtimeToMsOrUndefined(e: { modified?: Date | number | string | null; mtime?: number | null; attrs?: { mtime?: number; modified?: Date | number | string } }): number | undefined {
  const rawModified = e.modified ?? e.attrs?.modified
  if (rawModified instanceof Date) {
    const t = rawModified.getTime()
    return isEpoch1970(t) ? undefined : t
  }
  if (typeof rawModified === 'number' && Number.isFinite(rawModified)) {
    const ms = rawModified < 1e10 ? rawModified * 1000 : rawModified
    return isEpoch1970(ms) ? undefined : ms
  }
  if (typeof rawModified === 'string') {
    const d = new Date(rawModified).getTime()
    if (Number.isFinite(d) && !isEpoch1970(d)) return d
  }
  const rawMtime = e.mtime ?? e.attrs?.mtime
  if (rawMtime != null) {
    const n = Number(rawMtime)
    if (Number.isFinite(n)) {
      const ms = n < 1e10 ? n * 1000 : n
      return isEpoch1970(ms) ? undefined : ms
    }
  }
  return undefined
}

async function dirGate(
  folder: TransferUseCasePorts['folder'],
  ctx: FolderTransferCtx | undefined,
): Promise<boolean> {
  if (!ctx) return true
  if (folder.isAborted(ctx)) return false
  await folder.waitWhilePaused(ctx)
  if (folder.isAborted(ctx)) return false
  return true
}

async function gatedDirTask(
  folder: TransferUseCasePorts['folder'],
  ctx: FolderTransferCtx | undefined,
  limiter: ConcurrencyLimiter,
  fn: () => Promise<boolean>,
): Promise<boolean> {
  if (!(await dirGate(folder, ctx))) return false
  return limiter.run(fn)
}

function foldSettled(settled: PromiseSettledResult<boolean>[]): { success: boolean; firstErr: unknown } {
  let success = true
  let firstErr: unknown = null
  for (const r of settled) {
    if (r.status === 'rejected') {
      success = false
      if (firstErr == null) firstErr = r.reason
    } else if (!r.value) {
      success = false
    }
  }
  return { success, firstErr }
}

﻿

export class DownloadDirUseCase {
  constructor(
    private readonly ports: TransferUseCasePorts,
    private readonly remoteStats: RemoteDirStatsPort,

    private readonly dirConcurrency?: () => number | undefined,
  ) {}

  async execute(
    remoteSrc: string,
    localDest: string,
    topCtx?: FolderTransferCtx,
    localName?: string,
    inLimiter?: ConcurrencyLimiter,

    forceOverwrite = false,
  ): Promise<boolean> {
    if (!this.ports.sftp.hasSession()) return false

    const rawBase = localName || path.posix.basename(remoteSrc)
    const base = safeEntryName(rawBase)
    if (!base) {
      log.warn('skip download dir with unsafe name:', rawBase)
      return false
    }
    const localDir = path.join(localDest, base)
    const isTop = !topCtx
    let ctx = topCtx

    if (isTop) {

      const targetExists = await this.ports.localFs.pathExists(localDir)
      if (this.ports.tarChannel && (!targetExists || forceOverwrite)) {
        const r = await this.ports.tarChannel.tryDownloadDir(remoteSrc, localDest, this.ports.folder, base, targetExists, this.ports.tarChannelMode)
        if (r === 'success') return true
        if (r === 'failed') return false
        log.info('[download-dir] tar channel fell back, starting standard file-by-file transfer:', remoteSrc)
      } else if (targetExists) {

        log.info('[download-dir] tar channel skipped (existing target requires per-file conflict checks):', localDir)

        // Existing directories require per-file conflict decisions, including tar-only preference.
      }

      let totalSize = 0
      let itemCount = 0
      const s = await this.remoteStats.scanDir(remoteSrc)
      totalSize = s.size
      itemCount = s.count
      ctx = this.ports.folder.start(base, 'download', remoteSrc, localDir, totalSize, itemCount)
    }

    let success = true

    const limiter = inLimiter ?? new ConcurrencyLimiter(clampDirConcurrency(this.dirConcurrency?.()))
    try {
      await this.ports.localFs.mkdirRecursive(localDir)
      const entries = await this.ports.sftp.readdir(remoteSrc)

      const tasks = entries.map(async (entry): Promise<boolean> => {

        const safeName = safeEntryName(entry.name)
        if (!safeName) {
          log.warn('skip unsafe entry name:', entry.name)
          return true
        }
        const remoteP = path.posix.join(remoteSrc, safeName)
        const localP = path.join(localDir, safeName)

        if (entry.isSymlink || await this.ports.sftp.isSymlink(remoteP)) {
          log.info('skip symlink during folder download:', entry.name)
          return true
        }

        if (entry.isDirectory) {

          if (!(await dirGate(this.ports.folder, ctx))) return false
          return this.execute(remoteP, localDir, ctx, undefined, limiter, forceOverwrite)
        }

        return gatedDirTask(this.ports.folder, ctx, limiter, async (): Promise<boolean> => {
          const sz = entry.size || 0

          let remoteMtime = entryMtimeToMsOrUndefined(entry) ?? 0
          if (remoteMtime === 0) {
            try {
              const st = await this.ports.sftp.stat(remoteP)
              if (st) remoteMtime = entryMtimeToMsOrUndefined(st) ?? 0
            } catch (e) {
              log.warn('stat fallback for folder download conflict failed:', remoteP, e)
            }
          }
          if (!forceOverwrite) {
            const conflictResult = await this.ports.conflictDetection.checkLocalConflict(localP, remoteP, sz, remoteMtime)
            if (conflictResult.kind === 'auto-skipped') {
              log.info('[download-dir] auto-skipped (content identical):', remoteP)
              return true
            }
            if (conflictResult.kind === 'conflict') {
              const conflictInfo = conflictResult.info
              this.ports.conflictQueue.enqueue({
                localPath: localP,
                remoteDir: path.posix.dirname(remoteP),
                fileName: safeName,
                remotePath: remoteP,
                localStat: { size: conflictInfo.localSize, mtimeMs: conflictInfo.localMtime } as Stats,
                direction: 'download',
                remoteFileSize: sz,
                remoteFileMtime: remoteMtime,
                transferCtx: ctx,
                localDigest: conflictInfo.localDigest,
                remoteDigest: conflictInfo.remoteDigest,
              })
              if (ctx) this.ports.folder.markHadConflict(ctx)
              this.ports.conflictQueue.showDialog()
              return true
            }
          }

          const liveMap = ctx ? (ctx.liveBytes || (ctx.liveBytes = new Map<string, number>())) : null

          const inFlightBytes = (): number => {
            if (!liveMap) return 0
            let sum = 0
            for (const v of liveMap.values()) sum += v
            return sum
          }
          let liveReportAt = 0
          const onLive = ctx && liveMap
            ? (bytes: number): void => {
                if (bytes > 0) liveMap.set(localP, Math.max(liveMap.get(localP) || 0, bytes))
                const now = Date.now()
                if (now - liveReportAt < FOLDER_LIVE_PROGRESS_MS) return
                liveReportAt = now
                this.ports.folder.updateProgress(ctx, ctx.bytesDone + inFlightBytes(), safeName, ctx.itemDone, sz)
              }
            : undefined
          const ok = await this.ports.execution.downloadRaw(remoteP, localP, entry.mode, entry.size, onLive)

          liveMap?.delete(localP)

          if (ctx && this.ports.folder.consumeAbortCurrent(ctx)) {
            if (!ok) return false
          } else if (!ok) {
            return false
          }
          if (ctx) {
            if (sz > 0) ctx.bytesDone += sz
            ctx.itemDone++

            this.ports.folder.updateProgress(ctx, ctx.bytesDone + inFlightBytes(), safeName, ctx.itemDone, sz)
          }
          return true
        })
      })
      const folded = foldSettled(await Promise.allSettled(tasks))
      success = folded.success
      if (folded.firstErr != null) throw folded.firstErr
    } catch (e) {
      success = false
      log.error(`folder download failed: ${remoteSrc} :: ${errText(e)}`)
      throw e
    } finally {

      if (isTop && ctx) {
        const ok = success && !ctx.hadConflict && !this.ports.folder.isAborted(ctx)
        this.ports.folder.finish(ctx, ok)
      }
    }
    return success && !ctx?.hadConflict
  }
}

export class DownloadOneUseCase {
  constructor(
    private readonly ports: TransferUseCasePorts,
    private readonly downloadOne: DownloadOnePort,
  ) {}

  async execute(file: SFTPFile, targetLocalDir?: string): Promise<void> {
    const localBase = targetLocalDir?.trim() || this.downloadOne.getLocalPath()
    if((file as any)._customSaveAs&&!file.isDirectory){const name=safeEntryName(file.name);if(!name||name!==file.name)throw Error('Invalid download filename');await this.ports.execution.downloadTopLevel(file.fullPath,path.join(localBase,name),file.mode,file.size);return}

    if (file.isDirectory) {

      const safeName = safeEntryName(file.name)
      if (!safeName) {
        log.warn('skip download dir with unsafe name:', file.name)
        return
      }
      const localDir = path.join(localBase, safeName)

      const existing = await this.ports.localFs.lstat(localDir)
      if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Cannot merge a folder into an existing file or link: ' + localDir)
      await this.downloadOne.downloadDir(file.fullPath, localBase)
      return
    }

    const safeName = safeEntryName(file.name)
    if (!safeName) {
      log.warn('skip download file with unsafe name:', file.name)
      return
    }
    const localPath = path.join(localBase, safeName)
    let remoteMtime = entryMtimeToMsOrUndefined(file)
    log.info('[download-one] file.modified:', file.modified, 'initial remoteMtime:', remoteMtime, 'path:', file.fullPath)

    if (remoteMtime == null) {
      try {
        const st = await this.ports.sftp.stat(file.fullPath)
        log.info('[download-one] stat fallback result:', st)
        const stMtime = entryMtimeToMsOrUndefined(st)
        if (stMtime != null) remoteMtime = stMtime
      } catch (e) {
        log.warn('[download-one] stat for file conflict failed:', file.fullPath, e)
      }
    }
    if (remoteMtime == null) remoteMtime = 0
    log.info('[download-one] final remoteMtime:', remoteMtime)
    const conflictResult = await this.ports.conflictDetection.checkLocalConflict(
      localPath, file.fullPath, file.size ?? 0, remoteMtime,
    )
    if (conflictResult.kind === 'auto-skipped') {

      log.info('[download-one] auto-skipped (content identical):', file.fullPath)
      return
    }
    if (conflictResult.kind === 'conflict') {
      const conflictInfo = conflictResult.info
      this.ports.conflictQueue.enqueue({
        localPath,
        remoteDir: path.posix.dirname(file.fullPath),
        fileName: safeName,
        remotePath: file.fullPath,
        localStat: { size: conflictInfo.localSize, mtimeMs: conflictInfo.localMtime } as Stats,
        direction: 'download',
        remoteFileSize: file.size ?? 0,
        remoteFileMtime: remoteMtime,

        localDigest: conflictInfo.localDigest,
        remoteDigest: conflictInfo.remoteDigest,
      })
      return
    }

    await this.ports.execution.downloadTopLevel(
      file.fullPath, localPath, file.mode, file.size,
    )
  }
}

export type { SftpDirEntry }

export interface MergeLocalDirPorts {
  localFs: Pick<LocalTransferFsPort, 'listChildren' | 'lstat'>
  sftp: Pick<SftpTransferPort, 'hasSession' | 'mkdir'>
  execution: Pick<TransferExecutionPort, 'uploadRaw'>
  refreshRemote(): Promise<unknown>

  folder?: FolderTransferPort

  scanLocalDir?(dirPath: string): Promise<{ size: number; count: number }>

  tarChannel?: TarChannelPort

  tarChannelMode?(): string

  checkRemotePathExists?(remotePath: string, expectDir?: boolean): Promise<boolean>
}

export class MergeLocalDirUseCase {
  constructor(private readonly ports: MergeLocalDirPorts) {}

  async execute(
    localSrc: string, remoteDest: string, isTop = true,
    reuseLogEntryId?: string, topCtx: FolderTransferCtx | null = null,
  ): Promise<boolean> {
    if (!this.ports.sftp.hasSession()) return false

    if (isTop && !topCtx) {
      const tar = await this._tryTarUpload(localSrc, remoteDest, reuseLogEntryId)
      if (tar !== null) return tar
    }
    try { await this.ports.sftp.mkdir(remoteDest) } catch {   }

    let ownCtx: FolderTransferCtx | null = null
    if (isTop && !topCtx && this.ports.folder) {
      let totalSize = 0
      let itemCount = 0
      if (this.ports.scanLocalDir) {
        try {
          const s = await this.ports.scanLocalDir(localSrc)
          totalSize = s.size
          itemCount = s.count
        } catch {   }
      }
      ownCtx = this.ports.folder.start(
        path.basename(localSrc), 'upload', remoteDest, localSrc, totalSize, itemCount, reuseLogEntryId,
      )
    }
    const ctx = topCtx ?? ownCtx

    let success = true
    try {
      const children = await this.ports.localFs.listChildren(localSrc)
      for (const c of children) {

        if (ctx && this.ports.folder) {
          if (this.ports.folder.isAborted(ctx)) {
            success = false
            break
          }
          await this.ports.folder.waitWhilePaused(ctx)
          if (this.ports.folder.isAborted(ctx)) {
            success = false
            break
          }
        }
        if (c.isSymbolicLink) continue
        const safeName = safeEntryName(c.name)
        if (!safeName) {
          log.warn('skip unsafe local entry name during merge:', c.name)
          continue
        }
        const localP = path.join(localSrc, safeName)
        const remoteP = path.posix.join(remoteDest, safeName)
        const st = await this.ports.localFs.lstat(localP)
        if (!st) continue
        if (st.isDirectory()) {
          const childOk = await this.execute(localP, remoteP, false, undefined, ctx)
          if (!childOk) success = false
        } else {
          const ok = await this.ports.execution.uploadRaw(remoteP, localP)
          if (ctx && this.ports.folder?.consumeAbortCurrent(ctx)) {
            if (!ok) success = false
            else {
              ctx.itemDone++
              if (st.size > 0) ctx.bytesDone += st.size
              this.ports.folder.updateProgress(ctx, ctx.bytesDone, c.name, ctx.itemDone, st.size)
            }
            continue
          }
          if (!ok) success = false
          else if (ctx && this.ports.folder) {
            ctx.itemDone++
            if (st.size > 0) ctx.bytesDone += st.size
            this.ports.folder.updateProgress(ctx, ctx.bytesDone, c.name, ctx.itemDone, st.size)
          }
        }
      }
    } catch (e) {

      success = false
      log.error(`merge local dir failed: ${localSrc} :: ${errText(e)}`)
      throw e
    } finally {
      if (ownCtx && this.ports.folder) this.ports.folder.finish(ownCtx, success)
    }
    if (isTop) await this.ports.refreshRemote()
    return success
  }

  private async _tryTarUpload(
    localSrc: string,
    remoteDest: string,
    reuseLogEntryId?: string,
  ): Promise<boolean | null> {
    const tarChannel = this.ports.tarChannel
    const probe = this.ports.checkRemotePathExists
    const folder = this.ports.folder
    if (!tarChannel || !probe || !folder) return null
    let exists = false
    try {
      exists = await probe(remoteDest, true)
    } catch (e) {
      log.warn('[merge-upload] remote target probe failed, skip tar channel:', errText(e))
      return null
    }

    const mode = this.ports.tarChannelMode?.() ?? 'smart'
    const r = await tarChannel.tryUploadDir(
      localSrc, remoteDest, folder, path.basename(localSrc), exists, mode, reuseLogEntryId,
    )
    if (r === 'success') {
      log.info(`[merge-upload] packed by tar channel (${exists ? 'merge-into-existing' : 'fresh'}):`, localSrc, '->', remoteDest)
      return true
    }
    if (r === 'failed') {
      log.warn('[merge-upload] tar channel required but unusable, merge aborted:', localSrc, '->', remoteDest)
      return false
    }
    log.info('[merge-upload] tar channel not taken, falling back to per-file merge:', localSrc, '->', remoteDest)
    return null
  }
}

export class UploadBatchUseCase {
  constructor(private readonly ports: TransferUseCasePorts) {}

  async execute(localPaths: string[], remoteDir: string, name: string): Promise<TarChannelResult> {
    const tarChannel = this.ports.tarChannel
    const probe = this.ports.conflictDetection?.checkRemotePathExists
    const folder = this.ports.folder
    if (!tarChannel?.tryUploadBatch || !probe || !folder) return 'fallback'

    const mode = this.ports.tarChannelMode ?? 'smart'
    if (mode === 'sftpOnly') return 'fallback'
    if (localPaths.length < 2) return 'fallback'
    if (new Set(localPaths.map(p => path.dirname(p))).size !== 1) return 'fallback'
    for (const p of localPaths) {
      const target = path.posix.join(remoteDir, path.basename(p))
      let exists = false
      try {
        exists = await probe(target)
      } catch (e) {
        log.warn('[batch-upload] remote target probe failed, batch packing skipped:', errText(e))
        return 'fallback'
      }
      if (exists) {
        log.info('[batch-upload] a target already exists, batch packing skipped (per-file flow decides):', target)
        return 'fallback'
      }
    }
    const r = await tarChannel.tryUploadBatch(localPaths, remoteDir, folder, name, mode)
    if (r === 'success') {
      log.info(`[batch-upload] packed by tar channel: ${localPaths.length} entries ->`, remoteDir)
    } else if (r === 'failed') {
      log.warn(`[batch-upload] tar channel required but unusable, batch aborted: ${localPaths.length} entries ->`, remoteDir)
    }
    return r
  }
}

export class UploadPathUseCase {
  constructor(
    private readonly ports: TransferUseCasePorts,

    private readonly dirConcurrency?: () => number | undefined,
  ) {}

  async execute(
    remoteDir: string,
    localPath: string,
    topCtx?: FolderTransferCtx,
    inLimiter?: ConcurrencyLimiter,
  ): Promise<boolean> {
    if (!this.ports.sftp.hasSession()) return false
    const st = await this.ports.localFs.lstat(localPath)
    if (!st) return false
    if (st.isSymbolicLink()) return false

    const base = path.basename(localPath)
    const remoteTarget = path.posix.join(remoteDir, base)
    const isTop = !topCtx

    if (st.isDirectory()) {
      return this._uploadDirectory(remoteDir, localPath, remoteTarget, st, isTop, topCtx, inLimiter)
    }

    return this._uploadFile(remoteDir, localPath, remoteTarget, st, isTop, topCtx)
  }

  private async _uploadDirectory(
    remoteDir: string,
    localPath: string,
    remoteTarget: string,
    st: import('fs').Stats,
    isTop: boolean,
    topCtx?: FolderTransferCtx,
    inLimiter?: ConcurrencyLimiter,
  ): Promise<boolean> {
    let ctx = topCtx
    if (isTop) {
      const base = path.basename(localPath)

      if (this.ports.tarChannel && !(await this.ports.conflictDetection.checkRemotePathExists(remoteTarget))) {
        // Archive only fresh targets. Existing directories need individual file conflict choices.
        const r = await this.ports.tarChannel.tryUploadDir(localPath, remoteTarget, this.ports.folder, base, false, this.ports.tarChannelMode)
        if (r === 'success') return true

        if (r === 'failed') return false
        log.info('[upload-dir] tar channel fell back, starting standard file-by-file transfer:', localPath)
      }

      let totalSize = 0
      let itemCount = 0
      const s = await this.ports.localFs.scanDir(localPath)
      totalSize = s.size
      itemCount = s.count
      ctx = this.ports.folder.start(base, 'upload', remoteTarget, localPath, totalSize, itemCount)

    }

    // Same-named directories merge; files are checked individually below.
    if (await this.ports.conflictDetection.checkRemotePathExists(remoteTarget, false)) {
      if (ctx && isTop) this.ports.folder.finish(ctx, false)
      throw new Error('Cannot merge a folder into an existing file: ' + remoteTarget)
    }
    try { await this.ports.sftp.mkdir(remoteTarget) } catch (error) {
      if (!await this.ports.conflictDetection.checkRemotePathExists(remoteTarget, true)) {
        if (ctx && isTop) this.ports.folder.finish(ctx, false)
        throw error
      }
    }

    const limiter = inLimiter ?? new ConcurrencyLimiter(clampDirConcurrency(this.dirConcurrency?.()))

    let success = true
    try {

      const children = await this.ports.localFs.listChildren(localPath)
      const tasks = children
        .filter(c => !c.isSymbolicLink)
        .map(async (c): Promise<boolean> => {
          const safeName = safeEntryName(c.name)
          if (!safeName) {
            log.warn('skip unsafe local entry during upload:', c.name)
            return true
          }
          const childLocal = path.join(localPath, safeName)
          const st = await this.ports.localFs.lstat(childLocal)
          if (!st) return false
          if (st.isDirectory()) {

            if (!(await dirGate(this.ports.folder, ctx))) return false
            return this.execute(remoteTarget, childLocal, ctx, limiter)
          }

          return gatedDirTask(this.ports.folder, ctx, limiter, () =>
            this._uploadFile(
              remoteTarget, childLocal, path.posix.join(remoteTarget, safeName), st, false, ctx,
            ))
        })
      const folded = foldSettled(await Promise.allSettled(tasks))
      success = folded.success
      if (folded.firstErr != null) throw folded.firstErr
    } catch (e) {

      success = false
      log.error(`upload dir failed: ${localPath} :: ${errText(e)}`)
      throw e
    } finally {
      if (isTop && ctx) {
        const ok = success && !ctx.hadConflict && !this.ports.folder.isAborted(ctx)
        this.ports.folder.finish(ctx, ok)
      }
    }
    return success && !ctx?.hadConflict
  }

  private async _uploadFile(
    remoteDir: string,
    localPath: string,
    remoteTarget: string,
    st: import('fs').Stats,
    isTop: boolean,
    topCtx?: FolderTransferCtx,
  ): Promise<boolean> {
    const base = path.basename(localPath)
    const conflictResult = await this.ports.conflictDetection.checkUploadConflict(
      remoteTarget, localPath, st.size, st.mtimeMs,
    )
    if (conflictResult.kind === 'auto-skipped') {

      log.info('[upload-file] auto-skipped (content identical):', remoteTarget)

      return true
    }
    if (conflictResult.kind === 'conflict') {
      const conflictInfo = conflictResult.info
      log.info('[upload-one] conflict for', remoteTarget, 'remoteSize:', conflictInfo.remoteSize, 'remoteMtime:', conflictInfo.remoteMtime)
      this.ports.conflictQueue.enqueue({
        localPath,
        remoteDir,
        fileName: base,
        remotePath: remoteTarget,
        localStat: st,
        direction: 'upload',
        remoteFileSize: conflictInfo.remoteSize,
        remoteFileMtime: conflictInfo.remoteMtime,

        transferCtx: topCtx,

        localDigest: conflictInfo.localDigest,
        remoteDigest: conflictInfo.remoteDigest,
      })
      if (topCtx) this.ports.folder.markHadConflict(topCtx)
      this.ports.conflictQueue.showDialog()
      return true
    }

    if (isTop) {
      return this.ports.execution.uploadTopLevel(remoteTarget, localPath)
    }

    const ok = await this.ports.execution.uploadRaw(remoteTarget, localPath)

    if (topCtx && this.ports.folder.consumeAbortCurrent(topCtx)) {
      if (!ok) return false
    } else if (!ok) {
      return false
    }
    if (topCtx) {
      topCtx.itemDone++
      if (st.size > 0) topCtx.bytesDone += st.size
      this.ports.folder.updateProgress(topCtx, topCtx.bytesDone, base, topCtx.itemDone, st.size)
    }
    return true
  }
}
