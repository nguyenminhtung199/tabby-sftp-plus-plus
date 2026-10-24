import { randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type { SFTPFile, SFTPSessionLike } from '../../services/sftp.service'
import { execSshCommand, safeEntryName } from './path-utils'
import { ConcurrencyLimiter } from './concurrency'

import { log } from '../../services/sftp-logger'

/** Guard recursive destinations, including case-insensitive Windows paths. */
export function isPathInside(parent: string, child: string, posix = false): boolean {
  let norm = posix ? path.posix.resolve(parent) : path.resolve(parent)
  let normChild = posix ? path.posix.resolve(child) : path.resolve(child)
  if (!posix && process.platform === 'win32') {
    norm = norm.toLowerCase()
    normChild = normChild.toLowerCase()
  }
  if (normChild === norm) return true
  const sep = posix ? '/' : path.sep
  return normChild.startsWith(norm + sep)
}

const DELETE_CONCURRENCY = 8

export async function deleteLocalRecursive(
  localPath: string,
  failed?: string[],
  depth = 0,
  limiter?: ConcurrencyLimiter,
): Promise<void> {
  if (depth > 100) {
    log.warn('deleteLocalRecursive max depth at', localPath)
    failed?.push(localPath)
    return
  }
  const lim = limiter ?? new ConcurrencyLimiter(DELETE_CONCURRENCY)
  const st = await fs.lstat(localPath).catch(() => null)
  if (!st) return
  if (st.isSymbolicLink() || !st.isDirectory()) {
    try { await lim.run(() => fs.unlink(localPath)) } catch (e) { failed?.push(localPath); log.warn('unlink failed', localPath, e) }
    return
  }
  let children: string[] = []
  try { children = await fs.readdir(localPath) } catch (e) { log.warn('readdir failed', localPath, e) }
  await Promise.all(children.map(child => deleteLocalRecursive(path.join(localPath, child), failed, depth + 1, lim)))
  try { await lim.run(() => fs.rmdir(localPath)) } catch (e) { failed?.push(localPath); log.warn('rmdir failed', localPath, e) }
}

export async function deleteRemoteRecursive(
  session: SFTPSessionLike | null,
  remotePath: string,
  failed?: string[],
  depth = 0,
  limiter?: ConcurrencyLimiter,
): Promise<void> {
  if (depth > 100 || !session) {
    if (depth > 100) log.warn('deleteRemoteRecursive max depth at', remotePath)
    if (!session) failed?.push(remotePath)
    return
  }
  const lim = limiter ?? new ConcurrencyLimiter(DELETE_CONCURRENCY)

  {
    try {
      const lstat = (session as any).lstat
      const readlink = (session as any).readlink

      if (typeof lstat !== 'function' && typeof readlink !== 'function') {
        log.warn('deleteRemoteRecursive refused: no lstat/readlink support:', remotePath)
        failed?.push(remotePath)
        return
      }
      const st: any = typeof lstat === 'function'
        ? await lstat.call(session, remotePath).catch(() => null)
        : null
      if (!st && typeof readlink !== 'function') {
        log.warn('deleteRemoteRecursive refused: symlink probe failed:', remotePath)
        failed?.push(remotePath)
        return
      }
      const isLink = !!(st && (
        st.isSymbolicLink === true ||
        (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) ||
        st.isSymlink === true ||

        st.type === 2 ||
        (st.attrs && (st.attrs.isSymlink || st.attrs.type === 'symbolic-link' || st.attrs.type === 2))
      ))

      if (!isLink && typeof readlink === 'function') {
        try {
          await readlink.call(session, remotePath)

          try { await lim.run(() => session.unlink(remotePath)) } catch (e) {
            failed?.push(remotePath); log.warn('unlink symlink failed', remotePath, e)
          }
          return
        } catch {   }
      }
      if (isLink) {
        try { await lim.run(() => session.unlink(remotePath)) } catch (e) {
          failed?.push(remotePath); log.warn('unlink symlink failed', remotePath, e)
        }
        return
      }
    } catch (e) {
      log.warn('deleteRemoteRecursive symlink probe failed:', remotePath, e)
    }
  }

  const entries = await session.readdir(remotePath).catch(() => null)
  if (!entries) {
    try { await lim.run(() => session.unlink(remotePath)) } catch (e) { failed?.push(remotePath); log.warn('unlink failed', remotePath, e) }
    return
  }
  const tasks = (entries as SFTPFile[]).map(async (e) => {
    const childPath = e.fullPath || path.posix.resolve(remotePath, e.name)

    const normParent = path.posix.resolve(remotePath)
    const normChild = path.posix.resolve(childPath)
    if (normChild !== normParent && !normChild.startsWith(normParent + '/')) {
      log.warn('delete skipped out-of-tree path:', childPath)
      failed?.push(childPath)
      return
    }

    if (e.isSymlink) {
      try { await lim.run(() => session.unlink(childPath)) } catch (e2) { failed?.push(childPath); log.warn('unlink failed', childPath, e2) }
      return
    }
    if (e.isDirectory) {

      try { await deleteRemoteRecursive(session, childPath, failed, depth + 1, lim) } catch { failed?.push(childPath) }
    } else {
      try { await lim.run(() => session.unlink(childPath)) } catch (e2) { failed?.push(childPath); log.warn('unlink failed', childPath, e2) }
    }
  })
  await Promise.all(tasks)
  try { await lim.run(() => session.rmdir(remotePath)) } catch (e) { failed?.push(remotePath); log.warn('rmdir failed', remotePath, e) }
}

async function copyFileWithRetry(src: string, dest: string, maxRetries = 3): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fs.copyFile(src, dest)
      return
    } catch (e: any) {
      const isBusy = e?.code === 'EBUSY' || e?.code === 'EPERM'
      if (isBusy && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 100 * (i + 1)))
        continue
      }
      throw e
    }
  }
}

