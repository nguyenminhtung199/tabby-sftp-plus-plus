import { mapConcurrent } from './concurrency'
import type { FileOperationBatch } from './panel-types'
const fileOperation = require('../../runtime/file-operation.cjs')
import * as path from 'path'

import { type Stats } from 'fs'

import { pasteEntryKey, parseRemoteMtime } from './conflict'

import { safeEntryName } from './path-utils'

import { type ConflictQueueItem } from './panel-types'

import * as fs from 'fs/promises'

import { copyLocalDir, copyRemoteDir, deleteLocalRecursive, deleteRemoteRecursive, isPathInside, tryRemoteCpViaSsh } from './fs-ops'

import { log } from '../../services/sftp-logger'

export type PasteEntry = {
  batch?: FileOperationBatch
  sourcePane?: 'local' | 'remote'
  isSymlink?: boolean
  name: string
  fullPath?: string
  isDirectory: boolean
  mode?: number
  size?: number
  mtimeMs?: number
}

type RemoteScanListings = Map<string, Promise<Map<string, PasteEntry>>>

export interface PasteTransferPort {

  uploadFile(remotePath: string, localPath: string): Promise<boolean>
  downloadFile(remotePath: string, localPath: string, mode?: number, size?: number): Promise<boolean>
  uploadDirectory(localSrc: string, remoteDestParent: string, batch?:FileOperationBatch, moveSource?:boolean): Promise<boolean>
  downloadDirectory(remoteSrc: string, localDestParent: string, batch?:FileOperationBatch, moveSource?:boolean): Promise<boolean>
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
  listLocalEntries?(folder: string): Promise<PasteEntry[]>
  removeEmptyDirectory?(side: 'local' | 'remote', folder: string): Promise<void>

