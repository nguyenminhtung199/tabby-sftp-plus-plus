import { log } from '../../services/sftp-logger'

import * as fs from 'fs'

import * as fsPromises from 'fs/promises'

import { FileHandle } from 'fs/promises'

import * as os from 'os'

import * as path from 'path'

import { randomUUID } from 'crypto'

import { type SFTPSessionLike } from '../../services/sftp.service'

import { markTransferProgress } from './transfer-progress'

﻿

export class BufferCollectingDownload {
  private chunks: Buffer[] = []
  private completedBytes = 0
  private complete = false
  private cancelled = false

  constructor(
    private readonly fileSize: number,
    private readonly mode = 0o644,
    private readonly maxBytes?: number,
  ) {}

  getName(): string { return '' }
  getMode(): number { return this.mode }
  getSize(): number { return this.fileSize }

  async write(buffer: Buffer): Promise<void> {
    if (this.cancelled) return
    this.chunks.push(buffer)
    this.completedBytes += buffer.length

    if (this.maxBytes != null && this.completedBytes > this.maxBytes) {
      this.cancelled = true
      throw new Error(`Downloaded data exceeds limit (${this.completedBytes} > ${this.maxBytes})`)
    }
    if (this.fileSize > 0 && this.completedBytes >= this.fileSize) {
      this.complete = true
    }
  }

  close(): void {}
  isComplete(): boolean { return this.complete || this.fileSize === 0 }
  isCancelled(): boolean { return this.cancelled }
  cancel(): void { this.cancelled = true }
  getCompletedBytes(): number { return this.completedBytes }
  increaseProgress(_bytes: number): void {}

