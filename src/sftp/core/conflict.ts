import * as path from 'path'

import { type ConflictQueueItem, type ConflictFileInfo, type FolderTransferCtx } from './panel-types'

import * as fs from 'fs/promises'

import { buildDownloadConflictInfo, buildUploadConflictInfo, DEFAULT_MTIME_TOLERANCE_MS, filesAreSame, isContentIdentical, type ConflictDigestInfo } from './transfer-types'
import type { ContentDigestPort } from './digest'

import { log } from '../../services/sftp-logger'

export type ConflictActionMode = 'ask' | 'overwrite' | 'skip' | 'rename'

export function conflictItemKey(item: ConflictQueueItem): string {

  return item.entryKey ?? `${item.direction}|${item.remotePath}|${item.localPath}`
}

export function pasteEntryKey(e: {
  name: string
  fullPath?: string
  remotePath?: string
  sourcePane?: 'local' | 'remote'
}): string {
  const pane = e.sourcePane ?? 'local'
  const p = pane === 'remote' ? (e.remotePath ?? e.name) : (e.fullPath ?? e.name)
  return `${pane}|${p}`
}

export function normalizeConflictAction(action: string): {
  action: 'cancel' | 'skip' | 'overwrite' | 'rename'
  allMode: ConflictActionMode | null
} {
  if (action === 'overwrite-all') return { action: 'overwrite', allMode: 'overwrite' }
  if (action === 'skip-all') return { action: 'skip', allMode: 'skip' }
  if (action === 'rename-all') return { action: 'rename', allMode: 'rename' }
  if (action === 'cancel' || action === 'skip' || action === 'overwrite' || action === 'rename') {
    return { action, allMode: null }
  }
  return { action: 'skip', allMode: null }
}

let _renameCounter = 0
export function buildConflictRenameName(fileName: string): string {
  const ext = path.extname(fileName)
  const nameNoExt = path.basename(fileName, ext)
  const suffix = Date.now().toString(36).toUpperCase() + (++_renameCounter).toString(36).toUpperCase() + Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0')
  return `${nameNoExt}_${suffix}${ext}`
}

export function buildConflictRenameDirName(dirName: string): string {
  const suffix = Date.now().toString(36).toUpperCase() + (++_renameCounter).toString(36).toUpperCase() + Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0')
  return `${dirName}_${suffix}`
}

const EPOCH_THRESHOLD_MS = 86400000

export function parseRemoteMtime(st: any): number | undefined {
  if (!st) return undefined
  const raw = st.modified ?? st.mtime ?? st.mtimeMs ?? st.attrs?.modified ?? st.attrs?.mtime
  if (raw instanceof Date) {
    const t = raw.getTime()
    return Number.isFinite(t) && t >= EPOCH_THRESHOLD_MS ? t : undefined
  }
  if (raw != null) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return undefined
    const ms = n < 1e10 ? n * 1000 : n
    return ms >= EPOCH_THRESHOLD_MS ? ms : undefined
  }
  return undefined
}

export type AutoSkippedInfo = {
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string

  digest?: ConflictDigestInfo | null
}

export type ConflictCheckOutcome =
  | { kind: 'no-conflict' }
  | { kind: 'auto-skipped'; digest?: ConflictDigestInfo | null }
  | { kind: 'conflict'; info: ConflictFileInfo }

export interface ConflictDetectionPort {

  checkUploadConflict(
    remotePath: string,
    localPath: string,
    localSize: number,
    localMtime: number,
  ): Promise<ConflictCheckOutcome>

  checkLocalConflict(
    localPath: string,
    remotePath: string,
    remoteSize: number,
    remoteMtime: number,
  ): Promise<ConflictCheckOutcome>
  checkRemotePathExists(remotePath: string, expectDir?: boolean): Promise<boolean>
}

export interface ConflictQueuePort {
  enqueue(item: ConflictQueueItem): void
  showDialog(): void
}

export interface ConflictResolveExecutionPort {

  mergeLocalDirToRemote(localSrc: string, remoteDest: string, reuseLogEntryId?: string): Promise<boolean>

