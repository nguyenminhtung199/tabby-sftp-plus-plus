import * as path from 'path'

import { type Stats } from 'fs'

import { pasteEntryKey, parseRemoteMtime } from './conflict'

import { safeEntryName } from './path-utils'

import { type ConflictQueueItem } from './panel-types'

import * as fs from 'fs/promises'

import { copyLocalDir, copyRemoteDir, deleteLocalRecursive, deleteRemoteRecursive, isPathInside, tryRemoteCpViaSsh } from './fs-ops'

import { log } from '../../services/sftp-logger'

export type PasteEntry = {
  name: string
  fullPath?: string
  isDirectory: boolean
  mode?: number
  size?: number
  mtimeMs?: number
}

export interface PasteTransferPort {

  uploadFile(remotePath: string, localPath: string): Promise<boolean>
  downloadFile(remotePath: string, localPath: string, mode?: number, size?: number): Promise<boolean>
  uploadDirectory(localSrc: string, remoteDestParent: string): Promise<boolean>
  downloadDirectory(remoteSrc: string, localDestParent: string): Promise<boolean>
}

export interface PasteFsPort {
  copyLocalDir(src: string, dest: string): Promise<void>
  copyLocalFile(src: string, dest: string): Promise<void>
  renameLocal(src: string, dest: string): Promise<void>
  copyRemoteDir(src: string, dest: string, isDir: boolean): Promise<void>
  renameRemote(src: string, dest: string): Promise<void>
  deleteLocalRecursive(path: string): Promise<void>
  deleteRemoteRecursive(path: string): Promise<void>
  localDirExists(path: string): Promise<boolean>
  statLocal(path: string): Promise<Stats | null>

  scanLocalDir?(dirPath: string): Promise<{ size: number; count: number }>
  readdirRemote(parentDir: string): Promise<Array<{
    name: string
    size?: number
    modified?: Date | number | string
    mtime?: number
    attrs?: { size?: number; mtime?: number; modified?: Date | number | string }
  }>>
}

export interface PasteConflictPort {
  checkDestExists(pane: 'local' | 'remote', filePath: string): Promise<boolean>
  checkRemotePathExists(remotePath: string, expectDir?: boolean): Promise<boolean>
  enqueue(item: ConflictQueueItem): void
  showDialog(): void
  queueLength(): number
  setOriginalTotal(count: number): void
}

export interface PastePendingPort {
  save(entries: PasteEntry[], destPane: 'local' | 'remote', destPath: string, mode: 'copy' | 'cut', source: 'local' | 'remote'): void
}

export interface PasteUiPort {
  refreshLocal(): Promise<void>
  refreshRemote(): Promise<unknown>
  notifyPasteFailed(): void
  hasSftpSession(): boolean
}

export interface PastePorts {
  transfer: PasteTransferPort
  fs: PasteFsPort
  conflict: PasteConflictPort
  pending: PastePendingPort
  ui: PasteUiPort

  notify: {
    error(key: string, params?: Record<string, string | number>): void
  }
}

export class PasteUseCase {
  constructor(private readonly ports: PastePorts) {}