  getBuffer(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

const STAT_FOR_SIZE_ATTEMPTS = 3
const STAT_FOR_SIZE_RETRY_DELAY_MS = 400

async function statSizeWithRetry(sftpSession: SFTPSessionLike, remotePath: string): Promise<number> {

  if (typeof sftpSession?.stat !== 'function') return -1
  for (let attempt = 1; attempt <= STAT_FOR_SIZE_ATTEMPTS; attempt++) {
    try {
      const st = await sftpSession.stat?.(remotePath)
      const statSize = Number((st as { size?: unknown } | null)?.size)
      if (Number.isFinite(statSize) && statSize >= 0) return statSize
    } catch (e) {
      if (attempt >= STAT_FOR_SIZE_ATTEMPTS) {
        log.warn(`stat failed while resolving remote download size (gave up after ${attempt} attempts):`, remotePath, e)
        break
      }
      log.warn(`stat failed while resolving remote download size (retry ${attempt}/${STAT_FOR_SIZE_ATTEMPTS}):`, remotePath)
      await new Promise(r => setTimeout(r, STAT_FOR_SIZE_RETRY_DELAY_MS))
    }
  }
  return -1
}

async function resolveRemoteDownloadSize(
  sftpSession: SFTPSessionLike,
  remotePath: string,
  listedSize: number,
): Promise<number> {
  if (Number.isFinite(listedSize) && listedSize > 0) return listedSize

  return statSizeWithRetry(sftpSession, remotePath)
}

async function verifyUnknownSizeDownload(
  sftpSession: SFTPSessionLike,
  remotePath: string,
  actualBytes: number,
): Promise<void> {
  const recheck = await resolveRemoteDownloadSize(sftpSession, remotePath, -1)
  if (recheck >= 0 && actualBytes !== recheck) {
    throw new Error(`Download incomplete: expected=${recheck}, actual=${actualBytes} (size resolved after transfer)`)
  }
  if (recheck < 0) {
    log.warn('[download] remote size unverifiable, integrity not guaranteed:', remotePath, 'bytes:', actualBytes)
  }
}

export async function downloadRemoteToBuffer(
  sftpSession: SFTPSessionLike,
  remotePath: string,
  size: number,
  mode = 0o644,
  maxBytes?: number,
  opts?: { requireExactSize?: boolean },
): Promise<Buffer> {
  const resolvedSize = await resolveRemoteDownloadSize(sftpSession, remotePath, size)
  if (resolvedSize === 0) return Buffer.alloc(0)
  if (resolvedSize < 0 && opts?.requireExactSize) {
    throw new Error('REMOTE_SIZE_UNKNOWN')
  }
  const dl = new BufferCollectingDownload(resolvedSize, mode, maxBytes)
  await sftpSession.download(remotePath, dl as any)

  if (dl.isCancelled()) throw new Error('Download cancelled')
  if (resolvedSize >= 0) {
    if (dl.getCompletedBytes() !== resolvedSize) {
      throw new Error(`Download incomplete: expected=${resolvedSize}, actual=${dl.getCompletedBytes()}`)
    }
  } else {
    await verifyUnknownSizeDownload(sftpSession, remotePath, dl.getCompletedBytes())
  }
  return dl.getBuffer()
}

export async function downloadRemoteToTempFile(
  sftpSession: SFTPSessionLike,
  remotePath: string,
  size: number,
  mode = 0o644,
  opts?: { requireExactSize?: boolean; maxBytes?: number },
): Promise<string> {
  const baseName = path.basename(remotePath) || 'file'
  const dir = path.join(os.tmpdir(), 'tabby-sftp-plus-plus', randomUUID())
  await fsPromises.mkdir(dir, { recursive: true })
  const localPath = path.join(dir, baseName)

  try {
    const resolvedSize = await resolveRemoteDownloadSize(sftpSession, remotePath, size)
    if (resolvedSize === 0) {
      const fd = await fsPromises.open(localPath, 'w')
      await fd.close()
      return localPath
    }

    if (resolvedSize < 0 && opts?.requireExactSize) {
      throw new Error('REMOTE_SIZE_UNKNOWN')
    }

    if (opts?.maxBytes != null && resolvedSize > opts.maxBytes) {
      throw new Error('FILE_TOO_LARGE')
    }

    const dl = new LocalPathFileDownload(localPath, mode, resolvedSize)
    try {
      await sftpSession.download(remotePath, dl as any)
      if (dl.isCancelled()) throw new Error('Download cancelled')
      const actualSize = (await fsPromises.stat(localPath)).size
      if (resolvedSize >= 0) {
        if (actualSize !== resolvedSize) {
          throw new Error(`Download incomplete: expected=${resolvedSize}, actual=${actualSize}`)
        }
      } else {
        await verifyUnknownSizeDownload(sftpSession, remotePath, actualSize)
      }
      await dl._markComplete()
    } finally {
      await dl.close()
    }
    return localPath
  } catch (err) {

    try { await fsPromises.rm(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    throw err
  }
}

export async function writeTextToFile(filePath: string, text: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
  await fsPromises.writeFile(filePath, text, encoding)
}

export async function readTextFromFile(filePath: string): Promise<string> {
  return fsPromises.readFile(filePath, 'utf8')
}

export async function writeBufferToTemp(buf: Buffer, fileName: string): Promise<string> {
  const baseName = path.basename(fileName) || 'file'
  const dir = path.join(os.tmpdir(), 'tabby-sftp-plus-plus', randomUUID())
  await fsPromises.mkdir(dir, { recursive: true })
  const localPath = path.join(dir, baseName)
  try {
    await fsPromises.writeFile(localPath, buf)
    return localPath
  } catch (err) {

    try { await fsPromises.rm(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    throw err
  }
}

export async function readLocalFileToBuffer(localPath: string, maxBytes?: number): Promise<Buffer> {
  if (maxBytes != null) {
    const st = await fsPromises.stat(localPath)
    if (st.size > maxBytes) {
      throw new Error('FILE_TOO_LARGE')
    }
  }
  return fsPromises.readFile(localPath)
}

export async function removeTempFile(filePath: string): Promise<void> {
  try {
    const dir = path.dirname(filePath)
    await fsPromises.unlink(filePath)
    const remaining = await fsPromises.readdir(dir)
    if (remaining.length === 0) {
      await fsPromises.rmdir(dir)
    }
  } catch {
    try {
      if (fs.existsSync(filePath)) await fsPromises.unlink(filePath)
    } catch { /* ignore */ }
  }
}

export class LocalPathFileUpload {
  private fd: FileHandle | null = null
  private position = 0
  private completedBytes = 0
  private cancelled = false
  private complete = false
  private paused = false

  private failed = false

  private status = ''

  private resumeMode = false

  constructor(private filePath: string, resumeOffset?: number) {
    if (resumeOffset !== undefined && resumeOffset > 0) {
      this.position = resumeOffset
      this.completedBytes = resumeOffset
      this.completedBytesForProgress = resumeOffset
      this.resumeMode = true
    }

  }

  getName(): string {
    return path.basename(this.filePath)
  }

  getMode(): number {
    return 0o644
  }

  async getSize(): Promise<number> {
    try {
      return (await fs.promises.stat(this.filePath)).size
    } catch (e) {
      log.warn('[upload] stat failed, size unknown:', this.filePath, e)
      return -1
    }
  }

  async read(): Promise<Buffer> {

    if (this.cancelled) {
      throw new Error('Transfer cancelled')
    }
    if (this.fd === null) {
      this.fd = await fs.promises.open(this.filePath, 'r')

      if (this.resumeMode && this.position > 0) {
        try {
          await this.fd.read(Buffer.alloc(0), 0, 0, this.position)
        } catch (e) {
          await this.close()
          throw e
        }
      }
    }

    const buf = Buffer.alloc(1024 * 1024)
    const { bytesRead } = await this.fd.read(buf, 0, buf.length, this.position)
    if (bytesRead === 0) {
      this.complete = true
      return Buffer.alloc(0)
    }
    this.position += bytesRead
    this.completedBytes += bytesRead
    this.increaseProgress(bytesRead)

    markTransferProgress()
    return buf.subarray(0, bytesRead)
  }

  async close(): Promise<void> {
    if (this.fd !== null) {
      try {
        await this.fd.close()
      } catch {
        // ignore
      }
      this.fd = null
    }
  }

  isComplete(): boolean {
    return this.complete
  }

  isCancelled(): boolean {
    return this.cancelled
  }

  isPaused(): boolean {
    return this.paused
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    await this.close()
  }

  async pause(): Promise<number> {

    this.paused = true
    return this.completedBytes
  }

  getPosition(): number {
    return this.position
  }

  isFailed(): boolean {
    return this.failed
  }

  getStatus(): string {
    return this.status
  }

  setStatus(status: string): void {
    this.status = String(status ?? '')
    if (this.status) {
      this.failed = true
      log.error('[transfer] remote reported failure (upload):', this.filePath, this.status)
    }
  }

  async _markFailed(): Promise<void> {
    this.failed = true
    await this.close()
  }

  private completedBytesForProgress = 0

  increaseProgress(bytes: number): void {
    this.completedBytesForProgress += bytes
  }

  getCompletedBytes(): number {
    return this.completedBytesForProgress
  }
}

const UNKNOWN_SIZE_HARD_CAP_BYTES = 64 * 1024 * 1024 * 1024

export class LocalPathFileDownload {
  private fd: FileHandle | null = null
  private completedBytes = 0
  private completedBytesForProgress = 0
  private cancelled = false
  private complete = false
  private paused = false
  private failed = false

  private status = ''
  private resumeOffset = 0

  constructor(
    readonly targetPath: string,
    private mode: number,
    private fileSize: number,
    resumeOffset?: number,
  ) {
    this.resumeOffset = resumeOffset ?? 0
    this.completedBytes = this.resumeOffset
    this.completedBytesForProgress = this.resumeOffset

    if (this.fileSize > 0 && this.resumeOffset >= this.fileSize) {
      this.complete = true
    }

    if (this.fileSize === 0) {
      this.complete = true
    }
  }

  getName(): string {
    return path.basename(this.targetPath)
  }

  getMode(): number {
    return this.mode
  }

  getSize(): number {
    return this.fileSize
  }

  async write(buffer: Buffer): Promise<void> {

    if (this.paused) {
      throw new Error('Transfer paused')
    }
    if (this.cancelled) {
      throw new Error('Transfer cancelled')
    }
    if (this.fd === null) {

      const dir = path.dirname(this.targetPath)
      try {
        await fs.promises.mkdir(dir, { recursive: true })
      } catch {
        // ignore - directory may already exist
      }

      const resumeAt = this.resumeOffset > 0 ? this.resumeOffset : this.completedBytes
      const flags = resumeAt > 0 ? 'r+' : 'w'
      this.fd = await fs.promises.open(this.targetPath, flags)
      if (resumeAt > 0) {

        try {
          const actualStat = await fs.promises.stat(this.targetPath)
          if (actualStat.size < resumeAt) {
            log.warn(`Resume offset mismatch: .tmp actual=${actualStat.size} < resumeAt=${resumeAt}, truncating to actual`)
            await this.fd.truncate(actualStat.size)
            this.completedBytes = actualStat.size
            this.completedBytesForProgress = actualStat.size
          } else if (actualStat.size > resumeAt) {

            await this.fd.truncate(resumeAt)
          }
        } catch {

          try { await this.fd.truncate(resumeAt) } catch { /* ignore */ }
        }
      }
    }
    await this.fd.write(buffer, 0, buffer.length, this.completedBytes)
    this.completedBytes += buffer.length
    this.increaseProgress(buffer.length)

    markTransferProgress()

    if (this.fileSize > 0 && this.completedBytes > this.fileSize) {
      throw new Error(`Download exceeded declared size: wrote=${this.completedBytes} declared=${this.fileSize}`)
    }

    if (this.fileSize < 0 && this.completedBytes > UNKNOWN_SIZE_HARD_CAP_BYTES) {
      throw new Error(`Unknown-size download exceeded hard cap: wrote=${this.completedBytes} cap=${UNKNOWN_SIZE_HARD_CAP_BYTES}`)
    }

    if (this.fileSize >= 0 && this.completedBytes >= this.fileSize) {
      this.complete = true
    }
  }

  async close(): Promise<void> {
    if (this.fd !== null) {
      try {
        await this.fd.close()
      } catch {
        // ignore
      }
      this.fd = null
    }
  }

  isComplete(): boolean {
    return this.complete
  }

  isCancelled(): boolean {
    return this.cancelled
  }

  isPaused(): boolean {
    return this.paused
  }

  isFailed(): boolean {
    return this.failed
  }

  getStatus(): string {
    return this.status
  }

  setStatus(status: string): void {
    this.status = String(status ?? '')
    if (this.status) {
      this.failed = true
      log.error('[transfer] remote reported failure (download):', this.targetPath, this.status)
    }
  }

  async _markFailed(): Promise<void> {
    this.failed = true
    await this.close()
  }

  _clearTransferFailureMarks(): void {
    this.cancelled = false
    this.paused = false
    this.failed = false
    this.status = ''
  }

  _resetForFullRetry(): void {
    this._clearTransferFailureMarks()
    this.complete = false
    this.completedBytes = 0
    this.completedBytesForProgress = 0
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    await this.close()
  }

  async pause(): Promise<number> {
    this.paused = true

    if (this.fd) {
      try { await this.fd.sync?.() } catch { /* ignore */ }
    }
    await this.close()
    return this.completedBytes
  }

  getResumeOffset(): number {
    return this.resumeOffset
  }

  async _markComplete(): Promise<void> {
    this.complete = true
    await this.close()
  }

  increaseProgress(bytes: number): void {
    this.completedBytesForProgress += bytes
  }

  getCompletedBytes(): number {
    return this.completedBytesForProgress
  }
}

async function renameWithOverwrite(rawSftp: any, tempPath: string, remotePath: string): Promise<void> {
  try {
    await rawSftp.rename(tempPath, remotePath)
    return
  } catch (renameErr) {

    if (typeof rawSftp.rename !== 'function') throw renameErr
    if (typeof rawSftp.stat === 'function') {
      try { await rawSftp.stat(remotePath) } catch { throw renameErr }
    }
    const backup = remotePath + `.sftp-plus-bak-${Date.now()}`
    let backedUp = false
    try {
      await rawSftp.rename(remotePath, backup)
      backedUp = true
      await rawSftp.rename(tempPath, remotePath)
      if (typeof rawSftp.unlink === 'function') {
        try { await rawSftp.unlink(backup) } catch {   }
      }
    } catch (e2) {
      if (backedUp) {
        try { await rawSftp.rename(backup, remotePath) } catch {   }
      }
      throw e2
    }
  }
}

export function errText(e: unknown): string {
  const err = e as { code?: unknown; message?: unknown } | null | undefined
  const code = err?.code != null ? String(err.code) : ''
  const msg = err?.message != null ? String(err.message) : String(e)
  return code ? `${code} ${msg}` : msg
}

export interface TransferCancelRef {
  current: any

  active?: Set<any>
}

function registerCancelRef(ref: TransferCancelRef | null | undefined, transfer: any): void {
  if (!ref) return
  ref.current = transfer
  if (!ref.active) ref.active = new Set()
  ref.active.add(transfer)
}

function unregisterCancelRef(ref: TransferCancelRef | null | undefined, transfer: any): void {
  if (!ref) return
  ref.active?.delete(transfer)
  if (ref.current === transfer) ref.current = null
}

export function cancelAllInFlight(ref: TransferCancelRef | null | undefined): void {
  if (!ref) return
  const list = ref.active ? [...ref.active] : (ref.current ? [ref.current] : [])
  for (const t of list) {
    try {
      const r = typeof t?.cancel === 'function' ? t.cancel()
        : typeof t?.destroy === 'function' ? t.destroy()
        : undefined
      void Promise.resolve(r).catch((e: unknown) => log.warn('cancelAllInFlight: cancel failed', e))
    } catch (e) { log.warn('cancelAllInFlight: cancel threw', e) }
  }
  ref.current = null
  ref.active?.clear()
}

export type TrackTransferFn = (
  t: LocalPathFileUpload | LocalPathFileDownload,
  direction: 'upload' | 'download',
  remotePath: string,
  localPath: string,
  logOperation?: 'upload' | 'download' | 'edit-upload' | 'edit-download',
) => void

export interface ByteTransferContext {
  session: SFTPSessionLike

  activeDownloadTargets: Set<string>

  activeUploadTargets?: Set<string>

  cancelRef?: TransferCancelRef | null
  trackTransfer?: TrackTransferFn
  onUploadError?: (remotePath: string, localPath: string, err: unknown) => void
  onDownloadError?: (remotePath: string, err: unknown) => void
}

export interface UploadByteOptions {
  onProgress?: (bytes: number) => void

  track?: boolean
  logOperation?: 'upload' | 'edit-upload'

  exposeCancel?: boolean
}

export interface DownloadByteOptions {
  track?: boolean
  logOperation?: 'download' | 'edit-download'
  exposeCancel?: boolean

  onTransfer?: (dl: LocalPathFileDownload) => void

  shouldAbort?: () => boolean
}

export async function uploadViaRawToTemp(
  rawSftp: any,
  remotePath: string,
  up: LocalPathFileUpload,
  offset: number,
): Promise<void> {
  const tempPath = remotePath + '.tabby-upload'
  const writeStream = rawSftp.createWriteStream(tempPath, {
    flags: offset > 0 ? 'r+' : 'w',
    start: offset,
  })
  const safeUnlinkTemp = () => { try { rawSftp.unlink(tempPath).catch(() => null) } catch { /* ignore */ } }
  return new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => {

      if (up.isPaused() || up.isCancelled?.()) { up.close().catch(() => {}); resolve(); return }

      renameWithOverwrite(rawSftp, tempPath, remotePath)
        .then(() => { up.close().catch(() => {}); resolve() })
        .catch((e: unknown) => { safeUnlinkTemp(); up.close().catch(() => {}); reject(e) })
    })
    writeStream.on('error', (err: Error) => {
      if (!up.isCancelled?.()) log.error('Raw upload stream error', err)
      safeUnlinkTemp()
      up.close().catch(() => {})
      reject(err)
    })
    const readNext = () => {
      up.read().then((buf) => {

        if (up.isCancelled?.() && !up.isPaused()) {
          try { writeStream.destroy() } catch { /* ignore */ }
          safeUnlinkTemp()
          up.close().catch(() => {})
          resolve()
          return
        }

        if (up.isPaused()) {
          writeStream.end()
          up.close().catch(() => {})
          return
        }
        if (buf.length === 0) { writeStream.end(); return }
        writeStream.write(buf, () => readNext())
      }).catch((e: unknown) => {

        if (up.isPaused()) {
          up.close().catch(() => {})
          resolve()
          return
        }

        if (up.isCancelled?.() && !up.isPaused()) {
          try { writeStream.destroy() } catch { /* ignore */ }
          safeUnlinkTemp()
          up.close().catch(() => {})
          resolve()
          return
        }
        log.error('Raw upload read error', e)
        try { writeStream.destroy() } catch { /* ignore */ }
        safeUnlinkTemp()
        up.close().catch(() => {})
        reject(e)
      })
    }
    readNext()
  })
}

export async function uploadLocalFile(
  ctx: ByteTransferContext,
  remotePath: string,
  localPath: string,
  opts: UploadByteOptions = {},
): Promise<boolean> {

  if (ctx.activeUploadTargets?.has(remotePath)) {
    log.warn('skip duplicate concurrent upload:', remotePath)
    return false
  }
  ctx.activeUploadTargets?.add(remotePath)
  const up = new LocalPathFileUpload(localPath)
  const progressTimer = opts.onProgress ? setInterval(() => opts.onProgress?.(Number(up.getCompletedBytes()) || 0), 250) : null
  if (opts.track && ctx.trackTransfer) {
    ctx.trackTransfer(up, 'upload', remotePath, localPath, opts.logOperation)
  }
  if (opts.exposeCancel && ctx.cancelRef) registerCancelRef(ctx.cancelRef, up)
  try {
    const rawSftp = ctx.session as any
    if (typeof rawSftp?.createWriteStream === 'function') {

      await uploadViaRawToTemp(rawSftp, remotePath, up, 0)
    } else {

      await ctx.session.upload(remotePath, up as any)
    }

    if (up.isCancelled() || up.isPaused()) {
      if (opts.track) log.info('Upload cancelled/paused:', localPath)
      return false
    }
    if (opts.track) log.info('Upload completed:', localPath)
    return true
  } catch (e) {

    if (up.isFailed() && up.getStatus()) {
      log.error(`Upload failed: ${remotePath} :: ${up.getStatus()}`)
      if (opts.track) ctx.onUploadError?.(remotePath, localPath, new Error(up.getStatus()))
      return false
    }

    if (up.isCancelled() || up.isPaused()) {
      if (opts.track) log.info('Upload cancelled/paused:', localPath)
      return false
    }

    log.error(`${opts.track ? 'Upload failed' : 'Upload failed (raw)'}: ${remotePath} :: ${errText(e)}`)
    if (opts.track) ctx.onUploadError?.(remotePath, localPath, e)
    return false
  } finally {
    if (progressTimer) clearInterval(progressTimer)
    ctx.activeUploadTargets?.delete(remotePath)
    if (opts.exposeCancel && ctx.cancelRef) unregisterCancelRef(ctx.cancelRef, up)
  }
}

const DOWNLOAD_TIMEOUT_RETRIES = 2

const DOWNLOAD_RETRY_DELAY_MS = 1500

const RUSSH_OPEN_READ = 0x0001

const READ_STALL_LIMIT_MS = 240_000

const READ_RETRY_DELAY_MS = 350

const READ_RETRY_DELAY_MAX_MS = 3000

const READ_RETRY_LOG_FIRST = 3
const READ_RETRY_LOG_EVERY = 5

export function isTimeoutLike(e: unknown): boolean {
  const s = typeof e === 'string'
    ? e
    : `${(e as any)?.code ?? ''} ${(e as any)?.message ?? ''} ${typeof e === 'object' && e !== null ? errText(e) : String(e)}`
  return /timed?\s*out|etimedout/i.test(s)
}

type ChunkedReadOutcome =
  | { kind: 'done' }

  | { kind: 'unsupported' }
  | { kind: 'aborted'; reason: 'paused' | 'cancelled' | 'external' }
  | { kind: 'failed'; error: unknown }

async function downloadViaChunkedRead(
  session: SFTPSessionLike,
  remotePath: string,
  dl: LocalPathFileDownload,
  declaredSize: number,
  externalAbort?: () => boolean,
): Promise<ChunkedReadOutcome> {

  if (!(declaredSize > 0)) return { kind: 'unsupported' }
  const openFn = session?.open
  if (typeof openFn !== 'function') return { kind: 'unsupported' }

  let handle: { read?: () => Promise<Uint8Array>; close?: () => Promise<void> } | null = null
  try {
    try {
      handle = await openFn.call(session, remotePath, RUSSH_OPEN_READ)
    } catch (e) {

      log.warn(`[download] chunked open failed, falling back to whole-file transfer: ${remotePath} :: ${errText(e)}`)
      return { kind: 'unsupported' }
    }
    const readFn = handle?.read
    if (!handle || typeof readFn !== 'function') return { kind: 'unsupported' }

    let lastByteAt = Date.now()
    let retryCount = 0

    for (;;) {
      if (dl.isPaused()) return { kind: 'aborted', reason: 'paused' }
      if (dl.isCancelled()) return { kind: 'aborted', reason: 'cancelled' }
      if (externalAbort?.()) return { kind: 'aborted', reason: 'external' }

      if (dl.isComplete()) return { kind: 'done' }

      let chunk: Uint8Array | null = null
      let lastErr: unknown = null

      for (;;) {
        try {
          chunk = await readFn.call(handle)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          if (dl.isPaused() || dl.isCancelled()) return { kind: 'aborted', reason: dl.isPaused() ? 'paused' : 'cancelled' }

          if (!isTimeoutLike(e)) break
          const stalledMs = Date.now() - lastByteAt
          if (stalledMs >= READ_STALL_LIMIT_MS) break
          retryCount++
          if (retryCount <= READ_RETRY_LOG_FIRST || retryCount % READ_RETRY_LOG_EVERY === 0) {
            log.warn(
              `[download] read timed out (retry ${retryCount}, no data for ${Math.round(stalledMs / 1000)}s), keeping partial data: ${remotePath}`,
            )
          }

          const backoff = Math.min(READ_RETRY_DELAY_MS * 2 ** Math.min(retryCount - 1, 4), READ_RETRY_DELAY_MAX_MS)
          await new Promise(r => setTimeout(r, backoff))
        }
      }
      if (lastErr != null || chunk === null) {
        log.error(
          `[download] chunked read failed (${retryCount} retries, no data for ${Math.round((Date.now() - lastByteAt) / 1000)}s): ${remotePath} :: ${errText(lastErr)}`,
        )
        return { kind: 'failed', error: lastErr }
      }
      if (!chunk.length) return { kind: 'done' } // EOF
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      try {
        await dl.write(buf)
      } catch (e) {

        if (dl.isPaused()) return { kind: 'aborted', reason: 'paused' }
        if (dl.isCancelled()) return { kind: 'aborted', reason: 'cancelled' }
        log.error(`[download] chunked write failed: ${remotePath} :: ${errText(e)}`)
        return { kind: 'failed', error: e }
      }
      lastByteAt = Date.now()
    }
  } finally {
    try { await handle?.close?.() } catch { /* ignore */ }
  }
}

async function unlinkQuiet(tmpPath: string): Promise<void> {
  try { await fsPromises.unlink(tmpPath) } catch { /* ignore */ }
}

export async function downloadRemoteFile(
  ctx: ByteTransferContext,
  remotePath: string,
  localPath: string,
  mode?: number,
  size?: number,
  opts: DownloadByteOptions = {},
): Promise<boolean> {
  if (ctx.activeDownloadTargets.has(localPath)) {
    log.warn(opts.exposeCancel ? 'skip duplicate concurrent download (raw):' : 'skip duplicate concurrent download:', localPath)
    return false
  }
  ctx.activeDownloadTargets.add(localPath)

  let dlRef: LocalPathFileDownload | null = null
  try {
    let resolvedSize = size

    if (resolvedSize === undefined || resolvedSize < 0) {
      resolvedSize = await statSizeWithRetry(ctx.session, remotePath)
    }

    let sz = resolvedSize ?? -1
    const tmpPath = localPath + '.tmp'

    if (sz === 0 && size !== undefined && size === 0) {
      const confirmed = await statSizeWithRetry(ctx.session, remotePath)
      if (confirmed > 0) {
        log.warn(`[download] caller declared size=0 but remote reports ${confirmed} bytes, downloading with real size:`, remotePath)
        sz = confirmed
      }
    }

    if (sz === 0 && size !== undefined && size === 0) {
      try {
        const fd = await fsPromises.open(tmpPath, 'w')
        await fd.close()
        await fsPromises.rename(tmpPath, localPath)
      } catch { /* ignore */ }
      if (opts.track && ctx.trackTransfer) {
        const dl = new LocalPathFileDownload(localPath, mode ?? 0o644, 0)
        ctx.trackTransfer(dl, 'download', remotePath, localPath, opts.logOperation)
      }
      return true
    }

    const dl = new LocalPathFileDownload(tmpPath, mode ?? 0o644, sz)
    dlRef = dl
    if (opts.track && ctx.trackTransfer) {
      ctx.trackTransfer(dl, 'download', remotePath, localPath, opts.logOperation)
    }
    if (opts.exposeCancel && ctx.cancelRef) registerCancelRef(ctx.cancelRef, dl)
    opts.onTransfer?.(dl)

    const chunked = await downloadViaChunkedRead(ctx.session, remotePath, dl, sz, opts.shouldAbort)
    if (chunked.kind === 'failed') {

      log.error(`${opts.track ? 'Download failed' : 'Download failed (raw)'}: ${remotePath} :: ${errText(chunked.error)}`)
      await unlinkQuiet(tmpPath)
      try { await dl._markFailed?.() } catch { /* ignore */ }
      if (opts.track) ctx.onDownloadError?.(remotePath, chunked.error)
      return false
    }
    if (chunked.kind === 'aborted') {

      if (chunked.reason === 'paused') {
        if (opts.track) log.info('Download paused:', remotePath)
        return false
      }
      await unlinkQuiet(tmpPath)
      return false
    }
    if (chunked.kind === 'unsupported') {

      let timeoutAttempts = 0
      for (;;) {
        try {
          await ctx.session.download(remotePath, dl)
          break
        } catch (dlErr) {

          const status = dl.getStatus()
          const userAbort = dl.isPaused() || /cancel|pause/i.test(status)
          if (userAbort) throw dlErr
          if (!(isTimeoutLike(dlErr) || isTimeoutLike(status))) {

            await unlinkQuiet(tmpPath)
            throw dlErr
          }

          const tmpStat = await fsPromises.stat(tmpPath).catch(() => null)
          if (tmpStat && sz > 0 && tmpStat.size === sz) {
            log.warn(`[download] timed out but all ${sz} bytes already received, completing:`, remotePath)
            dl._clearTransferFailureMarks()
            try { await dl._markComplete?.() } catch { /* ignore */ }
            break
          }

          if (timeoutAttempts >= DOWNLOAD_TIMEOUT_RETRIES) {
            log.error(`[download] request timed out ${timeoutAttempts + 1} times, giving up:`, remotePath)

            await unlinkQuiet(tmpPath)
            throw dlErr
          }
          timeoutAttempts++
          log.warn(`[download] request timed out (retry ${timeoutAttempts}/${DOWNLOAD_TIMEOUT_RETRIES}), restarting file:`, remotePath)
          dl._resetForFullRetry()
          await unlinkQuiet(tmpPath)
          await new Promise(r => setTimeout(r, DOWNLOAD_RETRY_DELAY_MS))
        }
      }
    }

    try {

      if (dl.isCancelled()) {
        await unlinkQuiet(tmpPath)
        return false
      }

      try { await dl.close() } catch { /* ignore */ }
      const localStat = await fsPromises.stat(tmpPath).catch(() => null)

      if (!localStat) throw new Error('Download integrity check failed: missing local temp file')
      if (sz > 0 && localStat.size !== sz) {
        throw new Error(`Size mismatch: remote=${sz} local=${localStat.size}`)
      }
      await fsPromises.rename(tmpPath, localPath)

      try { await dl._markComplete?.() } catch { /* ignore */ }
      if (opts.track) log.info('Download completed:', remotePath)
      return true
    } catch (e) {

      if (dl.isFailed() && dl.getStatus()) {
        log.error(`Download failed: ${remotePath} :: ${dl.getStatus()}`)
        try { await fsPromises.unlink(tmpPath) } catch { /* ignore */ }
        try { await dl._markFailed?.() } catch { /* ignore */ }
        if (opts.track) ctx.onDownloadError?.(remotePath, new Error(dl.getStatus()))
        return false
      }

      if (dl.isPaused()) {
        if (opts.track) log.info('Download paused:', remotePath)
        return false
      }
      if (dl.isCancelled()) {
        try { await fsPromises.unlink(tmpPath) } catch { /* ignore */ }
        return false
      }

      log.error(`${opts.track ? 'Download failed' : 'Download failed (raw)'}: ${remotePath} :: ${errText(e)}`)
      await unlinkQuiet(tmpPath)

      try { await dl._markFailed?.() } catch { /* ignore */ }
      if (opts.track) ctx.onDownloadError?.(remotePath, e)
      return false
    }
  } finally {

    if (opts.exposeCancel && dlRef && ctx.cancelRef) unregisterCancelRef(ctx.cancelRef, dlRef)
    ctx.activeDownloadTargets.delete(localPath)
  }
}
