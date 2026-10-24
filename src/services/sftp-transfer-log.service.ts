import { Injectable, Optional } from '@angular/core'
import { ConfigService } from 'tabby-core'

import { log } from './sftp-logger'
export type TransferLogEntry = {
  id: string
  timestamp: number
  operation: 'upload' | 'download' | 'edit-upload' | 'edit-download' | 'delete' | 'rename' | 'mkdir' | 'chmod'
  localPath: string
  remotePath: string
  profileName?: string
  success: boolean
  error?: string
  size?: number
  duration?: number  // milliseconds
  startTime?: number
  endTime?: number
  failReason?: 'interrupted' | 'cancelled' | 'error'

  pending?: boolean

  transferMode?: 'sftp' | 'tar'

  fileCount?: number

  skippedAsDuplicate?: { reason: 'content-identical'; algo?: 'sha1' | 'sha256'; at: number }
}

// Old editor-origin tags migrate into the same two public transfer operations.
export function normalizeTransferOperation<T extends string>(operation: T): T | 'upload' | 'download' {
  return operation === 'edit-upload' ? 'upload' : operation === 'edit-download' ? 'download' : operation
}

const STORAGE_KEY = 'sftp-plus-transfer-logs'
const MAX_LOGS = 1000

const TOMBSTONE_KEY = 'sftp-plus-transfer-logs-deleted'
const MAX_TOMBSTONES = 1000

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

@Injectable()
export class SftpTransferLogService {
  private logs: TransferLogEntry[] = []
  private _loaded = false

  private _tombstones: string[] = []

  private _bootReaped = false

  constructor(@Optional() private configService?: ConfigService) {
    this.load()
  }

