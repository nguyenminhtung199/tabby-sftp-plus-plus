import { type Stats } from 'fs'

import { type SFTPFile } from '../../services/sftp.service'

import { type FileOperationBatch, type FolderTransferCtx, type ConflictFileInfo } from './panel-types'

import * as path from 'path'

﻿

export type SftpDirEntry = {
  name: string
  isDirectory: boolean

  isSymlink?: boolean
  size?: number
  mode?: number
  modified?: Date | number | string
  mtime?: number

  attrs?: { mtime?: number; modified?: Date | number | string; size?: number }
}

export interface LocalTransferFsPort {
  lstat(localPath: string): Promise<Stats | null>
  listChildren(localPath: string): Promise<Array<{ name: string; isSymbolicLink: boolean }>>

  scanDir(localPath: string): Promise<{ size: number; count: number }>
  pathExists(localPath: string): Promise<boolean>
  mkdirRecursive(localPath: string): Promise<void>
  removeFile?(localPath:string):Promise<void>
  removeEmptyDirectory?(localPath:string):Promise<void>
}

export interface SftpTransferPort {
  hasSession(): boolean
  mkdir(remotePath: string): Promise<void>
  readdir(remoteSrc: string): Promise<SftpDirEntry[]>

  stat(remotePath: string): Promise<SftpDirEntry | null>

  isSymlink(remotePath: string): Promise<boolean>
  unlink?(remotePath:string):Promise<void>
  rmdir?(remotePath:string):Promise<void>
}

export interface RemoteDirStatsPort {

  scanDir(remotePath: string): Promise<{ size: number; count: number }>
}

export type TarChannelResult = 'fallback' | 'success' | 'failed'

export interface TarChannelPort {

  tryUploadDir(
    localPath: string, remoteTarget: string, folder: FolderTransferPort, name: string,
    mergeIntoExisting?: boolean, mode?: string, reuseLogEntryId?: string,
  ): Promise<TarChannelResult>

  tryDownloadDir(remoteSrc: string, localDest: string, folder: FolderTransferPort, name: string, mergeIntoExisting?: boolean, mode?: string): Promise<TarChannelResult>

  tryUploadBatch?(
    localPaths: string[], remoteDir: string, folder: FolderTransferPort,
    name: string, mode?: string,
  ): Promise<TarChannelResult>
}

export interface FolderTransferPort {
  start(
    name: string,
    direction: 'upload' | 'download',
    remotePath: string,
    localPath: string,
    totalSize: number,
    itemCount: number,

    reuseLogEntryId?: string,
  ): FolderTransferCtx
  finish(ctx: FolderTransferCtx, success: boolean): void

  discard?(ctx: FolderTransferCtx): void

  updateLogSize?(ctx: FolderTransferCtx, size: number): void

  markChannelMode?(ctx: FolderTransferCtx, mode: 'tar'): void
  updateProgress(
    ctx: FolderTransferCtx,
    bytesDone: number,
    currentItem: string,
    itemDone: number,
    currentItemSize?: number,
  ): void
  markHadConflict(ctx: FolderTransferCtx): void
  isAborted(ctx: FolderTransferCtx): boolean
  isPaused(ctx: FolderTransferCtx): boolean
  waitWhilePaused(ctx: FolderTransferCtx): Promise<void>
  consumeAbortCurrent(ctx: FolderTransferCtx): boolean
}

export interface TransferExecutionPort {

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
}

export interface DownloadOnePort {
  getLocalPath(): string
  downloadDir(remoteSrc: string, localDest: string, batch?: FileOperationBatch): Promise<boolean>
}

export interface TransferUseCasePorts {
  localFs: LocalTransferFsPort
  sftp: SftpTransferPort
  folder: FolderTransferPort
  execution: TransferExecutionPort
  conflictDetection: import('./conflict').ConflictDetectionPort
  conflictQueue: import('./conflict').ConflictQueuePort

  tarChannel?: TarChannelPort

  readonly tarChannelMode: string

  notifyTarOnlyInapplicable?(name: string, reason: 'targetExists', detail: string): void
}

export type { SFTPFile }

export const DEFAULT_MTIME_TOLERANCE_MS = 2000

export function filesAreSame(
  localSize: number,
  localMtime: number,
  remoteSize: number,
  remoteMtime: number,
  toleranceMs = DEFAULT_MTIME_TOLERANCE_MS,
): boolean {
  return localSize === remoteSize
    && Math.abs(localMtime - remoteMtime) <= toleranceMs
}

export interface ConflictDigestInfo {
  localDigest?: string | null
  remoteDigest?: string | null
}

export function isContentIdentical(d?: ConflictDigestInfo | null): boolean {
  return !!d && !!d.localDigest && !!d.remoteDigest && d.localDigest === d.remoteDigest
}

export function buildUploadConflictInfo(
  remotePath: string,
  localPath: string,
  fileName: string,
  localSize: number,
  localMtime: number,
  remoteSize: number,
  remoteMtime: number,

  digest?: ConflictDigestInfo,
): ConflictFileInfo {
  const parentDir = path.posix.dirname(remotePath)
  const localDigest = digest?.localDigest ?? null
  const remoteDigest = digest?.remoteDigest ?? null
  const bothAvailable = !!localDigest && !!remoteDigest
  return {
    localPath,
    remotePath,
    fileName,
    localSize,
    remoteSize,
    localMtime,
    remoteMtime,
    remoteDir: parentDir,
    direction: 'upload',
    isSamePane: false,
    localDigest,
    remoteDigest,
    contentIdentical: isContentIdentical(digest),

    contentDiffers: bothAvailable && localDigest !== remoteDigest,
  }
}

export function buildDownloadConflictInfo(
  localPath: string,
  remotePath: string,
  remoteSize: number,
  remoteMtime: number,
  localSize: number,
  localMtime: number,

  digest?: ConflictDigestInfo,
): ConflictFileInfo {
  const localDigest = digest?.localDigest ?? null
  const remoteDigest = digest?.remoteDigest ?? null
  const bothAvailable = !!localDigest && !!remoteDigest
  return {
    localPath,
    remotePath,
    fileName: path.basename(localPath),
    localSize,
    remoteSize,
    localMtime,
    remoteMtime,
    remoteDir: path.posix.dirname(remotePath),
    direction: 'download',
    isSamePane: false,
    localDigest,
    remoteDigest,
    contentIdentical: isContentIdentical(digest),

    contentDiffers: bothAvailable && localDigest !== remoteDigest,
  }
}