  downloadRemoteDir(remotePath: string, localDestParent: string, localName?: string, forceOverwrite?: boolean): Promise<boolean>
  doDownload(remotePath: string, localPath: string, mode?: number, size?: number): Promise<boolean>
  doUpload(remotePath: string, localPath: string): Promise<boolean>
  copyLocalDir(src: string, dest: string): Promise<void>
  copyLocalFile(src: string, dest: string): Promise<void>
  copyRemoteDir(srcRemotePath: string, destRemotePath: string, isDirectory: boolean): Promise<void>

  renameRemote(src: string, dest: string): Promise<void>
  statLocal(path: string): Promise<{ isDirectory: boolean } | null>
  readdirRemote(parentDir: string): Promise<Array<{ name: string; isDirectory: boolean }>>

  markTransferSucceeded(ctx: FolderTransferCtx): void

  discardTransferLog(ctx: FolderTransferCtx): void
  hasSftpSession(): boolean

  unlinkLocal(path: string): Promise<void>

  unlinkRemote(path: string): Promise<void>

  deleteLocalRecursive(path: string): Promise<void>
  deleteRemoteRecursive(path: string): Promise<void>
}

export interface ConflictPendingPastePort {
  hasPendingPaste(): boolean
  restoreClipboardFromPending(): void
  clearPending(): void
  resumePaste(resolvedKeys: Set<string>): Promise<void>
}

export interface ConflictQueueStatePort {
  shift(): ConflictQueueItem | undefined
  clear(): void
  length(): number

  snapshot(): ConflictQueueItem[]
  markResolved(key: string): void
  getResolvedKeys(): Set<string>
  clearResolvedKeys(): void
  getAllMode(): ConflictActionMode
  setAllMode(mode: ConflictActionMode): void
  resetAllMode(): void
  resetOriginalTotal(): void
}

export interface ConflictResolveUiPort {
  hideDialog(): void
  clearSelection(): void
  refreshPanes(): void
  showNextDialog(): void
}

export interface ConflictResolvePorts {
  execution: ConflictResolveExecutionPort
  pendingPaste: ConflictPendingPastePort
  queue: ConflictQueueStatePort
  ui: ConflictResolveUiPort
}

export class ConflictResolveUseCase {
  constructor(private readonly ports: ConflictResolvePorts) {}

  private _processing = false

  private _ctxHadSuccess = new Set<string>()

  async resolve(action: string): Promise<void> {
    if (this._processing) return
    this._processing = true
    try {
      this.ports.ui.hideDialog()
      const { action: normalized, allMode } = normalizeConflictAction(action)
      if (allMode) this.ports.queue.setAllMode(allMode)

      const current = this.ports.queue.shift()
      if (!current) {

        await this._drainQueue()
        return
      }

      let shouldContinue = true
      try {
        shouldContinue = await this.applyAction(current, normalized)
      } catch (e) {
        log.error('Conflict resolve failed for item', current.fileName, e)
      }

      if (shouldContinue) await this._drainQueue()
    } finally {
      this._processing = false
    }
  }

  private async _drainQueue(): Promise<void> {
    if (this.ports.queue.length() === 0) {
      this.ports.queue.resetAllMode()
      this.ports.queue.resetOriginalTotal()
      this._ctxHadSuccess.clear()
      this.ports.ui.clearSelection()
      if (this.ports.pendingPaste.hasPendingPaste()) {
        await this.ports.pendingPaste.resumePaste(this.ports.queue.getResolvedKeys())
        this.ports.queue.clearResolvedKeys()

        if (this.ports.queue.length() > 0) {
          this.ports.ui.showNextDialog()
        }
      } else {
        this.ports.ui.refreshPanes()
      }
      return
    }

    if (this.ports.queue.getAllMode() !== 'ask') {
      const item = this.ports.queue.shift()
      const mode = this.ports.queue.getAllMode()

      if (item && mode !== 'ask') {
        try {
          await this.applyAction(item, mode)
        } catch (e) {
          log.error('Conflict resolve failed for item', item.fileName, e)
        }
      }
      await this._drainQueue()
      return
    }

    this.ports.ui.showNextDialog()
  }

