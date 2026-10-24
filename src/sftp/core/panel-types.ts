import type { Stats } from 'fs'
import type { SFTPFile, SFTPSessionLike, SSHSessionLike } from '../../services/sftp.service'
import type { TaskCancelRef } from './task-scope'

export type LocalEntry = {
  name: string
  fullPath: string
  isDirectory: boolean

  linkTarget?: string

  isSymlink?: boolean
  mode?: number
  size?: number
  mtimeMs?: number
  atimeMs?: number
  birthtimeMs?: number
  owner?: string | number
  group?: string | number
  inaccessible?: boolean
}

export type DragPayload =
  | { kind: 'local-paths'; sourceScope?: string; paths: Array<{ fullPath: string; name: string; isDirectory: boolean }> }
  | { kind: 'remote-paths'; sourceScope?: string; paths: Array<{ remotePath: string; name: string; isDirectory: boolean; size?: number; mode?: number; modified?: number }> }

export type ConflictFileInfo = {
  localPath: string
  remotePath: string
  fileName: string
  localSize: number
  remoteSize: number
  localMtime: number
  remoteMtime: number
  remoteDir: string
  direction: 'upload' | 'download'
  isSamePane: boolean
  isDirectory?: boolean

  localSizePending?: boolean
  remoteSizePending?: boolean

  localDigest?: string | null
  remoteDigest?: string | null

  contentIdentical?: boolean

  contentDiffers?: boolean
}

export type ConflictQueueItem = {
  localPath: string
  remoteDir: string
  fileName: string
  remotePath: string
  localStat: Stats
  direction: 'upload' | 'download'
  remoteFileSize?: number
  remoteFileMtime?: number
  isSamePane?: boolean
  samePaneSource?: 'local' | 'remote'
  isDirectory?: boolean

  entryKey?: string

  mode?: 'copy' | 'cut'

  transferCtx?: FolderTransferCtx

  localDigest?: string | null
  remoteDigest?: string | null
}

export type FolderTransferCtx = {
  t: any
  startTime: number
  logEntryId: string
  bytesDone: number
  itemDone: number
  hadConflict?: boolean

  liveBytes?: Map<string, number>
}

export type BookmarkScope = 'connection' | 'global' | 'all'

export type PanelTransferItem = {
  transfer: any
  direction: 'upload' | 'download'
  name: string
  remotePath: string
  localPath: string
  percent: number
  speed: string

  speedBps?: number
  bytesDone: number
  bytesTotal: number
  paused: boolean

  queued?: boolean
  logEntryId?: string
  isFolder?: boolean
  currentItem?: string
  currentItemSize?: number
  itemCount?: number
  itemDone?: number

  skippedAsDuplicate?: boolean

  transferMode?: 'sftp' | 'tar'

  _taskCancelRef?: TaskCancelRef
}

export type { SFTPFile, SFTPSessionLike, SSHSessionLike }