  private load(): void {
    if (this._loaded) return
    this._loaded = true
    this._loadTombstones()

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.logs = this._sanitizeIds(parsed)
          this._reapStaleEntriesOnce()
          return
        }
      }
    } catch { /* fall through */ }

    if (this.configService?.store) {
      try {
        const cfg = this.configService.store['tabby-sftp-plus-plus']
        if (cfg && Array.isArray(cfg.transferLogs) && cfg.transferLogs.length > 0) {
          this.logs = this._sanitizeIds([...cfg.transferLogs])
          this._reapStaleEntriesOnce()

          delete cfg.transferLogs
          try { this.configService.save() } catch {}
          this.save()
          return
        }
      } catch {}
    }
    this.logs = []
  }

  private _reapStaleEntriesOnce(): void {
    if (this._bootReaped) return
    this._bootReaped = true
    this._reapStaleEntries()
  }

  private _reapStaleEntries(): void {
    const REAP_PENDING_MAX_AGE_MS = 10 * 60 * 1000
    let changed = false
    const now = Date.now()
    for (const entry of this.logs) {
      if (entry.pending) {
        const age = now - (entry.startTime ?? entry.timestamp)
        if (!Number.isFinite(age) || age < REAP_PENDING_MAX_AGE_MS) continue
        entry.pending = false
        entry.success = false
        entry.failReason = 'interrupted'
        entry.endTime = now
        changed = true
      }
    }
    if (changed) this.save()
  }

  private _sanitizeIds(logs: TransferLogEntry[]): TransferLogEntry[] {
    const seen = new Set<string>()
    const num = (v: unknown): number | undefined => {
      const x = Number(v)
      return isFinite(x) ? x : undefined
    }
    return logs.map(l => {
      let id = l.id
      if (!id || seen.has(id)) id = generateId()
      seen.add(id)
      return {
        ...l,
        operation: normalizeTransferOperation(l.operation),
        id,
        timestamp: num(l.timestamp) ?? Date.now(),
        size: l.size != null ? num(l.size) : undefined,
        duration: l.duration != null ? num(l.duration) : undefined,
        startTime: l.startTime != null ? num(l.startTime) : undefined,
        endTime: l.endTime != null ? num(l.endTime) : undefined,
      }
    })
  }

  private _loadTombstones(): void {
    try {
      const raw = localStorage.getItem(TOMBSTONE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this._tombstones = parsed.filter((x: unknown) => typeof x === 'string').slice(-MAX_TOMBSTONES)
        }
      }
    } catch { /* ignore */ }
  }

  private _saveTombstones(): void {
    try { localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(this._tombstones)) } catch { /* ignore */ }
  }

  private _tombstone(id: string | null | undefined): void {
    if (!id || this._tombstones.includes(id)) return
    this._tombstones.push(id)
    if (this._tombstones.length > MAX_TOMBSTONES) {
      this._tombstones.splice(0, this._tombstones.length - MAX_TOMBSTONES)
    }
  }

  private save(): void {

    const deleted = new Set(this._tombstones)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        if (Array.isArray(stored)) {
          const merged = new Map<string, TransferLogEntry>(
            this.logs.filter(l => l?.id && !deleted.has(l.id)).map(l => [l.id, l]),
          )

          const now = Date.now()
          const REAP_PENDING_MAX_AGE_MS = 10 * 60 * 1000
          for (const l of stored) {
            if (!l?.id || deleted.has(l.id) || merged.has(l.id)) continue
            if (l.pending) {
              const age = now - (l.startTime ?? l.timestamp)
              if (Number.isFinite(age) && age >= REAP_PENDING_MAX_AGE_MS) {
                l.pending = false
                l.success = false
                l.failReason = 'interrupted'
                l.endTime = now
              }
            }
            merged.set(l.id, l)
          }
          this.logs = [...merged.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        }
      }
    } catch {   }

    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(-MAX_LOGS)
    }

    try {
      const MAX_BYTES = 4 * 1024 * 1024 // 4 MB
      let serialized = JSON.stringify(this.logs)

      let estimatedBytes: number
      try {
        estimatedBytes = new Blob([serialized]).size
      } catch {
        estimatedBytes = serialized.length * 2 // UTF-16 worst case
      }
      while (estimatedBytes > MAX_BYTES && this.logs.length > 1) {

        this.logs = this.logs.slice(-Math.ceil(this.logs.length / 2))
        serialized = JSON.stringify(this.logs)
        try {
          estimatedBytes = new Blob([serialized]).size
        } catch {
          estimatedBytes = serialized.length * 2
        }
      }
      localStorage.setItem(STORAGE_KEY, serialized)
      this._saveTombstones()
    } catch (e) { log.warn('localStorage save failed', e) }
  }

  replaceFromImport(raw: unknown): boolean {
    if (!Array.isArray(raw)) return false
    const operations = new Set<TransferLogEntry['operation']>([
      'upload', 'download', 'edit-upload', 'edit-download',
      'delete', 'rename', 'mkdir', 'chmod',
    ])
    const modes = new Set<NonNullable<TransferLogEntry['transferMode']>>(['sftp', 'tar'])
    const now = Date.now()
    const finiteNumber = (value: unknown): number | undefined => {
      const number = Number(value)
      return Number.isFinite(number) ? number : undefined
    }
    const imported: TransferLogEntry[] = []
    for (const value of raw.slice(-MAX_LOGS)) {
      if (!value || typeof value !== 'object') continue
      const source = value as Record<string, unknown>
      const operation = String(source.operation ?? '') as TransferLogEntry['operation']
      if (!operations.has(operation)) continue
      const wasPending = source.pending === true
      const mode = String(source.transferMode ?? '') as NonNullable<TransferLogEntry['transferMode']>
      imported.push({
        id: typeof source.id === 'string' ? source.id.slice(0, 256) : '',
        timestamp: finiteNumber(source.timestamp) ?? now,
        operation,
        localPath: String(source.localPath ?? '').slice(0, 4096),
        remotePath: String(source.remotePath ?? '').slice(0, 4096),
        profileName: source.profileName == null ? undefined : String(source.profileName).slice(0, 512),
        success: wasPending ? false : source.success === true,
        error: source.error == null ? undefined : String(source.error).slice(0, 16384),
        size: finiteNumber(source.size),
        duration: finiteNumber(source.duration),
        startTime: finiteNumber(source.startTime),
        endTime: wasPending ? now : finiteNumber(source.endTime),
        failReason: wasPending ? 'interrupted'
          : (source.failReason === 'cancelled' || source.failReason === 'interrupted' || source.failReason === 'error'
              ? source.failReason : undefined),
        pending: false,
        transferMode: modes.has(mode) ? mode : undefined,
        fileCount: finiteNumber(source.fileCount),
      })
    }
    this.logs = this._sanitizeIds(imported)
    this._tombstones = []
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(TOMBSTONE_KEY)
    } catch { /* save() will report storage failures */ }
    this.save()
    return true
  }

  add(entry: Omit<TransferLogEntry, 'id' | 'timestamp'>): TransferLogEntry {
    const fullEntry: TransferLogEntry = {
      ...entry,
      operation: normalizeTransferOperation(entry.operation),
      id: generateId(),
      timestamp: Date.now(),
    }
    this.logs.push(fullEntry)
    const _name = (entry.remotePath || entry.localPath || '').split('/').pop() || (entry.localPath || '').split(/[\\/]/).pop() || '?'
    log.info('[transfer-log] add #' + this.logs.length + ' op=' + entry.operation + ' profile=' + (entry.profileName ?? '∅') + ' file=' + _name + ' pending=' + !!entry.pending)
    this.save()
    return fullEntry
  }

  update(id: string, updates: Partial<Omit<TransferLogEntry, 'id' | 'timestamp'>>): boolean {
    const idx = this.logs.findIndex(l => l.id === id)
    if (idx < 0) return false
    Object.assign(this.logs[idx], updates)
    this.save()
    return true
  }

  remove(id: string): boolean {
    const idx = this.logs.findIndex(l => l.id === id)
    if (idx < 0) return false
    this.logs.splice(idx, 1)
    this._tombstone(id)
    this.save()
    return true
  }

  getAll(): TransferLogEntry[] {
    return [...this.logs].reverse()
  }

  filter(options?: {
    operation?: TransferLogEntry['operation']
    success?: boolean
    profileName?: string
    since?: number  // timestamp (inclusive)
    until?: number  // timestamp (inclusive)
  }): TransferLogEntry[] {
    let result = [...this.logs]
    if (options?.operation) {
      result = result.filter(l => normalizeTransferOperation(l.operation) === normalizeTransferOperation(options.operation))
    }
    if (options?.success !== undefined) {
      result = result.filter(l => !l.pending && l.success === options.success)
    }
    if (options?.profileName) {

      result = result.filter(l => this._profileMatches(l, options.profileName))
    }
    if (options?.since !== undefined) {
      result = result.filter(l => l.timestamp >= options.since!)
    }
    if (options?.until !== undefined) {
      result = result.filter(l => l.timestamp <= options.until!)
    }
    return result.reverse()
  }

  clear(): void {

    const keptPending = this.logs.filter(l => l.pending === true)
    for (const l of this.logs) {
      if (l.pending !== true) this._tombstone(l.id)
    }
    this.logs = keptPending
    this.save()
  }

  importLogs(logs: TransferLogEntry[]): void {
    const imported = Array.isArray(logs) ? this._sanitizeIds(logs).slice(-MAX_LOGS) : []
    const keep = new Set(imported.map(l => l.id))

    for (const l of this.logs) {
      if (!keep.has(l.id)) this._tombstone(l.id)
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        if (Array.isArray(stored)) {
          for (const l of stored) {
            if (l?.id && !keep.has(l.id)) this._tombstone(l.id)
          }
        }
      }
    } catch { /* ignore */ }
    this.logs = imported
    this.save()
  }

  reload(): void {
    this._loaded = false
    this.logs = []
    this.load()
  }

  clearProfile(profileName: string): void {

    for (const l of this.logs) {
      if (l.pending !== true && this._profileMatches(l, profileName)) this._tombstone(l.id)
    }
    this.logs = this.logs.filter(l => l.pending === true || !this._profileMatches(l, profileName))
    this.save()
  }

  private _profileMatches(l: TransferLogEntry, profileName?: string): boolean {
    if (profileName === undefined) return true
    return !l.profileName || l.profileName === profileName
  }

  countClearable(profileName?: string): number {
    return this.logs.filter(l =>
      l.pending !== true && this._profileMatches(l, profileName),
    ).length
  }

  exportAsJson(): string {
    return JSON.stringify(this.getAll(), null, 2)
  }

  getStats(): {
    total: number
    success: number
    failed: number
    totalBytes: number
  } {
    const completed = this.logs.filter(l => !l.pending)
    const success = completed.filter(l => l.success).length
    const totalBytes = completed
      .filter(l => l.success && l.size)
      .reduce((sum, l) => sum + (l.size || 0), 0)
    return {
      total: this.logs.length,
      success,
      failed: completed.length - success,
      totalBytes,
    }
  }
}