  async scanConflicts(
    entries: PasteEntry[],
    destPane: 'local' | 'remote',
    destPath: string,
    source: 'local' | 'remote',
    mode: 'copy' | 'cut',
  ): Promise<boolean> {
    for (const entry of entries) {

      const safeName = safeEntryName(entry.name)
      if (!safeName) {
        log.warn('skip unsafe paste entry in scanConflicts:', entry.name)
        continue
      }
      const destFilePath = destPane === 'local'
        ? path.join(destPath, safeName)
        : path.posix.join(destPath, safeName)

      if (entry.isDirectory) {
        // Cross-pane directories use the recursive upload/download file conflict checks.
        if (source === destPane) {

          const exists = await this.ports.conflict.checkDestExists(destPane, destFilePath)
          if (exists) {
            const srcPath = entry.fullPath ?? ''
            const destStat: Stats = { size: entry.size ?? 0, mtimeMs: entry.mtimeMs ?? Date.now() } as Stats
            this.ports.conflict.enqueue({
              localPath: destFilePath,
              remoteDir: destPane === 'remote' ? destPath : path.posix.dirname(srcPath),
              fileName: safeName,
              remotePath: srcPath,
              localStat: destStat,
              direction: 'upload',
              isDirectory: true,
              isSamePane: true,
              samePaneSource: source,
              remoteFileSize: entry.size ?? 0,
              remoteFileMtime: entry.mtimeMs ?? Date.now(),
              entryKey: pasteEntryKey(entry),
              mode,
            })
          }
        }
        continue
      }

      const exists = await this.ports.conflict.checkDestExists(destPane, destFilePath)
      if (!exists) continue

      const isSamePane = source === destPane
      const direction: 'upload' | 'download' = isSamePane ? 'upload'
        : (source === 'local' && destPane === 'remote') ? 'upload'
        : 'download'

      let destStat: Stats = { size: 0, mtimeMs: Date.now() } as Stats
      if (isSamePane) {
        if (destPane === 'local') {
          const st = await this.ports.fs.statLocal(destFilePath)
          if (st) destStat = st
        } else if (this.ports.ui.hasSftpSession()) {
          try {
            const dir = path.posix.dirname(destFilePath)
            const name = path.posix.basename(destFilePath)
            const remoteEntries = await this.ports.fs.readdirRemote(dir)
            const found = remoteEntries.find(e => e.name === name)
            if (found) {
              destStat = {
                size: found.size ?? found.attrs?.size ?? 0,
                mtimeMs: parseRemoteMtime(found) ?? Date.now(),
              } as Stats
            }
          } catch { /* ignore */ }
        }
      } else if (destPane === 'remote') {

        const meta = await this._remoteListingMeta(destPath, safeName)
        destStat = {
          size: meta.size ?? 0,
          mtimeMs: meta.mtimeMs ?? Date.now(),
        } as Stats
      } else if (destPane === 'local') {
        const st = await this.ports.fs.statLocal(destFilePath)
        if (st) destStat = st
      }

      this.ports.conflict.enqueue(this._buildFileConflictItem(
        entry, destPane, destPath, source, destFilePath, isSamePane, direction, destStat, mode,
      ))
    }

    return this.ports.conflict.queueLength() > 0
  }

  async execute(
    entries: PasteEntry[],
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
  ): Promise<void> {

    let failed = 0
    for (const entry of entries) {
      try {
        const srcPath = entry.fullPath ?? ''
        if (!srcPath) continue

        const safeName = safeEntryName(entry.name)
        if (!safeName) {
          log.warn('skip unsafe paste entry name:', entry.name)
          continue
        }
        const destFilePath = destPane === 'local'
          ? path.join(destPath, safeName)
          : path.posix.join(destPath, safeName)

        if (source === destPane) {
          await this._pasteSamePane(entry, srcPath, destFilePath, destPane, mode)
        } else if (source === 'local' && destPane === 'remote') {
          await this._pasteLocalToRemote(entry, srcPath, destPath, destFilePath, mode)
        } else {
          await this._pasteRemoteToLocal(entry, srcPath, destPath, destFilePath, mode)
        }
      } catch (e) {
        failed++
        log.error('Paste entry failed:', entry.name, e)
      }
    }
    try {
      if (destPane === 'local' || source === 'local') await this.ports.ui.refreshLocal()
      if (destPane === 'remote' || source === 'remote') await this.ports.ui.refreshRemote()
    } catch (e) {
      log.warn('Paste post-refresh failed:', e)
    }
    if (failed > 0) {
      this.ports.ui.notifyPasteFailed()
    }
  }

