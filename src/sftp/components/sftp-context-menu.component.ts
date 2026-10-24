import { featureApis, invokeFeature, readFeature, writeFeature } from "../../features/api"
﻿

import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'
import { GroupByMode } from '../core/grouping'

export const GROUP_BY_MODES: GroupByMode[] = ['none', 'name', 'modified', 'type', 'size']

export type ContextMenuAction =
  | 'newFolder' | 'newFile' | 'rename' | 'delete'
  | 'openLocal' | 'viewFile' | 'editFile' | 'upload' | 'download'
  | 'revealInExplorer' | 'chmod' | 'details'
  | 'openWith' | 'openTerminalHere' | 'copyFileName'
  | 'copy' | 'cut' | 'paste' | 'refresh' | 'selectAll' | 'selectInvert' | 'copyPath'

export type HeaderMenuAction =
  | 'adjustCol' | 'adjustAllCols'
  | 'toggleCol:size' | 'toggleCol:date' | 'toggleCol:created' | 'toggleCol:access' | 'toggleCol:owner'
  | 'toggleCol:group' | 'toggleCol:perms' | 'toggleCol:mode' | 'toggleCol:path' | 'toggleCol:ext'
  | 'togglePinFolders' | 'toggleHidden' | 'toggleColBorders' | 'toggleZebra'

export type ColVisibilityState = {
  size: boolean
  date: boolean
  created: boolean
  access: boolean
  owner: boolean
  group: boolean
  perms: boolean
  mode: boolean
  path: boolean
  ext: boolean
}

interface FileMenuItemDef {
  labelKey: string
  danger?: boolean

  shortcut?: string

  category: 'transfer' | 'open' | 'clipboard' | 'modify' | 'info' | 'create' | 'panel'
}

export const FILE_MENU_REGISTRY: Partial<Record<ContextMenuAction, FileMenuItemDef>> = {"upload":{"labelKey":"app.upload","category":"transfer"},"download":{"labelKey":"app.download","category":"transfer"},"openLocal":{"labelKey":"file.open","category":"open"},"editFile":{"labelKey":"file.open","category":"open"},"revealInExplorer":{"labelKey":"file.showInFolder","category":"open"},"copy":{"labelKey":"file.copy","shortcut":"${mod}C","category":"clipboard"},"cut":{"labelKey":"file.cut","shortcut":"${mod}X","category":"clipboard"},"paste":{"labelKey":"file.paste","shortcut":"${mod}V","category":"clipboard"},"rename":{"labelKey":"app.rename","shortcut":"F2","category":"modify"},"delete":{"labelKey":"app.delete","shortcut":"Del","danger":true,"category":"modify"},"chmod":{"labelKey":"permission.title","category":"info"},"details":{"labelKey":"file.properties","category":"info"},"newFolder":{"labelKey":"file.newFolder","category":"create"},"newFile":{"labelKey":"file.newFile","category":"create"},"refresh":{"labelKey":"app.refresh","shortcut":"F5","category":"panel"},"selectAll":{"labelKey":"pane.selectAll","shortcut":"${mod}A","category":"panel"},"selectInvert":{"labelKey":"pane.selectInvert","category":"panel"},"copyPath":{"labelKey":"pane.copyPath","category":"panel"},"openWith":{"labelKey":"Open with…","category":"open"},"openTerminalHere":{"labelKey":"Open terminal here","category":"open"},"copyFileName":{"labelKey":"Copy file name","category":"panel"}}

export const DEFAULT_FILE_MENU_ORDER: ContextMenuAction[] = [
  'upload', 'download', 'openLocal', 'viewFile', 'editFile', 'revealInExplorer',
  'copy', 'cut', 'paste', 'rename', 'delete', 'chmod', 'details',
  'newFolder', 'newFile', 'refresh', 'selectAll', 'selectInvert', 'copyPath',
]

export function sanitizeMenuOrder(value: unknown): ContextMenuAction[] {
  if (!Array.isArray(value) || !value.length) return DEFAULT_FILE_MENU_ORDER
  const valid = value.filter(
    (a): a is ContextMenuAction => typeof a === 'string' && Object.prototype.hasOwnProperty.call(FILE_MENU_REGISTRY, a),
  )
  return valid.length ? valid : DEFAULT_FILE_MENU_ORDER
}