const LOCAL_COPY_MAX_DEPTH = 64

export async function copyLocalDir(src: string, dest: string, depth = 0): Promise<void> {

  if (isPathInside(src, dest, false)) {
    throw new Error('Cannot copy a directory into itself or its subdirectory: ' + src)
  }
  if (depth > LOCAL_COPY_MAX_DEPTH) {
    throw new Error('Local copy exceeded max depth: ' + src)
  }
  await fs.mkdir(dest, { recursive: true })
  for (const item of await fs.readdir(src, { withFileTypes: true })) {
    const srcP = path.join(src, item.name)
    const destP = path.join(dest, item.name)
    if (item.isSymbolicLink()) {
      log.warn('copyLocalDir: skipping symbolic link', srcP)
      continue
    }
    if (item.isDirectory()) {
      await copyLocalDir(srcP, destP, depth + 1)
    } else {
      await copyFileWithRetry(srcP, destP)
    }
  }
}

export interface RemoteCopyDeps {
  hasSession(): boolean
  mkdir(remotePath: string): Promise<void>
  readdir(remoteSrc: string): Promise<Array<{ name: string; isDirectory: boolean; isSymbolicLink?: boolean }>>

  download(remotePath: string, localPath: string): Promise<boolean>
  upload(remotePath: string, localPath: string): Promise<boolean>

  tryServerCopy?(src: string, dest: string, isDir: boolean): Promise<boolean>
}

export function shellQuotePosix(value: string): string {

  const encoded = Buffer.from(value).toString('base64')
  return `"$(echo '${encoded}' | base64 -d)"`
}

export async function tryRemoteCpViaSsh(
  sshSession: unknown,
  src: string,
  dest: string,
  isDir: boolean,
): Promise<boolean> {
  if (!sshSession || !src || !dest || src === dest) return false

  if (isPathInside(src, dest, true)) {
    log.warn('Remote server-side cp refused: dest is inside src (would recurse):', src, '->', dest)
    return false
  }

  if (src.includes('\0') || dest.includes('\0')) return false
  const flag = isDir ? '-a' : '-p'
  const cmd =
    `cp ${flag} -- ${shellQuotePosix(src)} ${shellQuotePosix(dest)} ` +
    `&& printf 'SFTP_PLUS_CP_OK\\n' || printf 'SFTP_PLUS_CP_FAIL\\n'`
  try {

    const out = await execSshCommand(sshSession, cmd, 12000, { retryOnEmpty: false })
    if (/\bSFTP_PLUS_CP_OK\b/.test(out)) {
      log.info('Remote server-side cp OK:', src, '->', dest)
      return true
    }
    if (out) log.warn('Remote server-side cp failed:', src, '->', dest, out.trim())
    else log.warn('Remote server-side cp unavailable or empty response:', src, '->', dest)
  } catch (e) {
    log.warn('Remote server-side cp error:', src, '->', dest, e)
  }
  return false
}

