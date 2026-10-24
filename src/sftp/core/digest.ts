import { createHash } from 'crypto'
import { createReadStream, promises as fsp } from 'fs'
import { execSshCommand } from './path-utils'
import { shellQuotePosix } from './fs-ops'
import { log } from '../../services/sftp-logger'

export type DigestAlgo = 'sha1' | 'sha256'

export interface DigestOptions {

  algo?: DigestAlgo

  maxBytes?: number

  timeoutMs?: number
}

export interface ContentDigestPort {
  readonly algo: DigestAlgo

  localDigest(localPath: string, size?: number, mtime?: number): Promise<string | null>

  remoteDigest(remotePath: string, size?: number, mtime?: number): Promise<string | null>
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20000

const CACHE_LIMIT = 256

interface CacheEntry {
  key: string
  digest: string
}

const HEX_RE = /\b([0-9a-fA-F]{40}|[0-9a-fA-F]{64})\b/

export class ContentDigestService implements ContentDigestPort {
  readonly algo: DigestAlgo
  private readonly maxBytes: number
  private readonly timeoutMs: number

  private readonly cache = new Map<string, CacheEntry>()

  private readonly pending = new Map<string, Promise<string | null>>()

  private remoteBin: 'sha1sum' | 'sha256sum' | 'openssl' | null | undefined
  private remoteProbe: Promise<void> | null = null

  constructor(
    private readonly getSshSession: () => unknown,
    opts: DigestOptions = {},
  ) {
    this.algo = opts.algo === 'sha256' ? 'sha256' : 'sha1'
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async localDigest(localPath: string, size?: number, mtime?: number): Promise<string | null> {
    return this._withDedupe('L|' + localPath, async () => {
      try {
        let s = size
        let m = mtime
        if (s == null || m == null) {
          const st = await fsp.stat(localPath)
          s = st.size
          m = st.mtimeMs
        }
        if (!this._withinLimit(s)) {
          log.warn('[digest] local file exceeds max size limit:', localPath, 'size:', s)
          return null
        }
        const key = `${s}:${m}`
        const hit = this.cache.get('L|' + localPath)
        if (hit && hit.key === key) return hit.digest
        const digest = await this._hashLocalFile(localPath)
        this._put('L|' + localPath, key, digest)
        return digest
      } catch (e) {
        log.warn('[digest] local digest failed:', localPath, e)
        return null
      }
    })
  }

  async remoteDigest(remotePath: string, size?: number, mtime?: number): Promise<string | null> {
    return this._withDedupe('R|' + remotePath, async () => {
      try {
        const ssh = this.getSshSession()
        if (!ssh) {
          log.warn('[digest] remote digest skipped: no SSH session for', remotePath)
          return null
        }

        if (size == null) {
          log.warn('[digest] remote size unknown, skipping digest to avoid unbounded hashing:', remotePath)
          return null
        }
        if (!this._withinLimit(size)) {
          log.warn('[digest] remote file exceeds max size limit:', remotePath, 'size:', size)
          return null
        }
        await this._ensureRemoteBin(ssh)
        if (!this.remoteBin) {
          log.warn('[digest] remote digest skipped: no sha1sum/sha256sum/openssl available on remote server for', remotePath)
          return null
        }
        const key = `${size ?? '?'}:${mtime ?? '?'}`
        const hit = this.cache.get('R|' + remotePath)
        if (hit && hit.key === key) return hit.digest

        const cmd = this.remoteBin === 'openssl'
          ? `openssl dgst -${this.algo} ${shellQuotePosix(remotePath)}`
          : `${this.remoteBin} ${shellQuotePosix(remotePath)}`

        const out = await execSshCommand(ssh, cmd, this.timeoutMs, { retryOnEmpty: true })
        const m = HEX_RE.exec(out || '')
        if (!m) {
          log.warn('[digest] remote digest output parse failed for', remotePath, 'output:', out?.slice(0, 200))
          return null
        }
        const digest = m[1].toLowerCase()
        this._put('R|' + remotePath, key, digest)
        return digest
      } catch (e) {
        log.warn('[digest] remote digest failed:', remotePath, e)
        return null
      }
    })
  }

  private _withinLimit(size: number | undefined): boolean {
    if (size == null) return true
    return size >= 0 && size <= this.maxBytes
  }

  private _hashLocalFile(p: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = createHash(this.algo)
      const s = createReadStream(p)
      s.on('error', reject)
      s.on('data', (chunk) => h.update(chunk))
      s.on('end', () => resolve(h.digest('hex')))
    })
  }

  private async _ensureRemoteBin(ssh: unknown): Promise<void> {
    if (this.remoteBin !== undefined) return
    if (this.remoteProbe) return this.remoteProbe
    this.remoteProbe = (async () => {
      const candidates: Array<'sha1sum' | 'sha256sum' | 'openssl'> =
        this.algo === 'sha256' ? ['sha256sum', 'openssl'] : ['sha1sum', 'openssl']
      for (const bin of candidates) {
        try {

          const out = await execSshCommand(ssh, `command -v ${bin} 2>/dev/null`, Math.min(this.timeoutMs, 8000), { retryOnEmpty: true })
          if (out && out.trim()) {
            log.info('[digest] remote bin detected:', bin)
            this.remoteBin = bin
            return
          }
        } catch {

        }
      }
      log.warn('[digest] no remote digest command found (tried:', candidates.join(', '), ')')
      this.remoteBin = null
    })()
    try {
      await this.remoteProbe
    } finally {
      this.remoteProbe = null
    }
  }

  private async _withDedupe(key: string, run: () => Promise<string | null>): Promise<string | null> {
    const existing = this.pending.get(key)
    if (existing) return existing
    const p = run()
    this.pending.set(key, p)
    try {
      return await p
    } finally {
      this.pending.delete(key)
    }
  }

  private _put(key: string, version: string, digest: string): void {
    if (this.cache.size >= CACHE_LIMIT) {

      const drop = Math.ceil(CACHE_LIMIT / 4)
      let i = 0
      for (const k of this.cache.keys()) {
        if (i++ >= drop) break
        this.cache.delete(k)
      }
    }
    this.cache.set(key, { key: version, digest })
  }
}
