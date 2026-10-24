import * as fs from 'fs/promises'
import * as path from 'path'

import { ConflictResolveUseCase, type ConflictResolvePorts } from '../core/conflict'
import { conflictItemKey, pasteEntryKey } from '../core/conflict'
import { deleteLocalRecursive, deleteRemoteRecursive } from '../core/fs-ops'
import type { ConflictFileInfo, ConflictQueueItem, FolderTransferCtx, LocalEntry, SFTPFile } from '../core/panel-types'

import { log } from '../../services/sftp-logger'
type ConflictActionMode = 'ask' | 'overwrite' | 'skip' | 'rename'

export interface PanelConflictResolverHost {
  sftpSession: any
  cdr: { detectChanges(): void }

  renameRemote(src: string, dest: string): Promise<void>

  conflictData: ConflictFileInfo | null
  showConflictDialog: boolean
  conflictCurrIdx: number
  conflictTotalIdx: number
  conflictOriginalTotal: number

  conflictQueue: ConflictQueueItem[]
  conflictAllMode: ConflictActionMode
  conflictResolvedKeys: Set<string>

  selectedLocal: LocalEntry[]
  selectedRemote: SFTPFile[]

  clipboardEntries: Array<{ name: string; fullPath?: string; remotePath?: string; isDirectory: boolean; sourcePane?: 'local' | 'remote'; mode?: number; size?: number }>
  clipboardSource: 'local' | 'remote'
  clipboardMode: 'copy' | 'cut'
  pendingPasteEntries: Array<{ name: string; fullPath?: string; remotePath?: string; isDirectory: boolean; sourcePane?: 'local' | 'remote'; mode?: number; size?: number }>
  pendingPasteDestPane: 'local' | 'remote'
  pendingPasteDestPath: string
  pendingPasteMode: 'copy' | 'cut'
  pendingPasteSource: 'local' | 'remote'

  refreshRemote(): Promise<boolean>
  refreshLocal(): Promise<void>
  executePaste(
    entries: Array<{ name: string; fullPath?: string; remotePath?: string; isDirectory: boolean; sourcePane?: 'local' | 'remote'; mode?: number; size?: number }>,
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
  ): Promise<void>
  doDownload(remotePath: string, localPath: string, mode?: number, size?: number): Promise<boolean>
  doUpload(remotePath: string, localPath: string): Promise<boolean>
  downloadRemoteDir(remoteDir: string, localDestDir: string, targetPane?: 'local' | 'remote', _top?: any, renameTo?: string, forceOverwrite?: boolean): Promise<boolean>
  mergeLocalDirToRemote(localSrc: string, remoteDest: string, reuseLogEntryId?: string): Promise<boolean>
  copyLocalDir(src: string, dest: string): Promise<void>
  copyRemoteDir(srcRemotePath: string, destRemotePath: string, isDirectory: boolean): Promise<void>

  markTransferSucceeded(ctx: FolderTransferCtx): void

  discardTransferLog(ctx: FolderTransferCtx): void

  scanLocalDir(dirPath: string): Promise<{ size: number; count: number }>

  scanRemoteDir(remotePath: string): Promise<{ size: number; count: number }>

  shouldAutoSkipSameContent?(): boolean

  notifyConflictAutoSkipped?(fileName: string): void

  computeConflictDigests?(args: {
    localPath: string
    remotePath: string
    localSize?: number
    localMtime?: number
    remoteSize?: number
    remoteMtime?: number
    samePaneSource?: 'local' | 'remote'
  }): Promise<{ localDigest: string | null; remoteDigest: string | null }>

  isAlive?(): boolean
}

export { pasteEntryKey }

export class PanelConflictResolver {
  private readonly useCase: ConflictResolveUseCase

  private _presenting = false

  private _pendingPresent = false

  constructor(private readonly host: PanelConflictResolverHost) {
    this.useCase = new ConflictResolveUseCase(this._buildPorts())
  }

  private get _alive(): boolean {
    try { return this.host.isAlive?.() ?? true } catch { return true }
  }

  private _detect(): void {
    if (!this._alive) return
    const cdr = this.host.cdr
    cdr.detectChanges()
  }

  showConflictDialog(): void {

    if (this._presenting) {
      this._pendingPresent = true
      return
    }
    this._presenting = true
    void this._showConflictDialogAsync()
      .catch((e: any) => { log.warn('[conflict-dialog] show chain failed:', e?.message ?? e) })
      .finally(() => {
        this._presenting = false
        if (this._pendingPresent) {
          this._pendingPresent = false
          this.showConflictDialog()
        }
      })
  }