  private async _pasteSamePane(
    entry: PasteEntry,
    srcPath: string,
    destFilePath: string,
    destPane: 'local' | 'remote',
    mode: 'copy' | 'cut',
  ): Promise<void> {

    log.info('_pasteSamePane:', { srcPath, destFilePath, destPane, mode, isDir: entry.isDirectory })

    if (destPane === 'local'
      ? path.resolve(srcPath) === path.resolve(destFilePath)
      : srcPath === destFilePath) {
      log.warn('_pasteSamePane self-copy skipped:', srcPath)
      return
    }

    if (entry.isDirectory && isPathInside(srcPath, destFilePath, destPane !== 'local')) {
      log.warn('_pasteSamePane refused copy into self:', srcPath, '->', destFilePath)
      this.ports.notify.error('op.cannotCopyIntoSelf', { name: entry.name })
      return
    }
    if (destPane === 'local') {
      if (mode === 'copy') {
        if (entry.isDirectory) await this.ports.fs.copyLocalDir(srcPath, destFilePath)
        else await this.ports.fs.copyLocalFile(srcPath, destFilePath)
      } else {
        await this.ports.fs.renameLocal(srcPath, destFilePath)
      }
      return
    }
    if (mode === 'copy') {
      await this.ports.fs.copyRemoteDir(srcPath, destFilePath, entry.isDirectory)
    } else if (this.ports.ui.hasSftpSession()) {
      await this.ports.fs.renameRemote(srcPath, destFilePath)
    }
  }

  private async _pasteLocalToRemote(
    entry: PasteEntry,
    srcPath: string,
    destPath: string,
    destFilePath: string,
    mode: 'copy' | 'cut',
  ): Promise<void> {
    if (entry.isDirectory) {
      const ok = await this.ports.transfer.uploadDirectory(srcPath, destPath)

      if (mode === 'cut') {
        if (!ok) throw new Error('Cut-paste aborted: directory upload not completed: ' + srcPath)
        if (!await this.ports.conflict.checkRemotePathExists(destFilePath, true)) {
          throw new Error('Cut-paste aborted: destination directory not found: ' + destFilePath)
        }
        await this.ports.fs.deleteLocalRecursive(srcPath)
      }
    } else {
      const ok = await this.ports.transfer.uploadFile(destFilePath, srcPath)

      if (mode === 'cut') {
        if (!ok) throw new Error('Cut-paste aborted: upload not completed: ' + srcPath)
        await this.ports.fs.deleteLocalRecursive(srcPath)
      }
    }
  }

  private async _pasteRemoteToLocal(
    entry: PasteEntry,
    srcPath: string,
    destPath: string,
    destFilePath: string,
    mode: 'copy' | 'cut',
  ): Promise<void> {
    if (entry.isDirectory) {

      const destDir = destFilePath
      const ok = await this.ports.transfer.downloadDirectory(srcPath, destPath)

      if (mode === 'cut' && this.ports.ui.hasSftpSession()) {
        if (!ok) throw new Error('Cut-paste aborted: directory download not completed: ' + srcPath)
        if (!await this.ports.fs.localDirExists(destFilePath)) {
          throw new Error('Cut-paste aborted: destination directory not found: ' + destFilePath)
        }
        await this.ports.fs.deleteRemoteRecursive(srcPath)
      }
    } else {
      const ok = await this.ports.transfer.downloadFile(srcPath, destFilePath, entry.mode, entry.size)

      if (mode === 'cut' && this.ports.ui.hasSftpSession()) {
        if (!ok) throw new Error('Cut-paste aborted: download not completed: ' + srcPath)
        await this.ports.fs.deleteRemoteRecursive(srcPath)
      }
    }
  }