  async applyAction(
    item: ConflictQueueItem,
    action: 'cancel' | 'skip' | 'overwrite' | 'rename',
  ): Promise<boolean> {
    this.ports.queue.markResolved(conflictItemKey(item))
    const exec = this.ports.execution

    switch (action) {
      case 'cancel': {

        this._discardConflictTransferLog(item, true)
        for (const q of this.ports.queue.snapshot()) this._discardConflictTransferLog(q, true)
        this._ctxHadSuccess.clear()
        this.ports.queue.clear()
        this.ports.pendingPaste.restoreClipboardFromPending()
        this.ports.pendingPaste.clearPending()
        this.ports.queue.clearResolvedKeys()
        return false
      }
      case 'skip':

        this._finalizeSharedCtxOnSkip(item)
        return true
      case 'overwrite':

        if (item.isSamePane) {
          const outcome = await this._samePaneOverwrite(item)
          if (outcome === 'copied') await this._deleteSourceIfCut(item, true)

        } else if (item.isDirectory) {
          let ok: boolean
          if (item.direction === 'upload') {

            ok = await exec.mergeLocalDirToRemote(item.localPath, item.remotePath, item.transferCtx?.logEntryId)
          } else {

            ok = await exec.downloadRemoteDir(item.remotePath, path.dirname(item.localPath), undefined, true)
            this._flipTransferLog(item, ok)
          }
          await this._deleteSourceIfCut(item, ok)
        } else if (item.direction === 'download') {
          const ok = await exec.doDownload(item.remotePath, item.localPath, 0o644, item.remoteFileSize)
          await this._deleteSourceIfCut(item, ok)
          this._flipTransferLog(item, ok)
        } else {
          const ok = await exec.doUpload(item.remotePath, item.localPath)
          await this._deleteSourceIfCut(item, ok)
          this._flipTransferLog(item, ok)
        }
        return true
      case 'rename': {

        if (item.isSamePane) {
          const newName = item.isDirectory
            ? buildConflictRenameDirName(item.fileName)
            : buildConflictRenameName(item.fileName)
          const outcome = await this._samePaneRename(item, newName)
          if (outcome === 'copied') await this._deleteSourceIfCut(item, true)
          return true
        }
        if (item.isDirectory) {
          const newName = buildConflictRenameDirName(item.fileName)
          let ok: boolean
          if (item.direction === 'upload') {
            const newRemote = path.posix.join(item.remoteDir, newName)
            ok = await exec.mergeLocalDirToRemote(item.localPath, newRemote, item.transferCtx?.logEntryId)
          } else {
            ok = await exec.downloadRemoteDir(item.remotePath, path.dirname(item.localPath), newName, true)
            this._flipTransferLog(item, ok)
          }
          await this._deleteSourceIfCut(item, ok)
          return true
        }
        const newName = buildConflictRenameName(item.fileName)
        if (item.direction === 'download') {
          const newLocal = path.join(path.dirname(item.localPath), newName)
          const ok = await exec.doDownload(item.remotePath, newLocal, 0o644, item.remoteFileSize)
          await this._deleteSourceIfCut(item, ok)
          this._flipTransferLog(item, ok)
        } else {
          const newRemote = path.posix.join(item.remoteDir, newName)
          const ok = await exec.doUpload(newRemote, item.localPath)
          await this._deleteSourceIfCut(item, ok)
          this._flipTransferLog(item, ok)
        }
        return true
      }
    }
  }

  private _remainingSharedCtxCount(item: ConflictQueueItem): number {
    const id = item.transferCtx?.logEntryId
    if (id == null || id === '') return 0
    return this.ports.queue.snapshot().filter(q => q.transferCtx?.logEntryId === id).length
  }

  private _flipTransferLog(item: ConflictQueueItem, ok: boolean): void {
    if (!ok || !item.transferCtx) return
    const id = item.transferCtx.logEntryId
    if (id) this._ctxHadSuccess.add(id)
    if (this._remainingSharedCtxCount(item) > 0) return
    try { this.ports.execution.markTransferSucceeded(item.transferCtx) } catch { /* ignore */ }
    if (id) this._ctxHadSuccess.delete(id)
  }

