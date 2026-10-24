const fileOperation = require('../../runtime/file-operation.cjs')
import type { FileOperationBatch } from './panel-types'
import { featureApis, invokeFeature, readFeature, writeFeature } from "../../features/api"

import * as fs from 'fs/promises'

import { type SFTPFile } from '../../services/sftp.service'

import { type AutoSkippedInfo, type ConflictCheckOutcome, type ConflictDetectionPort, type ConflictQueuePort, SftpConflictDetector } from './conflict'

import { DownloadDirUseCase, DownloadOneUseCase, MergeLocalDirUseCase, UploadBatchUseCase, UploadPathUseCase } from './transfer-ops'

import { type FolderTransferPort, type LocalTransferFsPort, type RemoteDirStatsPort, type SftpTransferPort, type TransferExecutionPort, type TransferUseCasePorts } from './transfer-types'

import { type ConflictFileInfo, type ConflictQueueItem, type FolderTransferCtx, type PanelTransferItem } from './panel-types'

import { createTaskScope, currentTaskScope, runInTaskScope } from './task-scope'

import * as fsSync from 'fs'

import * as path from 'path'

import { LocalPathFileDownload, LocalPathFileUpload, uploadViaRawToTemp } from './transfer-adapters'

import { TarChannel } from './tar-channel'

import { execSshCommand } from './path-utils'

import { ContentDigestService, type DigestAlgo } from './digest'

import { log } from '../../services/sftp-logger'
﻿

const SPEED_WINDOW_MAX_MS = 5000

export const SPEED_STALL_ZERO_MS = 15000

export const SPEED_STALL_ZERO_TEXT = '0 B/s'

export interface ConflictDigestSettings {
  enabled: boolean

  autoSkipSameContent: boolean
  maxBytes: number
  algo: DigestAlgo
}

export interface PanelTransferHost {
  sftpSession: unknown

  sshSession?: unknown
  mtimeToleranceMs: number

  conflictDigestOptions?(): ConflictDigestSettings | null
  localPath: string
  enqueueConflict(item: ConflictQueueItem): void
  showConflictDialog(): void

  scanLocalDir(dirPath: string): Promise<{ size: number; count: number }>
  scanRemoteDir(remotePath: string): Promise<{ size: number; count: number }>

  tarChannelMode?(): string
  startFolderTransfer(
    name: string,
    direction: 'upload' | 'download',
    remotePath: string,
    localPath: string,
    totalSize: number,
    itemCount: number,

    reuseLogEntryId?: string,
  ): FolderTransferCtx
  finishFolderTransfer(ctx: FolderTransferCtx, success: boolean): void

  discardFolderTransfer?(ctx: FolderTransferCtx): void

  updateFolderLogSize(ctx: FolderTransferCtx, size: number): void

  markChannelMode?(ctx: FolderTransferCtx, mode: 'tar'): void
  updateFolderProgress(
    ctx: FolderTransferCtx,
    bytesDone: number,
    currentItem: string,
    itemDone: number,
    currentItemSize?: number,
  ): void

  onTransferSkipped?(info: AutoSkippedInfo): void

  uploadTopLevel(remotePath: string, localPath: string): Promise<boolean>
  uploadRaw(remotePath: string, localPath: string, onProgress?: (bytes: number) => void): Promise<boolean>
  downloadTopLevel(remotePath: string, localPath: string, mode?: number, size?: number): Promise<boolean>

  downloadRaw(
    remotePath: string,
    localPath: string,
    mode?: number,
    size?: number,
    onProgress?: (bytes: number) => void,
  ): Promise<boolean>
  refreshRemote(): Promise<unknown>

  dirUploadConcurrency?(): number
  dirDownloadConcurrency?(): number

  downloadTarBall(
    remotePath: string,
    localPath: string,
    size: number,
    onProgress?: (bytes: number) => void,
    shouldAbort?: () => boolean,
  ): Promise<boolean>

  notifyDuplicateTransfer?(displayName: string): void

  notifyTarChannelFailure?(name: string, code: string, detail: string): void
}

export function buildTransferSlotKey(
  direction: 'upload' | 'download', remotePath: string, localPath: string,
): string {
  let normLocal = localPath
  try { normLocal = path.resolve(localPath) } catch {   }
  return `${direction}|${(remotePath ?? '').replace(/\/+$/, '')}|${normLocal}`
}

export class PanelTransferCoordinator {
  readonly conflictDetection: ConflictDetectionPort
  private readonly uploadUseCase: UploadPathUseCase
  private readonly downloadOneUseCase: DownloadOneUseCase
  private readonly downloadDirUseCase: DownloadDirUseCase
  private readonly mergeLocalDirUseCase: MergeLocalDirUseCase

  private readonly uploadBatchUseCase: UploadBatchUseCase

  private readonly _activeTransferSlots = new Set<string>()

