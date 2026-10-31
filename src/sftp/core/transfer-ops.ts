import type { FileOperationBatch } from './panel-types'
const fileOperation = require('../../runtime/file-operation.cjs')
import { folderFileProgress, folderPhase, folderSkipped } from './transfer-progress'
import * as path from 'path'

import { type Stats } from 'fs'

import { type FolderTransferCtx } from './panel-types'

import { type SFTPFile } from '../../services/sftp.service'

import { safeEntryName } from './path-utils'

import { parseRemoteMtime } from './conflict'

import { ConcurrencyLimiter, clampDirConcurrency, mapSettledConcurrent } from './concurrency'

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
  if (rawModified instanceof Date || typeof (rawModified as any)?.getTime === 'function') {
    const t = (rawModified as Date).getTime()
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
  if (ctx.batch?.cancelled || folder.isAborted(ctx)) return false
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
  return limiter.run(async () => (await dirGate(folder, ctx)) ? fn() : false)
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
    batch?: FileOperationBatch,
    moveSource = false,
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
    let initialEntries: SftpDirEntry[] | undefined

    const existing = await this.ports.localFs.lstat(localDir)
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      fileOperation.enqueue(this.ports.conflictQueue, {localPath:localDir,remotePath:remoteSrc,remoteDir:path.posix.dirname(remoteSrc),fileName:base,localStat:existing,direction:'download',isDirectory:true,typeMismatch:true,transferCtx:ctx,mode:ctx?.moveSource?'cut':undefined},ctx?.batch || batch)
      if (ctx) { ctx.discoveryIncomplete = true; ctx.discoveryPending = Math.max(0, (ctx.discoveryPending || 1) - 1); this.ports.folder.markHadConflict(ctx) }
      this.ports.conflictQueue.showDialog()
      return !isTop
    }
    if (isTop) {

      const targetExists = await this.ports.localFs.pathExists(localDir)
      if (!moveSource && this.ports.tarChannel && (!targetExists || forceOverwrite)) {
        initialEntries = await this.ports.sftp.readdir(remoteSrc)
        const preview = initialEntries.filter(entry => safeEntryName(entry.name) === entry.name && !entry.isSymlink)
        const statsHint = preview.every(entry => !entry.isDirectory && entry.isSymlink === false && entry.size != null) ? { size: preview.reduce((sum,entry)=>sum+(entry.size || 0),0), count: preview.length } : undefined
        const r = await this.ports.tarChannel.tryDownloadDir(remoteSrc, localDest, this.ports.folder, base, targetExists, this.ports.tarChannelMode, statsHint)
        if (r === 'success') return true
        if (r === 'failed') return false
        log.info('[download-dir] tar channel fell back, starting standard file-by-file transfer:', remoteSrc)
      } else if (targetExists) {

        log.info('[download-dir] tar channel skipped (existing target requires per-file conflict checks):', localDir)

        // Existing directories require per-file conflict decisions, including tar-only preference.
      }

      ctx = this.ports.folder.start(base, 'download', remoteSrc, localDir, 0, 0)
      ctx.moveSource = moveSource
      ctx.sourceDirectories = []
      ctx.batch = batch; if (ctx.t) { ctx.t.batch = batch; ctx.t.discoveryComplete = false }
      ctx.producing = true
      ctx.discoveryPending = 1; ctx.discoveredBytes = 0; ctx.discoveredItems = 0
      ctx.discoveryLimiter = new ConcurrencyLimiter(Math.min(4, clampDirConcurrency(this.dirConcurrency?.())))
      folderPhase(this.ports.folder, ctx, 'scanning', remoteSrc)
      log.info('[download-dir] streaming traversal; no recursive pre-scan:', remoteSrc)
    }

    if (ctx?.moveSource) ctx.sourceDirectories!.push(remoteSrc)
    let success = true

    const limiter = inLimiter ?? new ConcurrencyLimiter(clampDirConcurrency(this.dirConcurrency?.()))
    try {
      await this.ports.localFs.mkdirRecursive(localDir)
      if (!(await dirGate(this.ports.folder, ctx))) { success = false; return false }
      const names = new Set<string>()
      const readDirectory = async () => (await dirGate(this.ports.folder, ctx)) ? this.ports.sftp.readdir(remoteSrc) : []
      const listing = initialEntries || await (ctx?.discoveryLimiter ? ctx.discoveryLimiter.run(readDirectory) : readDirectory())
      const entries = listing.filter(entry => {
        const name = safeEntryName(entry.name)
        if (!name || name !== entry.name || names.has(name) || entry.isSymlink === true) return false
        names.add(name); return true
      })
      if (!(await dirGate(this.ports.folder, ctx))) { success = false; return false }
      if (ctx) {
        ctx.discoveryPending = Math.max(0, (ctx.discoveryPending || 1) - 1) + entries.filter(entry => entry.isDirectory).length
        for (const entry of entries) if (!entry.isDirectory) { ctx.discoveredBytes = (ctx.discoveredBytes || 0) + Math.max(0, entry.size || 0); ctx.discoveredItems = (ctx.discoveredItems || 0) + 1 }
        this.publishDiscovery(ctx)
      }

      const settled = await mapSettledConcurrent(entries, clampDirConcurrency(this.dirConcurrency?.()) * 2, async (entry): Promise<boolean> => {
        if (!(await dirGate(this.ports.folder, ctx))) return false
        const safeName = safeEntryName(entry.name)
        if (!safeName) {
          log.warn('skip unsafe entry name:', entry.name)
          return true
        }
        const remoteP = path.posix.join(remoteSrc, safeName)
        const localP = path.join(localDir, safeName)

        if (entry.isSymlink === true || (entry.isSymlink == null && await this.ports.sftp.isSymlink(remoteP))) {
          log.info('skip symlink during folder download:', entry.name)
          if (ctx) {
            if (entry.isDirectory) ctx.discoveryPending = Math.max(0, (ctx.discoveryPending || 1) - 1)
            else { ctx.discoveredBytes = Math.max(0, (ctx.discoveredBytes || 0) - (entry.size || 0)); ctx.discoveredItems = Math.max(0, (ctx.discoveredItems || 0) - 1) }
            this.publishDiscovery(ctx)
          }
          return true
        }

        if (entry.isDirectory) {

          if (!(await dirGate(this.ports.folder, ctx))) return false
          return this.execute(remoteP, localDir, ctx, undefined, limiter, forceOverwrite)
        }

        return gatedDirTask(this.ports.folder, ctx, limiter, async (): Promise<boolean> => {
          let sz = entry.size || 0

          let remoteMtime = entryMtimeToMsOrUndefined(entry) ?? 0
          if (remoteMtime === 0 || entry.size == null) {
            try {
              const st = await this.ports.sftp.stat(remoteP)
              if (st) {
                remoteMtime = entryMtimeToMsOrUndefined(st) ?? 0
                if (entry.size == null && st.size != null) { sz = Math.max(0, st.size); entry.size = sz; if (ctx) { ctx.discoveredBytes = (ctx.discoveredBytes || 0) + sz; this.publishDiscovery(ctx) } }
              }
            } catch (e) {
              log.warn('stat fallback for folder download conflict failed:', remoteP, e)
            }
          }
          if (ctx) folderPhase(this.ports.folder, ctx, 'checking', safeName)
          if (!forceOverwrite) {
            const conflictResult = await this.ports.conflictDetection.checkLocalConflict(localP, remoteP, sz, remoteMtime)
            if (conflictResult.kind === 'auto-skipped') {
              log.info('[download-dir] auto-skipped (content identical):', remoteP)
              ctx && folderSkipped(this.ports.folder,ctx,safeName,sz)
              return true
            }
            if (conflictResult.kind === 'conflict') {
              const conflictInfo = conflictResult.info
              fileOperation.enqueue(this.ports.conflictQueue, {
                mode: ctx?.moveSource ? 'cut' : undefined,
                typeMismatch: conflictInfo.typeMismatch,
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
              }, ctx?.batch || batch)
              if (ctx) this.ports.folder.markHadConflict(ctx)
              this.ports.conflictQueue.showDialog()
              return true
            }
          }

          const progress = folderFileProgress(this.ports.folder, ctx, localP, safeName, sz)
          let ok = false
          try { ok = await this.ports.execution.downloadRaw(remoteP, localP, entry.mode, entry.size, progress.report) }
          finally { progress.finish(ok) }
          if (ok && ctx?.moveSource) await this.ports.sftp.unlink?.(remoteP)
          if (ctx) this.ports.folder.consumeAbortCurrent(ctx)
          return ok
        })
      })
      const folded = foldSettled(settled)
      success = folded.success
      if (success && ctx?.moveSource) await this.ports.sftp.rmdir?.(remoteSrc)
      if (folded.firstErr != null) throw folded.firstErr
    } catch (e) {
      success = false
      log.error(`folder download failed: ${remoteSrc} :: ${errText(e)}`)
      throw e
    } finally {

      if (isTop && ctx) {
        ctx.producing = false
        ctx.failed ||= !success || this.ports.folder.isAborted(ctx)
        const ok = success && !ctx.hadConflict && !this.ports.folder.isAborted(ctx)
        this.ports.folder.finish(ctx, ok)
      }
    }
    return success && !ctx?.hadConflict
  }

  private publishDiscovery(ctx: FolderTransferCtx): void {
    if (ctx.t) {
      ctx.t.bytesTotal = ctx.discoveredBytes || 0; ctx.t.itemCount = ctx.discoveredItems || 0
      ctx.t.discoveryComplete = ctx.discoveryPending === 0 && !ctx.discoveryIncomplete
    }
    if (ctx.discoveryPending === 0) this.ports.folder.updateLogSize?.(ctx, ctx.discoveredBytes || 0)
    folderPhase(this.ports.folder, ctx, 'transferring')
  }

}