  private _finalizeSharedCtxOnSkip(item: ConflictQueueItem): void {
    if (!item.transferCtx) return
    if (this._remainingSharedCtxCount(item) > 0) return
    const id = item.transferCtx.logEntryId
    if (id && this._ctxHadSuccess.has(id)) {
      try { this.ports.execution.markTransferSucceeded(item.transferCtx) } catch { /* ignore */ }
      this._ctxHadSuccess.delete(id)
      return
    }
    this._discardConflictTransferLog(item, true)
  }

  private _discardConflictTransferLog(item: ConflictQueueItem, force = false): void {
    if (!item.transferCtx) return
    if (!force && this._remainingSharedCtxCount(item) > 0) return
    try { this.ports.execution.discardTransferLog(item.transferCtx) } catch { /* ignore */ }
  }

  async processNext(): Promise<void> {
    if (this._processing) return
    this._processing = true
    try {
      await this._drainQueue()
    } finally {
      this._processing = false
    }
  }

  private async _deleteSourceIfCut(item: ConflictQueueItem, transferOk = true): Promise<void> {
    if (item.mode !== 'cut') return

    if (!transferOk) {
      log.warn('Cut source delete skipped: transfer not completed', item.fileName)
      return
    }
    const exec = this.ports.execution
    try {
      if (item.isDirectory) {

        if (item.isSamePane) {
          if (item.samePaneSource === 'local') await exec.deleteLocalRecursive(item.remotePath)
          else await exec.deleteRemoteRecursive(item.remotePath)
        } else if (item.direction === 'upload') {
          await exec.deleteLocalRecursive(item.localPath)
        } else {
          await exec.deleteRemoteRecursive(item.remotePath)
        }
        return
      }
      if (item.isSamePane) {

        if (item.samePaneSource === 'local') await exec.unlinkLocal(item.remotePath)
        else await exec.unlinkRemote(item.remotePath)
      } else if (item.direction === 'upload') {
        await exec.unlinkLocal(item.localPath)
      } else {
        await exec.unlinkRemote(item.remotePath)
      }
    } catch (e) {
      log.error('Cut source delete failed', item.remotePath, e)
    }
  }

  private async _samePaneOverwrite(item: ConflictQueueItem): Promise<'moved' | 'copied' | 'failed'> {
    const src = item.remotePath
    const dest = item.localPath
    const exec = this.ports.execution

    const sameFile = item.samePaneSource === 'local'
      ? path.resolve(src) === path.resolve(dest)
      : src === dest
    if (sameFile) return 'failed'
    if (item.samePaneSource === 'local') {
      try {
        const st = await exec.statLocal(src)
        if (!st) return 'failed'
        if (st.isDirectory) await exec.copyLocalDir(src, dest)
        else await exec.copyLocalFile(src, dest)
        return 'copied'
      } catch (e) {
        log.error('Same-pane overwrite failed', e)
        return 'failed'
      }
    }
    if (!exec.hasSftpSession()) return 'failed'
    try {

      if (item.mode === 'cut' && item.isDirectory) {
        try {
          await exec.renameRemote(src, dest)
          return 'moved'
        } catch (e) {
          log.info('same-pane dir cut: rename failed, falling back to copy+delete:', src, '->', dest, e)
        }
      }

      if (item.mode === 'cut' && !item.isDirectory) {
        const backup = dest + `.sftp-plus-bak-${Date.now()}`
        let backedUp = false
        try {
          await exec.renameRemote(src, dest)
          return 'moved'
        } catch {
          try {
            await exec.renameRemote(dest, backup)
            backedUp = true
            await exec.renameRemote(src, dest)

            try { await exec.unlinkRemote(backup) } catch {   }
            return 'moved'
          } catch (e2) {
            if (backedUp) {
              try { await exec.renameRemote(backup, dest) } catch {   }
            }
            throw e2
          }
        }
      }

      const parentDir = path.posix.dirname(src)
      const baseName = path.posix.basename(src)
      const parentEntries = await exec.readdirRemote(parentDir)
      const srcEntry = parentEntries.find(e => e.name === baseName)
      if (!srcEntry) return 'failed'

      const isDir = !!item.isDirectory && srcEntry.isDirectory !== false
      await exec.copyRemoteDir(src, dest, isDir)
      return 'copied'
    } catch (e) {
      log.error('Same-pane remote overwrite failed', e)
      return 'failed'
    }
  }