  constructor(private readonly host: PanelTransferHost) {

    const digestSettings = host.conflictDigestOptions?.() ?? null
    const digestService = digestSettings?.enabled
      ? new ContentDigestService(() => host.sshSession ?? null, {
          algo: digestSettings.algo,
          maxBytes: digestSettings.maxBytes,
        })
      : null
    this.conflictDetection = new SftpConflictDetector(
      () => host.sftpSession as any,
      host.mtimeToleranceMs,
      digestService,

      () => host.conflictDigestOptions?.()?.autoSkipSameContent ?? true,

      (info) => { try { host.onTransferSkipped?.(info) } catch (e) { log.warn('onTransferSkipped host callback threw:', e) } },
    )
    const ports = this._buildPorts()
    this.downloadDirUseCase = new DownloadDirUseCase(
      ports, this._remoteStats(), () => host.dirDownloadConcurrency?.(),
    )
    this.downloadOneUseCase = new DownloadOneUseCase(ports, {
      getLocalPath: () => host.localPath,
      downloadDir: (remoteSrc, localDest, batch) => this.downloadRemoteDir(remoteSrc, localDest, undefined, undefined, undefined, batch),
    })
    this.uploadUseCase = new UploadPathUseCase(ports, () => host.dirUploadConcurrency?.())

    this.uploadBatchUseCase = new UploadBatchUseCase(ports)
    this.mergeLocalDirUseCase = new MergeLocalDirUseCase({
      localFs: ports.localFs,
      sftp: ports.sftp,
      execution: ports.execution,
      refreshRemote: () => host.refreshRemote(),

      folder: ports.folder,
      scanLocalDir: (dirPath) => host.scanLocalDir(dirPath),

      tarChannel: ports.tarChannel,
      tarChannelMode: () => ports.tarChannelMode,
      checkRemotePathExists: (remotePath, expectDir) =>
        this.conflictDetection.checkRemotePathExists(remotePath, expectDir),
    })
  }

  private _runScopedFolderTask<T>(fn: () => Promise<T>): Promise<T> {
    return runInTaskScope(currentTaskScope() ?? createTaskScope(), fn)
  }

  isTransferSlotActive(direction: 'upload' | 'download', remotePath: string, localPath: string): boolean {
    return this._activeTransferSlots.has(buildTransferSlotKey(direction, remotePath, localPath))
  }

  private _claimTransferSlot(
    direction: 'upload' | 'download', remotePath: string, localPath: string, displayName: string,
  ): boolean {
    const key = buildTransferSlotKey(direction, remotePath, localPath)
    if (this._activeTransferSlots.has(key)) {
      log.warn('[dup-transfer] ignored duplicate request:', key)
      try { this.host.notifyDuplicateTransfer?.(displayName) } catch { /* ignore */ }
      return false
    }
    this._activeTransferSlots.add(key)
    return true
  }

  private _releaseTransferSlot(direction: 'upload' | 'download', remotePath: string, localPath: string): void {
    this._activeTransferSlots.delete(buildTransferSlotKey(direction, remotePath, localPath))
  }

  uploadPathToRemote(remoteDir: string, localPath: string, top?: FolderTransferCtx, batch?: FileOperationBatch, moveSource = false): Promise<boolean> {

    if (top) {
      return this._runScopedFolderTask(() => this.uploadUseCase.execute(remoteDir, localPath, top, undefined, fileOperation.ensure(batch), moveSource))
    }
    const slotName = path.basename(localPath)
    const slotRemote = path.posix.join(remoteDir, slotName)
    if (!this._claimTransferSlot('upload', slotRemote, localPath, slotName)) return Promise.resolve(false)
    return this._runScopedFolderTask(() => this.uploadUseCase.execute(remoteDir, localPath, top, undefined, fileOperation.ensure(batch), moveSource))
      .finally(() => this._releaseTransferSlot('upload', slotRemote, localPath))
  }

  streamDownloadOne(file: SFTPFile, targetLocalDir?: string, batch?: FileOperationBatch): Promise<void> {
    return this.downloadOneUseCase.execute(file, targetLocalDir, fileOperation.ensure(batch))
  }

  downloadRemoteDir(
    remoteSrc: string,
    localDest: string,
    top?: FolderTransferCtx,
    localName?: string,
    forceOverwrite?: boolean,
    batch?: FileOperationBatch,
    moveSource = false,
  ): Promise<boolean> {
    const run = () => this._runScopedFolderTask(
      () => this.downloadDirUseCase.execute(remoteSrc, localDest, top, localName, undefined, !!forceOverwrite, fileOperation.ensure(batch), moveSource),
    )
    if (top) return run()

    const slotName = localName || path.posix.basename(remoteSrc)
    const slotLocal = path.join(localDest, slotName)
    if (!this._claimTransferSlot('download', remoteSrc, slotLocal, slotName)) return Promise.resolve(false)
    return run().finally(() => this._releaseTransferSlot('download', remoteSrc, slotLocal))
  }

  mergeLocalDirToRemote(localSrc: string, remoteDest: string, reuseLogEntryId?: string): Promise<boolean> {

    const slotName = path.basename(localSrc)
    if (!this._claimTransferSlot('upload', remoteDest, localSrc, slotName)) return Promise.resolve(false)
    return this._runScopedFolderTask(
      () => this.mergeLocalDirUseCase.execute(localSrc, remoteDest, true, reuseLogEntryId),
    ).finally(() => this._releaseTransferSlot('upload', remoteDest, localSrc))
  }

  uploadBatchToRemote(localPaths: string[], remoteDir: string, displayName: string): Promise<boolean> {
    if (localPaths.length < 2) return Promise.resolve(false)
    const claimed: Array<[string, string]> = []
    for (const localPath of localPaths) {
      const name = path.basename(localPath)
      const remoteTarget = path.posix.join(remoteDir, name)
      if (!this._claimTransferSlot('upload', remoteTarget, localPath, name)) {
        for (const [r, l] of claimed) this._releaseTransferSlot('upload', r, l)
        return Promise.resolve(false)
      }
      claimed.push([remoteTarget, localPath])
    }
    return this._runScopedFolderTask(
      () => this.uploadBatchUseCase.execute(localPaths, remoteDir, displayName),
    )

      .then(r => r !== 'fallback')
      .catch(e => {

        log.warn('[batch-upload] batch path threw, falling back to per-file:', e)
        return false
      })
      .finally(() => {
        for (const [r, l] of claimed) this._releaseTransferSlot('upload', r, l)
      })
  }

