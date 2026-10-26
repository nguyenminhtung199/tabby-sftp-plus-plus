import { featureApis, invokeFeature, readFeature, writeFeature } from "../../features/api"
﻿

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone, ElementRef, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core'
import * as path from 'path'
import * as fs from 'fs'

import { SftpI18nService } from '../../services/sftp-i18n.service'
import { DEFAULT_ICON_MAP } from '../core/icon-defaults'
import { NAV_HEADER_KEY_PREFIX } from '../core/grouping'
import { fileList as fileListPolicy } from '../../../transfer-policy.json'

export type PaneNavAction =
  | 'back' | 'forward' | 'up' | 'home' | 'refresh'
  | 'toggleFilter' | 'toggleHidden'

export type PaneSortAction = { col: string }

@Component({
  selector: 'sftp-file-pane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: require('./sftp-file-pane.component.view.html'),
})
export class SftpFilePaneComponent {
  constructor(private hostRef: ElementRef<HTMLElement>, private viewDetector: ChangeDetectorRef, private zone: NgZone) {}

  @Input() labelIcon = '🖥'
  @Input() paneLabel = ''
  @Input() listClass = 'local-pane'
  @Input() pathInput = ''
  @Input() pathDisabled = false
  @Input() refreshDisabled = false
  @Input() canBack = false
  @Input() canForward = false
  @Input() canUp = false
  @Input() filterVisible = false
  @Input() filterPending = ''
  @Input() filterActive = ''
  @Input() bookmarksActive = false
  @Input() loading = false
  @Input() flash = false
  @Input() dragOver = false
  @Input() hasError = false
  @Input() showNoSession = false
  @Input() showHeader = true
  @Input() showEmpty = false
  @Input() entries: any[] = []

  @Input() groupRows: import('../core/grouping').GroupDisplayRow[] | null = null

  @Input() iconBaseDir = ''

  @Input() fileTypeIcons: { ext: string; svg: string; name?: string }[] = []

  @Input() disabledIconSvgs: string[] = []

  @Input() folderIconSvg = ''

  @Input() bundledIconDir = ''
  @Input() visibleCols: string[] = []

  @Input() headerCols: string[] | null = null
  @Input() colWidths = ''

  @Input() headerColWidths = ''
  @Input() sortBy = 'name'
  @Input() sortAsc = true
  @Input() draggable = true
  @Input() selectionInfo = ''

