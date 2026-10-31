import { folderPhase } from './transfer-progress'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type { FolderTransferPort } from './transfer-types'
import type { FolderTransferCtx } from './panel-types'
import { shellQuotePosix } from './fs-ops'
import { log } from '../../services/sftp-logger'

export type TarChannelResult = 'fallback' | 'success' | 'failed'

export type TarChannelMode = 'smart' | 'sftpOnly' | 'tarOnly' | 'preferSftp' | 'preferTar'

export type TarFailureCode =
  | 'localTarMissing'
  | 'remoteTarMissing'
  | 'symlinkUnsupported'
  | 'localPackFailed'
  | 'remotePackFailed'
  | 'localExtractFailed'
  | 'nameEncodingUnsupported'
  | 'tarballFailed'
  | 'other'

const TAR_THRESHOLDS: Record<Exclude<TarChannelMode, 'sftpOnly' | 'tarOnly'>, { minFiles: number; maxBytes: number }> = {

  smart: { minFiles: 600, maxBytes: 48 * 1024 * 1024 },

  preferSftp: { minFiles: 1500, maxBytes: 48 * 1024 * 1024 },

  preferTar: { minFiles: 150, maxBytes: 256 * 1024 * 1024 },
}

export interface TarChannelDeps {
  hasSsh(): boolean

  exec(cmd: string, timeoutMs?: number, opts?: { retryOnEmpty?: boolean }): Promise<string>

  uploadFile(localPath: string, remotePath: string, onProgress?: (bytes: number) => void, shouldAbort?: () => boolean): Promise<boolean>
  downloadFile(remotePath: string, localPath: string, size: number, onProgress?: (bytes: number) => void, shouldAbort?: () => boolean): Promise<boolean>
  remoteUnlink(remotePath: string): Promise<void>

  scanLocalSize(localDir: string): Promise<number>

  scanLocalDir?(localDir: string): Promise<{ size: number; count: number }>

  scanLocalPaths?(paths: string[]): Promise<{ size: number; count: number }>

  scanRemoteSize(remotePath: string): Promise<number>

  notifyFailure?(name: string, code: TarFailureCode, detail: string): void
}

const TAR_OK = 'SFTP_PLUS_TAR_OK'

const REMOTE_TAR_TIMEOUT_MS = 120_000

const REMOTE_STATS_TIMEOUT_MS = 30_000

const BATCH_MAX_ARG_CHARS = 8_000

const MERGE_MAX_DEPTH = 64

function tarRecoverableFallback(folder: FolderTransferPort, ctx: FolderTransferCtx): 'fallback' {
  try {
    if (folder.discard) folder.discard(ctx)
    else folder.finish(ctx, false)
  } catch { /* ignore */ }
  return 'fallback'
}

function tarWorthwhile(
  mode: TarChannelMode,
  stats: { size: number; count: number } | null,
): { ok: boolean; reason: string } {
  if (mode === 'sftpOnly') return { ok: false, reason: 'channel mode = SFTP-only: skip tar channel' }
  if (mode === 'tarOnly') {

    return { ok: true, reason: 'channel mode = TAR-only: force tar (no fallback when packing is unavailable)' }
  }
  const th = TAR_THRESHOLDS[mode]
  const mb = (stats?.size ?? 0) / 1048576
  const mbStr = mb.toFixed(1)
  if (!stats) {

    if (mode === 'smart' || mode === 'preferSftp') return { ok: false, reason: 'no remote stats: use streaming SFTP without waiting for archive preparation' }
    return { ok: true, reason: 'no remote stats (probe unavailable): keep tar channel' }
  }
  if (stats.count >= th.minFiles && stats.size <= th.maxBytes) {
    return { ok: true, reason: `${stats.count} files / ${mbStr} MB: round-trip dominated, tar pays off (${mode})` }
  }
  if (stats.count < th.minFiles) {
    return {
      ok: false,
      reason: `only ${stats.count} files / ${mbStr} MB (< ${th.minFiles} files): pack+extract overhead ` +
        'outweighs saved round-trips, per-file channel is faster',
    }
  }
  return {
    ok: false,
    reason: `${stats.count} files / ${mbStr} MB (> ${Math.round(th.maxBytes / 1048576)} MB): single-stream tar ` +
      'loses to 3-way concurrent per-file transfer',
  }
}

const LOCAL_TAR_OUTPUT_MAX = 4_000

const LOCAL_TAR_TIMEOUT_MS = 10 * 60_000

let localTarCmdCache: string | null = null
function resolveLocalTarCmd(): string {
  if (localTarCmdCache) return localTarCmdCache
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
    const candidate = path.join(root, 'System32', 'tar.exe')
    if (existsSync(candidate)) {
      localTarCmdCache = candidate
      return candidate
    }

    log.warn('tar channel: System32\\tar.exe not found, falling back to PATH tar:', candidate)
  }
  localTarCmdCache = 'tar'
  return 'tar'
}

interface LocalTarResult {
  ok: boolean
  code: number | null

  output: string
}