  checkUploadConflict(
    remotePath: string,
    localPath: string,
    localSize: number,
    localMtime: number,
  ): Promise<ConflictCheckOutcome> {
    return this.conflictDetection.checkUploadConflict(remotePath, localPath, localSize, localMtime)
  }

  checkLocalConflict(
    localPath: string,
    remotePath: string,
    remoteSize: number,
    remoteMtime: number,
  ): Promise<ConflictCheckOutcome> {
    return this.conflictDetection.checkLocalConflict(localPath, remotePath, remoteSize, remoteMtime)
  }

  checkRemotePathExists(remotePath: string, expectDir?: boolean): Promise<boolean> {
    return this.conflictDetection.checkRemotePathExists(remotePath, expectDir)
  }

  private _remoteStats(): RemoteDirStatsPort {
    const host = this.host
    return {
      scanDir: (p) => host.scanRemoteDir(p),
    }
  }

  private _tarChannel(): TarChannel {
    const host = this.host
    return new TarChannel({
      hasSsh: () => !!host.sshSession,
      exec: (cmd, timeoutMs, opts) => execSshCommand(host.sshSession, cmd, timeoutMs, opts),
      uploadFile: async (localPath, remotePath, onProgress, shouldAbort) => {
        const raw = host.sftpSession as any
        if (!raw) return false
        const up = new LocalPathFileUpload(localPath)
        const timer = setInterval(() => {
          if (shouldAbort?.() && !up.isCancelled()) void up.cancel()
          onProgress?.(up.getCompletedBytes())
        }, 400)
        try {

          if (typeof raw.createWriteStream === 'function') {
            await uploadViaRawToTemp(raw, remotePath, up, 0)
          } else {
            await raw.upload(remotePath, up)
          }
          return !up.isCancelled() && !up.isPaused() && up.isComplete()
        } catch (e) {
          log.warn('tar channel tarball upload failed:', remotePath, e)
          return false
        } finally {
          clearInterval(timer)
          up.close().catch(() => {})
        }
      },
      downloadFile: (remotePath, localPath, size, onProgress, shouldAbort) =>
        host.downloadTarBall(remotePath, localPath, size, onProgress, shouldAbort),
      remoteUnlink: async (p) => {
        try { await (host.sftpSession as any).unlink(p) } catch { /* ignore */ }
      },

      scanLocalSize: (p) => host.scanLocalDir(p).then(s => s?.size ?? 0).catch(() => 0),

      scanLocalDir: (p) => host.scanLocalDir(p).catch(() => null),

      scanLocalPaths: async (paths) => {
        let size = 0
        let count = 0
        for (const p of paths) {
          const st = await fs.stat(p).catch(() => null)
          if (!st) continue
          if (st.isDirectory()) {
            const s = await host.scanLocalDir(p).catch(() => null)
            if (s) { size += s.size; count += s.count }
          } else {
            size += st.size
            count += 1
          }
        }
        return { size, count }
      },

      scanRemoteSize: (p) => host.scanRemoteDir(p).then(s => s?.size ?? 0).catch(() => 0),

      notifyFailure: (name, code, detail) => {
        try { host.notifyTarChannelFailure?.(name, code, detail) } catch { /* ignore */ }
      },
    })
  }