  private async _showConflictDialogAsync(): Promise<void> {

    if (!this._alive) return
    const item = this.host.conflictQueue[0]
    if (!item) return
    this.host.conflictTotalIdx = this.host.conflictOriginalTotal
    this.host.conflictCurrIdx = this.host.conflictOriginalTotal - this.host.conflictQueue.length + 1

    if (this.host.showConflictDialog) {
      this._detect()
      return
    }

    if (!item.isDirectory) {
      await this._ensureQueueItemDigests(item)
      const ld = item.localDigest
      const rd = item.remoteDigest
      if (
        this.host.shouldAutoSkipSameContent?.()
        && ld && rd && ld === rd
      ) {
        log.info('[conflict-dialog] auto-skip identical content:', item.fileName)
        try { this.host.notifyConflictAutoSkipped?.(item.fileName) } catch { /* ignore */ }

        await this._autoSkipHeadAndContinue()
        return
      }
    }

    this._presentConflictDialog(item)
  }

  private async _autoSkipHeadAndContinue(): Promise<void> {

    if (!this._alive) return
    const current = this.host.conflictQueue.shift()
    if (!current) return
    this.host.conflictResolvedKeys.add(conflictItemKey(current))

    if (current.transferCtx) {
      try { this.host.discardTransferLog(current.transferCtx) } catch { /* ignore */ }
    }

    if (this.host.conflictQueue.length > 0) {
      await this._showConflictDialogAsync()
      return
    }

    this.host.conflictAllMode = 'ask'
    this.host.conflictOriginalTotal = 1
    this.host.selectedLocal = []
    this.host.selectedRemote = []
    if (this.host.pendingPasteEntries.length > 0) {
      const entries = this.host.pendingPasteEntries
      const destPane = this.host.pendingPasteDestPane
      const destPath = this.host.pendingPasteDestPath
      const mode = this.host.pendingPasteMode
      const source = this.host.pendingPasteSource
      const resolvedKeys = new Set(this.host.conflictResolvedKeys)
      this.host.pendingPasteEntries = []
      this.host.pendingPasteDestPane = 'local'
      this.host.pendingPasteDestPath = ''
      this.host.pendingPasteMode = 'copy'
      this.host.pendingPasteSource = 'local'
      this.host.conflictResolvedKeys.clear()
      await this.host.executePaste(
        entries.filter(e => !resolvedKeys.has(pasteEntryKey(e))),
        destPane, destPath, mode, source,
      )
      if (this.host.conflictQueue.length > 0) {
        await this._showConflictDialogAsync()
      }
    } else {
      void this.host.refreshRemote()
      void this.host.refreshLocal()
    }
    this._detect()
  }

  private async _ensureQueueItemDigests(item: ConflictQueueItem): Promise<void> {
    if (item.localDigest && item.remoteDigest) return
    if (!this.host.computeConflictDigests) return
    const remoteFilePath = item.remotePath || path.posix.join(item.remoteDir, item.fileName)
    try {
      const { localDigest, remoteDigest } = await this.host.computeConflictDigests({
        localPath: item.localPath,
        remotePath: remoteFilePath,
        localSize: Number(item.localStat?.size) || undefined,
        localMtime: Number(item.localStat?.mtimeMs) || undefined,
        remoteSize: item.remoteFileSize,
        remoteMtime: item.remoteFileMtime,

        samePaneSource: item.isSamePane ? item.samePaneSource : undefined,
      })
      if (localDigest) item.localDigest = localDigest
      if (remoteDigest) item.remoteDigest = remoteDigest
    } catch (e: any) {
      log.warn('[conflict-dialog] ensure digests failed:', e?.message ?? e)
    }
  }