function runLocalTar(args: string[]): Promise<LocalTarResult> {
  return new Promise((resolve) => {
    let settled = false
    const chunks: string[] = []
    let len = 0
    const done = (r: LocalTarResult) => { if (!settled) { settled = true; resolve(r) } }
    const take = (buf: Buffer) => {
      if (len >= LOCAL_TAR_OUTPUT_MAX) return
      const keep = buf.toString('utf8').slice(0, LOCAL_TAR_OUTPUT_MAX - len)
      if (keep) { chunks.push(keep); len += keep.length }
    }
    const text = () => chunks.join('').trim()
    try {
      const child = spawn(resolveLocalTarCmd(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
      child.stderr?.on('data', take)
      child.on('error', (e) => done({ ok: false, code: null, output: `spawn failed: ${(e as Error)?.message ?? e}` }))
      child.on('close', (code) => done({ ok: code === 0, code, output: text() }))
      setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        const tail = text()
        done({ ok: false, code: null, output: `${tail}${tail ? ' | ' : ''}timed out after ${LOCAL_TAR_TIMEOUT_MS}ms` })
      }, LOCAL_TAR_TIMEOUT_MS)
    } catch (e) {
      done({ ok: false, code: null, output: `spawn threw: ${String((e as Error)?.message ?? e)}` })
    }
  })
}

type LocalTarFlavor = 'bsd' | 'gnu' | 'unknown'
let localTarFlavorCache: LocalTarFlavor | null = null

async function detectLocalTarFlavor(): Promise<LocalTarFlavor> {
  if (localTarFlavorCache) return localTarFlavorCache
  const text = await new Promise<string>((resolve) => {
    let settled = false
    const chunks: string[] = []
    const done = (s: string) => { if (!settled) { settled = true; resolve(s) } }
    try {
      const child = spawn(resolveLocalTarCmd(), ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      const take = (b: Buffer) => { if (chunks.join('').length < 2000) chunks.push(b.toString('utf8')) }
      child.stdout?.on('data', take)
      child.stderr?.on('data', take)
      child.on('error', () => done(''))
      child.on('close', () => done(chunks.join('')))
      setTimeout(() => { try { child.kill() } catch { /* ignore */ }; done(chunks.join('')) }, 5000)
    } catch { done('') }
  })
  const lower = text.toLowerCase()
  localTarFlavorCache = /bsdtar|libarchive/.test(lower) ? 'bsd' : /gnu tar/.test(lower) ? 'gnu' : 'unknown'
  return localTarFlavorCache
}

async function assertExtractedUnderRoot(root: string): Promise<boolean> {
  const rootReal = await fs.realpath(root).catch(() => path.resolve(root))
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep
  const walk = async (dir: string): Promise<boolean> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isSymbolicLink()) {

        let target: string
        try {
          target = await fs.readlink(full)
        } catch {
          return false
        }
        const resolved = path.resolve(path.dirname(full), target)
        if (resolved !== rootReal && !resolved.startsWith(prefix)) {
          log.warn('tar channel: symlink target escapes sandbox, rejected:', full, '->', target)
          return false
        }
        continue
      }
      let real: string
      try {
        real = await fs.realpath(full)
      } catch {
        return false
      }
      if (real !== rootReal && !real.startsWith(prefix)) {
        log.warn('tar channel: zip-slip rejected path:', real)
        return false
      }
      if (e.isDirectory()) {
        if (!(await walk(full))) return false
      }
    }
    return true
  }
  return walk(root)
}

async function containsSymlink(root: string, depth = 0): Promise<boolean> {
  if (depth > 100) return true
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return true
  }
  for (const name of names) {
    const full = path.join(root, name)
    const st = await fs.lstat(full).catch(() => null)
    if (!st) return true
    if (st.isSymbolicLink()) return true
    if (st.isDirectory() && await containsSymlink(full, depth + 1)) return true
  }
  return false
}

const STAGING_DIR_NAME = '.sftp-plus-tmp'

async function resolveStagingRoot(nearDir: string): Promise<string> {
  const candidate = path.join(nearDir, STAGING_DIR_NAME)
  try {
    await fs.mkdir(candidate, { recursive: true })
    return candidate
  } catch (e) {

    log.warn(`tar channel: staging dir unusable near target, falling back to system temp: ${candidate} :: ${String((e as Error)?.message ?? e)}`)
    return os.tmpdir()
  }
}

async function cleanupStaging(root: string | null, subDir: string | null): Promise<void> {
  if (subDir) await fs.rm(subDir, { recursive: true, force: true }).catch(() => {})
  if (!root || root === os.tmpdir()) return
  await fs.rmdir(root).catch(() => {   })
}