  @Input() isLocal = true
  @Input() paneCustomOrder: Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'> = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']

  @Input() paneHiddenItems: string[] = []

  @Input() showHidden = false
  @Input() colHeaderLabelFn: (col: string) => string = (c) => c
  @Input() colValueFn: (col: string, e: any) => string = () => ''
  @Input() isSelectedFn: (e: any) => boolean = () => false

  @Input() navFocusKey: string | null = null
  @Input() sortArrowFn: (col: string) => string = () => ''
  @Input() trackByFn: (index: number, e: any) => any = (i) => i

  @Input() resizingCol: string | null = null

  @Input() draggingCol: string | null = null

  @Input() dropIndicatorCol: string | null = null

  @Input() dropIndicatorAfter = false

  get headerColsResolved(): string[] {
    return this.headerCols && this.headerCols.length ? this.headerCols : this.visibleCols
  }

  private get effectiveIconBaseDir(): string {
    const u = (this.iconBaseDir || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return u ? u : (this.bundledIconDir || '')
  }

  private _validIconFiles: Set<string> | null = null
  private _validIconDirCache: string = ''

  private _refreshValidIconFiles(): Set<string> {
    const dir = this.effectiveIconBaseDir
    if (this._validIconFiles && this._validIconDirCache === dir) return this._validIconFiles

    this._clearIconMemo()
    const set = new Set<string>()
    if (dir) {
      try {
        const files = fs.readdirSync(dir)
        for (const f of files) {
          if (typeof f === 'string' && f.toLowerCase().endsWith('.svg')) set.add(f)
        }
      } catch {   }
    }
    this._validIconFiles = set
    this._validIconDirCache = dir
    return set
  }

  svgFileExists(svg: string): boolean {
    if (!svg) return false
    return this._refreshValidIconFiles().has(svg)
  }

  private _iconSrcMemo = new Map<string, string | null>()
  private _folderIconMemo: { v: string | null } | null = null

  private _clearIconMemo(): void {
    this._iconSrcMemo.clear()
    this._folderIconMemo = null
  }

  _base_iconSrc(e: any): string | null {

    if (!this.bundledIconDir && !this.iconBaseDir) return null
    if (!e || e.isDirectory) return null
    const name: string = e.name || ''

    const iconName = (e.linkTarget && !e.isSymlink) ? (e.linkTarget || name) : name
    const dot = iconName.lastIndexOf('.')

    const ext = (dot > 0) ? iconName.slice(dot).toLowerCase() : ''

    const memoHit = this._iconSrcMemo.get(ext)
    if (memoHit !== undefined) return memoHit
    const resolved = this._resolveIconSrcForExt(ext)
    this._iconSrcMemo.set(ext, resolved)
    return resolved
  }

  private _resolveIconSrcForExt(ext: string): string | null {

    if (ext && this.fileTypeIcons && this.fileTypeIcons.length) {
      const validSet = this._refreshValidIconFiles()
      const rule = this.fileTypeIcons.find(r => (r.ext || '').toLowerCase() === ext)
      if (rule && rule.svg && !this.disabledIconSvgs.includes(rule.svg) && validSet.has(rule.svg)) {
        const dir = this.effectiveIconBaseDir
        if (dir) {
          try { return 'file://' + path.join(dir, rule.svg) } catch { /* ignore */ }
        }
      }
    }

    if (this.bundledIconDir) {
      const svg = DEFAULT_ICON_MAP[ext]
      if (svg && !this.disabledIconSvgs.includes(svg)) {
        try { return 'file://' + path.join(this.bundledIconDir, svg) } catch { /* ignore */ }
      }
    }

    const def = 'default.svg'
    if (this.bundledIconDir && !this.disabledIconSvgs.includes(def)) {
      try { return 'file://' + path.join(this.bundledIconDir, def) } catch { /* ignore */ }
    }

    return null
  }

  folderIconSrc(): string | null {
    if (this._folderIconMemo) return this._folderIconMemo.v
    const v = this._computeFolderIconSrc()
    this._folderIconMemo = { v }
    return v
  }

  get _base_folderIcon(): string | null {
    return this.folderIconSrc()
  }

  private _computeFolderIconSrc(): string | null {
    const svg = (this.folderIconSvg || '').trim()
    if (!svg || this.disabledIconSvgs.includes(svg)) return null
    if (!this.svgFileExists(svg)) return null
    const dir = this.effectiveIconBaseDir
    if (!dir) return null
    try { return 'file://' + path.join(dir, svg) } catch { return null }
  }

  @Output() pathInputChange = new EventEmitter<string>()
  @Output() pathEnter = new EventEmitter<void>()
  @Output() pathBlur = new EventEmitter<void>()
  @Output() nav = new EventEmitter<PaneNavAction>()
  @Output() filterPendingChange = new EventEmitter<string>()
  @Output() applyFilter = new EventEmitter<void>()
  @Output() clearFilter = new EventEmitter<void>()
  @Input() dragHoverHandler?: (kind: 'over' | 'enter' | 'leave', event: DragEvent) => void
  @Output() listDragOver = new EventEmitter<DragEvent>()
  @Output() listDragEnter = new EventEmitter<DragEvent>()
  @Output() listDragLeave = new EventEmitter<DragEvent>()
  @Output() listDrop = new EventEmitter<DragEvent>()
  @Output() listMouseDown = new EventEmitter<MouseEvent>()
  @Output() listMouseEnter = new EventEmitter<void>()
  @Output() listScroll = new EventEmitter<void>()

  @Output() listWheel = new EventEmitter<WheelEvent>()
  @Output() listClick = new EventEmitter<MouseEvent>()
  @Output() listContextMenu = new EventEmitter<MouseEvent>()
  @Output() headerContextMenu = new EventEmitter<MouseEvent>()
  @Output() sort = new EventEmitter<PaneSortAction>()
  @Output() colResizeStart = new EventEmitter<{ col: string; event: MouseEvent }>()
  @Output() colResizeAutoFit = new EventEmitter<{ col: string }>()
  @Output() colHeaderReorderStart = new EventEmitter<{ col: string; event: MouseEvent }>()
  @Output() entryClick = new EventEmitter<{ entry: any; event: MouseEvent; index: number }>()
  @Output() entryDblClick = new EventEmitter<{ entry: any; event: MouseEvent }>()
  @Output() entryContextMenu = new EventEmitter<{ entry: any; event: MouseEvent }>()
  @Output() entryDragStart = new EventEmitter<{ entry: any; event: DragEvent }>()
  @Output() entryDragEnd = new EventEmitter<void>()
  @Output() toggleBookmarks = new EventEmitter<MouseEvent>()

  @Output() groupToggle = new EventEmitter<string>()

  @Output() groupSelect = new EventEmitter<string>()

  @Input() i18n!: SftpI18nService

  get resolvedPaneCustomOrder(): Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'> {
    const allowed: Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'> = ['label', 'path', 'back', 'forward', 'up', 'refresh', 'home', 'hidden', 'filter', 'bookmark']

    const order = this.paneCustomOrder.filter((x): x is any => allowed.includes(x as any))
    const base = order.length ? order : allowed

    return base.filter(x => !this.paneHiddenItems.includes(x))
  }

  isToolbarItem(item: string): item is 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden' {
    return ['back', 'forward', 'up', 'refresh', 'home', 'filter', 'bookmark', 'hidden'].includes(item)
  }

  onToolbarAction(action: 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden', event: MouseEvent): void {
    if (action === 'bookmark') {
      event.stopPropagation()
      this.toggleBookmarks.emit(event)
      return
    }
    if (action === 'hidden') {
      event.stopPropagation()
      this.nav.emit('toggleHidden')
      return
    }
    this.nav.emit(action === 'filter' ? 'toggleFilter' : action)
  }

  isToolbarActionDisabled(action: 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'): boolean {
    if (action === 'back') return !this.canBack
    if (action === 'forward') return !this.canForward
    if (action === 'up') return !this.canUp
    if (action === 'refresh' || action === 'home') return this.refreshDisabled
    if (action === 'hidden') return false
    return false
  }

  isToolbarActionActive(action: 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'): boolean {
    if (action === 'filter') return this.filterVisible || !!this.filterActive
    if (action === 'bookmark') return this.bookmarksActive
    if (action === 'hidden') return this.showHidden
    return false
  }

  toolbarActionTitle(action: 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'): string {

    return this._toolbarTitles[action] || ''
  }

  pathFocused = false

  pathModel = ''
  private _pathFocused = false

  labels = { filter: '', filterApply: '', filterClear: '', noSession: '', name: '', errorAccess: '', noMatch: '', empty: '', groupExpand: '', groupCollapse: '' }
  private _toolbarTitles: Record<string, string> = {}
  colHeaderLabels: Record<string, string> = {}

  private _rebuildLabels(): void {
    const t = (k: string) => (this.i18n ? this.i18n.t(k) : '')
    this.labels = {
      filter: t('pane.filter'),
      filterApply: t('filter.apply'),
      filterClear: t('filter.clear'),
      noSession: t('notify.noSSHSession'),
      name: t('file.name'),
      errorAccess: t('pane.errorAccess'),
      noMatch: t('pane.noMatch'),
      empty: t('pane.empty'),
      groupExpand: t('group.expand'),
      groupCollapse: t('group.collapse'),
    }
    this._toolbarTitles = {
      back: t('pane.back'), forward: t('pane.forward'), up: t('pane.up'),
      refresh: t('pane.refresh'), home: t('pane.home'), filter: t('pane.filterBtn'),
      bookmark: t('bookmark.title'), hidden: t('pane.showHidden'),
    }

    const cols = ['name', 'size', 'date', 'created', 'perms', 'mode', 'access', 'owner', 'group', 'path', 'ext']
    const map: Record<string, string> = {}
    for (const c of cols) map[c] = this.colHeaderLabelFn(c)
    this.colHeaderLabels = map
  }

  ngOnInit(): void {
    this.pathModel = this.pathInput
    this._rebuildLabels()
  }

  // Keep the full input model; only the active page participates in Angular rendering.
  listPage = 0
  listPageStart = 0
  listPageCount = 1
  listRowCount = 0
  pageEntries: any[] = []
  pageGroupRows: any[] = []
  private pageKeys = new Map<string, number>()
  private pageBridge: HTMLElement | null = null
  private listListenerCleanup: (() => void) | null = null
  // Selection callbacks keep a stable identity; the state reference explicitly invalidates this view.
  @Input() selectionState: any[] = []
  @Input() navigationReturnPath = ''
  @Input() cellRevision = 0
  @Input() transientMenuVisible = false
  private pageGroupHeaders = new Map<number, any>()

  private rebuildListPage(): void {
    const rows = this.groupRows || this.entries
    this.listRowCount = rows.length
    this.listPageCount = Math.max(1, Math.ceil(rows.length / fileListPolicy.pageSize))
    this.listPage = Math.min(this.listPage, this.listPageCount - 1)
    this.listPageStart = this.listPage * fileListPolicy.pageSize
    const slice = rows.slice(this.listPageStart, this.listPageStart + fileListPolicy.pageSize)
    this.pageEntries = this.groupRows ? [] : slice
    this.pageGroupRows = this.groupRows ? slice : []
    const header = this.pageGroupHeaders.get(this.listPageStart)
    if (this.groupRows && slice[0]?.kind === 'entry' && header) this.pageGroupRows = [header, ...slice]
  }

  private indexListPages(): void {
    this.pageKeys.clear()
    this.pageGroupHeaders.clear()
    let header: any = null
    const rows = this.groupRows || this.entries
    rows.forEach((row: any, index) => {
      if (this.groupRows && row.kind === 'header') header = row
      if (index % fileListPolicy.pageSize === 0 && header) this.pageGroupHeaders.set(index, header)
      const key = this.groupRows
        ? row.kind === 'header' ? NAV_HEADER_KEY_PREFIX + row.bucketKey : row.entry.fullPath
        : row.fullPath
      this.pageKeys.set(key, index)
    })
  }

  private revealListKey(key: string): boolean {
    if (this.customInlineEdit?.originalPath && key !== this.customInlineEdit.originalPath) return false
    const index = this.pageKeys.get(key)
    if (index === undefined) return false
    const page = Math.floor(index / fileListPolicy.pageSize)
    if (page === this.listPage) return false
    this.listPage = page
    this.rebuildListPage()
    return true
  }

  changeListPage(page: number): void {
    // Keep inline inputs mounted until Enter/Escape/blur has completed the operation.
    if (this.customInlineEdit || page < 0 || page >= this.listPageCount) return
    this.listPage = page
    this.rebuildListPage()
    this.viewDetector.markForCheck()
    const list = this.hostRef.nativeElement.querySelector('.pane-list') as HTMLElement
    if (list) list.scrollTop = 0
  }

  get listPageEnd(): number {
    return Math.min(this.listRowCount, this.listPageStart + fileListPolicy.pageSize)
  }

  private attachListPageBridge(): void {
    const list = this.hostRef.nativeElement.querySelector('.pane-list') as HTMLElement
    if (!list || list === this.pageBridge) return
    this.listListenerCleanup?.()
    this.pageBridge = list
    this.zone.runOutsideAngular(() => {
      const scroll = () => {
        if (this.transientMenuVisible) this.zone.run(() => this.listScroll.emit())
      }
      const wheel = (event: WheelEvent) => {
        this.listWheel.emit(event)
        if (event.defaultPrevented) this.zone.run(() => this.viewDetector.markForCheck())
      }
      list.addEventListener('scroll', scroll, { passive: true })
      list.addEventListener('wheel', wheel, { passive: false })
      const host = this.hostRef.nativeElement
      const surface = (event: DragEvent) => {
        const target = event.target as Element | null
        const area = target?.closest?.('.pane-list, [data-drop-parent]')
        return area && host.contains(area) ? area : null
      }
      const hover = (kind: 'over' | 'enter' | 'leave', event: DragEvent) => {
        const area = surface(event)
        if (!area) return
        // This file pane owns hover; keep outer Tabby drag handlers out of its hot path.
        event.stopPropagation()
        if (kind === 'over' && (event.target as Element)?.closest('.entry.header')) {
          if (this.dragHoverHandler) this.dragHoverHandler('leave', event)
          else this.listDragLeave.emit(event)
          this.onHeaderDragOver(event); return
        }
        if (kind !== 'over' && event.relatedTarget && area.contains(event.relatedTarget as Node)) return
        if (this.dragHoverHandler) this.dragHoverHandler(kind, event)
        else (kind === 'over' ? this.listDragOver : kind === 'enter' ? this.listDragEnter : this.listDragLeave).emit(event)
      }
      const over = (event: DragEvent) => hover('over', event)
      const enter = (event: DragEvent) => hover('enter', event)
      const leave = (event: DragEvent) => hover('leave', event)
      const drop = (event: DragEvent) => {
        if (!surface(event)) return
        event.stopPropagation()
        if ((event.target as Element)?.closest('.entry.header')) { this.onHeaderDragOver(event); return }
        // Only the actual drop enters Angular. DataTransfer is consumed synchronously by its handler.
        this.zone.run(() => this.listDrop.emit(event))
      }
      host.addEventListener('dragover', over)
      host.addEventListener('dragenter', enter)
      host.addEventListener('dragleave', leave)
      host.addEventListener('drop', drop)
      this.listListenerCleanup = () => {
        list.removeEventListener('scroll', scroll); list.removeEventListener('wheel', wheel)
        host.removeEventListener('dragover', over); host.removeEventListener('dragenter', enter)
        host.removeEventListener('dragleave', leave); host.removeEventListener('drop', drop)
      }
    })
    // Keyboard/type-to-find scrolling asks for a full-model path before looking up its DOM row.
    ;(list as any).sftpRevealRow = (attr: string, value: string) => {
      const key = attr === 'data-group-key' ? NAV_HEADER_KEY_PREFIX + value : value
      if (this.revealListKey(key)) this.viewDetector.detectChanges()
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.entries || changes.groupRows) this.indexListPages()
    if (changes.pathInput || changes.filterActive || changes.sortBy || changes.sortAsc) this.listPage = 0
    if (changes.navigationReturnPath && this.navigationReturnPath) this.revealListKey(this.navigationReturnPath)
    if (changes.navFocusKey && this.navFocusKey) this.revealListKey(this.navFocusKey)
    if (this.customInlineEdit?.originalPath) this.revealListKey(this.customInlineEdit.originalPath)
    this.rebuildListPage()

    if (changes.pathInput && !this._pathFocused) {
      this.pathModel = this.pathInput
    }

    if (changes.i18n || changes.colHeaderLabelFn) {
      this._rebuildLabels()
    }

    if (changes.iconBaseDir || changes.bundledIconDir) {
      this._validIconFiles = null
      this._validIconDirCache = ''
    }

    if (changes.iconBaseDir || changes.bundledIconDir || changes.fileTypeIcons
      || changes.disabledIconSvgs || changes.folderIconSvg) {
      this._clearIconMemo()
    }
  }

  _base_onPathFocus(): void {
    this._pathFocused = true
    this.pathFocused = true

    this.pathModel = this.pathInput
  }

  _base_onPathModelChange(v: string): void {
    this.pathModel = v
    this.pathInputChange.emit(v)
  }

  _base_onPathBlur(): void {
    this._pathFocused = false
    this.pathFocused = false
    this.pathBlur.emit()
  }

  onPaneAreaMouseDown(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('.path-input')) return
    this.blurAllPathInputs()
  }

  private blurAllPathInputs(): void {
    const root = this.hostRef.nativeElement.closest('.sftp-root') ?? this.hostRef.nativeElement
    root.querySelectorAll('.path-input').forEach(node => {
      const el = node as HTMLInputElement
      if (document.activeElement === el) el.blur()
    })
    this.pathFocused = false
  }

  onColResizeMouseDown(col: string, event: MouseEvent): void {
    event.stopPropagation()
    this.colResizeStart.emit({ col, event })
  }

  onColResizeDblClick(col: string, event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    this.colResizeAutoFit.emit({ col })
  }

  onHeaderDragOver(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  onColHeaderMouseDown(col: string, event: MouseEvent): void {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('.col-resize-handle')) return
    event.stopPropagation()
    this.colHeaderReorderStart.emit({ col, event })
  }

  blurPathInput(_el?: HTMLInputElement): void {
    this.blurAllPathInputs()
  }

  trackByCol = (_: number, col: string): string => col

  trackGroupRowFn = (_: number, row: any): string => {
    if (!row) return ''
    return row.kind === 'header'
      ? `h|${row.bucketKey}|${row.collapsed ? 1 : 0}`
      : `e|${row.entry?.fullPath || ''}`
  }

  colHeaderLabel(col: string): string { return this.colHeaderLabelFn(col) }
  colValue(col: string, e: any): string { return this.colValueFn(col, e) }
  isSelected(e: any): boolean { return this.isSelectedFn(e) }

  groupSelState(row: any): 'all' | 'partial' | 'none' {
    const items = row && row.kind === 'header' ? row.items : null
    if (!items || !items.length) return 'none'
    let selected = 0
    for (const e of items) if (this.isSelectedFn(e)) selected++
    if (selected === 0) return 'none'
    return selected === items.length ? 'all' : 'partial'
  }

  isNavFocusedEntry(e: any): boolean {
    return !!this.navFocusKey && !!e && this.navFocusKey === e.fullPath
  }

  isNavFocusedHeader(row: any): boolean {
    return !!this.navFocusKey
      && !!row && row.kind === 'header' && row.bucketKey != null
      && this.navFocusKey === NAV_HEADER_KEY_PREFIX + row.bucketKey
  }
  sortArrow(col: string): string { return this.sortArrowFn(col) }

  inaccessiblePrefix(e: any): string {
    return this.isLocal && e.inaccessible ? '* ' : ''
  }

  isLinkEntry(e: any): boolean {
    return !!(e?.isSymlink || e?.linkTarget)
  }

  linkBadgeTitle(e: any): string {
    const t = (k: string) => (this.i18n ? this.i18n.t(k) : '')
    return e?.isSymlink ? t('file.symlink') : t('file.shortcut')
  }

  displayName(e: any): string {
    const name: string = e?.name || ''
    if (this.isLocal && !e?.isSymlink && e?.linkTarget && /\.lnk$/i.test(name)) {
      return name.replace(/\.lnk$/i, '')
    }
    return name
  }

  isHiddenEntry(e: any): boolean {
    return typeof e?.name === 'string' && e.name.startsWith('.')
  }

  onSortCol(col: string): void {
    const mapped = col === 'date' ? 'modified' : col === 'created' ? 'birthtime' : col
    this.sort.emit({ col: mapped })
  }

  // Controller facade: named source methods, one explicit composition root.
  iconSrc(...args: any[]): any { return invokeFeature("FilePane","iconSrc",this,args) }
  get folderIcon(): any { return readFeature("FilePane","folderIcon",this) }
  onPathFocus(...args: any[]): any { return invokeFeature("FilePane","onPathFocus",this,args) }
  onPathModelChange(...args: any[]): any { return invokeFeature("FilePane","onPathModelChange",this,args) }
  onPathBlur(...args: any[]): any { return invokeFeature("FilePane","onPathBlur",this,args) }
  _customHideSuggestions(...args: any[]): any { return invokeFeature("FilePane","_customHideSuggestions",this,args) }
  _customChooseSuggestion(...args: any[]): any { return invokeFeature("FilePane","_customChooseSuggestion",this,args) }
  _customScheduleSuggestions(...args: any[]): any { return invokeFeature("FilePane","_customScheduleSuggestions",this,args) }
  _customPreviewSuggestion(...args: any[]): any { return invokeFeature("FilePane","_customPreviewSuggestion",this,args) }
  _customHighlightSuggestion(...args: any[]): any { return invokeFeature("FilePane","_customHighlightSuggestion",this,args) }
  ngOnDestroy(...args: any[]): any { this.listListenerCleanup?.(); if (this.pageBridge) delete (this.pageBridge as any).sftpRevealRow; return invokeFeature("FilePane","ngOnDestroy",this,args) }
  customSetiPython(...args: any[]): any { return invokeFeature("FilePane","customSetiPython",this,args) }
  customInlineRename(...args: any[]): any { return invokeFeature("FilePane","customInlineRename",this,args) }
  customInlineKey(...args: any[]): any { return invokeFeature("FilePane","customInlineKey",this,args) }
  ngAfterViewChecked(...args: any[]): any { this.attachListPageBridge(); return invokeFeature("FilePane","ngAfterViewChecked",this,args) }
  @Input() customPathProvider: any
  @Input() customRefreshSameFolder: any
  @Input() customInlineEdit: any
  @Input() customInlineOwner: any
}

export interface SftpFilePaneComponent { [key: string]: any }