@Component({
  selector: 'sftp-context-menu',
  template: require('./sftp-context-menu.component.view.html'),
  styles: [require('./sftp-context-menu.component.view.css')],
})
export class SftpContextMenuComponent implements OnChanges {
  @ViewChild('menuEl') menuEl!: ElementRef<HTMLElement>
  @ViewChild('headerMenuEl') headerMenuEl!: ElementRef<HTMLElement>
  @ViewChild('groupBySubEl') groupBySubEl?: ElementRef<HTMLElement>

  @Input() menuVisible = false
  @Input() menuX = 0
  @Input() menuY = 0
  @Input() pane: 'local' | 'remote' = 'local'
  @Input() entry: any = null
  @Input() hasSelection = false
  @Input() singleSelected = false
  @Input() clipboardHasEntries = false
  @Input() canView = false
  @Input() canEdit = false
  @Input() canTransfer = false
  @Input() modKey = 'Ctrl'

  get hasLocalOpen(): boolean {
    return this.pane === 'local' && this.singleSelected && !!this.entry
  }

  get hasView(): boolean {
    return this.singleSelected && !!this.entry && !this.entry.isDirectory && this.canView
  }

  get hasEdit(): boolean {
    return this.singleSelected && !!this.entry && !this.entry.isDirectory && this.canEdit
  }

  get hasLocalReveal(): boolean {
    return this.pane === 'local' && this.singleSelected && !!this.entry
  }

  get hasUpload(): boolean {
    return this.pane === 'local' && this.hasSelection && this.canTransfer
  }

  get hasDownload(): boolean {
    return this.pane === 'remote' && this.hasSelection && this.canTransfer
  }

  get hasOpenActions(): boolean {
    return this.hasLocalOpen || this.hasView || this.hasEdit || this.hasLocalReveal
  }

  get hasTransferActions(): boolean {
    return this.hasUpload || this.hasDownload
  }

  get hasClipboardActions(): boolean {
    return this.hasSelection || this.clipboardHasEntries
  }

  get hasModifyActions(): boolean {
    return this.singleSelected || this.hasSelection
  }

  get hasRemoteChmod(): boolean {
    return this.pane === 'remote' && this.singleSelected
  }

  get hasInfoActions(): boolean {
    return this.hasRemoteChmod || !!this.entry
  }

  get hasCreateActions(): boolean {
    return true
  }

  get hasPanelActions(): boolean {
    return true
  }

  get sepBeforeOpen(): boolean {
    return this.hasOpenActions && this.hasTransferActions
  }

  get sepBeforeClipboard(): boolean {
    return this.hasClipboardActions && (this.hasOpenActions || this.hasTransferActions)
  }

  get sepBeforeModify(): boolean {
    return this.hasModifyActions && (this.hasOpenActions || this.hasTransferActions || this.hasClipboardActions)
  }

  get sepBeforeInfo(): boolean {
    return this.hasInfoActions && (this.hasOpenActions || this.hasTransferActions || this.hasClipboardActions || this.hasModifyActions)
  }

  get sepBeforeCreate(): boolean {
    return this.hasCreateActions && (this.hasOpenActions || this.hasTransferActions || this.hasClipboardActions || this.hasModifyActions || this.hasInfoActions)
  }

  get sepBeforePanel(): boolean {
    const above = this.hasOpenActions || this.hasTransferActions || this.hasClipboardActions
      || this.hasModifyActions || this.hasInfoActions || this.hasCreateActions
    return this.hasPanelActions && above
  }

  @Input() headerVisible = false
  @Input() headerX = 0
  @Input() headerY = 0
  @Input() headerCol: string | null = null
  @Input() cols: ColVisibilityState = {
    size: false, date: false, created: false, access: false, owner: false,
    group: false, perms: false, mode: false, path: false, ext: false,
  }
  @Input() pinFolders = true
  @Input() showHidden = false
  @Input() showColBorders = false
  @Input() showZebra = false

  @Output() menuAction = new EventEmitter<ContextMenuAction>()
  @Output() headerAction = new EventEmitter<HeaderMenuAction>()

  @Input() i18n!: SftpI18nService

  @Input() menuOrder: ContextMenuAction[] = DEFAULT_FILE_MENU_ORDER

  @Input() panelHotkeyShortcuts: Record<string, string> | null = null

  readonly MENU_REGISTRY = FILE_MENU_REGISTRY