  private async _samePaneRename(item: ConflictQueueItem, newName: string): Promise<'moved' | 'copied' | 'failed'> {
    const src = item.remotePath
    const destDir = path.dirname(item.localPath)
    const dest = path.join(destDir, newName)
    const exec = this.ports.execution
    const sameFile = item.samePaneSource === 'local'
      ? path.resolve(src) === path.resolve(dest)
      : src === dest
    if (sameFile) return 'failed'
    if (item.samePaneSource === 'local') {
      try {
        const st = await exec.statLocal(src)
        if (!st) return 'failed'
        log.info('_samePaneRename local:', { src, dest, isDir: st.isDirectory })
        if (st.isDirectory) await exec.copyLocalDir(src, dest)
        else await exec.copyLocalFile(src, dest)
        return 'copied'
      } catch (e) {
        log.error('Same-pane rename failed', e)
        return 'failed'
      }
    }
    if (!exec.hasSftpSession()) return 'failed'
    try {

      const destRemote = path.posix.join(path.posix.dirname(item.localPath), newName)

      if (item.mode === 'cut' && item.isDirectory) {
        try {
          await exec.renameRemote(src, destRemote)
          return 'moved'
        } catch (e) {
          log.info('same-pane dir cut-rename failed, falling back to copy+delete:', src, '->', destRemote, e)
        }
      }
      if (item.mode === 'cut' && !item.isDirectory) {
        const backup = destRemote + `.sftp-plus-bak-${Date.now()}`
        let backedUp = false
        try {
          await exec.renameRemote(src, destRemote)
          return 'moved'
        } catch {
          try {
            await exec.renameRemote(destRemote, backup)
            backedUp = true
            await exec.renameRemote(src, destRemote)
            try { await exec.unlinkRemote(backup) } catch { /* ignore */ }
            return 'moved'
          } catch (e2) {
            if (backedUp) {
              try { await exec.renameRemote(backup, destRemote) } catch { /* ignore */ }
            }
            throw e2
          }
        }
      }
      const parentDir = path.posix.dirname(src)
      const baseName = path.posix.basename(src)
      const parentEntries = await exec.readdirRemote(parentDir)
      const srcEntry = parentEntries.find(e => e.name === baseName)
      if (!srcEntry) return 'failed'

      const isDir = !!item.isDirectory && srcEntry.isDirectory !== false
      await exec.copyRemoteDir(src, destRemote, isDir)
      return 'copied'
    } catch (e) {
      log.error('Same-pane remote rename failed', e)
      return 'failed'
    }
  }
}

export interface SftpConflictSession {
  stat?(remotePath: string): Promise<{ size?: number; modified?: Date; mtime?: number }>
  readdir(parentDir: string): Promise<Array<{ name: string; size?: number; modified?: Date; isDirectory?: boolean }>>
}

export class SftpConflictDetector implements ConflictDetectionPort {
  constructor(
    private readonly getSession: () => SftpConflictSession | null,
    private readonly mtimeToleranceMs = DEFAULT_MTIME_TOLERANCE_MS,

    private readonly digest: ContentDigestPort | null = null,

    private readonly isAutoSkipSameContent: () => boolean = () => true,

    private readonly onAutoSkipped: (info: AutoSkippedInfo) => void = () => {},
  ) {}

  private _dirListingCache = new Map<string, Promise<Map<string, { size?: number; mtime?: number }>>>()