export async function tryRemoteRmViaSsh(sshSession: unknown, remotePath: string): Promise<boolean> {
  if (!sshSession || !remotePath) return false
  if (remotePath.includes('\0')) return false
  const resolved = path.posix.resolve(remotePath.replace(/\/+$/, '') || '/')
  if (
    resolved === '/' ||
    resolved === '.' ||
    resolved === '..' ||
    resolved.length < 2
  ) {
    log.warn('Remote server-side rm refused dangerous path:', remotePath, '→', resolved)
    return false
  }
  const banned = new Set(['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/root', '/sbin', '/sys', '/usr', '/var', '/home', '/Users'])
  if (banned.has(resolved)) {
    log.warn('Remote server-side rm refused system path:', remotePath, '→', resolved)
    return false
  }

  const depth = resolved.split('/').filter(Boolean).length
  if (depth < 2) {
    log.warn('Remote server-side rm refused shallow path:', remotePath, '→', resolved)
    return false
  }
  const cmd =
    `rm -rf -- ${shellQuotePosix(resolved)} ` +
    `&& printf 'SFTP_PLUS_RM_OK\\n' || printf 'SFTP_PLUS_RM_FAIL\\n'`
  try {

    const out = await execSshCommand(sshSession, cmd, 60000)
    if (/\bSFTP_PLUS_RM_OK\b/.test(out)) {
      log.info('Remote server-side rm OK:', resolved)
      return true
    }
    if (out) log.warn('Remote server-side rm failed:', resolved, out.trim())
    else log.warn('Remote server-side rm unavailable or empty response:', resolved)
  } catch (e) {
    log.warn('Remote server-side rm error:', resolved, e)
  }
  return false
}

const REMOTE_COPY_MAX_DEPTH = 64

export async function copyRemoteDir(
  src: string,
  dest: string,
  isDir: boolean,
  deps: RemoteCopyDeps,
  depth = 0,
): Promise<void> {
  if (!deps.hasSession()) return

  if (isPathInside(src, dest, true)) {
    throw new Error('Cannot copy a directory into itself or its subdirectory: ' + src)
  }
  if (depth > REMOTE_COPY_MAX_DEPTH) {
    throw new Error('Remote copy exceeded max depth: ' + src)
  }

  if (deps.tryServerCopy) {
    try {
      if (await deps.tryServerCopy(src, dest, isDir)) return
    } catch (e) {
      log.warn('tryServerCopy threw, fallback to download+upload:', e)
    }
  }

  if (!isDir) {

    const tmpDir = await fs.mkdir(path.join(os.tmpdir(), `sftp-copy-${randomUUID()}`), { recursive: true })
    const tmpFile = path.join(tmpDir, path.basename(src))
    try {

      const dlOk = await deps.download(src, tmpFile)
      if (!dlOk) throw new Error('Remote copy download incomplete: ' + src)
      const upOk = await deps.upload(dest, tmpFile)
      if (!upOk) throw new Error('Remote copy upload incomplete: ' + dest)
    } finally {
      try { await fs.unlink(tmpFile) } catch {}
      try { await fs.rmdir(tmpDir) } catch {}
    }
    return
  }
  await deps.mkdir(dest)
  const entries = await deps.readdir(src)
  for (const entry of entries) {

    if (entry.isSymbolicLink || (entry as any).isSymlink) {
      log.warn('copyRemoteDir skip symlink entry:', path.posix.join(src, entry.name))
      continue
    }
    const safeName = safeEntryName(entry.name)
    if (!safeName) {
      log.warn('copyRemoteDir skip unsafe entry name:', entry.name)
      continue
    }
    const srcP = path.posix.join(src, safeName)
    const destP = path.posix.join(dest, safeName)
    if (entry.isDirectory) {
      await copyRemoteDir(srcP, destP, true, deps, depth + 1)
    } else {
      await copyRemoteDir(srcP, destP, false, deps, depth + 1)
    }
  }
}
