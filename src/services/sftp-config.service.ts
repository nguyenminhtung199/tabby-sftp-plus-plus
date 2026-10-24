import { Injectable, Optional } from '@angular/core'
import { ConfigService } from 'tabby-core'

const OLD_KEY_MAP: Record<string, string> = {
  'sftp-plus-path-mode':        'perHost.{host}.pathMode',
  'sftp-plus-path-mem':         'perHost.{host}.rememberPath',
  'sftp-plus-saved-local-path': 'perHost.{host}.savedLocalPath',
  'sftp-plus-saved-remote-path':'perHost.{host}.savedRemotePath',
}

@Injectable({ providedIn: 'root' })
export class SftpConfigService {
  private _migrated = false

  private _cache: Record<string, any> = {}

  private _localRoot: Record<string, any> = {}

  constructor(@Optional() private configService?: ConfigService) {
    this._migrateIfNeeded()
  }

  private get root(): Record<string, any> {
    if (!this.configService?.store) return this._localRoot
    const storeKey = 'tabby-sftp-plus-plus'
    if (!(storeKey in this.configService.store)) {
      this.configService.store[storeKey] = {}
    }
    return this.configService.store[storeKey]
  }

  get(path: string, fallback?: any): any {

    const newVal = this._getByPath(this.root, path)
    if (newVal !== undefined) {
      if (path in this._cache) delete this._cache[path]
      return newVal
    }
    if (path in this._cache) return this._cache[path]

    const oldVal = this._fallbackRead(path)
    if (oldVal !== undefined) return oldVal
    return fallback
  }

  set(path: string, value: any): void {
    this._cache[path] = value
    this._setByPath(this.root, path, value)
  }

  setAndFlush(path: string, value: any): void {
    this.set(path, value)
    this.flush()
  }

  flush(): void {
    try { this.configService?.save() } catch { /* ignore */ }

    this.clearCache()
  }

  clearCache(): void {
    this._cache = {}
  }

  remove(path: string): void {
    const parts = path.split('/')
    const parent = this._getParentObj(this.root, path)
    if (parent) {
      delete parent[parts[parts.length - 1]]
    }
    delete this._cache[path]
    this.flush()
  }

  private _migrateIfNeeded(): void {
    if (this._migrated || !this.configService?.store) return
    this._migrated = true
    const paneState = this.root.paneState
    if (!paneState || typeof paneState !== 'object') return

    if (typeof paneState.layout === 'object' && typeof paneState.perHost === 'object') return

    this._migratePerHost(paneState)
    this._migrateLayout(paneState)
    this._migrateColumns(paneState)

    this._cleanupOldKeys(paneState)
    this.flush()
  }

  private _cleanupOldKeys(paneState: Record<string, any>): void {

    const hostKeys = Object.keys(paneState).filter(k => k.startsWith('sftp-plus-path-mode.'))
    for (const key of hostKeys) {
      const host = key.substring('sftp-plus-path-mode.'.length)
      delete paneState[`sftp-plus-path-mode.${host}`]
      delete paneState[`sftp-plus-path-mem.${host}`]
      delete paneState[`sftp-plus-saved-local-path.${host}`]
      delete paneState[`sftp-plus-saved-remote-path.${host}`]
    }

    delete paneState['sftp-plus-layout-mode']
    delete paneState['sftp-plus-horizontal-split-ratio']
    delete paneState['sftp-plus-vertical-split-ratio']

    for (const scope of ['local', 'remote'] as const) {
      delete paneState[`sftp-plus-${scope}-sort`]
      delete paneState[`sftp-plus-${scope}-cols`]
      delete paneState[`sftp-plus-${scope}-cols-order`]
      delete paneState[`sftp-plus-${scope}-col-widths`]
    }
  }

  private _migratePerHost(src: Record<string, any>): void {
    const hostKeys = Object.keys(src).filter(k => k.startsWith('sftp-plus-path-mode.'))
    for (const key of hostKeys) {
      const host = key.substring('sftp-plus-path-mode.'.length)
      this._setByPath(this.root, `paneState/perHost/${host}/pathMode`, src[`sftp-plus-path-mode.${host}`])
      if (`sftp-plus-path-mem.${host}` in src)
        this._setByPath(this.root, `paneState/perHost/${host}/rememberPath`, src[`sftp-plus-path-mem.${host}`])
      if (`sftp-plus-saved-local-path.${host}` in src)
        this._setByPath(this.root, `paneState/perHost/${host}/savedLocalPath`, src[`sftp-plus-saved-local-path.${host}`])
      if (`sftp-plus-saved-remote-path.${host}` in src)
        this._setByPath(this.root, `paneState/perHost/${host}/savedRemotePath`, src[`sftp-plus-saved-remote-path.${host}`])
    }
  }