  @Input() groupByPane: 'local' | 'remote' | null = null

  @Input() groupBy: GroupByMode = 'none'
  @Output() groupByAction = new EventEmitter<GroupByMode>()

  @Input() groupAllCollapsed = false

  @Output() groupToggleAll = new EventEmitter<void>()

  @Input() disabledMenuEntries: Set<string> = new Set<string>()

  readonly GROUP_BY_MODES = GROUP_BY_MODES

  positionGroupBySubmenu(): void {
    const sub = this.groupBySubEl?.nativeElement
    if (!sub) return
    sub.classList.remove('flip-x')
    sub.style.transform = ''

    const r = sub.getBoundingClientRect()
    if (!r.width) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const M = 4
    if (r.right > vw - M) sub.classList.add('flip-x')
    if (r.bottom > vh - M) sub.style.transform = `translateY(${(vh - M) - r.bottom}px)`
  }

  _base_isActionVisible(a: ContextMenuAction): boolean {
    switch (a) {
      case 'upload': return this.hasUpload
      case 'download': return this.hasDownload
      case 'openLocal': return this.hasLocalOpen
      case 'viewFile': return this.hasView
      case 'editFile': return this.hasEdit
      case 'revealInExplorer': return this.hasLocalReveal
      case 'copy': return this.hasSelection
      case 'cut': return this.hasSelection
      case 'paste': return this.clipboardHasEntries
      case 'rename': return this.singleSelected
      case 'delete': return this.hasSelection
      case 'chmod': return this.hasRemoteChmod
      case 'details': return !!this.entry
      case 'newFolder': return this.hasCreateActions
      case 'newFile': return this.hasCreateActions
      case 'refresh': return true
      case 'selectAll': return true
      case 'selectInvert': return true
      case 'copyPath': return this.hasSelection || !!this.entry
      default: return false
    }
  }

  get _base_orderedVisibleActions(): ContextMenuAction[] {

    const order = sanitizeMenuOrder(this.menuOrder)
    return order.filter(a => this.isActionVisible(a) && !this.disabledMenuEntries.has(a))
  }

  needsSep(a: ContextMenuAction, i: number): boolean {
    if (i <= 0) return false
    const prev = this.orderedVisibleActions[i - 1]
    return FILE_MENU_REGISTRY[prev].category !== FILE_MENU_REGISTRY[a].category
  }

  shortcutText(s?: string): string {
    if (!s) return ''
    return s.replace('${mod}', this.modKey)
  }

  effectiveShortcut(action: ContextMenuAction): string {

    if (this.panelHotkeyShortcuts && action in this.panelHotkeyShortcuts) {
      const key = this.panelHotkeyShortcuts[action]

      return key ? this.shortcutText(key) : ''
    }

    return this.shortcutText(FILE_MENU_REGISTRY[action].shortcut)
  }

  ngOnChanges(changes: SimpleChanges): void {

    if (changes['menuVisible'] && this.menuVisible) {
      setTimeout(() => this._clampMenu(this.menuEl, 'menuX', 'menuY'))
    }
    if (changes['headerVisible'] && this.headerVisible) {
      setTimeout(() => this._clampMenu(this.headerMenuEl, 'headerX', 'headerY'))
    }
  }

  private _clampMenu(ref: ElementRef<HTMLElement> | undefined, xProp: 'menuX' | 'headerX', yProp: 'menuY' | 'headerY'): void {
    const el = ref?.nativeElement
    if (!el) return
    const MARGIN = 4
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = this[xProp]
    let y = this[yProp]
    if (x + rect.width > vw - MARGIN) x = vw - rect.width - MARGIN
    if (y + rect.height > vh - MARGIN) y = vh - rect.height - MARGIN
    if (x < MARGIN) x = MARGIN
    if (y < MARGIN) y = MARGIN
    this[xProp] = x
    this[yProp] = y
  }

  // Controller facade: named source methods, one explicit composition root.
  isActionVisible(...args: any[]): any { return invokeFeature("Menu","isActionVisible",this,args) }
  get orderedVisibleActions(): any { return readFeature("Menu","orderedVisibleActions",this) }
  contextActionLabel(...args: any[]): any { return invokeFeature("Menu","contextActionLabel",this,args) }
}

export interface SftpContextMenuComponent { [key: string]: any }
