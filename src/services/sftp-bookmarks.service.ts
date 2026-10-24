import { Injectable, Optional } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { randomUUID } from 'crypto'
import * as path from 'path'

import { log } from './sftp-logger'
export type Bookmark = {
  id: string
  name: string
  path: string
  type: 'local' | 'remote'

  connectionKey?: string
  createdAt: number
}

const STORAGE_KEY = 'sftp-plus-bookmarks-v2'
const TOMBSTONE_KEY = 'sftp-plus-bookmarks-tombstones-v1'
const MAX_TOMBSTONES = 500

let _idCounter = 0
function generateId(): string {
  return Date.now().toString(36) + '-' + (++_idCounter).toString(36) + '-' + randomUUID()
}

export function normalizeBookmarkPath(p: string, type: 'local' | 'remote'): string | null {
  if (typeof p !== 'string') return null
  let s = p.trim()
  if (!s) return null
  if (type === 'remote') {
    if (!s.startsWith('/')) s = '/' + s
    s = path.posix.normalize(s.replace(/\/+/g, '/'))
    if (!s.startsWith('/')) s = '/' + s
    return s
  }
  try {
    return path.normalize(s)
  } catch {
    return null
  }
}

@Injectable()
export class SftpBookmarksService {
  private bookmarks: Bookmark[] = []
  private _tombstones: string[] = []
  private _loaded = false

  constructor(@Optional() private configService?: ConfigService) {
    this.load()
  }

  private _loadTombstones(): void {
    try {
      const raw = localStorage.getItem(TOMBSTONE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this._tombstones = parsed.filter((x: unknown) => typeof x === 'string').slice(-MAX_TOMBSTONES)
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
    this._saveTombstones()
  }

  private load(): void {
    if (this._loaded) return
    this._loaded = true
    this._loadTombstones()

    if (this.configService?.store) {
      try {
        const cfg = this.configService.store['tabby-sftp-plus-plus']
        if (cfg && 'bookmarks' in cfg) {
          this.bookmarks = [...cfg.bookmarks].filter(b => b?.id && !this._tombstones.includes(b.id))
          return
        }
      } catch {}
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        this.bookmarks = (Array.isArray(parsed) ? parsed : []).filter(
          (b: Bookmark) => b?.id && !this._tombstones.includes(b.id),
        )
      }
    } catch {
      this.bookmarks = []
    }
  }

  private save(): void {

    if (this.configService?.store) {
      try {
        const target = this.configService.store['tabby-sftp-plus-plus']
        if (target) {

          const deleted = new Set(this._tombstones)
          const stored: Bookmark[] = Array.isArray(target.bookmarks) ? target.bookmarks : []
          const merged = new Map<string, Bookmark>(
            this.bookmarks.filter(b => b?.id && !deleted.has(b.id)).map(b => [b.id, b]),
          )
          for (const b of stored) {
            if (b?.id && !merged.has(b.id) && !deleted.has(b.id)) merged.set(b.id, b)
          }
          this.bookmarks = [...merged.values()]
          target.bookmarks = this.bookmarks
          this.configService.save()
          return
        }
      } catch (e) { log.warn('config save failed', e) }
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bookmarks))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        log.warn('localStorage quota exceeded for bookmarks; config save may still succeed')
      }
    }
  }

  getAll(): Bookmark[] {
    return [...this.bookmarks]
  }

  getGlobal(): Bookmark[] {
    return this.bookmarks.filter(b => !b.connectionKey)
  }

  getByConnection(connectionKey: string): Bookmark[] {
    return this.bookmarks.filter(b => b.connectionKey === connectionKey)
  }

  getByType(type: 'local' | 'remote', connectionKey?: string): Bookmark[] {
    return this.bookmarks.filter(b => {
      if (b.type !== type) return false
      if (connectionKey && b.connectionKey && b.connectionKey !== connectionKey) return false
      return true
    })
  }

  add(name: string, pathStr: string, type: 'local' | 'remote', connectionKey?: string): Bookmark | null {
    const normalized = normalizeBookmarkPath(pathStr, type)
    if (!normalized) {
      log.warn('reject bookmark with invalid path:', pathStr)
      return null
    }
    const bookmark: Bookmark = {
      id: generateId(),
      name,
      path: normalized,
      type,
      connectionKey: connectionKey || undefined,
      createdAt: Date.now(),
    }
    this.bookmarks.push(bookmark)
    this.save()
    return bookmark
  }

  remove(id: string): void {
    this._tombstone(id)
    this.bookmarks = this.bookmarks.filter(b => b.id !== id)
    this.save()
  }

  update(id: string, updates: Partial<Pick<Bookmark, 'name' | 'path'>>): void {
    const idx = this.bookmarks.findIndex(b => b.id === id)
    if (idx === -1) return
    if (updates.name !== undefined) this.bookmarks[idx].name = updates.name
    if (updates.path !== undefined) {
      const type = this.bookmarks[idx].type
      const normalized = normalizeBookmarkPath(updates.path, type)
      if (!normalized) {
        log.warn('reject bookmark update with invalid path:', updates.path)
        return
      }
      this.bookmarks[idx].path = normalized
    }
    this.save()
  }

  hasBookmark(pathStr: string, type: 'local' | 'remote'): boolean {
    const normalized = normalizeBookmarkPath(pathStr, type) || pathStr
    return this.bookmarks.some(b => b.path === normalized && b.type === type)
  }

  getByPath(pathStr: string, type: 'local' | 'remote'): Bookmark | undefined {
    const normalized = normalizeBookmarkPath(pathStr, type) || pathStr
    return this.bookmarks.find(b => b.path === normalized && b.type === type)
  }

  reload(): void {
    this._loaded = false
    this.bookmarks = []
    this.load()
  }

  reorder(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.bookmarks.length) return
    if (toIndex < 0 || toIndex >= this.bookmarks.length) return
    if (fromIndex === toIndex) return
    const [item] = this.bookmarks.splice(fromIndex, 1)
    this.bookmarks.splice(toIndex, 0, item)
    this.save()
  }
}