  private _buildPorts(): TransferUseCasePorts {
    const host = this.host
    const conflictQueue: ConflictQueuePort = {
      enqueue: (item) => host.enqueueConflict(item),
      showDialog: () => host.showConflictDialog(),
    }
    const localFs: LocalTransferFsPort = {
      lstat: (p) => fs.lstat(p).catch(() => null),
      listChildren: async (p) => {
        const entries = await fs.readdir(p, { withFileTypes: true })
        return entries.map(e => ({ name: e.name, isSymbolicLink: e.isSymbolicLink() }))
      },
      scanDir: (p) => host.scanLocalDir(p),
      pathExists: (p) => fs.stat(p).then(() => true).catch(() => false),
      removeFile: p => fs.unlink(p),
      removeEmptyDirectory: async p => {try{await fs.rmdir(p)}catch(error:any){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(error.code))throw error}},
      mkdirRecursive: async (p) => { try { await fs.mkdir(p, { recursive: true }) } catch {} },
    }
    const sftp: SftpTransferPort = {
      hasSession: () => !!host.sftpSession,
      mkdir: async (remotePath) => {
        try { await (host.sftpSession as any).mkdir(remotePath) } catch {}
      },
      readdir: async (remoteSrc) => {
        const entries = await (host.sftpSession as any).readdir(remoteSrc)
        return entries.map((e: any) => ({
          name: e.name,
          isDirectory: !!e.isDirectory,
          isSymlink: !!(e.isSymlink || e.isSymbolicLink),
          size: e.size,
          mode: e.mode,
          modified: e.modified,
        }))
      },
      stat: async (remotePath) => {
        const session = host.sftpSession as any
        if (!session?.stat) return null
        try {
          const st = await session.stat(remotePath)
          if (!st) return null
          return {
            name: path.posix.basename(remotePath),
            isDirectory: !!st.isDirectory,
            size: st.size ?? st.attrs?.size,
            mode: st.mode ?? st.attrs?.permissions ?? st.attrs?.mode,
            modified: st.modified ?? st.mtime ?? st.mtimeMs ?? st.attrs?.modified ?? st.attrs?.mtime,
            mtime: st.mtime ?? st.attrs?.mtime,
            attrs: st.attrs,
          }
        } catch (e: any) {
          if (e?.code === 'ENOENT' || /not exist/i.test(String(e?.message))) return null
          log.warn('sftp stat failed in transfer coordinator:', remotePath, e?.message)
          return null
        }
      },
      unlink: async p => {await (host.sftpSession as any).unlink(p)},
      rmdir: async p => {try{if ((await (host.sftpSession as any).readdir(p)).some((e:any)=>e.name!=='.'&&e.name!=='..')) return; await (host.sftpSession as any).rmdir(p)}catch(error:any){if(!/not empty|no such file/i.test(error.message)&&!['ENOTEMPTY','ENOENT'].includes(error.code))throw error}},
      isSymlink: async (remotePath) => {
        const session = host.sftpSession as any
        try {
          const st = await session?.lstat?.(remotePath)
          if (st) {
            const isLink = !!(
              st.isSymbolicLink === true ||
              (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) ||
              st.isSymlink === true ||
              st.type === 2 ||
              st.attrs?.isSymlink === true ||
              st.attrs?.type === 2 ||
              st.attrs?.type === 'symbolic-link'
            )
            if (isLink) return true
          }
        } catch { /* readlink fallback below */ }
        if (typeof session?.readlink === 'function') {
          try {
            await session.readlink(remotePath)
            return true
          } catch { /* ordinary path or unsupported */ }
        }
        return false
      },
    }
    const folder: FolderTransferPort = {
      start: (...args) => host.startFolderTransfer(...args),
      finish: (ctx, success) => host.finishFolderTransfer(ctx, success),
      discard: (ctx) => {
        try { host.discardFolderTransfer?.(ctx) } catch { /* ignore */ }
      },
      updateLogSize: (ctx, size) => host.updateFolderLogSize(ctx, size),

      markChannelMode: (ctx, mode) => { try { host.markChannelMode?.(ctx, mode) } catch { /* ignore */ } },
      updateProgress: (...args) => host.updateFolderProgress(...args),
      markHadConflict: (ctx) => { ctx.hadConflict = true },
      isAborted: (ctx) => !!(ctx.t as any)?._aborted,
      isPaused: (ctx) => !!(ctx.t as any)?._paused,
      waitWhilePaused: async (ctx) => {
        while ((ctx.t as any)?._paused) {
          await new Promise(r => setTimeout(r, 1000))
          if ((ctx.t as any)?._aborted) break
        }
      },
      consumeAbortCurrent: (ctx) => {
        if ((ctx.t as any)?._abortCurrent) {
          delete (ctx.t as any)._abortCurrent
          return true
        }
        return false
      },
    }
    const execution: TransferExecutionPort = {
      uploadTopLevel: (remotePath, localPath) => host.uploadTopLevel(remotePath, localPath),
      uploadRaw: (remotePath, localPath, onProgress) => host.uploadRaw(remotePath, localPath, onProgress),
      downloadTopLevel: (remotePath, localPath, mode, size) =>
        host.downloadTopLevel(remotePath, localPath, mode, size),
      downloadRaw: (remotePath, localPath, mode, size, onProgress) =>
        host.downloadRaw(remotePath, localPath, mode, size, onProgress),
    }
    return {
      localFs,
      sftp,
      folder,
      execution,
      conflictDetection: this.conflictDetection,

      tarChannel: this._tarChannel(),
      get tarChannelMode(): string { return host.tarChannelMode?.() ?? 'smart' },

      notifyTarOnlyInapplicable: (name, reason, detail) => {
        try { host.notifyTarChannelFailure?.(name, reason, detail) } catch { /* ignore */ }
      },
      conflictQueue,
    }
  }
}

export interface PanelTransferRuntimeHost {
  connected: boolean
  sftpSession: any
  transfers: PanelTransferItem[]
  transferLog: {
    add(input: any): { id: string }
    update(id: string, patch: any): void
    remove(id: string): boolean
    getAll(): any[]
  }
  profile?: { name?: string }
  effectiveLang: string
  notifications: { error?: (message: string, detail?: string) => void } | null
  cdr: { detectChanges(): void }
  detectChanges?(): void
  zone: { run<T>(fn: () => T): T }
  formatSpeed(bytes: number, ms: number): string
}

export class PanelTransferRuntime {

  private _transferMeta = new Map<object, {
    prevBytes: number
    prevTime: number
    startTime: number
    lastProgressTime: number
  }>()
  private _transferTimer: ReturnType<typeof setInterval> | null = null
  private _trackedTransferCount = 0

  private _queuedCancelKeys = new Map<string, number>()
  private static readonly QUEUED_CANCEL_TTL_MS = 10_000

  private _disposed = false

  constructor(private readonly host: PanelTransferRuntimeHost) {}

  private _detect(): void {
    if (this._disposed) return
    if (this.host.detectChanges) this.host.detectChanges()
    else {
      try { this.host.cdr.detectChanges() } catch { /* destroyed view */ }
    }
  }

  watchFolder(entry: PanelTransferItem): void {
    if (this._transferMeta.has(entry)) return
    const now = Date.now()
    this._transferMeta.set(entry, { prevBytes: entry.bytesDone || 0, prevTime: now, startTime: now, lastProgressTime: now })
    this._trackedTransferCount++; this._startTransferTimer()
  }

  unwatchFolder(entry: PanelTransferItem): void {
    if (this._transferMeta.delete(entry)) this._trackedTransferCount--
    if (this._trackedTransferCount <= 0) { this._trackedTransferCount = 0; this._stopTransferTimer() }
  }

  private _queuedCancelKey(direction: string, localPath: string, remotePath?: string): string {
    return direction + '|' + localPath + '|' + (remotePath || '')
  }