  scanLocalDir?(dirPath: string): Promise<{ size: number; count: number }>
  readdirRemote(parentDir: string): Promise<Array<{
    name: string
    isDirectory?: boolean
    isSymlink?: boolean
    mode?: number
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
    listings: RemoteScanListings = new Map(),
  ): Promise<boolean> {
    let visited = 0
    for (const entry of entries) {
      if (entry.batch?.cancelled) break
      // Let input/rendering run even when a large remote snapshot resolves immediately.
      if (++visited % 200 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
      const safeName = safeEntryName(entry.name)
      if (!safeName) { log.warn('skip unsafe paste entry:', entry.name); continue }
      const api = destPane === 'local' ? path : path.posix
      const destFilePath = api.join(destPath, safeName)
      const isSamePane = source === destPane
      if (isSamePane && entry.fullPath) {
        if (api.resolve(entry.fullPath) === api.resolve(destFilePath)) continue
        if (entry.isDirectory && isPathInside(entry.fullPath, destFilePath, source === 'remote')) throw new Error('Cannot copy or move a folder into itself.')
      }
      // Cross-pane directories use the transfer engine's per-file checks.
      if (entry.isDirectory && !isSamePane) continue
      const destination = await this.destinationEntry(destPane, destFilePath, listings)
      if (!destination) continue
      if (entry.isDirectory && destination.isDirectory && !destination.isSymlink) {
        await this.scanConflicts(await this.children(entry, source, listings), destPane, destFilePath, source, mode, listings)
        continue
      }
      let incoming = entry
      if (isSamePane && entry.fullPath && (source === 'remote' || entry.size == null || entry.mtimeMs == null)) {
        const metadata = await this.destinationEntry(source, entry.fullPath, listings)
        if (!metadata) throw new Error('Source no longer exists: ' + entry.fullPath)
        incoming = { ...entry, size: metadata.size, mtimeMs: metadata.mtimeMs }
      }
      const direction = isSamePane || source === 'local' ? 'upload' : 'download'
      const destStat = { size: destination.size ?? 0, mtimeMs: destination.mtimeMs ?? 0 } as Stats
      fileOperation.enqueue(this.ports.conflict, {
        ...this._buildFileConflictItem(incoming, destPane, destPath, source, destFilePath, isSamePane, direction, destStat, mode),
        isDirectory: entry.isDirectory || undefined,
        typeMismatch: entry.isDirectory !== destination.isDirectory || !!destination.isSymlink,
      }, entry.batch)
    }
    return this.ports.conflict.queueLength() > 0
  }

  private remoteListing(folder: string, listings: RemoteScanListings): Promise<Map<string, PasteEntry>> {
    let listing = listings.get(folder)
    if (!listing) {
      listing = this.ports.fs.readdirRemote(folder).then(entries => new Map(entries.map(entry => [entry.name, {
        ...entry, fullPath: path.posix.join(folder, entry.name), isDirectory: !!entry.isDirectory,
        size: entry.size ?? entry.attrs?.size, mtimeMs: parseRemoteMtime(entry),
      }])))
      listings.set(folder, listing)
    }
    return listing
  }

  private async destinationEntry(side: 'local' | 'remote', fullPath: string, listings?: RemoteScanListings): Promise<PasteEntry | null> {
    if (side === 'local') {
      const stat = await this.ports.fs.statLocal(fullPath)
      return stat ? { name:path.basename(fullPath), fullPath, isDirectory:stat.isDirectory(), isSymlink:stat.isSymbolicLink?.(), size:stat.size, mtimeMs:stat.mtimeMs } : null
    }
    try {
      return (await this.remoteListing(path.posix.dirname(fullPath), listings || new Map())).get(path.posix.basename(fullPath)) || null
    } catch (error:any) {
      if (error.code === 'ENOENT' || /no such file|not found/i.test(error.message)) return null
      throw error
    }
  }

  private async children(entry: PasteEntry, side: 'local' | 'remote', listings?: RemoteScanListings): Promise<PasteEntry[]> {
    const entries = side === 'local' ? await this.ports.fs.listLocalEntries!(entry.fullPath!) :
      [...(await this.remoteListing(entry.fullPath!, listings || new Map())).values()]
    return [...entries].filter(child => !child.isSymlink).map(child => ({ ...child, sourcePane:side, batch:entry.batch }))
  }

  async prepare(entries: PasteEntry[], side: 'local' | 'remote', folder: string, mode: 'copy' | 'cut', source: 'local' | 'remote'): Promise<PasteEntry[]> {
    const api = side === 'local' ? path : path.posix, result:PasteEntry[] = []
    for (const entry of entries) {
      let name = entry.name
      if (mode === 'copy' && side === source && entry.fullPath && (side === 'local' && process.platform === 'win32' ? api.resolve(entry.fullPath).toLowerCase() === api.resolve(api.join(folder, name)).toLowerCase() : api.resolve(entry.fullPath) === api.resolve(api.join(folder, name)))) {
        const ext = entry.isDirectory ? '' : api.extname(name), base = name.slice(0, name.length-ext.length)
        let index = 1
        do { name = base + ' - Copy' + (index === 1 ? '' : ' ('+index+')') + ext; index++ }
        while (await this.ports.conflict.checkDestExists(side, api.join(folder, name)))
      }
      result.push({ ...entry, name })
    }
    return result
  }

  private async mergeSamePane(entry: PasteEntry, side: 'local' | 'remote', parent: string, mode: 'copy' | 'cut', resolved: Set<string>): Promise<void> {
    if (resolved.has(pasteEntryKey(entry)) || entry.batch?.cancelled) return
    const api = side === 'local' ? path : path.posix, destination = api.join(parent, entry.name)
    if (api.resolve(entry.fullPath!) === api.resolve(destination)) return
    if (entry.isDirectory && await this.ports.conflict.checkDestExists(side, destination)) {
      if (isPathInside(entry.fullPath!, destination, side === 'remote')) throw new Error('Cannot copy or move a folder into itself.')
      const target = await this.destinationEntry(side, destination)
      if (!target?.isDirectory || target.isSymlink) throw new Error('Destination type changed; choose Keep both or Skip.')
      for (const child of await this.children(entry, side)) await this.mergeSamePane(child, side, destination, mode, resolved)
      if (mode === 'cut') await this.ports.fs.removeEmptyDirectory?.(side, entry.fullPath!)
      return
    }
    await this._pasteSamePane(entry, entry.fullPath!, destination, side, mode)
  }

  async execute(
    entries: PasteEntry[],
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
    resolvedKeys: Set<string> = new Set(),
  ): Promise<void> {

    let failed = 0
    for (const entry of entries) {
      try {
        if (resolvedKeys.has(pasteEntryKey(entry)) || entry.batch?.cancelled) continue
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
          await this.mergeSamePane(entry, destPane, destPath, mode, resolvedKeys)
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
      const ok = await this.ports.transfer.uploadDirectory(srcPath, destPath, entry.batch, mode === 'cut')

      if (!ok && this.ports.conflict.queueLength() === 0) throw new Error('Folder upload did not complete; remaining source files retained.')
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
      const ok = await this.ports.transfer.downloadDirectory(srcPath, destPath, entry.batch, mode === 'cut')

      if (!ok && this.ports.conflict.queueLength() === 0) throw new Error('Folder download did not complete; remaining source files retained.')
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

    const remoteSize = !isSamePane && destPane === 'remote'
      ? Number(destStat.size) || 0
      : (entry.size ?? 0)
    const remoteMtime = !isSamePane && destPane === 'remote'
      ? Number(destStat.mtimeMs) || 0
      : (entry.mtimeMs ?? 0)
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
  uploadDirectory(localSrc: string, remoteDestParent: string, batch?:FileOperationBatch, moveSource?:boolean): Promise<boolean>
  downloadDirectory(remoteSrc: string, localDestParent: string, batch?:FileOperationBatch, moveSource?:boolean): Promise<boolean>

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
    if (this.host.getConflictQueueLength()) throw new Error('Resolve the current file conflicts before starting another paste.')
    const batch = fileOperation.create()
    entries = await this.useCase.prepare(entries.map(entry => ({ ...entry, sourcePane:source, batch })), destPane, destPath, mode, source)
    let deferred = false
    try {
    const hasConflicts = await this.useCase.scanConflicts(entries, destPane, destPath, source, mode)
    if (hasConflicts) {
      deferred = true
      this.host.savePendingPaste(entries, destPane, destPath, mode, source)
      this.host.setConflictOriginalTotal(this.host.getConflictQueueLength())
      this.host.showConflictDialog()
      return
    }
    await this.useCase.execute(entries, destPane, destPath, mode, source)
    } finally { if (!deferred) fileOperation.finish(batch) }
  }

  executePaste(
    entries: PasteEntry[],
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
    resolvedKeys: Set<string> = new Set(),
  ): Promise<void> {
    return this.useCase.execute(entries, destPane, destPath, mode, source, resolvedKeys)
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
        uploadDirectory: (localSrc, remoteDestParent, batch, moveSource) =>
          host.uploadDirectory(localSrc, remoteDestParent, batch, moveSource),
        downloadDirectory: (remoteSrc, localDestParent, batch, moveSource) =>
          host.downloadDirectory(remoteSrc, localDestParent, batch, moveSource),
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
          return fs.copyFile(src, dest, 1)
        },
        renameLocal: async (src, dest) => {
          try { await fs.rename(src, dest) }
          catch (error:any) {
            if (error.code !== 'EXDEV') throw error
            const stat = await fs.lstat(src)
            if (stat.isDirectory()) await copyLocalDir(src, dest)
            else await fs.copyFile(src, dest, 1)
            await deleteLocalRecursive(src)
          }
        },
        copyRemoteDir: (src, dest, isDir) => copyRemoteDir(src, dest, isDir, remoteCopyDeps),
        renameRemote: (src, dest) => host.renameRemote(src, dest),
        deleteLocalRecursive: (p) => deleteLocalRecursive(p),
        deleteRemoteRecursive: (p) => deleteRemoteRecursive(host.sftpSession as any, p),
        localDirExists: (p) => fs.stat(p).then(() => true).catch(() => false),
        statLocal: (p) => fs.lstat(p).catch(error => { if (error.code === 'ENOENT') return null; throw error }),
        listLocalEntries: async folder => {
          const entries = await fs.readdir(folder, {withFileTypes:true})
          return mapConcurrent(entries, 8, async entry => { const fullPath=path.join(folder,entry.name), stat=await fs.lstat(fullPath); return {name:entry.name,fullPath,isDirectory:stat.isDirectory(),isSymlink:stat.isSymbolicLink(),size:stat.size,mtimeMs:stat.mtimeMs} })
        },
        removeEmptyDirectory: async (side, folder) => {
          try { if (side === 'local') await fs.rmdir(folder); else { if ((await (host.sftpSession as any).readdir(folder)).some((e:any)=>e.name!=='.'&&e.name!=='..')) return; await (host.sftpSession as any).rmdir(folder) } }
          catch(error:any) { if (!['ENOTEMPTY','EEXIST','ENOENT'].includes(error.code) && !/not empty|no such file/i.test(error.message)) throw error }
        },
        scanLocalDir: host.scanLocalDir
          ? (p) => host.scanLocalDir!(p)
          : undefined,
        readdirRemote: async (parentDir) => {
          const entries = await (host.sftpSession as any).readdir(parentDir)
          return entries.map((e: any) => ({
            name: e.name,
            isDirectory: !!e.isDirectory,
            isSymlink: !!e.isSymlink || (typeof e.isSymbolicLink === 'function' ? e.isSymbolicLink() : !!e.isSymbolicLink),
            mode: e.mode,
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
            try { await fs.lstat(filePath); return true } catch(error:any) { if(error.code === 'ENOENT') return false; throw error }
          }
          if (!host.sftpSession) return false
          const dir = path.posix.dirname(filePath)
          const name = path.posix.basename(filePath)
          try {
            const entries = await (host.sftpSession as any).readdir(dir)
            return entries.some((e: any) => e.name === name)
          } catch(error:any) {
            if(error.code === 'ENOENT' || /no such file|not found/i.test(error.message)) return false
            throw error
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
