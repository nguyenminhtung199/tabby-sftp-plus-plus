import { folderFileProgress, folderSkipped } from './transfer-progress'
const fileOperation = require('../../runtime/file-operation.cjs')
import * as path from 'path'

import { type ConflictQueueItem, type ConflictFileInfo, type FolderTransferCtx } from './panel-types'

import * as fs from 'fs/promises'

import { buildDownloadConflictInfo, buildUploadConflictInfo, DEFAULT_MTIME_TOLERANCE_MS, filesAreSame, isContentIdentical, type ConflictDigestInfo } from './transfer-types'
import type { ContentDigestPort } from './digest'

import { log } from '../../services/sftp-logger'

export type ConflictActionMode = 'ask' | 'overwrite' | 'skip' | 'rename'

export function conflictItemKey(item: ConflictQueueItem): string {

  return item.entryKey ?? `${item.batch?.id || ''}|${item.direction}|${item.remotePath}|${item.localPath}`
}

export function pasteEntryKey(e: {
  name: string
  fullPath?: string
  remotePath?: string
  sourcePane?: 'local' | 'remote'
  batch?: import('./panel-types').FileOperationBatch
}): string {
  const pane = e.sourcePane ?? 'local'
  const p = e.fullPath ?? e.remotePath ?? e.name
  return `${e.batch?.id || ''}|${pane}|${p}`
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

export function buildConflictRenameName(fileName: string, index = 2): string {
  const ext = path.extname(fileName), base = path.basename(fileName, ext)
  return base + ' (' + index + ')' + ext
}

export function buildConflictRenameDirName(name: string, index = 2): string { return name + ' (' + index + ')' }

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
  doDownload(remotePath: string, localPath: string, mode?: number, size?: number, onProgress?: (bytes: number) => void): Promise<boolean>
  doUpload(remotePath: string, localPath: string, onProgress?: (bytes: number) => void): Promise<boolean>
  copyLocalDir(src: string, dest: string): Promise<void>
  copyLocalFile(src: string, dest: string): Promise<void>
  copyRemoteDir(srcRemotePath: string, destRemotePath: string, isDirectory: boolean): Promise<void>

  renameRemote(src: string, dest: string): Promise<void>
  statLocal(path: string): Promise<{ isDirectory: boolean } | null>
  readdirRemote(parentDir: string): Promise<Array<{ name: string; isDirectory: boolean }>>

  cleanupMoveFolders?(ctx: FolderTransferCtx): Promise<void>
  updateFolderProgress?(ctx: FolderTransferCtx, bytes: number, name: string, done: number, size?: number): void
  markTransferSucceeded(ctx: FolderTransferCtx): void

  discardTransferLog(ctx: FolderTransferCtx): void
  isCurrentSession?(session:unknown): boolean
  hasSftpSession(): boolean

  unlinkLocal(path: string): Promise<void>

  unlinkRemote(path: string): Promise<void>

  deleteLocalRecursive(path: string): Promise<void>
  deleteRemoteRecursive(path: string): Promise<void>
}

export interface ConflictPendingPastePort {
  getBatch?(): import('./panel-types').FileOperationBatch | undefined
  hasPendingPaste(): boolean
  restoreClipboardFromPending(): void
  clearPending(): void
  resumePaste(resolvedKeys: Set<string>): Promise<void>
}

export interface ConflictQueueStatePort {
  peek?(): ConflictQueueItem | undefined
  shift(): ConflictQueueItem | undefined
  clear(): void
  replace?(items: ConflictQueueItem[]): void
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
  reportError?(fileName: string, error: unknown): void
  onResolved?(item: ConflictQueueItem, action: string): void
  cancelBatch?(batch: import('./panel-types').FileOperationBatch): void
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
  private readonly legacyActions = new WeakMap<ConflictQueueItem, 'overwrite' | 'skip' | 'rename'>()

  autoAction(item: ConflictQueueItem): 'overwrite' | 'skip' | 'rename' | null {
    const action = item.batch?.decision || this.legacyActions.get(item) || 'ask'
    return action === 'ask' || (action === 'overwrite' && item.typeMismatch) ? null : action
  }

  private _ctxHadSuccess = new Set<string>()