function makeTempName(baseName: string, kind: string): string {
  return `${sanitizeNameSegment(baseName)}.sftp-plus-${kind}-${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeNameSegment(name: string): string {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .trim()
  if (!cleaned) return 'archive'
  return Array.from(cleaned).slice(0, 40).join('')
}

function buildRemoteUploadLanding(opts: {
  remoteTar: string
  remoteExtractDir: string
  expectedBase: string
  remoteTarget: string
  mergeIntoExisting: boolean
}): { cmd: string; retryOnEmpty: boolean } {
  const extractDirEntry = path.posix.join(opts.remoteExtractDir, opts.expectedBase)

  const placeStep = opts.mergeIntoExisting
    ? `&& mkdir -p ${shellQuotePosix(opts.remoteTarget)} ` +
      `&& cp -a ${shellQuotePosix(extractDirEntry + '/.')} ${shellQuotePosix(opts.remoteTarget + '/')} `
    : `&& test ! -e ${shellQuotePosix(opts.remoteTarget)} ` +
      `&& mv ${shellQuotePosix(extractDirEntry)} ${shellQuotePosix(opts.remoteTarget)} `
  return {
    cmd:

      `! tar tzf ${shellQuotePosix(opts.remoteTar)} | grep -E '(^/|(^|/)\\.\\.((/|$)))' >/dev/null ` +
      `&& mkdir -p ${shellQuotePosix(opts.remoteExtractDir)} ` +
      `&& tar xzf ${shellQuotePosix(opts.remoteTar)} -C ${shellQuotePosix(opts.remoteExtractDir)} ` +
      `&& test -e ${shellQuotePosix(extractDirEntry)} ` +
      placeStep +
      `&& rm -rf ${shellQuotePosix(opts.remoteExtractDir)} ` +
      `&& printf '${TAR_OK}\\n'`,
    retryOnEmpty: opts.mergeIntoExisting,
  }
}

function buildRemoteUploadBatchLanding(opts: {
  remoteTar: string
  remoteExtractDir: string
  remoteDir: string

  names: string[]
}): string {
  const at = (base: string, n: string) => shellQuotePosix(path.posix.join(base, n))
  const entryChecks = opts.names.map(n => `&& test -e ${at(opts.remoteExtractDir, n)} `).join('')
  const targetChecks = opts.names.map(n => `&& test ! -e ${at(opts.remoteDir, n)} `).join('')
  const moves = opts.names.map(n => `&& mv ${at(opts.remoteExtractDir, n)} ${at(opts.remoteDir, n)} `).join('')
  return (
    `! tar tzf ${shellQuotePosix(opts.remoteTar)} | grep -E '(^/|(^|/)\\.\\.((/|$)))' >/dev/null ` +
    `&& mkdir -p ${shellQuotePosix(opts.remoteExtractDir)} ` +
    `&& tar xzf ${shellQuotePosix(opts.remoteTar)} -C ${shellQuotePosix(opts.remoteExtractDir)} ` +
    entryChecks +
    targetChecks +
    moves +
    `&& rm -rf ${shellQuotePosix(opts.remoteExtractDir)} ` +
    `&& printf '${TAR_OK}\\n'`
  )
}

type ExtractOutcome = { ok: true } | { ok: false; code: TarFailureCode; detail: string }

async function extractTarSafely(
  tarFile: string,
  localDest: string,
  expectedBase: string,
  stagingRoot?: string,

  mergeIntoExisting = false,
): Promise<ExtractOutcome> {

  const sandbox = await fs.mkdtemp(path.join(stagingRoot ?? os.tmpdir(), 'untar-')).catch(() => null)
  if (!sandbox) {
    return { ok: false, code: 'localExtractFailed', detail: `cannot create extract sandbox under ${stagingRoot ?? os.tmpdir()}` }
  }
  try {
    const flavor = await detectLocalTarFlavor()

    const base = ['-xf', tarFile, '-C', sandbox]
    const charSetRetry = ['--options', 'hdrcharset=UTF-8', '-xf', tarFile, '-C', sandbox]
    const forceLocalRetry = ['-xf', tarFile, '-C', sandbox, '--force-local']
    const attempts: string[][] =
      flavor === 'gnu'

        ? [forceLocalRetry, base]
        : flavor === 'bsd'

          ? [base, charSetRetry]
          : [base, forceLocalRetry, charSetRetry]

    let extracted = false
    let lastOutput = ''
    for (const args of attempts) {
      const r = await runLocalTar(args)
      lastOutput = r.output
      if (r.ok) { extracted = true; break }
    }
    if (!extracted) {

      return {
        ok: false,
        code: 'localExtractFailed',
        detail: `local tar extract failed (tar=${flavor}, cmd="${resolveLocalTarCmd()}"): ${localDest} :: output="${lastOutput.slice(0, 400)}"`,
      }
    }
    if (!(await assertExtractedUnderRoot(sandbox))) {
      return { ok: false, code: 'localExtractFailed', detail: `extracted tree escapes sandbox (zip-slip or symbolic link): ${localDest}` }
    }
    const extractedDir = path.join(sandbox, expectedBase)
    const st = await fs.lstat(extractedDir).catch(() => null)
    if (!st) {

      const tops = await fs.readdir(sandbox).catch(() => [] as string[])
      const detail =
        `expected top-level entry missing after extract: expected="${expectedBase}" ` +
        `got=${JSON.stringify(tops.slice(0, 3))} (tar=${flavor}): ${localDest}`
      log.warn('tar channel: ' + detail)
      return { ok: false, code: tops.length === 1 ? 'nameEncodingUnsupported' : 'localExtractFailed', detail }
    }
    await fs.mkdir(localDest, { recursive: true }).catch(() => {})
    const finalDest = path.join(localDest, expectedBase)

    if (mergeIntoExisting) {

      const stats: MergeStats = { dirs: 0, files: 0, links: 0, vanished: [], failed: [] }
      const seen = new Set<string>([await fs.realpath(finalDest).catch(() => finalDest)])
      await mergeDirInto(extractedDir, finalDest, stats, seen)
      log.info(
        `tar channel: merge into existing dir done (dirs=${stats.dirs} files=${stats.files} ` +
        `links=${stats.links} skipped=${stats.vanished.length} failed=${stats.failed.length}): ${finalDest}`,
      )
      if (stats.vanished.length) {

        log.warn(
          `tar channel: merge skipped ${stats.vanished.length} entries (source vanished after listing): ` +
          stats.vanished.slice(0, 5).join(' | '),
        )
      }
      if (stats.failed.length) {

        log.warn(
          `tar channel: merge failed ${stats.failed.length} entries, refill via per-file channel: ` +
          stats.failed.slice(0, 5).join(' | '),
        )
        return {
          ok: false,
          code: 'localExtractFailed',
          detail: `merge into existing dir failed at ${stats.failed.length} entries: ${stats.failed.slice(0, 3).join(' | ')}`,
        }
      }
      return { ok: true }
    }

    if (await fs.stat(finalDest).then(() => true).catch(() => false)) {
      log.warn('tar channel: destination already exists, abort move:', finalDest)
      return { ok: false, code: 'localExtractFailed', detail: `destination already exists, abort move: ${finalDest}` }
    }
    try {
      await fs.rename(extractedDir, finalDest)
    } catch (e) {

      if (typeof (fs as any).cp === 'function') {
        try {
          await (fs as any).cp(extractedDir, finalDest, { recursive: true, dereference: false })
        } catch (e2) {
          return {
            ok: false,
            code: 'localExtractFailed',
            detail: `move into destination failed (rename+cp): ${finalDest} :: ${String((e2 as Error)?.message ?? e2)}`,
          }
        }
      } else {
        return {
          ok: false,
          code: 'localExtractFailed',
          detail: `move into destination failed (rename, no fs.cp available): ${finalDest} :: ${String((e as Error)?.message ?? e)}`,
        }
      }
    }
    return { ok: true }
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true }).catch(() => {})
  }
}

interface MergeStats {
  dirs: number
  files: number
  links: number
  vanished: string[]
  failed: string[]
}

async function mergeDirInto(
  src: string,
  dest: string,
  stats: MergeStats,
  seen: Set<string>,
  depth = 0,
): Promise<void> {
  if (depth > MERGE_MAX_DEPTH) {
    stats.failed.push(`depth limit reached at "${dest}"`)
    return
  }
  await fs.mkdir(dest, { recursive: true }).catch(() => {})

  let entries
  try {
    entries = await fs.readdir(src, { withFileTypes: true })
  } catch (err) {
    stats.vanished.push(`${src} :: ${String((err as Error)?.message ?? err)}`)
    return
  }

  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)

    let st
    try {
      st = await fs.lstat(s)
    } catch (err) {
      stats.vanished.push(`${s} :: ${String((err as Error)?.message ?? err)}`)
      continue
    }

    if (st.isSymbolicLink()) {
      await copyLinkOrTarget(s, d, stats, seen, depth)
      continue
    }
    if (st.isDirectory()) {

      const real = await fs.realpath(s).catch(() => s)
      if (seen.has(real)) {
        stats.vanished.push(`${s} (alias already merged)`)
        continue
      }
      seen.add(real)
      stats.dirs++
      await mergeDirInto(s, d, stats, seen, depth + 1)
      continue
    }
    await copyEntry(s, d, stats)
    stats.files++
  }
}

async function copyLinkOrTarget(
  s: string,
  d: string,
  stats: MergeStats,
  seen: Set<string>,
  depth: number,
): Promise<void> {
  const target = await fs.readlink(s).catch(() => null)
  if (target !== null) {
    const dst = await fs.lstat(d).catch(() => null)
    if (dst && !dst.isDirectory()) await fs.rm(d, { force: true }).catch(() => {})
    const ok = await fs.symlink(target, d).then(() => true).catch(() => false)
    if (ok) { stats.links++; return }
  }

  const rst = await fs.stat(s).catch(() => null)
  if (rst?.isDirectory()) {
    const real = await fs.realpath(s).catch(() => s)
    if (seen.has(real)) { stats.vanished.push(`${s} (alias already merged)`); return }
    seen.add(real)
    stats.links++
    await mergeDirInto(s, d, stats, seen, depth + 1)
    return
  }
  if (rst?.isFile()) {
    await copyEntry(s, d, stats)
    stats.links++
    return
  }
  stats.vanished.push(`${s} (dangling link)`)
}

async function copyEntry(s: string, d: string, stats: MergeStats): Promise<void> {
  const dst = await fs.lstat(d).catch(() => null)
  if (dst) {
    if (dst.isDirectory()) {
      stats.failed.push(`"${d}" (destination is a directory, refusing to replace)`)
      return
    }

    if (!dst.isFile()) await fs.rm(d, { force: true }).catch(() => {})
  }
  try {
    await fs.copyFile(s, d)
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)

    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') stats.vanished.push(`${s} :: ${msg}`)
    else stats.failed.push(`${s} -> ${d} :: ${msg}`)
  }
}

export class TarChannel {
  private localTarOk: boolean | null = null
  private remoteTarOk: boolean | null = null

  private remotePaxOk: boolean | null = null

  private remoteIoniceOk: boolean | null = null

  constructor(private readonly deps: TarChannelDeps) {}

  private _decline(
    mode: TarChannelMode,
    name: string,
    code: TarFailureCode,
    detail: string,
    folder?: FolderTransferPort,
    ctx?: FolderTransferCtx,
  ): TarChannelResult {
    if (mode !== 'tarOnly') {
      log.warn(`tar channel unavailable (${code}), fallback to per-file channel: ${detail}`)
      if (folder && ctx) return tarRecoverableFallback(folder, ctx)
      return 'fallback'
    }
    log.warn(`tar channel required by TAR-only mode but unusable (${code}), transfer will fail: ${detail}`)
    if (folder && ctx) {
      try { folder.finish(ctx, false) } catch { /* ignore */ }
    }
    try { this.deps.notifyFailure?.(name, code, detail) } catch { /* ignore */ }
    return 'failed'
  }

  private async _localTarAvailable(): Promise<boolean> {
    if (this.localTarOk !== null) return this.localTarOk
    const r = await runLocalTar(['--version'])
    this.localTarOk = r.ok
    if (!r.ok) log.warn(`tar channel: local tar unusable ("${resolveLocalTarCmd()}"): ${r.output}`)
    return this.localTarOk
  }

  private async _remoteTarAvailable(): Promise<boolean> {
    if (this.remoteTarOk !== null) return this.remoteTarOk
    try {

      const out = await this.deps.exec('command -v tar || which tar', undefined, { retryOnEmpty: true })
      this.remoteTarOk = /\btar\b/.test(out)
    } catch {
      this.remoteTarOk = false
    }
    return this.remoteTarOk
  }

  private async _remoteTarSupportsPax(): Promise<boolean> {
    if (this.remotePaxOk !== null) return this.remotePaxOk
    try {
      const out = await this.deps.exec(`tar --help 2>&1 | grep -c -- '--format' || true`, REMOTE_STATS_TIMEOUT_MS, { retryOnEmpty: true })
      this.remotePaxOk = parseInt(String(out).trim(), 10) > 0
    } catch {
      this.remotePaxOk = false
    }
    return this.remotePaxOk
  }

  private async _remoteIoniceAvailable(): Promise<boolean> {
    if (this.remoteIoniceOk !== null) return this.remoteIoniceOk
    try {
      const out = await this.deps.exec('command -v ionice || which ionice', undefined, { retryOnEmpty: true })
      this.remoteIoniceOk = /\bionice\b/.test(out)
    } catch {
      this.remoteIoniceOk = false
    }
    return this.remoteIoniceOk
  }

  private async _remoteNicePrefix(): Promise<string> {
    const io = (await this._remoteIoniceAvailable()) ? 'ionice -c3 ' : ''
    return `${io}nice -n 19 `
  }

  async tryUploadDir(
    localPath: string,
    remoteTarget: string,
    folder: FolderTransferPort,
    name: string,

    mergeIntoExisting = false,

    mode: TarChannelMode = 'smart',

    reuseLogEntryId?: string,
  ): Promise<TarChannelResult> {

    if (mode === 'sftpOnly') return 'fallback'

    if (!this.deps.hasSsh()) {
      return this._decline(mode, name, 'other', `no ssh session: ${localPath} -> ${remoteTarget}`)
    }
    if (localPath.includes('\0') || remoteTarget.includes('\0')) {
      return this._decline(mode, name, 'other', `NUL byte in path: ${localPath} -> ${remoteTarget}`)
    }

    if (!(await this._localTarAvailable())) {
      return this._decline(mode, name, 'localTarMissing', `local tar unavailable (pack step): ${localPath}`)
    }
    if (!(await this._remoteTarAvailable())) {
      return this._decline(mode, name, 'remoteTarMissing', `remote tar unavailable (extract step): ${remoteTarget}`)
    }
    if (await containsSymlink(localPath)) {

      return this._decline(mode, name, 'symlinkUnsupported', `local tree contains symlink: ${localPath}`)
    }

    const localStats = this.deps.scanLocalDir ? await this.deps.scanLocalDir(localPath).catch(() => null) : null
    const verdict = tarWorthwhile(mode, localStats)
    if (!verdict.ok) {

      return this._decline(mode, name, 'other', `not worthwhile (${verdict.reason}): ${localPath} -> ${remoteTarget}`)
    }

    log.info(`tar channel: packed upload start (${mergeIntoExisting ? 'merge-into-existing' : 'fresh'}); ${verdict.reason}: ${localPath} -> ${remoteTarget}`)

    const stagingRoot = await resolveStagingRoot(path.dirname(path.resolve(localPath)))
    const tmpDir = await fs.mkdtemp(path.join(stagingRoot, 'pack-')).catch(() => null)
    if (!tmpDir) {
      return this._decline(mode, name, 'other', `local staging dir unusable (mkdtemp failed): ${stagingRoot}`)
    }
    const tarFile = path.join(tmpDir, `${makeTempName(path.basename(localPath), 'tar')}.tar.gz`)

    const packArgs = ['-czf', tarFile, '-C', path.dirname(localPath), path.basename(localPath)]
    let packed = await runLocalTar(['-czf', '--format=pax', tarFile, '-C', path.dirname(localPath), path.basename(localPath)])
    if (!packed.ok) packed = await runLocalTar(packArgs)
    if (!packed.ok) {
      await cleanupStaging(stagingRoot, tmpDir)
      return this._decline(
        mode, name, 'localPackFailed',
        `local tar pack failed: ${localPath} (tar="${resolveLocalTarCmd()}") :: output="${packed.output.slice(0, 400)}"`,
      )
    }
    const tarSize = (await fs.stat(tarFile).catch(() => null))?.size ?? 0
    if (tarSize <= 0) {
      await cleanupStaging(stagingRoot, tmpDir)
      return this._decline(mode, name, 'localPackFailed', `local tarball empty or unreadable: ${tarFile}`)
    }

    const parent = path.posix.dirname(remoteTarget)

    const remoteTar = path.posix.join(parent, `${makeTempName(path.posix.basename(remoteTarget), 'tar')}.tar.gz`)
    const realSize = await this.deps.scanLocalSize(localPath).catch(() => 0)
    const displayTotal = realSize > 0 ? realSize : tarSize
    const disp = (b: number) => displayTotal === tarSize ? b : Math.round(b * displayTotal / tarSize)
    const ctx = folder.start(name, 'upload', remoteTarget, localPath, displayTotal, 1, reuseLogEntryId)

    folder.markChannelMode?.(ctx, 'tar')
    if (realSize > 0) folder.updateLogSize?.(ctx, realSize)
    let remoteExtractDir: string | null = null
    try {
      if (folder.isAborted(ctx)) {
        folder.finish(ctx, false)
        return 'failed'
      }
      const upOk = await this.deps.uploadFile(
        tarFile, remoteTar,
        bytes => folder.updateProgress(ctx, disp(bytes), name, 0, displayTotal),
        () => folder.isAborted(ctx),
      )
      if (folder.isAborted(ctx)) {
        folder.finish(ctx, false)
        return 'failed'
      }
      if (!upOk) {
        return this._decline(mode, name, 'tarballFailed', `tarball upload failed: ${remoteTarget}`, folder, ctx)
      }

      remoteExtractDir = path.posix.join(parent, makeTempName(path.posix.basename(remoteTarget), 'untar'))
      const expectedBase = path.posix.basename(remoteTarget)

      folderPhase(folder, ctx, 'extracting', name)
      const landing = buildRemoteUploadLanding({
        remoteTar, remoteExtractDir, expectedBase, remoteTarget, mergeIntoExisting,
      })
      folderPhase(folder, ctx, 'extracting', name)
      const out = await this.deps.exec(
        landing.cmd,
        REMOTE_TAR_TIMEOUT_MS,
        { retryOnEmpty: landing.retryOnEmpty },
      )
      if (!new RegExp(`\\b${TAR_OK}\\b`).test(out)) {

        this.deps.exec(`rm -rf ${shellQuotePosix(remoteExtractDir)}`).catch(() => {})

        return this._decline(
          mode, name, 'remotePackFailed',
          `remote extract failed: ${remoteTarget} :: output="${String(out ?? '').trim().slice(0, 400)}"`,
          folder, ctx,
        )
      }
      folder.updateProgress(ctx, displayTotal, name, 1, displayTotal)
      folder.finish(ctx, true)
      log.info('tar channel upload OK:', localPath, '->', remoteTarget)
      return 'success'
    } catch (e) {
      if (remoteExtractDir) {
        this.deps.exec(`rm -rf ${shellQuotePosix(remoteExtractDir)}`).catch(() => {})
      }

      return this._decline(
        mode, name, 'other',
        `upload via tar channel threw: ${remoteTarget} :: ${String((e as Error)?.message ?? e)}`,
        folder, ctx,
      )
    } finally {
      this.deps.remoteUnlink(remoteTar).catch(() => {})
      await cleanupStaging(stagingRoot, tmpDir)
    }
  }

  async tryUploadBatch(
    localPaths: string[],
    remoteDir: string,
    folder: FolderTransferPort,

    name: string,
    mode: TarChannelMode = 'smart',
  ): Promise<TarChannelResult> {
    const skip = (detail: string): TarChannelResult => {
      log.info(`[batch-upload] batch packing not applicable, per-file channel takes over: ${detail}`)
      return 'fallback'
    }

    if (mode === 'sftpOnly') return 'fallback'
    if (localPaths.length < 2) return skip(`only ${localPaths.length} entry`)
    const parents = [...new Set(localPaths.map(p => path.dirname(p)))]
    if (parents.length !== 1) return skip(`${parents.length} distinct parent dirs (multiple landing points)`)
    if (remoteDir.includes('\0') || localPaths.some(p => p.includes('\0'))) return skip('NUL byte in path')
    const names: string[] = []
    for (const p of localPaths) {

      const b = path.basename(p)
      if (!b || b === '.' || b === '..' || b.includes('/') || b.includes('\\')) return skip(`unsafe entry name: ${JSON.stringify(b)}`)
      names.push(b)
    }
    if (new Set(names).size !== names.length) return skip(`duplicate entry names (${names.length})`)

    const argChars = names.reduce((n, s) => n + s.length + 1, 0)
    if (argChars > BATCH_MAX_ARG_CHARS) return skip(`too many entry names for one command line (${argChars} chars)`)
    if (!this.deps.hasSsh()) return skip(`no ssh session: ${remoteDir}`)
    if (!(await this._localTarAvailable())) return skip(`local tar unavailable (pack step): ${parents[0]}`)
    if (!(await this._remoteTarAvailable())) return skip(`remote tar unavailable (extract step): ${remoteDir}`)

    for (const p of localPaths) {
      const st = await fs.lstat(p).catch(() => null)
      if (!st) return skip(`lstat failed: ${p}`)
      if (st.isSymbolicLink()) return skip(`entry is a symlink: ${p}`)
      if (st.isDirectory() && (await containsSymlink(p))) return skip(`local tree contains symlink: ${p}`)
    }

    const stats = this.deps.scanLocalPaths ? await this.deps.scanLocalPaths(localPaths).catch(() => null) : null
    const verdict = tarWorthwhile(mode, stats)
    if (!verdict.ok) return skip(`not worthwhile (${verdict.reason}): ${names.length} entries -> ${remoteDir}`)
    log.info(`[batch-upload] packed batch upload start; ${verdict.reason}; ${names.length} entries: ${parents[0]} -> ${remoteDir}`)

    const stagingRoot = await resolveStagingRoot(parents[0])
    const tmpDir = await fs.mkdtemp(path.join(stagingRoot, 'pack-')).catch(() => null)
    if (!tmpDir) return skip(`local staging dir unusable (mkdtemp failed): ${stagingRoot}`)
    const batchTag = `${path.basename(remoteDir) || 'batch'}-${names.length}`
    const tarFile = path.join(tmpDir, `${makeTempName(batchTag, 'tar')}.tar.gz`)

    const packTail = ['-C', parents[0], ...names]
    let packed = await runLocalTar(['-czf', '--format=pax', tarFile, ...packTail])
    if (!packed.ok) packed = await runLocalTar(['-czf', tarFile, ...packTail])
    if (!packed.ok) {
      await cleanupStaging(stagingRoot, tmpDir)
      return skip(`local tar pack failed (tar="${resolveLocalTarCmd()}") :: output="${packed.output.slice(0, 400)}"`)
    }
    const tarSize = (await fs.stat(tarFile).catch(() => null))?.size ?? 0
    if (tarSize <= 0) {
      await cleanupStaging(stagingRoot, tmpDir)
      return skip(`local tarball empty or unreadable: ${tarFile}`)
    }

    const realSize = stats?.size ?? 0
    const displayTotal = realSize > 0 ? realSize : tarSize
    const disp = (b: number) => displayTotal === tarSize ? b : Math.round(b * displayTotal / tarSize)
    const remoteTar = path.posix.join(remoteDir, `${makeTempName(batchTag, 'tar')}.tar.gz`)
    const ctx = folder.start(name, 'upload', remoteDir, parents[0], displayTotal, names.length)
    folder.markChannelMode?.(ctx, 'tar')
    if (realSize > 0) folder.updateLogSize?.(ctx, realSize)
    let remoteExtractDir: string | null = null
    try {
      if (folder.isAborted(ctx)) {
        folder.finish(ctx, false)
        return 'failed'
      }
      const upOk = await this.deps.uploadFile(
        tarFile, remoteTar,
        bytes => folder.updateProgress(ctx, disp(bytes), name, 0, displayTotal),
        () => folder.isAborted(ctx),
      )
      if (folder.isAborted(ctx)) {
        folder.finish(ctx, false)
        return 'failed'
      }
      if (!upOk) {
        return this._decline(mode, name, 'tarballFailed', `batch tarball upload failed: ${remoteDir}`, folder, ctx)
      }
      remoteExtractDir = path.posix.join(remoteDir, makeTempName(batchTag, 'untar'))
      const out = await this.deps.exec(
        buildRemoteUploadBatchLanding({ remoteTar, remoteExtractDir, remoteDir, names }),
        REMOTE_TAR_TIMEOUT_MS,

        { retryOnEmpty: false },
      )
      if (!new RegExp(`\\b${TAR_OK}\\b`).test(out)) {
        this.deps.exec(`rm -rf ${shellQuotePosix(remoteExtractDir)}`).catch(() => {})
        return this._decline(
          mode, name, 'remotePackFailed',
          `remote extract/landing failed: ${remoteDir} :: output="${String(out ?? '').trim().slice(0, 400)}"`,
          folder, ctx,
        )
      }
      folder.updateProgress(ctx, displayTotal, name, names.length, displayTotal)
      folder.finish(ctx, true)
      log.info(`[batch-upload] tar channel upload OK: ${names.length} entries -> ${remoteDir}`)
      return 'success'
    } catch (e) {
      if (remoteExtractDir) {
        this.deps.exec(`rm -rf ${shellQuotePosix(remoteExtractDir)}`).catch(() => {})
      }
      return this._decline(
        mode, name, 'other',
        `batch upload via tar channel threw: ${remoteDir} :: ${String((e as Error)?.message ?? e)}`,
        folder, ctx,
      )
    } finally {
      this.deps.remoteUnlink(remoteTar).catch(() => {})
      await cleanupStaging(stagingRoot, tmpDir)
    }
  }

  private async _remoteDirStats(dir: string, timeoutMs = REMOTE_STATS_TIMEOUT_MS): Promise<{ size: number; count: number } | null> {
    try {
      const q = shellQuotePosix(dir)
      const out = await this.deps.exec(
        `find ${q} -type f -printf '%s\\n' 2>/dev/null | awk '{n++; s+=$1} END {print n+0, s+0}'`,
        timeoutMs,
        { retryOnEmpty: false },
      )
      const m = String(out ?? '').trim().match(/^(\d+)\s+(\d+)$/)
      if (!m) return null
      return { count: parseInt(m[1], 10), size: parseInt(m[2], 10) }
    } catch {
      return null
    }
  }

  async tryDownloadDir(
    remoteSrc: string,
    localDest: string,
    folder: FolderTransferPort,
    name: string,

    mergeIntoExisting = false,

    mode: TarChannelMode = 'smart',
    statsHint?: { size: number; count: number },
  ): Promise<TarChannelResult> {

    if (mode === 'sftpOnly') return 'fallback'
    if (statsHint && !tarWorthwhile(mode, statsHint).ok) return 'fallback'

    if (!this.deps.hasSsh()) {
      return this._decline(mode, name, 'other', `no ssh session: ${remoteSrc} -> ${localDest}`)
    }
    if (remoteSrc.includes('\0') || localDest.includes('\0')) {
      return this._decline(mode, name, 'other', `NUL byte in path: ${remoteSrc} -> ${localDest}`)
    }
    if (!(await this._localTarAvailable())) {
      return this._decline(mode, name, 'localTarMissing', `local tar unavailable (extract step): ${localDest}`)
    }
    if (!(await this._remoteTarAvailable())) {
      return this._decline(mode, name, 'remoteTarMissing', `remote tar unavailable (pack step): ${remoteSrc}`)
    }

    const parent = path.posix.dirname(remoteSrc)
    const base = path.posix.basename(remoteSrc)

    const dirStats = statsHint || await this._remoteDirStats(remoteSrc, mode === 'smart' || mode === 'preferSftp' ? 3_000 : REMOTE_STATS_TIMEOUT_MS)
    const verdict = tarWorthwhile(mode, dirStats)
    if (!verdict.ok) {

      return this._decline(mode, name, 'other', `not worthwhile (${verdict.reason}): ${remoteSrc} -> ${localDest}`)
    }

    log.info(
      `tar channel: packed download start (mergeIntoExisting=${mergeIntoExisting}); ${verdict.reason}: ` +
      `${remoteSrc} -> ${localDest}`,
    )

    const remoteTar = path.posix.join(parent, `${makeTempName(base, 'tar')}.tar`)

    const paxFlag = (await this._remoteTarSupportsPax()) ? '--format=pax ' : ''
    let out = await this.deps.exec(
      `${await this._remoteNicePrefix()}tar cf ${shellQuotePosix(remoteTar)} ${paxFlag}-C ${shellQuotePosix(parent)} ${shellQuotePosix(base)} ` +
      `&& printf '${TAR_OK}\\n'`,
      REMOTE_TAR_TIMEOUT_MS,
      { retryOnEmpty: true },
    )
    if (!new RegExp(`\\b${TAR_OK}\\b`).test(out)) {
      this.deps.remoteUnlink(remoteTar).catch(() => {})

      return this._decline(
        mode, name, 'remotePackFailed',
        `remote pack failed: ${remoteSrc} (pax=${paxFlag ? 'on' : 'off'}) :: output="${String(out ?? '').trim().slice(0, 400)}"`,
      )
    }

    out = await this.deps.exec(`wc -c < ${shellQuotePosix(remoteTar)}`, undefined, { retryOnEmpty: true })
    const tarSize = parseInt(out.trim(), 10)
    if (!Number.isFinite(tarSize) || tarSize <= 0) {
      this.deps.remoteUnlink(remoteTar).catch(() => {})

      return this._decline(
        mode, name, 'remotePackFailed',
        `remote tarball size invalid ("${String(out ?? '').trim().slice(0, 120)}"): ${remoteTar}`,
      )
    }

    const realSize = dirStats?.size ?? 0
    const displayTotal = realSize > 0 ? realSize : tarSize
    const disp = (b: number) => displayTotal === tarSize ? b : Math.round(b * displayTotal / tarSize)
    const ctx = folder.start(name, 'download', remoteSrc, path.join(localDest, base), displayTotal, 1)

    folder.markChannelMode?.(ctx, 'tar')
    if (realSize > 0) folder.updateLogSize?.(ctx, realSize)

    const stagingRoot = await resolveStagingRoot(localDest)
    const tmpDir = await fs.mkdtemp(path.join(stagingRoot, 'pack-')).catch(() => null)

    const tarFile = tmpDir ? path.join(tmpDir, `${makeTempName(base, 'tar')}.tar`) : null
    try {
      if (folder.isAborted(ctx)) {
        folder.finish(ctx, false)
        return 'failed'
      }

      if (!tmpDir || !tarFile) {
        return this._decline(mode, name, 'other', `local staging dir unusable (mkdtemp failed): ${stagingRoot}`, folder, ctx)
      }
      const dlOk = await this.deps.downloadFile(
        remoteTar, tarFile, tarSize,
        bytes => folder.updateProgress(ctx, disp(bytes), name, 0, displayTotal),
        () => folder.isAborted(ctx),
      )
      if (folder.isAborted(ctx)) {
        folder.finish(ctx, false)
        return 'failed'
      }
      if (!dlOk) {
        return this._decline(mode, name, 'tarballFailed', `tarball download failed: ${remoteSrc}`, folder, ctx)
      }

      folderPhase(folder, ctx, 'extracting', name)
      const extracted = await extractTarSafely(tarFile, localDest, base, stagingRoot, mergeIntoExisting)
      if (extracted.ok === false) {
        return this._decline(mode, name, extracted.code, extracted.detail, folder, ctx)
      }

      if (!(realSize > 0) && !mergeIntoExisting) {
        const extractedSize = await this.deps.scanLocalSize(path.join(localDest, base)).catch(() => 0)
        if (extractedSize > 0) folder.updateLogSize?.(ctx, extractedSize)
      }
      folder.updateProgress(ctx, displayTotal, name, 1, displayTotal)
      folder.finish(ctx, true)
      log.info('tar channel download OK:', remoteSrc, '->', localDest)
      return 'success'
    } catch (e) {

      return this._decline(
        mode, name, 'other',
        `download via tar channel threw: ${remoteSrc} :: ${String((e as Error)?.message ?? e)}`,
        folder, ctx,
      )
    } finally {
      this.deps.remoteUnlink(remoteTar).catch(() => {})
      if (tmpDir) await cleanupStaging(stagingRoot, tmpDir)
    }
  }
}
