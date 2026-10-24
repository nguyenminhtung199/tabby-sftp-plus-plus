import { ChangeDetectorRef, ElementRef, NgZone } from '@angular/core'
import { SftpI18nService } from '../../services/sftp-i18n.service'
import { PanelHeaderReorder } from '../components/panel-header-reorder'
import type { LocalEntry, SFTPFile } from '../core/panel-types'

export abstract class SftpPanelColumnController {
  protected abstract _safeDetect(): void

  static readonly LOCAL_COLS_KEY = 'sftp-plus-local-cols'
  static readonly LOCAL_COL_ORDER_KEY = 'sftp-plus-local-cols-order'
  static readonly REMOTE_COLS_KEY = 'sftp-plus-remote-cols'
  static readonly REMOTE_COL_ORDER_KEY = 'sftp-plus-remote-cols-order'
  static readonly ALL_COLS = ['size', 'date', 'created', 'perms', 'mode', 'access', 'owner', 'group', 'path', 'ext'] as const
  static readonly TABLE_SETTINGS_KEY = 'sftp-plus-table'
  static readonly LOCAL_COL_WIDTHS_KEY = 'sftp-plus-local-col-widths'
  static readonly REMOTE_COL_WIDTHS_KEY = 'sftp-plus-remote-col-widths'

  protected static _normalizeColOrder(parsed: unknown[]): string[] {
    const all = SftpPanelColumnController.ALL_COLS as readonly string[]
    const order: string[] = []
    for (const c of parsed) {
      if (typeof c === 'string' && all.includes(c) && !order.includes(c)) order.push(c)
    }
    for (const c of all) {
      if (!order.includes(c)) order.push(c)
    }
    return order
  }

  protected static _validColWidth(v: unknown, min: number): boolean {
    return typeof v === 'number' && Number.isFinite(v) && v >= min
  }

  showHiddenLocal = false
  pinFoldersLocal = true
  localSortBy: 'name' | 'size' | 'modified' | 'birthtime' = 'name'
  localSortAsc = true
  showHiddenRemote = false
  pinFoldersRemote = true
  remoteSortBy: 'name' | 'size' | 'modified' | 'birthtime' = 'name'
  remoteSortAsc = true
  localShowColSize = true
  localShowColDate = true
  localShowColCreated = false
  localShowColPerms = true
  localShowColMode = false
  localShowColAccess = false
  localShowColOwner = false
  localShowColGroup = false
  localShowColPath = false
  localShowColExt = false
  localColNameWidth = 200
  localColSizeWidth = 80
  localColDateWidth = 140
  localColCreatedWidth = 140
  localColPermsWidth = 70
  localColAccessWidth = 140
  localColOwnerWidth = 80
  localColGroupWidth = 70
  localColModeWidth = 60
  localColPathWidth = 120
  localColExtWidth = 60
  localColOrder: string[] = [...SftpPanelColumnController.ALL_COLS]
  remoteShowColSize = true
  remoteShowColDate = true
  remoteShowColCreated = false
  remoteShowColPerms = true
  remoteShowColMode = false
  remoteShowColAccess = false
  remoteShowColOwner = false
  remoteShowColGroup = false
  remoteShowColPath = false
  remoteShowColExt = false
  remoteColNameWidth = 200
  remoteColSizeWidth = 80
  remoteColDateWidth = 140
  remoteColCreatedWidth = 140
  remoteColPermsWidth = 70
  remoteColAccessWidth = 140
  remoteColOwnerWidth = 80
  remoteColGroupWidth = 70
  remoteColModeWidth = 60
  remoteColPathWidth = 120
  remoteColExtWidth = 60
  remoteColOrder: string[] = [...SftpPanelColumnController.ALL_COLS]
  headerMenuVisible = false
  headerMenuX = 0
  headerMenuY = 0
  headerMenuCol: string | null = null
  showColBorders = false
  showZebra = false
  colIconWidth = 24
  colNameMinWidth = 60
  resizeCol: string | null = null
  resizePane: 'local' | 'remote' = 'local'
  resizeStartX = 0
  resizeStartWidth = 0
  resizing = false
  _colJustResized = false
  _measureCanvas: HTMLCanvasElement | null = null

  private _colResizeMoveHandler: ((e: MouseEvent) => void) | null = null
  private _colResizeUpHandler: (() => void) | null = null