  private _buildFileConflictItem(
    entry: PasteEntry,
    destPane: 'local' | 'remote',
    destPath: string,
    source: 'local' | 'remote',
    destFilePath: string,
    isSamePane: boolean,
    direction: 'upload' | 'download',
    destStat: Stats,
    mode: 'copy' | 'cut',
  ): ConflictQueueItem {

    const remoteSize = destPane === 'remote'
      ? Number(destStat.size) || 0
      : (entry.size ?? 0)
    const remoteMtime = destPane === 'remote'
      ? Number(destStat.mtimeMs) || Date.now()
      : (entry.mtimeMs ?? Date.now())
    const localStat = isSamePane
      ? destStat
      : (source === 'local'
        ? { size: entry.size ?? 0, mtimeMs: entry.mtimeMs ?? Date.now() } as Stats
        : destStat)
    return {
      localPath: isSamePane ? destFilePath : (source === 'local' ? (entry.fullPath ?? '') : destFilePath),
      remoteDir: destPane === 'remote' ? destPath : path.posix.dirname(entry.fullPath ?? ''),
      fileName: entry.name,
      remotePath: isSamePane ? (entry.fullPath ?? '') : (destPane === 'remote' ? destFilePath : (entry.fullPath ?? '')),
      localStat,
      direction,
      remoteFileSize: remoteSize,
      remoteFileMtime: remoteMtime,
      isSamePane,
      samePaneSource: isSamePane ? source : undefined,
      entryKey: pasteEntryKey(entry),
      mode,
    }
  }

  private async _remoteListingMeta(
    parentDir: string,
    name: string,
  ): Promise<{ size?: number; mtimeMs?: number }> {
    if (!parentDir || !name) return {}
    try {
      const entries = await this.ports.fs.readdirRemote(parentDir)
      const found = entries.find(e => e.name === name)
      if (!found) return {}
      const sz = found.size ?? found.attrs?.size
      const mtimeMs = parseRemoteMtime(found)
      return {
        size: sz != null && Number.isFinite(Number(sz)) ? Number(sz) : undefined,
        mtimeMs,
      }
    } catch (e) {
      log.warn('[paste] readdir remote listing meta failed:', parentDir, name, e)
      return {}
    }
  }
}

export interface PanelPasteHost {
  sftpSession: unknown

  sshSession?: unknown
  effectiveLang: string
  i18n: { t(key: string, params?: Record<string, string | number>): string }
  notifications: { error?(msg: string, detail: string): void } | null

  scanLocalDir?(dirPath: string): Promise<{ size: number; count: number }>

  uploadFile(remotePath: string, localPath: string): Promise<boolean>
  downloadFile(remotePath: string, localPath: string, mode?: number, size?: number): Promise<boolean>
  uploadDirectory(localSrc: string, remoteDestParent: string): Promise<boolean>
  downloadDirectory(remoteSrc: string, localDestParent: string): Promise<boolean>

  checkRemotePathExists(remotePath: string, expectDir?: boolean): Promise<boolean>
  enqueueConflict(item: import('../core/panel-types').ConflictQueueItem): void
  showConflictDialog(): void
  getConflictQueueLength(): number
  setConflictOriginalTotal(count: number): void

  savePendingPaste(
    entries: PasteEntry[],
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
  ): void

  renameRemote(src: string, dest: string): Promise<void>
  refreshLocal(): Promise<void>
  refreshRemote(): Promise<unknown>
}

export class PanelPasteAdapter {
  private readonly useCase: PasteUseCase

  constructor(private readonly host: PanelPasteHost) {
    this.useCase = new PasteUseCase(this._buildPorts())
  }

  async paste(
    entries: PasteEntry[],
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
  ): Promise<void> {
    const hasConflicts = await this.useCase.scanConflicts(entries, destPane, destPath, source, mode)
    if (hasConflicts) {
      this.host.savePendingPaste(entries, destPane, destPath, mode, source)
      this.host.setConflictOriginalTotal(this.host.getConflictQueueLength())
      this.host.showConflictDialog()
      return
    }
    await this.useCase.execute(entries, destPane, destPath, mode, source)
  }

  executePaste(
    entries: PasteEntry[],
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
  ): Promise<void> {
    return this.useCase.execute(entries, destPane, destPath, mode, source)
  }