  recordQueuedCancel(direction?: string, localPath?: string, remotePath?: string): void {
    if (!direction || !localPath) return
    const now = Date.now()

    for (const [k, ts] of this._queuedCancelKeys) {
      if (now - ts > PanelTransferRuntime.QUEUED_CANCEL_TTL_MS) this._queuedCancelKeys.delete(k)
    }
    this._queuedCancelKeys.set(this._queuedCancelKey(direction, localPath, remotePath), now)
  }

  consumeQueuedCancel(direction?: string, localPath?: string, remotePath?: string): boolean {
    if (!direction || !localPath) return false

    const keys = [
      this._queuedCancelKey(direction, localPath, remotePath),
      this._queuedCancelKey(direction, localPath),
    ]
    for (const key of keys) {
      const ts = this._queuedCancelKeys.get(key)
      if (ts == null) continue
      this._queuedCancelKeys.delete(key)
      return Date.now() - ts <= PanelTransferRuntime.QUEUED_CANCEL_TTL_MS
    }
    return false
  }

  async trackTransfer(
    t: any,
    direction: 'upload' | 'download',
    remotePath: string,
    localPath: string,
    logOperation?: 'upload' | 'download' | 'edit-upload' | 'edit-download',
  ): Promise<void> {

    if (this.consumeQueuedCancel(direction, localPath, remotePath)) {
      try { await t.cancel?.() } catch { /* ignore */ }
      return
    }

    const rawSz = await Promise.resolve(t.getSize?.())
    const sz = Number.isFinite(rawSz as number) ? Number(rawSz) : -1
    const profileName = this.host.profile?.name || undefined
    const operation = logOperation ?? direction

    const claimed = this.host.transfers.find(
      e => e.queued && e.direction === direction && e.localPath === localPath && e.remotePath === remotePath,
    )
    if (claimed) {
      if (sz === 0) {

        this.host.transfers = this.host.transfers.filter(x => x !== claimed)
        if (claimed.logEntryId != null) {
          this.host.transferLog.update(claimed.logEntryId, { success: true, duration: 0, endTime: Date.now(), pending: false })
        }
        return
      }
      claimed.transfer = t
      claimed.queued = false
      claimed.bytesTotal = sz
      claimed.bytesDone = 0
      claimed.percent = 0
      claimed.transferMode = claimed.transferMode || 'sftp'
      if (claimed.logEntryId != null) {
        this.host.transferLog.update(claimed.logEntryId, {
          size: sz, startTime: Date.now(), transferMode: claimed.transferMode || 'sftp',
        })
      }
      const claimNow = Date.now()
      this._transferMeta.set(claimed, { prevBytes: 0, prevTime: claimNow, startTime: claimNow, lastProgressTime: claimNow })
      this._trackedTransferCount++
      this._startTransferTimer()
      return
    }

    const logEntry = this.host.transferLog.add({
      operation,
      localPath,
      remotePath,
      profileName,
      success: true,

      size: sz >= 0 ? sz : undefined,
      duration: 0,
      startTime: Date.now(),

      pending: sz !== 0,
      transferMode: 'sftp',
    })

    if (sz === 0) {
      this.host.transferLog.update(logEntry.id, { success: true, duration: 0, endTime: Date.now() })
      return
    }

    const entry: PanelTransferItem = {
      transfer: t,
      direction,

      name: String(t.getName()).replace(/\.(tmp|tabby-upload)$/, ''),
      remotePath,
      localPath,
      percent: 0,
      speed: '',
      bytesDone: 0,
      bytesTotal: sz,
      logEntryId: logEntry.id,
      paused: false,
      transferMode: 'sftp',
    }
    this.host.transfers.push(entry)

    const now = Date.now()
    this._transferMeta.set(entry, { prevBytes: 0, prevTime: now, startTime: now, lastProgressTime: now })
    this._trackedTransferCount++
    this._startTransferTimer()
  }

  cancelTransfer(entry: { transfer: any; logEntryId?: string; paused?: boolean; isFolder?: boolean }): void {

    if ((entry as any).queued) {
      this.recordQueuedCancel((entry as any).direction, (entry as any).localPath, (entry as any).remotePath)
      this.host.transfers = this.host.transfers.filter(x => x !== entry)
      if (entry.logEntryId != null) {
        try { this.host.transferLog.remove(entry.logEntryId) } catch { /* ignore */ }
      }
      return
    }
    if (entry.transfer) {
      try {

        const r = typeof entry.transfer.cancel === 'function' ? entry.transfer.cancel()
          : typeof entry.transfer.destroy === 'function' ? entry.transfer.destroy()
          : undefined
        void Promise.resolve(r).catch((e: unknown) => log.warn('cancelTransfer: cancel failed', e))
      } catch (e) { log.warn('cancelTransfer: cancel threw', e) }
    }
    if (entry.isFolder) {
      ;(entry as any)._aborted = true
    }

    this._cleanupPausedDownloadTmp(entry)
    this._cleanupPausedUploadTmp(entry)
    this.host.transfers = this.host.transfers.filter(x => x !== entry)
    if (this._transferMeta.has(entry as any)) {
      this._transferMeta.delete(entry as any)
      this._trackedTransferCount--
      if (this._trackedTransferCount <= 0) {
        this._trackedTransferCount = 0
        this._stopTransferTimer()
      }
    }
    if (entry.logEntryId != null) {
      this.host.transferLog.update(entry.logEntryId, { success: false, endTime: Date.now(), failReason: 'cancelled', pending: false })
    }
  }

  cancelCurrentFile(entry: { isFolder?: boolean }): void {
    if (entry.isFolder) {
      ;(entry as any)._abortCurrent = true
    }
  }