  protected i18n!: SftpI18nService
  protected cdr!: ChangeDetectorRef
  protected elRef!: ElementRef
  protected zone!: NgZone
  protected _headerReorder!: PanelHeaderReorder

  protected connected!: boolean
  protected contextMenuPane!: 'local' | 'remote'
  protected contextMenuVisible = false
  protected contextMenuEntry: LocalEntry | SFTPFile | null = null

  protected formatSize!: (bytes?: number) => string
  protected formatDate!: (ms?: number) => string
  protected getExt(name: string): string { return '' }
  protected formatMode(mode: number): string { return '' }
  protected formatOctalMode(mode: number): string { return '' }
  protected _paneGet(key: string, def?: any): any { return def }
  protected _paneSet(key: string, val: any): void {}

  protected _paneFlush(): void {}

  protected _parsePaneJson(raw: any): any {
    if (raw == null || raw === '') return null
    if (typeof raw === 'object') return raw
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) } catch { return null }
    }
    return null
  }
  protected _invalidateLocalCache(): void {}
  protected _invalidateRemoteCache(): void {}
  protected async refreshRemote(): Promise<boolean> { return false }
  protected getFilteredLocalEntries(): LocalEntry[] { return [] }
  protected getFilteredRemoteEntries(): SFTPFile[] { return [] }

  colHeaderLabel(col: string): string {
    const map: Record<string, string> = {
      name: 'file.name', size: 'file.size', date: 'file.modified', created: 'file.created',
      perms: 'file.permissions', mode: 'file.mode', access: 'file.accessed',
      owner: 'file.owner', group: 'file.group', path: 'file.path', ext: 'file.ext',
    }
    return this.i18n.t(map[col] || '')
  }

  sortArrow(col: string, pane: 'local' | 'remote'): string {
    const sortBy = pane === 'local' ? this.localSortBy : this.remoteSortBy
    const sortAsc = pane === 'local' ? this.localSortAsc : this.remoteSortAsc
    const mapped = col === 'date' ? 'modified' : col === 'created' ? 'birthtime' : col
    if (sortBy === mapped) return sortAsc ? '▲' : '▼'
    return ''
  }

  colValue(col: string, e: any): string {
    if (col === 'size') return e.isDirectory ? '' : this.formatSize(e.size)
    if (col === 'date' || col === 'modified') return e.modified ? this.formatDate(e.modified?.getTime?.()) : e.mtimeMs ? this.formatDate(e.mtimeMs) : ''
    if (col === 'created' || col === 'birthtime') return e.birthtimeMs ? this.formatDate(e.birthtimeMs) : ''
    if (col === 'perms') return e.mode != null ? this.formatMode(e.mode) : ''
    if (col === 'mode') return e.mode != null ? this.formatOctalMode(e.mode) : ''
    if (col === 'access' || col === 'accessed') return e.atimeMs ? this.formatDate(e.atimeMs) : ''
    if (col === 'owner') return e.owner != null ? String(e.owner) : ''
    if (col === 'group') return e.group != null ? String(e.group) : ''
    if (col === 'path') return e.fullPath || ''
    if (col === 'ext') return this.getExt(e.name)
    return ''
  }

  onColHeaderReorderStart(col: string, event: MouseEvent, pane: 'local' | 'remote'): void {
    this._headerReorder.start(col, event, pane)
  }

  get localVisibleCols(): string[] {
    return this.localColOrder.filter(c => this._localColVisible(c))
  }
  get remoteVisibleCols(): string[] {
    return this.remoteColOrder.filter(c => this._remoteColVisible(c))
  }
  protected _localColVisible(col: string): boolean { return this._paneColVisible('local', col) }
  protected _remoteColVisible(col: string): boolean { return this._paneColVisible('remote', col) }
  protected _paneColVisible(side: 'local' | 'remote', col: string): boolean {
    if (side === 'local') {
      if (col === 'size') return this.localShowColSize
      if (col === 'date') return this.localShowColDate
      if (col === 'created') return this.localShowColCreated
      if (col === 'perms') return this.localShowColPerms
      if (col === 'mode') return this.localShowColMode
      if (col === 'access') return this.localShowColAccess
      if (col === 'owner') return this.localShowColOwner
      if (col === 'group') return this.localShowColGroup
      if (col === 'path') return this.localShowColPath
      if (col === 'ext') return this.localShowColExt
    } else {
      if (col === 'created') return false
      if (col === 'size') return this.remoteShowColSize
      if (col === 'date') return this.remoteShowColDate
      if (col === 'perms') return this.remoteShowColPerms
      if (col === 'mode') return this.remoteShowColMode
      if (col === 'access') return this.remoteShowColAccess
      if (col === 'owner') return this.remoteShowColOwner
      if (col === 'group') return this.remoteShowColGroup
      if (col === 'path') return this.remoteShowColPath
      if (col === 'ext') return this.remoteShowColExt
    }
    return false
  }

  getLocalColWidths(): string {
    return this._buildColWidths('local', this.localVisibleCols)
  }

  getRemoteColWidths(): string {
    return this._buildColWidths('remote', this.remoteVisibleCols)
  }

  protected _buildColWidths(pane: 'local' | 'remote', cols: string[]): string {
    const parts: string[] = [`${this.colIconWidth}px`]
    if (pane === 'local') {
      parts.push(`${this.localColNameWidth}px`)
      const widthMap: Record<string, number> = {
        size: this.localColSizeWidth, date: this.localColDateWidth, created: this.localColCreatedWidth,
        perms: this.localColPermsWidth,
        mode: this.localColModeWidth, access: this.localColAccessWidth, owner: this.localColOwnerWidth,
        group: this.localColGroupWidth, path: this.localColPathWidth, ext: this.localColExtWidth,
      }
      for (const col of cols) parts.push(`${widthMap[col] || 80}px`)
    } else {
      parts.push(`${this.remoteColNameWidth}px`)
      const widthMap: Record<string, number> = {
        size: this.remoteColSizeWidth, date: this.remoteColDateWidth, created: this.remoteColCreatedWidth,
        perms: this.remoteColPermsWidth,
        mode: this.remoteColModeWidth, access: this.remoteColAccessWidth, owner: this.remoteColOwnerWidth,
        group: this.remoteColGroupWidth, path: this.remoteColPathWidth, ext: this.remoteColExtWidth,
      }
      for (const col of cols) parts.push(`${widthMap[col] || 80}px`)
    }
    return parts.join(' ')
  }

  protected loadLocalColSettings(): void {
    try {
      const cols = this._parsePaneJson(this._paneGet(SftpPanelColumnController.LOCAL_COLS_KEY))
      if (cols) {
        this.localShowColSize = cols.size !== false
        this.localShowColDate = cols.date !== false
        this.localShowColPerms = cols.perms !== false
        if (cols.created !== undefined) this.localShowColCreated = cols.created
        if (cols.mode !== undefined) this.localShowColMode = cols.mode
        if (cols.access !== undefined) this.localShowColAccess = cols.access
        if (cols.owner !== undefined) this.localShowColOwner = cols.owner
        if (cols.group !== undefined) this.localShowColGroup = cols.group
        if (cols.path !== undefined) this.localShowColPath = cols.path
        if (cols.ext !== undefined) this.localShowColExt = cols.ext
      }
    } catch {   }
    try {
      const parsed = this._parsePaneJson(this._paneGet(SftpPanelColumnController.LOCAL_COL_ORDER_KEY))
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.localColOrder = SftpPanelColumnController._normalizeColOrder(parsed)
      }
    } catch {   }
    try {
      const s = this._parsePaneJson(this._paneGet('sftp-plus-local-sort')) || {}
      if (s.by) { this.localSortBy = s.by; this.localSortAsc = s.asc !== false }
    } catch {}
  }

  protected loadRemoteColSettings(): void {
    try {
      const c = this._parsePaneJson(this._paneGet(SftpPanelColumnController.REMOTE_COLS_KEY))
      if (c) {
        this.remoteShowColSize = c.size !== false
        this.remoteShowColDate = c.date !== false
        this.remoteShowColPerms = c.perms !== false
        this.remoteShowColCreated = false
        if (c.mode !== undefined) this.remoteShowColMode = c.mode
        if (c.access !== undefined) this.remoteShowColAccess = c.access
        if (c.owner !== undefined) this.remoteShowColOwner = c.owner
        if (c.group !== undefined) this.remoteShowColGroup = c.group
        if (c.path !== undefined) this.remoteShowColPath = c.path
        if (c.ext !== undefined) this.remoteShowColExt = c.ext
      }
    } catch {   }
    try {
      const parsed = this._parsePaneJson(this._paneGet(SftpPanelColumnController.REMOTE_COL_ORDER_KEY))
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.remoteColOrder = SftpPanelColumnController._normalizeColOrder(parsed)
      }
    } catch {   }
    try {
      const s = this._parsePaneJson(this._paneGet('sftp-plus-remote-sort')) || {}
      if (s.by && s.by !== 'birthtime') { this.remoteSortBy = s.by; this.remoteSortAsc = s.asc !== false }
    } catch {}
  }

  protected saveLocalColSettings(): void {
    try {
      this._paneSet(SftpPanelColumnController.LOCAL_COLS_KEY, JSON.stringify({
        size: this.localShowColSize,
        date: this.localShowColDate,
        created: this.localShowColCreated,
        perms: this.localShowColPerms,
        mode: this.localShowColMode,
        access: this.localShowColAccess,
        owner: this.localShowColOwner,
        group: this.localShowColGroup,
        path: this.localShowColPath,
        ext: this.localShowColExt,
      }))
      this._paneSet(SftpPanelColumnController.LOCAL_COL_ORDER_KEY, JSON.stringify(this.localColOrder))

      this._paneFlush()
    } catch {}
  }

  protected saveRemoteColSettings(): void {
    try {
      this._paneSet(SftpPanelColumnController.REMOTE_COLS_KEY, JSON.stringify({
        size: this.remoteShowColSize,
        date: this.remoteShowColDate,
        created: false,
        perms: this.remoteShowColPerms,
        mode: this.remoteShowColMode,
        access: this.remoteShowColAccess,
        owner: this.remoteShowColOwner,
        group: this.remoteShowColGroup,
        path: this.remoteShowColPath,
        ext: this.remoteShowColExt,
      }))
      this._paneSet(SftpPanelColumnController.REMOTE_COL_ORDER_KEY, JSON.stringify(this.remoteColOrder))

      this._paneFlush()
    } catch {}
  }

  moveColumn(pane: 'local' | 'remote', fromIdx: number, toIdx: number): void {
    const order = pane === 'local' ? this.localColOrder : this.remoteColOrder
    if (fromIdx === toIdx) return
    if (fromIdx < 0 || fromIdx >= order.length) return
    if (toIdx < 0 || toIdx >= order.length) return
    const item = order.splice(fromIdx, 1)[0]
    order.splice(toIdx, 0, item)
    if (pane === 'local') this.saveLocalColSettings()
    else this.saveRemoteColSettings()

    try { window.dispatchEvent(new CustomEvent('sftp-plus-settings-changed')) } catch {}
  }

  toggleColumn(col: string, pane: 'local' | 'remote'): void {
    if (pane === 'local') {
      if (col === 'size') this.localShowColSize = !this.localShowColSize
      else if (col === 'date') this.localShowColDate = !this.localShowColDate
      else if (col === 'created') this.localShowColCreated = !this.localShowColCreated
      else if (col === 'perms') this.localShowColPerms = !this.localShowColPerms
      else if (col === 'mode') this.localShowColMode = !this.localShowColMode
      else if (col === 'access') this.localShowColAccess = !this.localShowColAccess
      else if (col === 'owner') this.localShowColOwner = !this.localShowColOwner
      else if (col === 'group') this.localShowColGroup = !this.localShowColGroup
      else if (col === 'path') this.localShowColPath = !this.localShowColPath
      else if (col === 'ext') this.localShowColExt = !this.localShowColExt
      this.saveLocalColSettings()
    } else {
      if (col === 'size') this.remoteShowColSize = !this.remoteShowColSize
      else if (col === 'date') this.remoteShowColDate = !this.remoteShowColDate
      else if (col === 'created') {   }
      else if (col === 'perms') this.remoteShowColPerms = !this.remoteShowColPerms
      else if (col === 'mode') this.remoteShowColMode = !this.remoteShowColMode
      else if (col === 'access') this.remoteShowColAccess = !this.remoteShowColAccess
      else if (col === 'owner') this.remoteShowColOwner = !this.remoteShowColOwner
      else if (col === 'group') this.remoteShowColGroup = !this.remoteShowColGroup
      else if (col === 'path') this.remoteShowColPath = !this.remoteShowColPath
      else if (col === 'ext') this.remoteShowColExt = !this.remoteShowColExt
      this.saveRemoteColSettings()
      if (this.connected && (col === 'owner' || col === 'group' || col === 'access')) {
        void this.refreshRemote()
      }
    }
    this.headerMenuVisible = false
    this.headerMenuCol = null
  }

  togglePinFolders(pane: 'local' | 'remote'): void {
    if (pane === 'local') {
      this.pinFoldersLocal = !this.pinFoldersLocal
      try { localStorage.setItem(`${SftpPanelColumnController.TABLE_SETTINGS_KEY}.pinFoldersLocal`, JSON.stringify(this.pinFoldersLocal)) } catch {}
      this._invalidateLocalCache()
    } else {
      this.pinFoldersRemote = !this.pinFoldersRemote
      try { localStorage.setItem(`${SftpPanelColumnController.TABLE_SETTINGS_KEY}.pinFoldersRemote`, JSON.stringify(this.pinFoldersRemote)) } catch {}
      this._invalidateRemoteCache()
    }
    this.headerMenuVisible = false
    this.headerMenuCol = null
  }

  toggleShowHidden(pane: 'local' | 'remote'): void {
    if (pane === 'local') {
      this.showHiddenLocal = !this.showHiddenLocal
      try { localStorage.setItem(`${SftpPanelColumnController.TABLE_SETTINGS_KEY}.showHiddenLocal`, JSON.stringify(this.showHiddenLocal)) } catch {}
      this._invalidateLocalCache()
    } else {
      this.showHiddenRemote = !this.showHiddenRemote
      try { localStorage.setItem(`${SftpPanelColumnController.TABLE_SETTINGS_KEY}.showHiddenRemote`, JSON.stringify(this.showHiddenRemote)) } catch {}
      this._invalidateRemoteCache()
    }
    this.headerMenuVisible = false
    this.headerMenuCol = null
  }

  toggleColBorders(): void {
    this.showColBorders = !this.showColBorders
    try { localStorage.setItem(`${SftpPanelColumnController.TABLE_SETTINGS_KEY}.colBorders`, JSON.stringify(this.showColBorders)) } catch {}
    this.headerMenuVisible = false
  }

  toggleZebra(): void {
    this.showZebra = !this.showZebra
    try { localStorage.setItem(`${SftpPanelColumnController.TABLE_SETTINGS_KEY}.zebra`, JSON.stringify(this.showZebra)) } catch {}
    this.headerMenuVisible = false
  }

  adjustColumnWidth(): void {
    const col = this.headerMenuCol
    if (!col || col === 'icon') return
    const pane = this.contextMenuPane
    const isLocal = pane === 'local'
    const entryList = isLocal ? this.getFilteredLocalEntries() : this.getFilteredRemoteEntries()
    if (!entryList || entryList.length === 0) return

    const targetCol = col === 'icon' ? 'name' : col
    let maxW = this._measureColWidth(targetCol, isLocal)
    maxW = Math.max(maxW, 30)
    this._setColWidth(targetCol, pane, maxW)
    this.headerMenuVisible = false
    this.headerMenuCol = null
    if (isLocal) this.saveLocalColWidths(); else this.saveRemoteColWidths()
    this._safeDetect()
  }

  adjustAllColumnsWidth(): void {
    const pane = this.contextMenuPane
    const isLocal = pane === 'local'
    const entryList = isLocal ? this.getFilteredLocalEntries() : this.getFilteredRemoteEntries()
    if (!entryList || entryList.length === 0) return

    const cols = isLocal ? this.localVisibleCols : this.remoteVisibleCols
    for (const col of cols) {
      let maxW = this._measureColWidth(col, isLocal)
      maxW = Math.max(maxW, 30)
      this._setColWidth(col, pane, maxW)
    }
    this.headerMenuVisible = false
    this.headerMenuCol = null
    if (isLocal) this.saveLocalColWidths(); else this.saveRemoteColWidths()
    this._safeDetect()
  }

  private _measureColWidth(col: string, isLocal: boolean): number {
    const root = this.elRef.nativeElement as HTMLElement
    const pane = isLocal ? root.querySelector('.local-pane') : root.querySelector('.remote-pane')
    if (!pane) return 80

    const headerSpan = pane.querySelector(`.entry.header span.${col}`) as HTMLElement | null
    if (!headerSpan) return 80
    const style = getComputedStyle(headerSpan)
    const font = `${style.fontSize} ${style.fontFamily}`

    if (!this._measureCanvas) this._measureCanvas = document.createElement('canvas')
    const ctx = this._measureCanvas.getContext('2d')
    if (!ctx) return 80
    ctx.font = font

    let maxW = 0

    const headerText = headerSpan.textContent || ''
    const headerW = ctx.measureText(headerText).width + 16 // padding
    maxW = Math.max(maxW, headerW)

    const items = pane.querySelectorAll(`.entry:not(.header):not(.up-entry) span.${col}`)
    items.forEach(el => {
      const text = el.textContent || ''
      const w = ctx.measureText(text).width + 8
      if (w > maxW) maxW = w
    })

    return Math.ceil(maxW)
  }

  private _setColWidth(col: string, pane: 'local' | 'remote', w: number): void {
    const isLocal = pane === 'local'
    switch (col) {
      case 'name': if (isLocal) this.localColNameWidth = w; else this.remoteColNameWidth = w; break
      case 'size': if (isLocal) this.localColSizeWidth = w; else this.remoteColSizeWidth = w; break
      case 'date': if (isLocal) this.localColDateWidth = w; else this.remoteColDateWidth = w; break
      case 'created': if (isLocal) this.localColCreatedWidth = w; else this.remoteColCreatedWidth = w; break
      case 'perms': if (isLocal) this.localColPermsWidth = w; else this.remoteColPermsWidth = w; break
      case 'mode': if (isLocal) this.localColModeWidth = w; else this.remoteColModeWidth = w; break
      case 'access': if (isLocal) this.localColAccessWidth = w; else this.remoteColAccessWidth = w; break
      case 'owner': if (isLocal) this.localColOwnerWidth = w; else this.remoteColOwnerWidth = w; break
      case 'group': if (isLocal) this.localColGroupWidth = w; else this.remoteColGroupWidth = w; break
      case 'path': if (isLocal) this.localColPathWidth = w; else this.remoteColPathWidth = w; break
      case 'ext': if (isLocal) this.localColExtWidth = w; else this.remoteColExtWidth = w; break
    }
  }

  onHeaderContextMenu(ev: MouseEvent): void {
    ev.preventDefault()
    ev.stopPropagation()
    const target = ev.target as HTMLElement

    this.contextMenuPane = target.closest('.local-pane') ? 'local' : 'remote'

    const span = target.closest('span')
    if (span) {
      const cls = span.className

      const colClasses = ['icon', 'name', 'size', 'date', 'perms', 'mode', 'access', 'owner', 'group', 'path', 'ext']
      const classTokens = cls.split(/\s+/)
      this.headerMenuCol = colClasses.find(c => classTokens.includes(c)) || null
    } else {
      this.headerMenuCol = null
    }

    this.contextMenuVisible = false
    this.contextMenuEntry = null
    this.headerMenuX = ev.clientX
    this.headerMenuY = ev.clientY
    this.headerMenuVisible = true
    this._safeDetect()

    setTimeout(() => {
      const menuEl = this.elRef.nativeElement.querySelector('.context-menu') as HTMLElement | null
      if (!menuEl || !this.headerMenuVisible) return
      const rect = menuEl.getBoundingClientRect()
      const margin = 8
      let x = ev.clientX
      let y = ev.clientY
      if (x + rect.width > window.innerWidth - margin) x = Math.max(margin, window.innerWidth - rect.width - margin)
      if (y + rect.height > window.innerHeight - margin) y = Math.max(margin, window.innerHeight - rect.height - margin)
      if (x < margin) x = margin
      if (y < margin) y = margin
      if (x !== this.headerMenuX || y !== this.headerMenuY) {
        this.headerMenuX = x
        this.headerMenuY = y
        this._safeDetect()
      }
    }, 0)
  }

  onColResizeAutoFit(col: string, pane: 'local' | 'remote'): void {
    this.resizing = false
    this.resizeCol = null
    const isLocal = pane === 'local'
    const MIN_WIDTHS: Record<string, number> = {
      name: this.colNameMinWidth,
      size: 40, date: 80, created: 80, perms: 40, mode: 40,
      access: 80, owner: 40, group: 40, path: 60, ext: 30,
    }
    let maxW = this._measureColWidth(col, isLocal)
    maxW = Math.max(maxW, MIN_WIDTHS[col] || 40)
    this._setColWidth(col, pane, maxW)
    if (isLocal) this.saveLocalColWidths()
    else this.saveRemoteColWidths()
    this._colJustResized = true
    setTimeout(() => { this._colJustResized = false }, 200)
    this._safeDetect()
  }

  onColResizeStart(col: string, event: MouseEvent, pane: 'local' | 'remote'): void {
    event.preventDefault()
    event.stopPropagation()
    this.resizing = true
    this.resizeCol = col
    this.resizePane = pane
    this.resizeStartX = event.clientX

    const handleEl = event.target as HTMLElement
    const colEl = handleEl.parentElement
    if (colEl) {
      this.resizeStartWidth = colEl.getBoundingClientRect().width
    } else {
      this.resizeStartWidth = this._getColDefaultWidth(col)
    }
    if (!this.resizeStartWidth || this.resizeStartWidth <= 0) {
      this.resizeStartWidth = this._getColDefaultWidth(col)
    }

    const MIN_WIDTHS: Record<string, number> = {
      name: this.colNameMinWidth,
      size: 40, date: 80, created: 80, perms: 40, mode: 40,
      access: 80, owner: 40, group: 40, path: 60, ext: 30,
    }
    const minW = MIN_WIDTHS[col] || 40

    this._colResizeMoveHandler = (e: MouseEvent) => {
      if (!this.resizing || !this.resizeCol) return
      const delta = e.clientX - this.resizeStartX
      const newWidth = Math.max(minW, this.resizeStartWidth + delta)
      this.zone.run(() => {

        const p = this.resizePane === 'local'
        switch (this.resizeCol) {
          case 'name': if (p) this.localColNameWidth = newWidth; else this.remoteColNameWidth = newWidth; break
          case 'size': if (p) this.localColSizeWidth = newWidth; else this.remoteColSizeWidth = newWidth; break
          case 'date': if (p) this.localColDateWidth = newWidth; else this.remoteColDateWidth = newWidth; break
          case 'created': if (p) this.localColCreatedWidth = newWidth; else this.remoteColCreatedWidth = newWidth; break
          case 'perms': if (p) this.localColPermsWidth = newWidth; else this.remoteColPermsWidth = newWidth; break
          case 'mode': if (p) this.localColModeWidth = newWidth; else this.remoteColModeWidth = newWidth; break
          case 'access': if (p) this.localColAccessWidth = newWidth; else this.remoteColAccessWidth = newWidth; break
          case 'owner': if (p) this.localColOwnerWidth = newWidth; else this.remoteColOwnerWidth = newWidth; break
          case 'group': if (p) this.localColGroupWidth = newWidth; else this.remoteColGroupWidth = newWidth; break
          case 'path': if (p) this.localColPathWidth = newWidth; else this.remoteColPathWidth = newWidth; break
          case 'ext': if (p) this.localColExtWidth = newWidth; else this.remoteColExtWidth = newWidth; break
        }
      })
    }

    this._colResizeUpHandler = () => {
      this.resizing = false
      this.resizeCol = null
      if (this._colResizeMoveHandler) {
        document.removeEventListener('mousemove', this._colResizeMoveHandler)
        this._colResizeMoveHandler = null
      }
      if (this._colResizeUpHandler) {
        document.removeEventListener('mouseup', this._colResizeUpHandler)
        this._colResizeUpHandler = null
      }
      this._colJustResized = true
      setTimeout(() => { this._colJustResized = false }, 200)
      if (this.resizePane === 'local') this.saveLocalColWidths()
      else this.saveRemoteColWidths()
      this._safeDetect()
    }

    document.addEventListener('mousemove', this._colResizeMoveHandler)
    document.addEventListener('mouseup', this._colResizeUpHandler)
    this._safeDetect()
  }

  disposeColResize(): void {
    if (this._colResizeMoveHandler) {
      document.removeEventListener('mousemove', this._colResizeMoveHandler)
      this._colResizeMoveHandler = null
    }
    if (this._colResizeUpHandler) {
      document.removeEventListener('mouseup', this._colResizeUpHandler)
      this._colResizeUpHandler = null
    }
    this.resizing = false
    this.resizeCol = null
  }

  private _getColDefaultWidth(col: string): number {
    const w = this.resizePane === 'local' ? this._localWidths() : this._remoteWidths()
    return w[col] || 80
  }

  private _localWidths(): Record<string, number> {
    return {
      name: this.localColNameWidth, size: this.localColSizeWidth, date: this.localColDateWidth,
      created: this.localColCreatedWidth,
      perms: this.localColPermsWidth, mode: this.localColModeWidth, access: this.localColAccessWidth,
      owner: this.localColOwnerWidth, group: this.localColGroupWidth, path: this.localColPathWidth,
      ext: this.localColExtWidth,
    }
  }

  private _remoteWidths(): Record<string, number> {
    return {
      name: this.remoteColNameWidth, size: this.remoteColSizeWidth, date: this.remoteColDateWidth,
      created: this.remoteColCreatedWidth,
      perms: this.remoteColPermsWidth, mode: this.remoteColModeWidth, access: this.remoteColAccessWidth,
      owner: this.remoteColOwnerWidth, group: this.remoteColGroupWidth, path: this.remoteColPathWidth,
      ext: this.remoteColExtWidth,
    }
  }

  private saveLocalColWidths(): void {
    const w = this._localWidths()
    try {
      this._paneSet(SftpPanelColumnController.LOCAL_COL_WIDTHS_KEY, JSON.stringify({
        name: w.name, size: w.size, date: w.date, created: w.created, perms: w.perms, mode: w.mode,
        access: w.access, owner: w.owner, group: w.group, path: w.path, ext: w.ext,
      }))

      this._paneFlush()
    } catch {}
  }

  private saveRemoteColWidths(): void {
    const w = this._remoteWidths()
    try {
      this._paneSet(SftpPanelColumnController.REMOTE_COL_WIDTHS_KEY, JSON.stringify({
        name: w.name, size: w.size, date: w.date, created: w.created, perms: w.perms, mode: w.mode,
        access: w.access, owner: w.owner, group: w.group, path: w.path, ext: w.ext,
      }))

      this._paneFlush()
    } catch {}
  }

  protected loadLocalColWidths(): void {
    try {

      const w = this._parsePaneJson(this._paneGet(SftpPanelColumnController.LOCAL_COL_WIDTHS_KEY)) || {}

      const ok = SftpPanelColumnController._validColWidth
      if (ok(w.name, this.colNameMinWidth)) this.localColNameWidth = w.name
      if (ok(w.size, 40)) this.localColSizeWidth = w.size
      if (ok(w.date, 80)) this.localColDateWidth = w.date
      if (ok(w.created, 80)) this.localColCreatedWidth = w.created
      if (ok(w.perms, 40)) this.localColPermsWidth = w.perms
      if (ok(w.mode, 40)) this.localColModeWidth = w.mode
      if (ok(w.access, 80)) this.localColAccessWidth = w.access
      if (ok(w.owner, 40)) this.localColOwnerWidth = w.owner
      if (ok(w.group, 40)) this.localColGroupWidth = w.group
      if (ok(w.path, 60)) this.localColPathWidth = w.path
      if (ok(w.ext, 30)) this.localColExtWidth = w.ext
    } catch {}
  }

  protected loadRemoteColWidths(): void {
    try {

      const w = this._parsePaneJson(this._paneGet(SftpPanelColumnController.REMOTE_COL_WIDTHS_KEY)) || {}

      const ok = SftpPanelColumnController._validColWidth
      if (ok(w.name, this.colNameMinWidth)) this.remoteColNameWidth = w.name
      if (ok(w.size, 40)) this.remoteColSizeWidth = w.size
      if (ok(w.date, 80)) this.remoteColDateWidth = w.date
      if (ok(w.created, 80)) this.remoteColCreatedWidth = w.created
      if (ok(w.perms, 40)) this.remoteColPermsWidth = w.perms
      if (ok(w.mode, 40)) this.remoteColModeWidth = w.mode
      if (ok(w.access, 80)) this.remoteColAccessWidth = w.access
      if (ok(w.owner, 40)) this.remoteColOwnerWidth = w.owner
      if (ok(w.group, 40)) this.remoteColGroupWidth = w.group
      if (ok(w.path, 60)) this.remoteColPathWidth = w.path
      if (ok(w.ext, 30)) this.remoteColExtWidth = w.ext
    } catch {}
  }
}