  private _migrateLayout(src: Record<string, any>): void {
    if (src['sftp-plus-layout-mode'] !== undefined)
      this._setByPath(this.root, 'paneState/layout/mode', src['sftp-plus-layout-mode'])
    if (src['sftp-plus-horizontal-split-ratio'] !== undefined)
      this._setByPath(this.root, 'paneState/layout/horizontalSplitRatio',
        this._toNum(src['sftp-plus-horizontal-split-ratio']))
    if (src['sftp-plus-vertical-split-ratio'] !== undefined)
      this._setByPath(this.root, 'paneState/layout/verticalSplitRatio',
        this._toNum(src['sftp-plus-vertical-split-ratio']))
  }

  private _migrateColumns(src: Record<string, any>): void {
    for (const scope of ['local', 'remote'] as const) {
      const sort = src[`sftp-plus-${scope}-sort`]
      if (sort !== undefined) this._setByPath(this.root, `paneState/${scope}/sort`, this._safeParse(sort))
      const cols = src[`sftp-plus-${scope}-cols`]
      if (cols !== undefined) this._setByPath(this.root, `paneState/${scope}/cols`, this._safeParse(cols))
      const order = src[`sftp-plus-${scope}-cols-order`]
      if (order !== undefined) this._setByPath(this.root, `paneState/${scope}/colsOrder`, this._safeParse(order))
      const widths = src[`sftp-plus-${scope}-col-widths`]
      if (widths !== undefined) this._setByPath(this.root, `paneState/${scope}/colWidths`, this._safeParse(widths))
    }
  }

  private _fallbackRead(path: string): any {
    const paneState = this.root.paneState
    if (!paneState || typeof paneState !== 'object') return undefined

    // paneState/perHost/{host}/{field} → sftp-plus-{field}.{host}
    const perHostMatch = path.match(
      /^paneState\/perHost\/(.+?)\/(pathMode|rememberPath|savedLocalPath|savedRemotePath)$/
    )
    if (perHostMatch) {
      const host = perHostMatch[1]
      const field = perHostMatch[2]
      const oldFieldMap: Record<string, string> = {
        pathMode: 'sftp-plus-path-mode',
        rememberPath: 'sftp-plus-path-mem',
        savedLocalPath: 'sftp-plus-saved-local-path',
        savedRemotePath: 'sftp-plus-saved-remote-path',
      }
      return paneState[`${oldFieldMap[field]}.${host}`]
    }

    // paneState/layout/*
    if (path === 'paneState/layout/mode')
      return paneState['sftp-plus-layout-mode'] ?? paneState['sftp-plus-settings.layoutMode']
    if (path === 'paneState/layout/horizontalSplitRatio')
      return paneState['sftp-plus-horizontal-split-ratio']
    if (path === 'paneState/layout/verticalSplitRatio')
      return paneState['sftp-plus-vertical-split-ratio']

    // paneState/{local|remote}/{sort|cols|colsOrder|colWidths}
    const colMatch = path.match(/^paneState\/(local|remote)\/(sort|cols|colsOrder|colWidths)$/)
    if (colMatch) {
      const scope = colMatch[1]
      const field = colMatch[2]

      const legacyField = field === 'colsOrder' ? 'cols-order'
        : field === 'colWidths' ? 'col-widths'
        : field
      const raw = paneState[`sftp-plus-${scope}-${legacyField}`]
      return raw !== undefined ? this._safeParse(raw) : undefined
    }

    return undefined
  }

  private _getByPath(obj: any, path: string): any {
    const parts = path.split('/')
    let cur = obj
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = cur[part]
    }
    return cur
  }

  private _setByPath(obj: any, path: string, value: any): void {
    const parts = path.split('/')
    let cur = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in cur) || cur[part] == null || typeof cur[part] !== 'object') {
        cur[part] = {}
      }
      cur = cur[part]
    }
    cur[parts[parts.length - 1]] = value
  }

  private _safeParse(raw: any): any {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) } catch { return raw }
    }
    return raw
  }

  private _toNum(v: any): number {
    if (typeof v === 'number') return v
    const n = parseFloat(String(v))
    return isNaN(n) ? 0.5 : n
  }

  private _getParentObj(obj: any, path: string): Record<string, any> | null {
    const parts = path.split('/')
    if (parts.length <= 1) return obj
    let cur = obj
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') return null
      cur = cur[parts[i]]
    }
    return cur
  }
}