  private _presentConflictDialog(item: ConflictQueueItem): void {
    const isDir = !!item.isDirectory

    const knownLocalContent = isDir && Number(item.localStat?.size) > 0
    const knownRemoteMtime = validConflictMtime(item.remoteFileMtime)
    this.host.conflictData = {
      localPath: item.localPath,
      remotePath: item.remotePath,
      fileName: item.fileName,

      localSize: isDir ? (knownLocalContent ? Number(item.localStat.size) : 0) : item.localStat.size,
      remoteSize: isDir ? 0 : (item.remoteFileSize ?? 0),
      localMtime: item.localStat.mtimeMs,
      remoteMtime: knownRemoteMtime ?? 0,
      remoteDir: item.remoteDir,
      direction: item.direction,
      isSamePane: item.isSamePane ?? false,
      isDirectory: isDir,
      localSizePending: isDir && !knownLocalContent,
      remoteSizePending: isDir,

      localDigest: item.localDigest ?? null,
      remoteDigest: item.remoteDigest ?? null,

      contentIdentical: !!item.localDigest && !!item.remoteDigest && item.localDigest === item.remoteDigest,
      contentDiffers: !!item.localDigest && !!item.remoteDigest && item.localDigest !== item.remoteDigest,
    }

    const remoteFilePath = item.remotePath || path.posix.join(item.remoteDir, item.fileName)
    log.info('[conflict-dialog] initial remoteMtime:', item.remoteFileMtime, 'remotePath:', remoteFilePath, 'hasStat:', typeof (this.host.sftpSession as any)?.stat)

    const itemToken = `${item.localPath}|${item.remotePath}`
    const isStillCurrent = (): boolean =>
      this._alive && !!this.host.showConflictDialog && !!this.host.conflictData
      && `${this.host.conflictData.localPath}|${this.host.conflictData.remotePath}` === itemToken

    const skipRemoteStat = item.isSamePane && item.samePaneSource === 'local'
    if (!skipRemoteStat && remoteFilePath && this.host.sftpSession && typeof (this.host.sftpSession as any).stat === 'function') {
      (this.host.sftpSession as any).stat(remoteFilePath).then((st: any) => {
        if (!isStillCurrent() || !st) return

        if (!item.isDirectory) {
          log.info('[conflict-dialog] stat result:', JSON.stringify(st))
          const sz = statSize(st)
          if (sz != null) this.host.conflictData.remoteSize = sz
        }
        const mt = statMtimeToMs(st)
        log.info('[conflict-dialog] parsed remoteMtime:', mt, 'from stat')

        if (mt != null && mt > 0) {
          const cur = this.host.conflictData.remoteMtime
          if (!validConflictMtime(cur)) this.host.conflictData.remoteMtime = mt
        }
        this._detect()
      }).catch((e: any) => {
        log.warn('[conflict-dialog] stat failed:', e?.message ?? e)
      })
    }

    if (isDir) {
      const localPath = item.localPath
      if (!knownLocalContent && localPath) {
        void this.host.scanLocalDir(localPath).then((r) => {
          if (!isStillCurrent()) return
          this.host.conflictData.localSize = (r && r.size >= 0) ? r.size : 0
          this.host.conflictData.localSizePending = false
          this._detect()
        }).catch((e: any) => {
          log.warn('[conflict-dialog] scanLocalDir failed:', e?.message ?? e)
          if (!isStillCurrent()) return
          this.host.conflictData.localSizePending = false
          this._detect()
        })
      } else if (!knownLocalContent) {
        this.host.conflictData.localSizePending = false
      }
      if (remoteFilePath) {
        void this.host.scanRemoteDir(remoteFilePath).then((r) => {
          if (!isStillCurrent()) return
          this.host.conflictData.remoteSize = (r && r.size >= 0) ? r.size : 0
          this.host.conflictData.remoteSizePending = false
          this._detect()
        }).catch((e: any) => {
          log.warn('[conflict-dialog] scanRemoteDir failed:', e?.message ?? e)
          if (!isStillCurrent()) return
          this.host.conflictData.remoteSizePending = false
          this._detect()
        })
      } else {
        this.host.conflictData.remoteSizePending = false
      }
    }

    if (!isDir && (!item.localDigest || !item.remoteDigest) && this.host.computeConflictDigests) {
      const digestLocalPath = item.localPath
      const digestRemotePath = remoteFilePath
      void this.host.computeConflictDigests({
        localPath: digestLocalPath,
        remotePath: digestRemotePath,
        localSize: Number(item.localStat?.size) || undefined,
        localMtime: Number(item.localStat?.mtimeMs) || undefined,
        remoteSize: item.remoteFileSize,
        remoteMtime: item.remoteFileMtime,

        samePaneSource: item.isSamePane ? item.samePaneSource : undefined,
      }).then(({ localDigest, remoteDigest }) => {

        if (!isStillCurrent()) return
        if (localDigest) this.host.conflictData.localDigest = localDigest
        if (remoteDigest) this.host.conflictData.remoteDigest = remoteDigest
        const ld = this.host.conflictData.localDigest
        const rd = this.host.conflictData.remoteDigest
        this.host.conflictData.contentIdentical = !!ld && !!rd && ld === rd
        this.host.conflictData.contentDiffers = !!ld && !!rd && ld !== rd
        this._detect()
      }).catch((e: any) => {
        log.warn('[conflict-dialog] compute digests failed:', e?.message ?? e)
      })
    }
    this.host.showConflictDialog = true
    this._detect()
  }

  resolveConflict(action: string): void {
    void this.useCase.resolve(action)
  }