  private async _getDirListing(parentDir: string): Promise<Map<string, { size?: number; mtime?: number }>> {
    const existing = this._dirListingCache.get(parentDir)
    if (existing) return existing
    const p = (async () => {
      const map = new Map<string, { size?: number; mtime?: number }>()
      try {
        const session = this.getSession()
        if (!session) return map
        const entries = await session.readdir(parentDir)
        for (const e of entries as any[]) {
          const rawSize = e?.size ?? e?.attrs?.size
          const size = rawSize != null ? Number(rawSize) : undefined
          map.set(e.name, {
            size: size != null && Number.isFinite(size) ? size : undefined,
            mtime: parseRemoteMtime(e),
          })
        }
      } catch {

      }
      return map
    })()

    if (this._dirListingCache.size > 256) {
      const drop = Math.ceil(256 / 4)
      let i = 0
      for (const k of this._dirListingCache.keys()) {
        if (i++ >= drop) break
        this._dirListingCache.delete(k)
      }
    }
    this._dirListingCache.set(parentDir, p)

    void p.then(() => this._dirListingCache.delete(parentDir)).catch(() => this._dirListingCache.delete(parentDir))
    return p
  }

  async checkUploadConflict(
    remotePath: string,
    localPath: string,
    localSize: number,
    localMtime: number,
  ): Promise<ConflictCheckOutcome> {
    const session = this.getSession()
    if (!session) return { kind: 'no-conflict' }
    const parentDir = path.posix.dirname(remotePath)
    const fileName = path.basename(remotePath)

    let remoteSize: number | undefined
    let remoteMtime: number | undefined

    log.info('[check-upload-conflict] remotePath:', remotePath, 'localSize:', localSize, 'localMtime:', localMtime)

    const listing = await this._getDirListing(parentDir)
    const found = listing.get(fileName)

    if (found) {
      remoteSize = found.size
      remoteMtime = found.mtime

      if ((remoteSize == null || remoteMtime == null) && session.stat) {
        try {
          const st = await session.stat(remotePath) as any
          log.info('[check-upload-conflict] stat fallback result:', JSON.stringify(st))
          const sz = st?.size ?? st?.attrs?.size
          const szNum = sz != null ? Number(sz) : undefined
          if (remoteSize == null && szNum != null && Number.isFinite(szNum) && szNum >= 0) remoteSize = szNum
          if (remoteMtime == null) {
            const mt = parseRemoteMtime(st)
            if (mt != null) remoteMtime = mt
          }
        } catch (e) {
          log.warn('[check-upload-conflict] stat fallback failed:', e)
        }
      }
    } else {
      log.info('[check-upload-conflict] not in parent listing (remote file absent):', fileName)
    }

    log.info('[check-upload-conflict] final remoteSize:', remoteSize, 'remoteMtime:', remoteMtime)

    if (remoteSize == null) {
      if (found) {
        log.warn('[check-upload-conflict] remote file exists but size unknown, forcing conflict:', remotePath)
        return {
          kind: 'conflict',
          info: buildUploadConflictInfo(remotePath, localPath, fileName, localSize, localMtime, Number.NaN, Number.NaN),
        }
      }

      return { kind: 'no-conflict' }
    }

    const rs = remoteSize
    const rm = remoteMtime ?? 0

    if (filesAreSame(localSize, localMtime, rs, rm, this.mtimeToleranceMs)) {
      log.info('[check-upload-conflict] size+mtime same, auto-skipped:', remotePath)
      this.onAutoSkipped({ direction: 'upload', localPath, remotePath, digest: null })
      return { kind: 'auto-skipped', digest: null }
    }

    const digest = await this._resolveDigest(localPath, remotePath, localSize, localMtime, rs, rm)
    if (this.isAutoSkipSameContent() && isContentIdentical(digest)) {
      log.info('[check-upload-conflict] content identical, auto-skipped:', remotePath)
      this.onAutoSkipped({ direction: 'upload', localPath, remotePath, digest: digest ?? null })
      return { kind: 'auto-skipped', digest: digest ?? null }
    }
    return { kind: 'conflict', info: buildUploadConflictInfo(remotePath, localPath, fileName, localSize, localMtime, rs, rm, digest) }
  }