  private _cleanupPausedDownloadTmp(entry: any): void {
    if (entry?.isFolder || !entry?.paused) return
    if (entry.direction !== 'download' || !entry.localPath) return
    const tmp = entry.localPath + '.tmp'
    try { fsSync.unlinkSync(tmp) } catch {   }
  }

  private _cleanupPausedUploadTmp(entry: any): void {
    if (entry?.isFolder || !entry?.paused) return
    if (entry.direction !== 'upload' || !entry.remotePath) return

    const session = this.host.sftpSession
    if (!session || typeof session.unlink !== 'function') return
    try {
      const p = session.unlink(entry.remotePath + '.tabby-upload')
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {   })
      }
    } catch { /* ignore */ }
  }

  async pauseTransfer(entry: any): Promise<void> {
    if (entry.queued) return
    if (entry.paused) return
    if (entry.isFolder) {

      ;(entry as any)._paused = true
      entry.paused = true
      this._detect()
      return
    }
    try {
      const offset = await entry.transfer.pause?.() ?? 0

      if (entry.direction !== 'upload') {
        await entry.transfer.cancel?.()
      }
      this.host.zone.run(() => { entry.paused = true })
      entry._pauseOffset = offset
      log.info(`Transfer paused: ${entry.name} at offset ${offset}`)
    } catch (e) {
      log.error('Pause failed', e)
    }
  }

  async resumeTransfer(entry: any): Promise<void> {
    if (entry.queued) return
    if (!entry.paused) return
    if (entry.isFolder) {
      delete (entry as any)._paused
      this.host.zone.run(() => { entry.paused = false })
      this._detect()
      return
    }
    try {
      this.host.zone.run(() => { entry.paused = false })
      this._detect()

      const direction = entry.direction as 'upload' | 'download'
      const remotePath = entry.remotePath as string
      const localPath = entry.localPath as string
      const tmpPath = localPath + '.tmp'
      const mode = entry.transfer.getMode?.() || 0o644
      const totalSize = (await Promise.resolve(entry.transfer.getSize?.())) || 0
      const offset = entry._pauseOffset ?? 0
      const info = direction === 'upload'
        ? await this._resumeTransfer(entry, 'upload', remotePath, localPath, offset)
        : await this._resumeWithRawRead(entry, remotePath, tmpPath, localPath, mode, totalSize, offset)
      this.host.zone.run(() => {
        entry.transfer = info.transfer
        entry.percent = info.percent

        const meta = this._transferMeta.get(entry as any)
        if (meta) {
          meta.prevBytes = info.transfer.getCompletedBytes?.() ?? 0
          meta.prevTime = Date.now()
          meta.startTime = Date.now()
          meta.lastProgressTime = Date.now()
        }
      })
      delete entry._pauseOffset
      log.info(`Transfer resumed: ${entry.name} (${direction})`)
    } catch (e) {
      log.error('Resume failed', e)
      entry.paused = true
    }
  }

  clearTransfers(): void {
    const now = Date.now()
    for (const t of this.host.transfers) {

      if ((t as any).isFolder) {
        ;(t as any)._aborted = true
      }

      if ((t as any).queued) {
        if (t.logEntryId) {
          try { this.host.transferLog.remove(t.logEntryId) } catch { /* ignore */ }
        }
        continue
      }

      if (t.logEntryId) {
        try {
          this.host.transferLog.update(t.logEntryId, {
            success: false, endTime: now, failReason: 'interrupted', pending: false,
          })
        } catch {}
      }
      if (t.transfer) {
        try {
          if (typeof t.transfer.cancel === 'function') t.transfer.cancel()
          else if (typeof t.transfer.destroy === 'function') t.transfer.destroy()
        } catch {}
      }

      this._cleanupPausedDownloadTmp(t)
      this._cleanupPausedUploadTmp(t)
    }
    this.host.transfers = []

    this._transferMeta.clear()
    this._trackedTransferCount = 0
    this._stopTransferTimer()
  }

  dispose(): void {
    this._disposed = true

    this._transferMeta.clear()
    this._trackedTransferCount = 0
    this._stopTransferTimer()
  }

  private _base__startTransferTimer(): void {
    if (this._transferTimer) return
    this._transferTimer = setInterval(() => this._tickAllTransfers(), 200)
  }

  private _stopTransferTimer(): void {
    if (this._transferTimer) {
      clearInterval(this._transferTimer)
      this._transferTimer = null
    }
  }

  private _base__tickAllTransfers(): void {

    if (this._disposed) {
      this._stopTransferTimer()
      return
    }
    if (this.host.transfers.length === 0) {
      this._stopTransferTimer()
      return
    }
    let needsDetect = false
    const toRemove: PanelTransferItem[] = []
    for (const entry of this.host.transfers) {
      const meta = this._transferMeta.get(entry as any)
      if (!meta) continue
      const t = entry.transfer
      if (entry.isFolder && !t) {
        const now = Date.now(), bytes = entry.bytesDone || 0
        const transmitting = !entry.paused && entry.phase === 'transferring'
        if (!transmitting || bytes > meta.prevBytes) meta.lastProgressTime = now
        const waiting = transmitting && now - meta.lastProgressTime >= SPEED_STALL_ZERO_MS
        if (entry.waitingForServer !== waiting) { entry.waitingForServer = waiting; needsDetect = true }
        if (waiting) { entry.speed = SPEED_STALL_ZERO_TEXT; entry.speedBps = 0 }
        meta.prevBytes = bytes
        continue
      }
      try {
        if (!this.host.connected) {

          try {
            if (typeof t.cancel === 'function') t.cancel()
            else if (typeof t.destroy === 'function') t.destroy()
          } catch { /* ignore */ }
          toRemove.push(entry)
          this.host.transferLog.update(entry.logEntryId!, {
            success: false,
            duration: Date.now() - meta.startTime,
            endTime: Date.now(),
            failReason: 'interrupted',
            pending: false,
          })
          continue
        }

        if (entry.paused) { entry.speed = ''; continue }
        const done = Number(t.getCompletedBytes?.()) || 0

        const total = Number(entry.bytesTotal) || 0
        const newPercent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
        entry.bytesDone = done
        const now = Date.now()
        if (done > meta.prevBytes || newPercent >= 100) {
          meta.lastProgressTime = now
        }
        const elapsed = now - meta.prevTime
        if (elapsed >= 500) {
          const delta = done - meta.prevBytes

          const windowOk = elapsed <= SPEED_WINDOW_MAX_MS

          if (windowOk && delta === 0 && now - meta.lastProgressTime >= SPEED_STALL_ZERO_MS) {
            if (entry.speed !== SPEED_STALL_ZERO_TEXT) {
              entry.speed = SPEED_STALL_ZERO_TEXT
              entry.speedBps = 0
              needsDetect = true
            }
          }

          if (windowOk && delta > 0) {
            entry.speed = this.host.formatSpeed(delta, elapsed)

            const inst = (delta * 1000) / Math.max(1, elapsed)
            const prevBps = Number(entry.speedBps) || 0
            entry.speedBps = prevBps > 0 ? prevBps * 0.65 + inst * 0.35 : inst
          }

          meta.prevBytes = done
          meta.prevTime = now
        }
        if (newPercent !== entry.percent) {
          entry.percent = newPercent
          needsDetect = true
        } else if (elapsed >= 1000) {
          needsDetect = true
        }
        const stallMs = now - meta.lastProgressTime
        if (stallMs > 900000) {
          try {
            if (typeof t.cancel === 'function') t.cancel()
            else if (typeof t.destroy === 'function') t.destroy()
          } catch { /* ignore */ }
          toRemove.push(entry)
          this.host.transferLog.update(entry.logEntryId!, {
            success: false,
            duration: now - meta.startTime,
            endTime: now,
            failReason: 'error',
            pending: false,
          })
          continue
        }
        if (t.isComplete?.() || t.isCancelled?.() || t.isFailed?.() || (!(t as any)._customStream && entry.percent >= 100)) {

          if (!entry.speed && done > 0) {
            const dur = Math.max(1, now - meta.startTime)
            entry.speed = this.host.formatSpeed(done, dur)
          }
          toRemove.push(entry)

          const finalSuccess = !t.isCancelled?.() && !t.isFailed?.()
          this.host.transferLog.update(entry.logEntryId!, { success: finalSuccess, duration: now - meta.startTime, endTime: now, failReason: finalSuccess ? undefined : 'error', pending: false })
        }
      } catch {
        toRemove.push(entry)
        this.host.transferLog.update(entry.logEntryId!, { success: false, duration: Date.now() - meta.startTime, endTime: Date.now(), failReason: 'error', pending: false })
      }
    }
    for (const entry of toRemove) {
      this._transferMeta.delete(entry as any)
      this.host.transfers = this.host.transfers.filter(x => x !== entry)
      this._trackedTransferCount--
    }
    if (needsDetect) this._detect()
    if (this._trackedTransferCount <= 0) {
      this._trackedTransferCount = 0
      this._stopTransferTimer()
    }
  }

  private async _resumeTransfer(
    entry: any,
    direction: 'upload' | 'download',
    remotePath: string,
    localPath: string,
    offset: number,
  ): Promise<{ transfer: any; percent: number }> {
    if (!this.host.sftpSession) throw new Error('No SFTP session')

    const totalSize = (await Promise.resolve(entry.transfer.getSize?.())) || 0
    const rawSftp = this.host.sftpSession as any
    const hasRawStream = direction === 'upload'
      ? typeof rawSftp.createWriteStream === 'function'
      : typeof rawSftp.createReadStream === 'function'

    if (direction === 'upload') {

      let remoteOffset = 0
      const tempPath = remotePath + '.tabby-upload'
      try {
        const tempStat = await this.host.sftpSession.stat(tempPath)
        const tempSize = Number(tempStat?.size)
        if (Number.isFinite(tempSize) && tempSize > 0 && tempSize <= totalSize) {
          remoteOffset = tempSize
        }
      } catch {

      }

      let up: LocalPathFileUpload
      if (hasRawStream) {
        up = new LocalPathFileUpload(localPath, remoteOffset)

        uploadViaRawToTemp(rawSftp, remotePath, up, remoteOffset).catch(async (e: unknown) => {
          if (this._disposed) return
          if (!up.isCancelled?.() && !up.isPaused()) {
            try { await up._markFailed?.() } catch {}
            log.error('Resume raw upload failed', e)
          }
        })
      } else {

        remoteOffset = 0
        up = new LocalPathFileUpload(localPath)

        this.host.sftpSession.upload(remotePath, up as any).catch(async (e: any) => {
          if (this._disposed) return
          if (!up.isCancelled?.()) {
            try { await up._markFailed?.() } catch {}
            log.error('Resume upload failed', e)
          }
        })
      }
      const percent = totalSize > 0 ? Math.min(99, Math.round((remoteOffset / totalSize) * 100)) : 0
      return { transfer: up, percent }
    } else {
      const percent = totalSize > 0 ? Math.min(99, Math.round((offset / totalSize) * 100)) : 0

      const tmpPath = localPath + '.tmp'
      const dl = new LocalPathFileDownload(
        tmpPath, entry.transfer.getMode?.() || 0o644, totalSize, offset,
      )
      const cleanupOnCancel = (): boolean => {

        if (dl.isCancelled?.() && !(dl as any).paused) {
          try { fsSync.unlinkSync(tmpPath) } catch { /* ignore */ }
          return true
        }
        return false
      }
      const renameOnDone = () => {
        if (cleanupOnCancel() || (dl as any).paused) return
        try {
          const stat = fsSync.statSync(tmpPath)
          if (totalSize > 0 && stat.size !== totalSize) {
            log.error(`Resume size mismatch: expected ${totalSize}, got ${stat.size}. Keep ${tmpPath}`)
            return
          }
          fsSync.renameSync(tmpPath, localPath)
          log.info(`Resume completed & renamed: ${localPath}`)
        } catch (e) {
          log.error('Resume rename failed:', e)
        }
      }
      this.host.sftpSession.download(remotePath, dl as any)
        .then(() => renameOnDone())
        .catch((e: any) => {
          if (cleanupOnCancel()) return
          if (!dl.isCancelled?.()) log.error('Resume download failed', e)
        })
      return { transfer: dl, percent }
    }
  }

  private async _resumeWithRawRead(
    entry: any, remotePath: string, tmpPath: string, localPath: string,
    mode: number, totalSize: number, offset: number,
  ): Promise<{ transfer: any; percent: number }> {
    const rawSftp = this.host.sftpSession as any

    if (!rawSftp || typeof rawSftp.open !== 'function' || typeof rawSftp.read !== 'function') {
      log.warn('Raw SFTP open/read not available, fallback to full redownload')

      try { fsSync.unlinkSync(tmpPath) } catch {}

      return this._resumeTransfer(entry, 'download', remotePath, localPath, 0)
    }
    const bufSize = 1024 * 1024
    const percent = totalSize > 0 ? Math.min(99, Math.round((offset / totalSize) * 100)) : 0
    const dl = new LocalPathFileDownload(tmpPath, mode, totalSize, offset)
    this._rawReadLoop(rawSftp, remotePath, dl, tmpPath, localPath, offset, totalSize, bufSize).catch(
      (e: any) => { if (!dl.isCancelled?.()) log.error('Raw resume failed', e) },
    )
    return { transfer: dl, percent }
  }

  private async _remoteSizeOrNegative(remotePath: string): Promise<number> {
    try {
      const st = await (this.host.sftpSession as any)?.stat?.(remotePath)
      const n = Number((st as any)?.size)
      return Number.isFinite(n) && n >= 0 ? n : -1
    } catch (e) {
      log.warn('remote stat for integrity check failed:', remotePath, e)
      return -1
    }
  }

  private async _rawReadLoop(
    rawSftp: any, remotePath: string, dl: LocalPathFileDownload,
    tmpPath: string, localPath: string,
    offset: number, totalSize: number, bufSize: number,
  ): Promise<void> {
    let position = offset
    let handle: Buffer | null = null
    try {
      handle = await new Promise<Buffer>((resolve, reject) => {
        rawSftp.open(remotePath, 'r', (err: any, h: Buffer) => { if (err) reject(err); else resolve(h) })
      })

      while ((totalSize < 0 || position < totalSize) && !dl.isCancelled?.()) {
        const buf = Buffer.alloc(bufSize)
        const bytesRead = await new Promise<number>((resolve, reject) => {
          rawSftp.read(handle, buf, 0, bufSize, position, (err: any, br: number) => {
            if (err) reject(err); else resolve(br)
          })
        })
        if (bytesRead === 0) break
        await dl.write(buf.subarray(0, bytesRead))
        position += bytesRead
      }
      await dl.close()

      if (dl.isCancelled?.() && !(dl as any).paused) {
        try { fsSync.unlinkSync(tmpPath) } catch { /* ignore */ }
        return
      }
      try {
        const stat = fsSync.statSync(tmpPath)

        let expected = totalSize
        if (expected < 0) {
          expected = await this._remoteSizeOrNegative(remotePath)
          if (expected < 0) {
            log.warn('Raw resume: remote size unverifiable, integrity not guaranteed:', remotePath, 'bytes:', stat.size)
          }
        }
        if (expected > 0 && stat.size !== expected) {
          log.error(`Raw resume size mismatch: expected ${expected}, got ${stat.size}`)

          try { await dl._markFailed?.() } catch {}
          return
        }
        fsSync.renameSync(tmpPath, localPath)
        log.info(`Raw resume completed: ${localPath}`)
        dl._markComplete?.()
      } catch (e) {
        log.error('Raw resume rename failed', e)
        try { await dl._markFailed?.() } catch {}
      }
    } catch (e) {

      try { await dl.close() } catch {}
      if (dl.isCancelled?.() && !(dl as any).paused) {

        try { fsSync.unlinkSync(tmpPath) } catch { /* ignore */ }
      } else if ((dl as any).paused) {

      } else {
        log.error('Raw resume error', e)
        try { await dl._markFailed?.() } catch {}
      }
    } finally {
      if (handle) {
        try {
          await new Promise<void>((resolve) => {
            const closeTimeout = setTimeout(() => {
              log.warn('SFTP close handle timed out')
              resolve()
            }, 5000)
            rawSftp.close(handle, () => {
              clearTimeout(closeTimeout)
              resolve()
            })
          })
        } catch {}
      }
    }
  }

  // Controller facade: named source methods, one explicit composition root.
  _startTransferTimer(...args: any[]): any { return invokeFeature("ProgressRuntime","_startTransferTimer",this,args) }
  _tickAllTransfers(...args: any[]): any { return invokeFeature("ProgressRuntime","_tickAllTransfers",this,args) }
}

export interface PanelTransferRuntime { [key: string]: any }