  private _buildPorts(): PastePorts {
    const host = this.host
    const remoteCopyDeps = {
      hasSession: () => !!host.sftpSession,
      mkdir: async (p: string) => { await (host.sftpSession as any).mkdir(p) },
      readdir: async (p: string) => {
        const entries = await (host.sftpSession as any).readdir(p)
        return entries.map((e: any) => ({
          name: e.name,
          isDirectory: !!e.isDirectory,
          isSymbolicLink: !!(e.isSymlink || e.isSymbolicLink),
        }))
      },
      download: (r: string, l: string) => host.downloadFile(r, l),
      upload: (r: string, l: string) => host.uploadFile(r, l),
      tryServerCopy: (src: string, dest: string, isDir: boolean) =>
        tryRemoteCpViaSsh(host.sshSession, src, dest, isDir),
    }
    return {
      transfer: {
        uploadFile: (remotePath, localPath) => host.uploadFile(remotePath, localPath),
        downloadFile: (remotePath, localPath, mode, size) =>
          host.downloadFile(remotePath, localPath, mode, size),
        uploadDirectory: (localSrc, remoteDestParent) =>
          host.uploadDirectory(localSrc, remoteDestParent),
        downloadDirectory: (remoteSrc, localDestParent) =>
          host.downloadDirectory(remoteSrc, localDestParent),
      },
      notify: {
        error: (key, params) => {
          try { host.notifications?.error?.(host.i18n.t(key, params), '') } catch { /* ignore */ }
        },
      },
      fs: {
        copyLocalDir: (src, dest) => copyLocalDir(src, dest),
        copyLocalFile: async (src, dest) => {

          try {
            const ra = await fs.realpath(src)
            const rb = await fs.realpath(dest).catch(() => null)
            if (rb && (ra === rb || (process.platform === 'win32' && ra.toLowerCase() === rb.toLowerCase()))) {
              log.warn('copyLocalFile self-copy skipped:', src, '->', dest)
              return
            }
          } catch {   }
          log.info('copyLocalFile:', src, '->', dest)
          return fs.copyFile(src, dest)
        },
        renameLocal: (src, dest) => fs.rename(src, dest),
        copyRemoteDir: (src, dest, isDir) => copyRemoteDir(src, dest, isDir, remoteCopyDeps),
        renameRemote: (src, dest) => host.renameRemote(src, dest),
        deleteLocalRecursive: (p) => deleteLocalRecursive(p),
        deleteRemoteRecursive: (p) => deleteRemoteRecursive(host.sftpSession as any, p),
        localDirExists: (p) => fs.stat(p).then(() => true).catch(() => false),
        statLocal: (p) => fs.stat(p).catch(() => null),
        scanLocalDir: host.scanLocalDir
          ? (p) => host.scanLocalDir!(p)
          : undefined,
        readdirRemote: async (parentDir) => {
          const entries = await (host.sftpSession as any).readdir(parentDir)
          return entries.map((e: any) => ({
            name: e.name,
            size: e.size ?? e.attrs?.size,
            modified: e.modified ?? e.attrs?.modified,
            mtime: e.mtime ?? e.attrs?.mtime,
            attrs: e.attrs,
          }))
        },
      },
      conflict: {
        checkDestExists: async (pane, filePath) => {
          if (pane === 'local') {
            try { await fs.access(filePath); return true } catch { return false }
          }
          if (!host.sftpSession) return false
          const dir = path.posix.dirname(filePath)
          const name = path.posix.basename(filePath)
          try {
            const entries = await (host.sftpSession as any).readdir(dir)
            return entries.some((e: any) => e.name === name)
          } catch {
            return false
          }
        },
        checkRemotePathExists: (remotePath, expectDir) =>
          host.checkRemotePathExists(remotePath, expectDir),
        enqueue: (item) => host.enqueueConflict(item),
        showDialog: () => host.showConflictDialog(),
        queueLength: () => host.getConflictQueueLength(),
        setOriginalTotal: (count) => host.setConflictOriginalTotal(count),
      },
      pending: {
        save: (entries, destPane, destPath, mode, source) =>
          host.savePendingPaste(entries, destPane, destPath, mode, source),
      },
      ui: {
        refreshLocal: () => host.refreshLocal(),
        refreshRemote: () => host.refreshRemote(),
        notifyPasteFailed: () => {
          const msg = host.i18n.t('notify.pasteFailed')
          try { host.notifications?.error?.(msg, '') } catch {}
        },
        hasSftpSession: () => !!host.sftpSession,
      },
    }
  }
}