export class DownloadOneUseCase {
  constructor(
    private readonly ports: TransferUseCasePorts,
    private readonly downloadOne: DownloadOnePort,
  ) {}

  async execute(file: SFTPFile, targetLocalDir?: string, batch?: FileOperationBatch): Promise<void> {
    const localBase = targetLocalDir?.trim() || this.downloadOne.getLocalPath()
    if((file as any)._customSaveAs&&!file.isDirectory){const name=safeEntryName(file.name);if(!name||name!==file.name)throw Error('Invalid download filename');await this.ports.execution.downloadTopLevel(file.fullPath,path.join(localBase,name),file.mode,file.size);return}

    if (file.isDirectory) {

      const safeName = safeEntryName(file.name)
      if (!safeName) {
        log.warn('skip download dir with unsafe name:', file.name)
        return
      }
      const localDir = path.join(localBase, safeName)

      await this.downloadOne.downloadDir(file.fullPath, localBase, batch)
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
      fileOperation.enqueue(this.ports.conflictQueue, {
        typeMismatch: conflictInfo.typeMismatch,
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
      }, batch)
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
          const progress = folderFileProgress(this.ports.folder!, ctx || undefined, localP, c.name, st.size)
          let ok = false
          try { ok = await this.ports.execution.uploadRaw(remoteP, localP, progress.report) }
          finally { progress.finish(ok) }
          if (ctx && this.ports.folder?.consumeAbortCurrent(ctx)) {
            if (!ok) success = false

            continue
          }
          if (!ok) success = false

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
    batch?: FileOperationBatch,
    moveSource = false,
  ): Promise<boolean> {
    if (!this.ports.sftp.hasSession()) return false
    const st = await this.ports.localFs.lstat(localPath)
    if (!st) return false
    if (st.isSymbolicLink()) return false

    const base = path.basename(localPath)
    const remoteTarget = path.posix.join(remoteDir, base)
    const isTop = !topCtx

    if (st.isDirectory()) {
      return this._uploadDirectory(remoteDir, localPath, remoteTarget, st, isTop, topCtx, inLimiter, batch, moveSource)
    }

    return this._uploadFile(remoteDir, localPath, remoteTarget, st, isTop, topCtx, batch)
  }

  private async _uploadDirectory(
    remoteDir: string,
    localPath: string,
    remoteTarget: string,
    st: import('fs').Stats,
    isTop: boolean,
    topCtx?: FolderTransferCtx,
    inLimiter?: ConcurrencyLimiter,
    batch?: FileOperationBatch,
    moveSource = false,
  ): Promise<boolean> {
    let ctx = topCtx
    if (await this.ports.conflictDetection.checkRemotePathExists(remoteTarget, false)) {
      fileOperation.enqueue(this.ports.conflictQueue, {localPath,remotePath:remoteTarget,remoteDir,fileName:path.basename(localPath),localStat:st,direction:'upload',isDirectory:true,typeMismatch:true,transferCtx:ctx,mode:ctx?.moveSource?'cut':undefined},ctx?.batch || batch)
      if (ctx) this.ports.folder.markHadConflict(ctx)
      this.ports.conflictQueue.showDialog()
      return !isTop
    }
    if (isTop) {
      const base = path.basename(localPath)

      if (!moveSource && this.ports.tarChannel && !(await this.ports.conflictDetection.checkRemotePathExists(remoteTarget))) {
        // Archive only fresh targets. Existing directories need individual file conflict choices.
        const r = await this.ports.tarChannel.tryUploadDir(localPath, remoteTarget, this.ports.folder, base, false, this.ports.tarChannelMode)
        if (r === 'success') return true

        if (r === 'failed') return false
        log.info('[upload-dir] tar channel fell back, starting standard file-by-file transfer:', localPath)
      }

      let totalSize = 0
      let itemCount = 0
      ctx = this.ports.folder.start(base, 'upload', remoteTarget, localPath, 0, 0)
      ctx.moveSource = moveSource
      ctx.sourceDirectories = []
      ctx.batch = batch; if (ctx.t) ctx.t.batch = batch
      ctx.producing = true
      folderPhase(this.ports.folder, ctx, 'scanning', localPath)
      try {
        const stats = await this.ports.localFs.scanDir(localPath)
        totalSize = stats.size; itemCount = stats.count
        if (ctx.t) { ctx.t.bytesTotal = totalSize; ctx.t.itemCount = itemCount }
        this.ports.folder.updateLogSize?.(ctx, totalSize)
      } catch (error) { ctx.producing = false; ctx.failed = true; this.ports.folder.finish(ctx, false); throw error }
      if (this.ports.folder.isAborted(ctx)) { ctx.producing = false; this.ports.folder.finish(ctx, false); return false }

    }

    // Same-named directories merge; files are checked individually below.
    if (await this.ports.conflictDetection.checkRemotePathExists(remoteTarget, false)) {
      if (ctx && isTop) { ctx.producing = false; ctx.failed = true; this.ports.folder.finish(ctx, false) }
      throw new Error('Cannot merge a folder into an existing file: ' + remoteTarget)
    }
    try { await this.ports.sftp.mkdir(remoteTarget) } catch (error) {
      if (!await this.ports.conflictDetection.checkRemotePathExists(remoteTarget, true)) {
        if (ctx && isTop) { ctx.producing = false; ctx.failed = true; this.ports.folder.finish(ctx, false) }
        throw error
      }
    }

    if (ctx?.moveSource) ctx.sourceDirectories!.push(localPath)
    const limiter = inLimiter ?? new ConcurrencyLimiter(clampDirConcurrency(this.dirConcurrency?.()))

    let success = true
    try {

      const children = await this.ports.localFs.listChildren(localPath)
      const settled = await mapSettledConcurrent(children.filter(c => !c.isSymbolicLink), clampDirConcurrency(this.dirConcurrency?.()) * 2, async (c): Promise<boolean> => {
          if (!(await dirGate(this.ports.folder, ctx))) return false
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
      const folded = foldSettled(settled)
      success = folded.success
      if (success && ctx?.moveSource) await this.ports.localFs.removeEmptyDirectory?.(localPath)
      if (folded.firstErr != null) throw folded.firstErr
    } catch (e) {

      success = false
      log.error(`upload dir failed: ${localPath} :: ${errText(e)}`)
      throw e
    } finally {
      if (isTop && ctx) {
        ctx.producing = false
        ctx.failed ||= !success || this.ports.folder.isAborted(ctx)
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
    batch?: FileOperationBatch,
    moveSource = false,
  ): Promise<boolean> {
    const base = path.basename(localPath)
    if (topCtx) folderPhase(this.ports.folder, topCtx, 'checking', base)
    const conflictResult = await this.ports.conflictDetection.checkUploadConflict(
      remoteTarget, localPath, st.size, st.mtimeMs,
    )
    if (conflictResult.kind === 'auto-skipped') {

      log.info('[upload-file] auto-skipped (content identical):', remoteTarget)
      topCtx && folderSkipped(this.ports.folder,topCtx,base,st.size)

      return true
    }
    if (conflictResult.kind === 'conflict') {
      const conflictInfo = conflictResult.info
      log.info('[upload-one] conflict for', remoteTarget, 'remoteSize:', conflictInfo.remoteSize, 'remoteMtime:', conflictInfo.remoteMtime)
      fileOperation.enqueue(this.ports.conflictQueue, {
        mode: topCtx?.moveSource ? 'cut' : undefined,
        typeMismatch: conflictInfo.typeMismatch,
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
      }, topCtx?.batch || batch)
      if (topCtx) this.ports.folder.markHadConflict(topCtx)
      this.ports.conflictQueue.showDialog()
      return true
    }

    if (isTop) {
      return this.ports.execution.uploadTopLevel(remoteTarget, localPath)
    }

    const progress = folderFileProgress(this.ports.folder, topCtx, localPath, base, st.size)
    let ok = false
    try { ok = await this.ports.execution.uploadRaw(remoteTarget, localPath, progress.report) }
    finally { progress.finish(ok) }

    if (ok && topCtx?.moveSource) await this.ports.localFs.removeFile?.(localPath)
    if (topCtx && this.ports.folder.consumeAbortCurrent(topCtx)) {
      if (!ok) return false
    } else if (!ok) {
      return false
    }
    return true
  }
}