  async resolve(action: string): Promise<void> {
    if (this._processing) return
    this._processing = true
    try {
      this.ports.ui.hideDialog()
      const { action: normalized, allMode } = normalizeConflictAction(action)

      const current = this.ports.queue.shift()
      if (!current) {

        await this._drainQueue()
        return
      }

      if (allMode) {
        this.ports.queue.setAllMode(allMode)
        if (current.batch) current.batch.decision = allMode
        else for (const item of [current, ...this.ports.queue.snapshot()]) if (!item.batch) this.legacyActions.set(item, allMode as any)
      }
      let outcome: string = normalized
      let shouldContinue = true
      try {
        shouldContinue = await this.applyAction(current, normalized)
      } catch (e) {
        outcome = 'error'
        if (current.transferCtx) { current.transferCtx.failed = true; this._flipTransferLog(current, true) }
        log.error('Conflict resolve failed for item', current.fileName, e)
        this.ports.ui.reportError?.(current.fileName, e)
      } finally { fileOperation.settle(current); this.ports.ui.onResolved?.(current, outcome) }

      if (shouldContinue || this.ports.queue.length()) await this._drainQueue()
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

    let processed = 0
    while (this.ports.queue.length() > 0) {
      if (++processed % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
      const head = this.ports.queue.peek ? this.ports.queue.peek() : this.ports.queue.snapshot()[0]
      const mode = head && this.autoAction(head)
      if (!mode) { this.ports.ui.showNextDialog(); return }
      const item = this.ports.queue.shift()!
      let outcome: string = mode
      try { await this.applyAction(item, mode) }
      catch (error) { outcome='error'; if (item.transferCtx) { item.transferCtx.failed = true; this._flipTransferLog(item, true) }; this.ports.ui.reportError?.(item.fileName, error) }
      finally { fileOperation.settle(item); this.ports.ui.onResolved?.(item, outcome) }
    }
    await this._drainQueue()
  }

  async applyAction(
    item: ConflictQueueItem,
    action: 'cancel' | 'skip' | 'overwrite' | 'rename',
  ): Promise<boolean> {
    this.ports.queue.markResolved(conflictItemKey(item))
    const exec = this.ports.execution
    if (action !== 'cancel' && (item.batch?.cancelled || item.transferCtx?.t?._aborted)) throw new Error('Transfer cancelled; source retained.')
    if (action !== 'cancel' && item.transferCtx?.session && exec.isCurrentSession && !exec.isCurrentSession(item.transferCtx.session)) throw new Error('The SFTP session changed; source retained.')

    switch (action) {
      case 'cancel': {

        const cancelled = this.ports.queue.snapshot().filter(q => !item.batch || q.batch === item.batch)
        if (item.batch) { item.batch.cancelled = true; this.ports.ui.cancelBatch?.(item.batch) }
        this._discardConflictTransferLog(item, true)
        for (const q of cancelled) { this._discardConflictTransferLog(q, true); fileOperation.settle(q); this.ports.ui.onResolved?.(q, 'cancel') }
        this._ctxHadSuccess.clear()
        if (item.batch && this.ports.queue.replace) this.ports.queue.replace(this.ports.queue.snapshot().filter(q => q.batch !== item.batch))
        else this.ports.queue.clear()
        this.ports.queue.resetAllMode()
        if (!item.batch || !this.ports.pendingPaste.getBatch || this.ports.pendingPaste.getBatch() === item.batch) {
          this.ports.pendingPaste.restoreClipboardFromPending()
          this.ports.pendingPaste.clearPending()
        }
        if (!item.batch) this.ports.queue.clearResolvedKeys()
        return false
      }
      case 'skip':
        if(item.transferCtx) folderSkipped({updateProgress:(...args:any[])=>this.ports.execution.updateFolderProgress?.(args[0],args[1],args[2],args[3],args[4])} as any,item.transferCtx,item.fileName,item.direction==='upload'?item.localStat.size:item.remoteFileSize||0)
        await this.cleanupMoveFolders(item)
        this._finalizeSharedCtxOnSkip(item)
        return true
      case 'overwrite':
        if (item.typeMismatch) throw new Error('A file cannot replace a folder, or a folder replace a file. Choose Keep both or Skip.')

        if (item.isSamePane) {
          const outcome = await this._samePaneOverwrite(item)
          if (outcome === 'failed') throw new Error('Could not replace the destination; source retained.')
          if (outcome === 'copied') await this._deleteSourceIfCut(item, true)

        } else if (item.isDirectory) {
          let ok: boolean
          if (item.direction === 'upload') {

            ok = await exec.mergeLocalDirToRemote(item.localPath, item.remotePath)
          } else {

            ok = await exec.downloadRemoteDir(item.remotePath, path.dirname(item.localPath), undefined, true)
          }
          if (!ok) throw new Error('Folder transfer did not finish; source retained.')
          await this._deleteSourceIfCut(item, ok)
          await this.cleanupMoveFolders(item)
          this._flipTransferLog(item, ok)
        } else if (item.direction === 'download') {
          const ok = await this.transferFile(item,item.remotePath,item.localPath)
          await this._deleteSourceIfCut(item, ok)
          await this.cleanupMoveFolders(item)
          this._flipTransferLog(item, ok)
        } else {
          const ok = await this.transferFile(item,item.remotePath,item.localPath)
          await this._deleteSourceIfCut(item, ok)
          await this.cleanupMoveFolders(item)
          this._flipTransferLog(item, ok)
        }
        await this.cleanupMoveFolders(item)
        return true
      case 'rename': {

        if (item.isSamePane) {
          const newName = await this.availableName(item)
          const outcome = await this._samePaneRename(item, newName)
          if (outcome === 'failed') throw new Error('Could not keep both files; source retained.')
          if (outcome === 'copied') await this._deleteSourceIfCut(item, true)
          return true
        }
        if (item.isDirectory) {
          const newName = await this.availableName(item)
          let ok: boolean
          if (item.direction === 'upload') {
            const newRemote = path.posix.join(item.remoteDir, newName)
            ok = await exec.mergeLocalDirToRemote(item.localPath, newRemote)
          } else {
            ok = await exec.downloadRemoteDir(item.remotePath, path.dirname(item.localPath), newName, true)
          }
          if (!ok) throw new Error('Folder transfer did not finish; source retained.')
          await this._deleteSourceIfCut(item, ok)
          await this.cleanupMoveFolders(item)
          this._flipTransferLog(item, ok)
          return true
        }
        const newName = await this.availableName(item)
        if (item.direction === 'download') {
          const newLocal = path.join(path.dirname(item.localPath), newName)
          const ok = await this.transferFile(item,item.remotePath,newLocal)
          await this._deleteSourceIfCut(item, ok)
          await this.cleanupMoveFolders(item)
          this._flipTransferLog(item, ok)
        } else {
          const newRemote = path.posix.join(item.remoteDir, newName)
          const ok = await this.transferFile(item,newRemote,item.localPath)
          await this._deleteSourceIfCut(item, ok)
          await this.cleanupMoveFolders(item)
          this._flipTransferLog(item, ok)
        }
        await this.cleanupMoveFolders(item)
        return true
      }
    }
  }

  private async availableName(item: ConflictQueueItem): Promise<string> {
    const local = item.isSamePane ? item.samePaneSource === 'local' : item.direction === 'download'
    const api = local ? path : path.posix, folder = local || item.isSamePane ? api.dirname(item.localPath) : item.remoteDir
    const remoteNames = local ? null : new Set((await this.ports.execution.readdirRemote(folder)).map(e => e.name))
    for (let index=2;index<10000;index++) {
      const name = item.isDirectory ? buildConflictRenameDirName(item.fileName,index) : buildConflictRenameName(item.fileName,index)
      if (local ? !await this.ports.execution.statLocal(api.join(folder,name)) : !remoteNames!.has(name)) return name
    }
    throw new Error('Could not find an unused copy name.')
  }

  private async transferFile(item: ConflictQueueItem, remote: string, local: string): Promise<boolean> {
    const folder = { updateProgress: (ctx:any, bytes:number, name:string, done:number, size?:number) => this.ports.execution.updateFolderProgress?.(ctx,bytes,name,done,size) } as any
    const size = item.direction === 'upload' ? item.localStat.size : item.remoteFileSize || 0
    const progress = folderFileProgress(folder, item.transferCtx, local + '|' + remote, item.fileName, size)
    let ok = false
    try { ok = item.direction === 'upload' ? await this.ports.execution.doUpload(remote,local,item.transferCtx ? progress.report : undefined) : await this.ports.execution.doDownload(remote,local,0o644,item.remoteFileSize,item.transferCtx ? progress.report : undefined) }
    finally { progress.finish(ok) }
    if (!ok) { if(item.transferCtx)item.transferCtx.failed=true; throw new Error('File transfer did not finish; source retained.') }
    return ok
  }

  private async cleanupMoveFolders(item: ConflictQueueItem): Promise<void> {
    if (item.transferCtx?.moveSource && !this._remainingSharedCtxCount(item)) await this.ports.execution.cleanupMoveFolders?.(item.transferCtx)
  }

  private _remainingSharedCtxCount(item: ConflictQueueItem): number {
    if (item._ctxCounted && item.transferCtx?.pendingConflicts != null) return Math.max(0, item.transferCtx.pendingConflicts - 1) + (item.transferCtx.producing ? 1 : 0)
    const id = item.transferCtx?.logEntryId
    if (id == null || id === '') return 0
    return this.ports.queue.snapshot().filter(q => q.transferCtx?.logEntryId === id).length + (item.transferCtx?.producing ? 1 : 0)
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
    try { this.ports.execution.markTransferSucceeded(item.transferCtx) } catch { /* ignore */ }
    if (id) this._ctxHadSuccess.delete(id)
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
      throw e
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
  stat?(remotePath: string): Promise<{ size?: number; modified?: Date; mtime?: number; isDirectory?: boolean }>
  readdir(parentDir: string): Promise<Array<{ name: string; size?: number; modified?: Date; isDirectory?: boolean }>>
}

export class SftpConflictDetector implements ConflictDetectionPort {
  constructor(
    private readonly getSession: () => SftpConflictSession | null,
    private readonly mtimeToleranceMs = DEFAULT_MTIME_TOLERANCE_MS,

    private readonly digest: ContentDigestPort | null = null,

    private readonly isAutoSkipSameContent: () => boolean = () => false,

    private readonly onAutoSkipped: (info: AutoSkippedInfo) => void = () => {},
  ) {}

  private _dirListingCache = new Map<string, Promise<Map<string, { size?: number; mtime?: number; isDirectory?: boolean }>>>()

  private async _getDirListing(parentDir: string): Promise<Map<string, { size?: number; mtime?: number; isDirectory?: boolean }>> {
    const existing = this._dirListingCache.get(parentDir)
    if (existing) return existing
    const p = (async () => {
      const map = new Map<string, { size?: number; mtime?: number; isDirectory?: boolean }>()
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
            isDirectory: typeof e.isDirectory === 'function' ? e.isDirectory() : !!e.isDirectory,
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

    let found: {size?:number;mtime?:number;isDirectory?:boolean} | undefined
    if (session.stat) {
      try {
        const st:any = await session.stat(remotePath)
        const isDirectory = typeof st.isDirectory === 'function' ? st.isDirectory() : st.isDirectory ?? ((Number(st.mode||st.attrs?.mode)||0)&0o170000)===0o040000
        found = {size:st.size??st.attrs?.size,mtime:parseRemoteMtime(st),isDirectory}
      } catch(error:any) {
        if(error.code==='ENOENT'||/no such file|not found|does not exist/i.test(error.message))return {kind:'no-conflict'}
        throw error
      }
    } else found = (await this._getDirListing(parentDir)).get(fileName)
    if(found?.isDirectory)return {kind:'conflict',info:{...buildUploadConflictInfo(remotePath,localPath,fileName,localSize,localMtime,0,0),typeMismatch:true}}

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


    const digest = this.isAutoSkipSameContent() ? await this._resolveDigest(localPath, remotePath, localSize, localMtime, rs, rm) : null
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
          info: {...buildDownloadConflictInfo(localPath, remotePath, remoteSize, remoteMtime, lst.size, lst.mtimeMs),typeMismatch:true},
        }
      }
      const st = await fs.stat(localPath)
      if(st.isDirectory())return {kind:'conflict',info:{...buildDownloadConflictInfo(localPath,remotePath,remoteSize,remoteMtime,0,0),typeMismatch:true}}

      const digest = this.isAutoSkipSameContent() ? await this._resolveDigest(localPath, remotePath, st.size, st.mtimeMs, remoteSize, remoteMtime) : null
      if (this.isAutoSkipSameContent() && isContentIdentical(digest)) {
        log.info('[check-local-conflict] content identical, auto-skipped:', remotePath)
        this.onAutoSkipped({ direction: 'download', localPath, remotePath, digest: digest ?? null })
        return { kind: 'auto-skipped', digest: digest ?? null }
      }
      return { kind: 'conflict', info: buildDownloadConflictInfo(localPath, remotePath, remoteSize, remoteMtime, st.size, st.mtimeMs, digest) }
    } catch (error:any) { if (error.code !== 'ENOENT') throw error }
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