  async checkLocalConflict(
    localPath: string,
    remotePath: string,
    remoteSize: number,
    remoteMtime: number,
  ): Promise<ConflictCheckOutcome> {
    try {

      const lst = await fs.lstat(localPath)
      if (lst.isSymbolicLink()) {
        log.info('[check-local-conflict] local path is a symlink, forcing conflict:', localPath)
        return {
          kind: 'conflict',
          info: buildDownloadConflictInfo(localPath, remotePath, remoteSize, remoteMtime, lst.size, lst.mtimeMs),
        }
      }
      const st = await fs.stat(localPath)
      if (filesAreSame(st.size, st.mtimeMs, remoteSize, remoteMtime, this.mtimeToleranceMs)) {
        log.info('[check-local-conflict] size+mtime same, auto-skipped:', localPath)
        this.onAutoSkipped({ direction: 'download', localPath, remotePath, digest: null })
        return { kind: 'auto-skipped', digest: null }
      }

      const digest = await this._resolveDigest(localPath, remotePath, st.size, st.mtimeMs, remoteSize, remoteMtime)
      if (this.isAutoSkipSameContent() && isContentIdentical(digest)) {
        log.info('[check-local-conflict] content identical, auto-skipped:', remotePath)
        this.onAutoSkipped({ direction: 'download', localPath, remotePath, digest: digest ?? null })
        return { kind: 'auto-skipped', digest: digest ?? null }
      }
      return { kind: 'conflict', info: buildDownloadConflictInfo(localPath, remotePath, remoteSize, remoteMtime, st.size, st.mtimeMs, digest) }
    } catch {   }
    return { kind: 'no-conflict' }
  }

  private async _resolveDigest(
    localPath: string,
    remotePath: string,
    localSize: number,
    localMtime: number,
    remoteSize: number | undefined,
    remoteMtime: number | undefined,
  ): Promise<ConflictDigestInfo | undefined> {
    if (!this.digest) {
      log.info('[resolveDigest] skipped: digest service not enabled')
      return undefined
    }
    try {
      const [localDigest, remoteDigest] = await Promise.all([
        this.digest.localDigest(localPath, localSize, localMtime),
        remoteSize != null ? this.digest.remoteDigest(remotePath, remoteSize, remoteMtime) : Promise.resolve(null),
      ])

      if (!localDigest && !remoteDigest) {
        log.info('[resolveDigest] both failed for', localPath)
        return undefined
      }
      if (!localDigest || !remoteDigest) {
        log.info('[resolveDigest] partial: local:', localDigest ? 'ok' : 'failed', 'remote:', remoteDigest ? 'ok' : 'failed')
      } else {
        log.info('[resolveDigest] computed for', localPath, 'local:', localDigest.slice(0, 8), '... remote:', remoteDigest.slice(0, 8), '...')
      }
      return { localDigest: localDigest ?? null, remoteDigest: remoteDigest ?? null }
    } catch (e) {
      log.warn('[resolveDigest] failed:', e)
      return undefined
    }
  }

  async checkRemotePathExists(remotePath: string, expectDir?: boolean): Promise<boolean> {
    const session = this.getSession()
    if (!session) return false
    if (session.stat) {
      try {
        const st = await session.stat(remotePath) as {
          isDirectory?: boolean | (() => boolean)
          mode?: number
          type?: number
        } | null
        if (!st) return false
        if (expectDir === undefined) return true

        let isDir: boolean | undefined
        if (typeof st.isDirectory === 'function') isDir = st.isDirectory()
        else if (typeof st.isDirectory === 'boolean') isDir = st.isDirectory
        else if (typeof st.type === 'number') isDir = st.type === 0
        else if (typeof st.mode === 'number') isDir = (st.mode & 0o170000) === 0o040000
        if (isDir === undefined) return false
        return expectDir ? isDir : !isDir
      } catch { return false }
    }
    const parentDir = path.posix.dirname(remotePath)
    const name = path.basename(remotePath)
    try {
      const entries = await session.readdir(parentDir)
      const found = entries.find(e => e.name === name)
      if (!found) return false
      if (expectDir === undefined) return true
      return expectDir ? !!found.isDirectory : !found.isDirectory
    } catch { return false }
  }
}