  private _buildPorts(): ConflictResolvePorts {
    const host = this.host
    return {
      execution: {
        mergeLocalDirToRemote: (localSrc, remoteDest, reuseLogEntryId) => host.mergeLocalDirToRemote(localSrc, remoteDest, reuseLogEntryId),
        downloadRemoteDir: (remotePath, localDestParent, localName, forceOverwrite) =>
          host.downloadRemoteDir(remotePath, localDestParent, 'local', undefined, localName, forceOverwrite),
        doDownload: (remotePath, localPath, mode, size) => host.doDownload(remotePath, localPath, mode, size),
        doUpload: (remotePath, localPath) => host.doUpload(remotePath, localPath),
        copyLocalDir: (src, dest) => host.copyLocalDir(src, dest),
        copyLocalFile: async (src, dest) => {

          try {
            const ra = await fs.realpath(src)
            const rb = await fs.realpath(dest).catch(() => null)
            if (rb && (ra === rb || (process.platform === 'win32' && ra.toLowerCase() === rb.toLowerCase()))) {
              log.warn('resolver copyLocalFile self-copy skipped:', src, '->', dest)
              return
            }
          } catch {}
          log.info('resolver copyLocalFile:', src, '->', dest)
          return fs.copyFile(src, dest)
        },
        copyRemoteDir: (src, dest, isDirectory) => host.copyRemoteDir(src, dest, isDirectory),
        renameRemote: (src, dest) => host.renameRemote(src, dest),
        statLocal: async (p) => {
          try {
            const st = await fs.stat(p)
            return { isDirectory: st.isDirectory() }
          } catch { return null }
        },
        readdirRemote: async (parentDir) => {
          const entries = await host.sftpSession.readdir(parentDir)
          return entries.map((e: any) => ({ name: e.name, isDirectory: !!e.isDirectory }))
        },
        hasSftpSession: () => !!host.sftpSession,
        unlinkLocal: async (p) => { await fs.unlink(p) },
        unlinkRemote: async (p) => {
          if (host.sftpSession) await host.sftpSession.unlink(p)
        },
        deleteLocalRecursive: async (p) => { await deleteLocalRecursive(p) },
        deleteRemoteRecursive: async (p) => { await deleteRemoteRecursive(host.sftpSession, p) },

        markTransferSucceeded: (ctx) => host.markTransferSucceeded(ctx),

        discardTransferLog: (ctx) => host.discardTransferLog(ctx),
      },
      pendingPaste: {
        hasPendingPaste: () => host.pendingPasteEntries.length > 0,
        restoreClipboardFromPending: () => {
          host.clipboardEntries = host.pendingPasteEntries.slice()
          host.clipboardSource = host.pendingPasteSource
          host.clipboardMode = host.pendingPasteMode
        },
        clearPending: () => {
          host.pendingPasteEntries = []
        },
        resumePaste: async (resolvedKeys) => {
          const entries = host.pendingPasteEntries
          const destPane = host.pendingPasteDestPane
          const destPath = host.pendingPasteDestPath
          const mode = host.pendingPasteMode
          const source = host.pendingPasteSource
          host.pendingPasteEntries = []
          host.pendingPasteDestPane = 'local'
          host.pendingPasteDestPath = ''
          host.pendingPasteMode = 'copy'
          host.pendingPasteSource = 'local'
          await host.executePaste(
            entries.filter(e => !resolvedKeys.has(pasteEntryKey(e))),
            destPane, destPath, mode, source,
          )
        },
      },
      queue: {
        shift: () => host.conflictQueue.shift(),
        clear: () => { host.conflictQueue = [] },
        length: () => host.conflictQueue.length,
        snapshot: () => host.conflictQueue.slice(),
        markResolved: (key) => { host.conflictResolvedKeys.add(key) },
        getResolvedKeys: () => host.conflictResolvedKeys,
        clearResolvedKeys: () => { host.conflictResolvedKeys.clear() },
        getAllMode: () => host.conflictAllMode,
        setAllMode: (mode) => { host.conflictAllMode = mode },
        resetAllMode: () => { host.conflictAllMode = 'ask' },
        resetOriginalTotal: () => { host.conflictOriginalTotal = 1 },
      },
      ui: {
        hideDialog: () => { host.showConflictDialog = false },
        clearSelection: () => {
          host.selectedLocal = []
          host.selectedRemote = []
        },
        refreshPanes: () => {
          void host.refreshRemote()
          void host.refreshLocal()

          this._detect()
        },
        showNextDialog: () => this.showConflictDialog(),
      },
    }
  }
}

function statSize(st: any): number | undefined {
  const v = st?.size ?? st?.attrs?.size
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const EPOCH_THRESHOLD_MS = 86400000

function validConflictMtime(ms?: number | null): number | undefined {
  if (ms == null) return undefined
  const n = Number(ms)
  return Number.isFinite(n) && n >= EPOCH_THRESHOLD_MS ? n : undefined
}

function statMtimeToMs(st: any): number | undefined {
  const raw = st?.modified ?? st?.mtime ?? st?.mtimeMs ?? st?.attrs?.modified ?? st?.attrs?.mtime
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
