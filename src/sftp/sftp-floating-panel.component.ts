const fileOperation = require('../runtime/file-operation.cjs')
import type { FileOperationBatch } from './core/panel-types'
import type { ConflictQueueItem } from './core/panel-types'
const {getPluginUpdater,panelHasWork}=require('../runtime/plugin-updater.cjs')
import { NavigationMemory } from './core/navigation-memory'
import { fileList as fileListPolicy } from '../../transfer-policy.json'
import sendTerminalCommand from '../runtime/terminal-command.cjs'
import { featureApis, invokeFeature, readFeature, writeFeature } from "../features/api"
﻿

import * as path from 'path'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as os from 'os'
import { createHash, randomUUID } from 'crypto'

import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef, ElementRef, NgZone, Injector, ViewEncapsulation, Inject, Optional } from '@angular/core'
import { ThemesService, NotificationsService, ConfigService, AppService, HostAppService } from 'tabby-core'

import { LocalPathFileDownload, LocalPathFileUpload, uploadLocalFile, downloadRemoteFile, cancelAllInFlight } from './core/transfer-adapters'
import { currentTaskScope, runInTaskScope, type TaskCancelRef } from './core/task-scope'
import { log } from '../services/sftp-logger'
import { SftpConnectionService, SFTPFile, SFTPSessionLike, SSHSessionLike, SftpEnrichOptions, getSftpConnectionService, enrichSftpFilesWithAtime, enrichRemoteOwnersViaStat, resolveRemoteSymlinkStat, statRemotePath } from '../services/sftp.service'
import { SftpI18nService } from '../services/sftp-i18n.service'
import type { Locale } from '../services/sftp-i18n.service'
import { SftpConfigService } from '../services/sftp-config.service'
import { SftpBookmarksService, Bookmark } from '../services/sftp-bookmarks.service'
import { SftpTransferLogService, TransferLogEntry } from '../services/sftp-transfer-log.service'
import { openSftpPlusSettings } from '../settings/sftp-open-settings'
import { PanelConnectionLifecycle, PathFollowMode } from './components/connection-lifecycle'
import { PanelRubberBand } from './components/panel-rubber-band'
import { PanelHeaderReorder } from './components/panel-header-reorder'
import { PanelFileDnd } from './components/panel-file-dnd'
import { PanelDropAdapter, dragDropTempDir } from './core/drop'
import { PanelTransferCoordinator, SPEED_STALL_ZERO_MS, SPEED_STALL_ZERO_TEXT } from './core/transfer-coordinator'
import { PanelPasteAdapter } from './core/paste'
import { ContentDigestService } from './core/digest'
import { isPathInside, copyLocalDir, copyRemoteDir, deleteLocalRecursive, deleteRemoteRecursive, tryRemoteCpViaSsh, tryRemoteRmViaSsh } from './core/fs-ops'
import { isChannelDeadError } from './core/session-errors'
import { mapConcurrent, ConcurrencyLimiter } from './core/concurrency'
import { trashLocalPath } from './core/trash-local'
import { PanelConflictResolver } from './components/panel-conflict-resolver'
import { PanelTransferRuntime } from './core/transfer-coordinator'
import { PaneNavHistory } from './core/selection'
import { computeSelection, computeSortToggle } from './core/selection'
import { GroupByMode, GroupDisplayRow, NAV_HEADER_KEY_PREFIX, buildGroupedRows, groupModeSortField, navHeaderKey } from './core/grouping'
import {
  keyboardHotkeySpecs,
  matchPointerHotkeySpecs,
  matchPanelHotkeyKey,
  matchPanelHotkeyKeys,
  normalizePanelHotkeyKeys,
  parsePanelHotkeyKey,
} from '../tabby/hotkey-util'
import {
  CONTEXT_ACTION_HOTKEYS,
  defaultPanelHotkeys,
  normalizeCaretShape,
  PANEL_HOTKEY_ACTIONS,
  type CaretShape,
  type PanelHotkeyAction,
} from '../tabby/config-provider'
import { isColorDark } from '@common/utils'
import { SftpPanelBookmarkController } from './controllers/panel-bookmark-controller'
import {
  isDirByMode,
  isSymlinkByMode,
  filterByHidden,
  filterByName,
  sortLocalEntries,
  sortRemoteEntries,
} from './core/file-utils'
import type {
  LocalEntry,
  ConflictFileInfo,
  DragPayload,
  FolderTransferCtx,
  BookmarkScope,
  PanelTransferItem,
} from './core/panel-types'
import type { AutoSkippedInfo } from './core/conflict'
import {
  formatSize,
  formatDate,
  formatPercent,
  formatLogTime,
  formatLogTimeRange,
  formatDuration,
  formatSpeedFromSize,
  getLogFileName,
  formatFailReason as formatFailReasonFn,
  getDateFormatPattern,
  setDateFormatPattern,
} from './core/file-utils'
import { DEFAULT_ICON_MAP, resolveSftpPlusBundledIconDir } from './core/icon-defaults'
import { SFTP_PANEL_STYLES } from './components/styles'
import { IdNameResolver, execSshCommand, safeEntryName, safeJoinUnder } from './core/path-utils'
import type { PaneNavAction, PaneSortAction } from './components/sftp-file-pane.component'
import type { ContextMenuAction, HeaderMenuAction, ColVisibilityState } from './components/sftp-context-menu.component'

import { sanitizeMenuOrder } from './components/sftp-context-menu.component'
import type { PermField } from './components/sftp-perm-dialog.component'
import type { DetailsDisplay } from './components/sftp-details-dialog.component'
import type { ViewerMode } from './components/sftp-viewer-dialog.component'
import type { CwdSetupChoice } from './components/sftp-cwd-setup-dialog.component'
import {
  CWD_SESSION_CMD,
  CWD_BASH_SNIPPET,
  CWD_ZSH_SNIPPET,
} from './components/sftp-cwd-setup-dialog.component'
import {
  isViewableRemoteFileType,
  isImageFile,
  isBinaryBuffer,
  bufferToText,
  bufferToDataUrl,
  isRemoteFileTooLargeForView,
  getViewMaxBytes,
  formatBytesLimit,
} from './core/file-utils'
import {
  downloadRemoteToBuffer,
  downloadRemoteToTempFile,
  writeTextToFile,
  readTextFromFile,
  removeTempFile,
  writeBufferToTemp,
  readLocalFileToBuffer,
} from './core/transfer-adapters'

const HOTKEY_CLEARED = '__NONE__'

const STRIP_QUERY_MAX = 64

interface NavRow {
  kind: 'header' | 'entry'

  key: string

  entries: any[]

  listIndex: number

  groupKey?: string
}

interface NavCache {
  src: any
  rows: any
  out: NavRow[]
  index: Map<string, number>
  headerPrefix: number[]
}

const EMPTY_ICON_RULES: { ext: string; svg: string; name?: string }[] = Object.freeze([]) as unknown as { ext: string; svg: string; name?: string }[]
const EMPTY_SVG_LIST: string[] = Object.freeze([]) as unknown as string[]

const TAR_CHANNEL_FAILURE_REASON_KEYS: Record<string, string> = {
  localTarMissing: 'tarchan.reason.localTarMissing',
  remoteTarMissing: 'tarchan.reason.remoteTarMissing',
  symlinkUnsupported: 'tarchan.reason.symlinkUnsupported',

  localPackFailed: 'tarchan.reason.localPackFailed',
  remotePackFailed: 'tarchan.reason.remotePackFailed',
  localExtractFailed: 'tarchan.reason.localExtractFailed',

  nameEncodingUnsupported: 'tarchan.reason.nameEncodingUnsupported',
  tarballFailed: 'tarchan.reason.tarballFailed',

  targetExists: 'tarchan.reason.targetExists',
  other: 'tarchan.reason.other',
}

@Component({
  selector: 'sftp-plus-panel',
  template: require('./sftp-floating-panel.component.view.html'),
  encapsulation: ViewEncapsulation.None,
  styles: [require('./sftp-floating-panel.component.view.css')],

  host: { 'attr.tabindex': '-1' },
})
export class SftpFloatingPanel extends SftpPanelBookmarkController implements OnInit, AfterViewInit, OnDestroy {

  private static readonly REMOTE_LISTING_ENRICH_LIMIT = 20000

  sshSession: SSHSessionLike | null = null
  profile: any = null
  onClose: (() => void) | null = null
  onMinimize: (() => void) | null = null
  displayMode: 'floating' | 'workspace' = 'floating'

  private sftpService = getSftpConnectionService()
  i18n: SftpI18nService
  private configService?: ConfigService

  private sftpConfig: SftpConfigService | null = null
  protected bookmarks!: SftpBookmarksService
  private transferLog: SftpTransferLogService

  terminalRef: any = null

  toastMessage = ''
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private _remoteLoadingTimer: ReturnType<typeof setTimeout> | null = null
  private _remoteFlashTimer: ReturnType<typeof setTimeout> | null = null
  private _localFlashTimer: ReturnType<typeof setTimeout> | null = null
  private _remoteRefreshGen = 0
  private _localRefreshGen = 0
  private static readonly MTIME_TOLERANCE_MS = 2000

  reconnecting = false

  minimized = false

  private _destroyed = false

  private _queuedEntryTimers: ReturnType<typeof setTimeout>[] = []

  private get _isAlive(): boolean {
    return !this._destroyed
  }

  protected override _safeDetect(): void {
    if (this._destroyed) return
    const cdr = this.cdr
    cdr.detectChanges()
  }

  panelDraggable = false

  panelDragging = false
  panelResizing = false

  panelMaximized = false

  topBarMenuVisible = false
  topBarMenuX = 0
  topBarMenuY = 0
  private _hostEl: HTMLElement | null = null
  private _dragOffsetX = 0
  private _dragOffsetY = 0
  private _dragStartClientX = 0
  private _dragStartClientY = 0
  private _dragThresholdPassed = false
  private _resizing = false
  private _resizeDir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null = null
  private _resizeStart = { left: 0, top: 0, w: 0, h: 0, mx: 0, my: 0 }
  private _prevGeom: { left: string; top: string; width: string; height: string; followWindow?: boolean } | null = null

  private readonly _geomMinW = 420
  private readonly _geomMinH = 240
  private _onGeomMoveBound = (e: MouseEvent): void => this._onGeomMove(e)
  private _onGeomUpBound = (): void => this._onGeomUp()
  private _geomInitRetried = false
  private _geomInitTimer: ReturnType<typeof setTimeout> | null = null
  private _layoutRefreshTimers: ReturnType<typeof setTimeout>[] = []

  private _followWindow = false

  private _panelGeom: { left?: string; top?: string; width?: string; height?: string; maximized?: boolean; followWindow?: boolean } = {}

  connecting = false
  connected = false
  hostInfo = ''

  localPath: string = os.homedir()
  localEntries: LocalEntry[] = []
  localFilter = ''
  localFilterPending = ''
  localFilterVisible = false

  private localClickTimer: ReturnType<typeof setTimeout> | null = null
  localPathInput = this.localPath
  localCache: any = null

  private _selectedLocal: LocalEntry[] = []
  private _localSelectedPaths = new Set<string>()
  get selectedLocal(): LocalEntry[] { return this._selectedLocal }
  set selectedLocal(val: LocalEntry[]) {
    this._selectedLocal = val
    this._localSelectedPaths = new Set(val.map(e => e.fullPath))
  }
  localLastSelectedIndex: number | null = null

  private _localNavFocusKey: string | null = null
  private _localNavAnchorKey: string | null = null

  private _localNavCache: NavCache | null = null

  private _localNavCursorOn = false

  private _lastLocalListedPath: string | null = null

  _localLoading = false

  _localFlash = false

  get _localDragOver(): boolean { return this._fileDnd?.localDragOver ?? false }

  _localError = false

  remotePath = '/'
  remoteEntries: SFTPFile[] = []
  remoteFilter = ''
  remoteFilterPending = ''
  remoteFilterVisible = false

  private remoteClickTimer: ReturnType<typeof setTimeout> | null = null

  private _connLifecycle!: PanelConnectionLifecycle
  remotePathInput = this.remotePath
  remoteCache: any = null

  private _selectedRemote: SFTPFile[] = []
  private _remoteSelectedPaths = new Set<string>()
  get selectedRemote(): SFTPFile[] { return this._selectedRemote }
  set selectedRemote(val: SFTPFile[]) {
    this._selectedRemote = val
    this._remoteSelectedPaths = new Set(val.map(e => e.fullPath))
  }
  remoteLastSelectedIndex: number | null = null

  private _remoteNavFocusKey: string | null = null
  private _remoteNavAnchorKey: string | null = null

  private _remoteNavCache: NavCache | null = null

  private _remoteNavCursorOn = false

  private _lastRemoteListedPath: string | null = null

  _remoteLoading = false

  _remoteFlash = false

  get _remoteDragOver(): boolean { return this._fileDnd?.remoteDragOver ?? false }

  _remoteError = false

  private _rubberBand!: PanelRubberBand
  protected _headerReorder!: PanelHeaderReorder
  private _fileDnd!: PanelFileDnd
  private _fileDropRuntime!: PanelDropAdapter
  private _transferCoordinator!: PanelTransferCoordinator
  private _pasteAdapter!: PanelPasteAdapter
  private readonly localIdResolver = new IdNameResolver()
  private readonly remoteIdResolver = new IdNameResolver()
  private _conflictResolver!: PanelConflictResolver
  private _transferRuntime!: PanelTransferRuntime

  transfers: PanelTransferItem[] = []

  private readonly _remoteNav = new PaneNavHistory(50)
  private _ignoreNavPush = false
  get canRemoteBack(): boolean { return this._remoteNav.canBack && this.connected }
  get canRemoteForward(): boolean { return this._remoteNav.canForward && this.connected }

  private readonly _localNav = new PaneNavHistory(50)

  private _ignoreLocalNavPush = false

  get canLocalBack(): boolean { return this._localNav.canBack }
  get canLocalForward(): boolean { return this._localNav.canForward }

  deleteConfirmVisible = false

  private _deleteBusy = false
  private _inputBusy = false
  deleteConfirmBatch = false

  deleteItemName = ''

  deleteItemLocation = ''
  deleteItemIsDir = false
  deleteItemType = ''
  deleteItemSize: string | null = null
  deleteItemDate = ''

  batchDeleteText = ''

  deleteToTrash = true
  private pendingLocalDelete: LocalEntry[] = []
  private pendingRemoteDelete: SFTPFile[] = []

  inputDialogVisible = false
  inputDialogTitle = ''
  inputDialogPlaceholder = ''
  inputDialogValue = ''
  private inputDialogMode: 'local-mkdir' | 'remote-mkdir' | 'local-rename' | 'remote-rename' | 'remote-chmod' | 'local-touch' | 'remote-touch' | null = null
  private inputDialogTargetPath: string | null = null
  private inputDialogRemotePath: string | null = null

  contextMenuX = 0
  contextMenuY = 0
  contextMenuPane: 'local' | 'remote' = 'local'

  clipboardEntries: (LocalEntry | SFTPFile)[] = []
  clipboardSource: 'local' | 'remote' = 'local'
  clipboardMode: 'copy' | 'cut' = 'copy'

  activePane: 'local' | 'remote' = 'local'

  private _arrowNavPane: 'local' | 'remote' | null = null

  private _typeAheadBuf = ''

  private _typeAheadLastHitPrefix = ''
  private _typeAheadResetTimer: ReturnType<typeof setTimeout> | null = null

  private _typeAheadLastComposeAt = 0
  private static readonly _TYPE_AHEAD_RESET_MS = 800

  detailsVisible = false
  detailsEntry: LocalEntry | SFTPFile | null = null
  detailsIsLocal = false

  detailsCalcState: 'idle' | 'calculating' | 'error' = 'idle'
  detailsCalcResult: string | null = null
  detailsCalcToken = 0

  get contextColVisibility(): ColVisibilityState {
    const isLocal = this.contextMenuPane === 'local'
    const v = (col: string): boolean => isLocal ? this._localColVisible(col) : this._remoteColVisible(col)
    return {
      size: v('size'),
      date: v('date'),
      created: v('created'),
      access: v('access'),
      owner: v('owner'),
      group: v('group'),
      perms: v('perms'),
      mode: v('mode'),
      path: v('path'),
      ext: v('ext'),
    }
  }

  showPermDialog = false
  permOwnerRead = false
  permOwnerWrite = false
  permOwnerExec = false
  permGroupRead = false
  permGroupWrite = false
  permGroupExec = false
  permOtherRead = false
  permOtherWrite = false
  permOtherExec = false
  permModePreview = '755'
  permTargetPath = ''

  permTargetName = ''

  localGroupBy: GroupByMode = 'none'

  remoteGroupBy: GroupByMode = 'none'

  private _localCollapsedGroups = new Set<string>()
  private _remoteCollapsedGroups = new Set<string>()

  private _localCollapsedVersion = 0
  private _remoteCollapsedVersion = 0

  private _localRowsCache: GroupDisplayRow[] | null = null
  private _localRowsSource: any[] | null = null
  private _localRowsSig = ''
  private _remoteRowsCache: GroupDisplayRow[] | null = null
  private _remoteRowsSource: any[] | null = null
  private _remoteRowsSig = ''

  private _loadGroupBy(): void {
    try {
      const keyPrefix = SftpFloatingPanel.TABLE_SETTINGS_KEY
      const gl = localStorage.getItem(`${keyPrefix}.groupByLocal`) as GroupByMode | null
      const gr = localStorage.getItem(`${keyPrefix}.groupByRemote`) as GroupByMode | null
      const valid: GroupByMode[] = ['none', 'name', 'modified', 'type', 'size']
      if (gl && valid.includes(gl)) this.localGroupBy = gl
      if (gr && valid.includes(gr)) this.remoteGroupBy = gr
    } catch {   }
  }

  private _saveGroupBy(pane: 'local' | 'remote'): void {
    try {
      const keyPrefix = SftpFloatingPanel.TABLE_SETTINGS_KEY
      const v = pane === 'local' ? this.localGroupBy : this.remoteGroupBy
      localStorage.setItem(`${keyPrefix}.groupBy${pane === 'local' ? 'Local' : 'Remote'}`, v)
    } catch {   }
  }

  setGroupBy(pane: 'local' | 'remote', mode: GroupByMode): void {
    if (pane === 'local') {
      this.localGroupBy = mode
      this._localCollapsedGroups.clear()
      this._localCollapsedVersion++
    } else {
      this.remoteGroupBy = mode
      this._remoteCollapsedGroups.clear()
      this._remoteCollapsedVersion++
    }
    this._saveGroupBy(pane)
  }

  private _rowsSig(pane: 'local' | 'remote'): string {
    const mode = pane === 'local' ? this.localGroupBy : this.remoteGroupBy
    const asc = pane === 'local' ? this.localSortAsc : this.remoteSortAsc
    const sortBy = pane === 'local' ? this.localSortBy : this.remoteSortBy
    const ver = pane === 'local' ? this._localCollapsedVersion : this._remoteCollapsedVersion
    return `${mode}|${asc ? 1 : 0}|${sortBy}|${ver}`
  }

  getLocalGroupRows(): GroupDisplayRow[] | null {
    if (this.localGroupBy === 'none') return null
    const list = this.getFilteredLocalEntries()
    const sig = this._rowsSig('local')
    if (this._localRowsSource === list && this._localRowsSig === sig && this._localRowsCache) return this._localRowsCache
    const rows = buildGroupedRows(list, this.localGroupBy, this._reverseGroups('local'), this._localCollapsedGroups, b => this._groupLabel(b))
    this._localRowsCache = rows
    this._localRowsSource = list
    this._localRowsSig = sig
    return rows
  }

  getRemoteGroupRows(): GroupDisplayRow[] | null {
    if (this.remoteGroupBy === 'none') return null
    const list = this.getFilteredRemoteEntries()
    const sig = this._rowsSig('remote')
    if (this._remoteRowsSource === list && this._remoteRowsSig === sig && this._remoteRowsCache) return this._remoteRowsCache
    const rows = buildGroupedRows(list, this.remoteGroupBy, this._reverseGroups('remote'), this._remoteCollapsedGroups, b => this._groupLabel(b))
    this._remoteRowsCache = rows
    this._remoteRowsSource = list
    this._remoteRowsSig = sig
    return rows
  }

  private _reverseGroups(pane: 'local' | 'remote'): boolean {
    const mode = pane === 'local' ? this.localGroupBy : this.remoteGroupBy
    const field = groupModeSortField(mode)
    if (!field) return false
    const sortBy = pane === 'local' ? this.localSortBy : this.remoteSortBy
    const asc = pane === 'local' ? this.localSortAsc : this.remoteSortAsc
    return sortBy === field && !asc
  }

  private _groupLabel(b: { labelKey: string; arg?: string }): string {
    const base = this.i18n ? this.i18n.t(b.labelKey) : ''
    if (b.labelKey === 'group.typeFiles') return b.arg ? `${b.arg} ${base}` : base
    return base
  }

  onLocalGroupToggle(key: string): void {
    if (this._localCollapsedGroups.has(key)) this._localCollapsedGroups.delete(key)
    else this._localCollapsedGroups.add(key)
    this._localCollapsedVersion++
  }

  onRemoteGroupToggle(key: string): void {
    if (this._remoteCollapsedGroups.has(key)) this._remoteCollapsedGroups.delete(key)
    else this._remoteCollapsedGroups.add(key)
    this._remoteCollapsedVersion++
  }

  onLocalGroupSelect(key: string): void {
    const rows = this.getLocalGroupRows()
    const g = rows?.find(r => r.kind === 'header' && r.bucketKey === key)
    if (!g) return
    const items = (g.items || []) as any[]
    if (!items.length) return
    const sel = (this.selectedLocal || []) as any[]
    const paths = new Set(items.map((it: any) => it.fullPath))
    const allSelected = items.every((it: any) => sel.some((s: any) => s.fullPath === it.fullPath))
    if (allSelected) {
      this.selectedLocal = sel.filter((s: any) => !paths.has(s.fullPath)) as any
    } else {
      this.selectedLocal = [...items] as any
    }
    this.selectedRemote = []
    this.localLastSelectedIndex = null

    this._localNavFocusKey = navHeaderKey(key)
    this._localNavAnchorKey = this._localNavFocusKey
    this._localNavCursorOn = false
  }

  onRemoteGroupSelect(key: string): void {
    const rows = this.getRemoteGroupRows()
    const g = rows?.find(r => r.kind === 'header' && r.bucketKey === key)
    if (!g) return
    const items = (g.items || []) as any[]
    if (!items.length) return
    const sel = (this.selectedRemote || []) as any[]
    const paths = new Set(items.map((it: any) => it.fullPath))
    const allSelected = items.every((it: any) => sel.some((s: any) => s.fullPath === it.fullPath))
    if (allSelected) {
      this.selectedRemote = sel.filter((s: any) => !paths.has(s.fullPath)) as any
    } else {
      this.selectedRemote = [...items] as any
    }
    this.selectedLocal = []
    this.remoteLastSelectedIndex = null

    this._remoteNavFocusKey = navHeaderKey(key)
    this._remoteNavAnchorKey = this._remoteNavFocusKey
    this._remoteNavCursorOn = false
  }

  onGroupByMenuAction(mode: GroupByMode): void {
    const pane = this.contextMenuPane
    this.setGroupBy(pane, mode)
    this.contextMenuVisible = false
    this._safeDetect()
  }

  onGroupToggleAll(): void {
    const pane = this.contextMenuPane
    const collapsed = pane === 'local' ? this._localCollapsedGroups : this._remoteCollapsedGroups
    const rows = pane === 'local' ? this.getLocalGroupRows() : this.getRemoteGroupRows()
    const keys = (rows || []).filter(r => r.kind === 'header' && r.bucketKey != null).map(r => r.bucketKey as string)

    const allCollapsed = keys.length > 0 && keys.every(k => collapsed.has(k))
    collapsed.clear()
    if (!allCollapsed) for (const k of keys) collapsed.add(k)
    if (pane === 'local') this._localCollapsedVersion++
    else this._remoteCollapsedVersion++
    this.contextMenuVisible = false
    this._safeDetect()
  }

  get groupAllCollapsed(): boolean {
    const pane = this.contextMenuPane
    const collapsed = pane === 'local' ? this._localCollapsedGroups : this._remoteCollapsedGroups
    const rows = pane === 'local' ? this.getLocalGroupRows() : this.getRemoteGroupRows()
    const keys = (rows || []).filter(r => r.kind === 'header' && r.bucketKey != null).map(r => r.bucketKey as string)
    return keys.length > 0 && keys.every(k => collapsed.has(k))
  }

  private loadTableSettings(): void {

    this._loadGroupBy()
    try {

      const keyPrefix = SftpFloatingPanel.TABLE_SETTINGS_KEY
      const borders = localStorage.getItem(`${keyPrefix}.colBorders`)
      const zebra = localStorage.getItem(`${keyPrefix}.zebra`)
      const pinLocal = localStorage.getItem(`${keyPrefix}.pinFoldersLocal`)
      const pinRemote = localStorage.getItem(`${keyPrefix}.pinFoldersRemote`)
      if (borders !== null) this.showColBorders = JSON.parse(borders)
      if (zebra !== null) this.showZebra = JSON.parse(zebra)
      if (pinLocal !== null) this.pinFoldersLocal = JSON.parse(pinLocal)
      if (pinRemote !== null) this.pinFoldersRemote = JSON.parse(pinRemote)
    } catch {   }

    try {
      const keyPrefix = SftpFloatingPanel.TABLE_SETTINGS_KEY
      const hidLocal = localStorage.getItem(`${keyPrefix}.showHiddenLocal`)
      const hidRemote = localStorage.getItem(`${keyPrefix}.showHiddenRemote`)
      const defShow = this._readDefaultShowHidden()
      const newLocal = hidLocal !== null ? JSON.parse(hidLocal) === true : defShow
      const newRemote = hidRemote !== null ? JSON.parse(hidRemote) === true : defShow
      if (newLocal !== this.showHiddenLocal) { this.showHiddenLocal = newLocal; this._invalidateLocalCache() }
      if (newRemote !== this.showHiddenRemote) { this.showHiddenRemote = newRemote; this._invalidateRemoteCache() }
    } catch {   }
  }

  private _base__readDefaultShowHidden(): boolean {
    try {
      return this.configService?.store?.['tabby-sftp-plus-plus']?.defaultShowHidden === true
    } catch { return false }
  }

  get localResizingCol(): string | null {
    return this.resizing && this.resizePane === 'local' ? this.resizeCol : null
  }

  get remoteResizingCol(): string | null {
    return this.resizing && this.resizePane === 'remote' ? this.resizeCol : null
  }

  get localDraggingCol(): string | null {
    return this._headerReorder?.draggingColFor('local') ?? null
  }

  get remoteDraggingCol(): string | null {
    return this._headerReorder?.draggingColFor('remote') ?? null
  }

  get localHeaderPreviewCols(): string[] | null {
    return this._headerReorder?.previewColsFor('local') ?? null
  }

  get remoteHeaderPreviewCols(): string[] | null {
    return this._headerReorder?.previewColsFor('remote') ?? null
  }

  get localHeaderPreviewWidths(): string {
    const preview = this.localHeaderPreviewCols
    return preview ? this._buildColWidths('local', preview) : ''
  }

  get remoteHeaderPreviewWidths(): string {
    const preview = this.remoteHeaderPreviewCols
    return preview ? this._buildColWidths('remote', preview) : ''
  }

  get localDropIndicatorCol(): string | null {
    return this._headerReorder?.dropIndicatorColFor('local') ?? null
  }

  get localDropIndicatorAfter(): boolean {
    return this._headerReorder?.dropIndicatorAfterFor('local') ?? false
  }

  get remoteDropIndicatorCol(): string | null {
    return this._headerReorder?.dropIndicatorColFor('remote') ?? null
  }

  get remoteDropIndicatorAfter(): boolean {
    return this._headerReorder?.dropIndicatorAfterFor('remote') ?? false
  }

  onPaneContextMenu(ev: MouseEvent): void {
    ev.preventDefault()
    ev.stopPropagation()

    this._rubberBand.clearContextMenuSuppress()

    this.headerMenuVisible = false
    this.headerMenuCol = null
    if (this._rubberBand.active) return
    if (this._rubberBand.suppressContextMenu || this._rubberBand.skipNextContextMenu) return

    const target = ev.target as HTMLElement
    const paneList = target.closest('.pane-list') as HTMLElement | null

    const onGroupHeader = !!(target.closest('.entry.header.group-row'))
    if (!target.closest('.entry:not(.header)') && paneList) {

      if (!onGroupHeader) {
        if (paneList.classList.contains('local-pane')) {
          this.selectedLocal = []
          this.localLastSelectedIndex = null
        } else if (paneList.classList.contains('remote-pane')) {
          this.selectedRemote = []
          this.remoteLastSelectedIndex = null
        }
        try { this._safeDetect() } catch {}
      }

      const pane = paneList.classList.contains('local-pane') ? 'local' : 'remote'
      this.contextMenuEntry = null
      this.contextMenuPane = pane
      this.zone.run(() => {
        this.closeBookmarks()
        this.headerMenuVisible = false
        this.contextMenuX = ev.clientX
        this.contextMenuY = ev.clientY
        this.contextMenuVisible = true
        this._safeDetect()
        this.fixContextMenuPosition(ev.clientX, ev.clientY)
      })
      return
    }
  }

  pathMode: PathFollowMode = 'off'
  private static PATH_MODE_KEY = 'sftp-plus-path-mode'
  private static REMEMBER_PATH_KEY = 'sftp-plus-path-mem'
  private static SAVED_LOCAL_PATH_KEY = 'sftp-plus-saved-local-path'
  private static SAVED_REMOTE_PATH_KEY = 'sftp-plus-saved-remote-path'
  private _cwdSyncTimer: ReturnType<typeof setTimeout> | null = null
  private _cwdPolling = false
  private _lastSyncedCwd = ''

  get rememberPath(): boolean {
    return this.pathMode === 'remember'
  }

  private get _hostKey(): string {
    const h = this.profile?.options?.host || ''
    const u = this.profile?.options?.username || this.profile?.options?.user || ''
    return (u ? `${u}@` : '') + h || '__default'
  }

  private _profileKey(base: string): string {
    return `${base}.${this._hostKey}`
  }

  private _base_loadPathMode(): void {
    try {

      const raw = localStorage.getItem(this._profileKey(SftpFloatingPanel.PATH_MODE_KEY))
      if (raw === 'off' || raw === 'remember' || raw === 'sync') {
        this.pathMode = raw as PathFollowMode
        return
      }

      const legacy = localStorage.getItem(this._profileKey(SftpFloatingPanel.REMEMBER_PATH_KEY))
      if (legacy === 'true') {
        this.pathMode = 'remember'
        return
      }
    } catch {   }

    this.pathMode = this._readDefaultPathMode()
  }

  private _base__readDefaultPathMode(): PathFollowMode {
    try {
      const v = this.configService?.store?.['tabby-sftp-plus-plus']?.defaultPathMode
      if (v === 'off' || v === 'remember' || v === 'sync') return v
    } catch { /* ignore */ }
    return 'off'
  }

  private _base__applyDefaultPathMode(): void {
    try {
      const raw = localStorage.getItem(this._profileKey(SftpFloatingPanel.PATH_MODE_KEY))
      if (raw === 'off' || raw === 'remember' || raw === 'sync') return
      const legacy = localStorage.getItem(this._profileKey(SftpFloatingPanel.REMEMBER_PATH_KEY))
      if (legacy === 'true') return
    } catch { return }
    const def = this._readDefaultPathMode()
    if (def === this.pathMode) return
    this.pathMode = def

    if (def === 'sync') {
      this._cwdSetupPrompted = false
      this._startCwdSync()
      void this._syncRemoteToTerminalCwd(true)
    } else {
      this._stopCwdSync()
      this.cwdSetupVisible = false
      this._cwdSetupPrompted = false
    }
    if (def === 'remember') this.saveCurrentPath()
  }

  private _base_savePathMode(): void {
    try {
      localStorage.setItem(this._profileKey(SftpFloatingPanel.PATH_MODE_KEY), this.pathMode)
      localStorage.setItem(
        this._profileKey(SftpFloatingPanel.REMEMBER_PATH_KEY),
        this.pathMode === 'remember' ? 'true' : 'false',
      )
    } catch { /* ignore */ }
  }

  protected _base_saveCurrentPath(): void {
    if (this.pathMode !== 'remember') return
    try {
      localStorage.setItem(this._profileKey(SftpFloatingPanel.SAVED_LOCAL_PATH_KEY), this.localPath)
      localStorage.setItem(this._profileKey(SftpFloatingPanel.SAVED_REMOTE_PATH_KEY), this.remotePath)

      this._paneSet(this._profileKey(SftpFloatingPanel.SAVED_LOCAL_PATH_KEY), this.localPath)
      this._paneSet(this._profileKey(SftpFloatingPanel.SAVED_REMOTE_PATH_KEY), this.remotePath)
    } catch { /* ignore */ }
  }

  _base_pathModeTitle(): string {
    if (this.pathMode === 'remember') return this.i18n.t('path.modeRemember')
    if (this.pathMode === 'sync') return this.i18n.t('path.modeSync')
    return this.i18n.t('path.modeOff')
  }

  _base_cyclePathMode(): void {
    const order: PathFollowMode[] = ['off', 'remember', 'sync']
    const idx = order.indexOf(this.pathMode)
    const next = order[(idx + 1) % order.length]
    this.setPathMode(next)
  }

  private _base_setPathMode(mode: PathFollowMode): void {
    const prev = this.pathMode
    this.pathMode = mode
    this.savePathMode()

    if (mode === 'remember') {
      this.saveCurrentPath()
    } else if (prev === 'remember') {
      try {
        const localKey = this._profileKey(SftpFloatingPanel.SAVED_LOCAL_PATH_KEY)
        const remoteKey = this._profileKey(SftpFloatingPanel.SAVED_REMOTE_PATH_KEY)

        const localNew = this._mapPaneKey(localKey)
        const remoteNew = this._mapPaneKey(remoteKey)
        if (localNew && this.sftpConfig) this.sftpConfig.remove(localNew)
        if (remoteNew && this.sftpConfig) this.sftpConfig.remove(remoteNew)
        try { localStorage.removeItem(localKey) } catch {}
        try { localStorage.removeItem(remoteKey) } catch {}
      } catch { /* ignore */ }
    }

    if (mode === 'sync') {
      this._cwdSetupPrompted = false
      this._startCwdSync()
      void this._syncRemoteToTerminalCwd(true)
    } else {
      this._stopCwdSync()
      this.cwdSetupVisible = false
      this._cwdSetupPrompted = false
    }
  }

  private async _base_tryGetTerminalCwd(): Promise<string | null> {
    try {
      const term = this.terminalRef as {
        session?: {
          supportsWorkingDirectory?: () => boolean
          getWorkingDirectory?: () => Promise<string | null>
          reportedCWD?: string | null
        } | null
      } | null
      const session = term?.session
      if (!session) return null
      if (typeof session.reportedCWD === 'string' && session.reportedCWD) {
        return this._normalizeRemoteCwd(session.reportedCWD)
      }
      if (!session.getWorkingDirectory) return null
      if (session.supportsWorkingDirectory && !session.supportsWorkingDirectory()) return null
      const cwd = await session.getWorkingDirectory()
      if (!cwd || typeof cwd !== 'string') return null
      return this._normalizeRemoteCwd(cwd)
    } catch {
      return null
    }
  }

  private _normalizeRemoteCwd(cwd: string): string {
    const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
    return normalized.startsWith('/') ? normalized : `/${normalized}`
  }

  private _base__startCwdSync(): void {
    if (this._cwdSyncTimer) {
      clearTimeout(this._cwdSyncTimer)
      this._cwdSyncTimer = null
    }
    this._cwdPolling = false
    if (this.pathMode !== 'sync') return
    const tick = (): void => {
      if (this._cwdPolling) {

        this._cwdSyncTimer = setTimeout(tick, 800)
        return
      }
      this._cwdPolling = true
      void this._syncRemoteToTerminalCwd(false).finally(() => {
        this._cwdPolling = false
        if (this.pathMode === 'sync') {
          this._cwdSyncTimer = setTimeout(tick, 800)
        }
      })
    }
    this._cwdSyncTimer = setTimeout(tick, 800)
  }

  private _stopCwdSync(): void {
    if (this._cwdSyncTimer) {
      clearTimeout(this._cwdSyncTimer)
      this._cwdSyncTimer = null
    }
    this._cwdPolling = false
    this._lastSyncedCwd = ''
  }

  cwdSetupVisible = false
  private _cwdSetupPrompted = false

  private async _base__syncRemoteToTerminalCwd(offerSetup: boolean): Promise<void> {
    if (this.pathMode !== 'sync' || !this.connected) return

    const cwd = await this.tryGetTerminalCwd()
    if (!cwd) {
      if (offerSetup && !this.cwdSetupVisible && !this._cwdSetupPrompted) {
        this._cwdSetupPrompted = true
        this.cwdSetupVisible = true
        this._safeDetect()
      }
      return
    }
    this._cwdSetupPrompted = false
    if (!offerSetup && cwd === this._lastSyncedCwd) return
    if (!offerSetup && cwd === this.remotePath) {
      this._lastSyncedCwd = cwd
      return
    }
    this._lastSyncedCwd = cwd
    this.remotePath = cwd
    this.remotePathInput = cwd
    if (offerSetup) this._pushRemoteNav(cwd)
    await this.refreshRemote()
    this._safeDetect()
  }

  async onCwdSetupChoice(choice: CwdSetupChoice): Promise<void> {
    this.cwdSetupVisible = false
    if (choice === 'cancel') {

      this.setPathMode('off')
      this._safeDetect()
      return
    }
    const ok = choice === 'permanent'
      ? await this._enableCwdReporterPermanent()
      : this._enableCwdReporterSession()
    if (!ok) {
      this.showToast(this.i18n.t('path.cwdSetupFailed'))
      this.setPathMode('off')
      this._safeDetect()
      return
    }
    this.showToast(this.i18n.t('path.cwdSetupDone'))
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 200))
      if (this.pathMode !== 'sync') return
      const cwd = await this.tryGetTerminalCwd()
      if (cwd) {
        this._lastSyncedCwd = cwd
        this.remotePath = cwd
        this.remotePathInput = cwd
        this._pushRemoteNav(cwd)
        await this.refreshRemote()
        this._safeDetect()
        return
      }
    }
    this._safeDetect()
  }

  private _base__enableCwdReporterSession(): boolean {
    const term = this.terminalRef as { sendInput?: (data: string) => void } | null
    if (!term?.sendInput) return false
    try {
      if (!sendTerminalCommand(term, CWD_SESSION_CMD)) return false
      return true
    } catch (e) {
      log.warn('Session cwd reporter failed', e)
      return false
    }
  }

  private async _base__enableCwdReporterPermanent(): Promise<boolean> {
    if (!this.sshSession) return false
    const marker = '# tabby-sftp-plus-plus cwd reporting'
    const shellOut = (await execSshCommand(
      this.sshSession,
      'echo "${SHELL:-}"; [ -n "${BASH_VERSION:-}" ] && echo BASH; [ -n "${ZSH_VERSION:-}" ] && echo ZSH; true',
    )).toLowerCase()
    const useZsh = /zsh/.test(shellOut)
    const rcFile = useZsh ? '$HOME/.zshrc' : '$HOME/.bashrc'
    const snippet = useZsh ? CWD_ZSH_SNIPPET + '\n' : CWD_BASH_SNIPPET + '\n'

    log.info(`Enabling permanent CWD reporting — target: ${useZsh ? '~/.zshrc' : '~/.bashrc'}`)

    const b64 = Buffer.from(snippet, 'utf8').toString('base64')
    /* Shell logic (all in one SSH round-trip):
     *  1. Idempotency — if marker already present, skip write entirely.
     *  2. One-time backup — copy rcFile → rcFile.sftp-plus-backup only when
     *     we are about to modify it for the first time.
     *  3. Append the base64-decoded snippet.
     */
    const writeCmd =
      `RC=${rcFile}; ` +
      `if grep -qF '${marker}' "$RC" 2>/dev/null; then ` +
        `echo ALREADY; ` +
      `else ` +
        `cp -p "$RC" "$RC.sftp-plus-backup" 2>/dev/null; ` +
        `echo '${b64}' | base64 -d >> "$RC"; ` +
        `echo WRITTEN; ` +
      `fi`
    const result = await execSshCommand(this.sshSession, writeCmd)
    if (/\bALREADY\b/.test(result)) {
      log.info('CWD reporting already present in rc file — skipped write')
    } else if (/\bWRITTEN\b/.test(result)) {
      log.warn(`Backed up original to ${useZsh ? '~/.zshrc.sftp-plus-backup' : '~/.bashrc.sftp-plus-backup'} and appended CWD reporting snippet`)
    } else {
      log.warn('Unexpected response when writing CWD reporter:', result)
      return false
    }

    const term = this.terminalRef as { sendInput?: (data: string) => void } | null
    if (term?.sendInput) {
      const apply = useZsh
        ? `source ~/.zshrc >/dev/null 2>&1; printf "\\033]1337;CurrentDir=%s\\007" "\${PWD:-\$(pwd)}"\n`
        : `source ~/.bashrc >/dev/null 2>&1; printf "\\033]1337;CurrentDir=%s\\007" "\${PWD:-\$(pwd)}"\n`
      try { sendTerminalCommand(term, apply) } catch {   }
    }
    return true
  }

  private _resolveEffectiveLayout(measuredW?: number, measuredH?: number): {
    split: 'horizontal' | 'vertical' | 'single'
    reason: null | 'too-narrow' | 'too-short' | 'too-cramped'
  } {
    if (this._layoutMode === 'single') return { split: 'single', reason: null }

    const w = typeof measuredW === 'number' && measuredW > 0
      ? measuredW
      : this._measureLayoutWidth()
    let h = typeof measuredH === 'number' && measuredH > 0 ? measuredH : 0
    if (h <= 0) {
      try {
        const body = this.elRef?.nativeElement?.querySelector('.sftp-body') as HTMLElement | null
        if (body) h = this._measureBodySize(body).h
      } catch { /* ignore */ }
    }
    if (h <= 0) h = 480

    const tooNarrow = w < SftpFloatingPanel._HORIZONTAL_FALLBACK_WIDTH
    const tooShort = h < SftpFloatingPanel._VERTICAL_FALLBACK_HEIGHT

    if (this._layoutMode === 'horizontal') {
      if (tooNarrow && tooShort) return { split: 'single', reason: 'too-cramped' }
      if (tooNarrow) return { split: 'vertical', reason: 'too-narrow' }
      return { split: 'horizontal', reason: null }
    }

    if (this._layoutMode === 'vertical') {
      if (tooShort && tooNarrow) return { split: 'single', reason: 'too-cramped' }
      if (tooShort) return { split: 'horizontal', reason: 'too-short' }
      return { split: 'vertical', reason: null }
    }

    if (tooNarrow && tooShort) return { split: 'single', reason: 'too-cramped' }

    if (tooShort) return { split: 'horizontal', reason: null }
    if (tooNarrow || w <= SftpFloatingPanel._AUTO_NARROW_WIDTH) return { split: 'vertical', reason: null }
    return { split: 'horizontal', reason: null }
  }

  private _syncNarrowLayout(measuredW?: number, measuredH?: number): void {
    const { split, reason } = this._resolveEffectiveLayout(measuredW, measuredH)
    this._effectiveLayout = split
    this._layoutOverrideReason = reason
    this._isNarrowLayout = split === 'vertical'
  }

  private _layoutOverrideToastMessage(): string {
    const reason = this._layoutOverrideReason
    if (!reason) return ''
    const key =
      reason === 'too-narrow' ? 'layout.override.tooNarrow'
        : reason === 'too-short' ? 'layout.override.tooShort'
          : 'layout.override.tooCramped'
    return this.i18n.t(key)
  }

  private _maybeAnnounceLayoutOverride(force = false): void {
    const reason = this._layoutOverrideReason

    const shouldTell =
      !!reason &&
      (force || reason !== this._lastAnnouncedOverrideReason) &&
      (this._layoutMode !== 'auto' || reason === 'too-cramped' || force)
    if (!shouldTell) {
      if (!reason) this._lastAnnouncedOverrideReason = null
      return
    }
    this._lastAnnouncedOverrideReason = reason
    const msg = this._layoutOverrideToastMessage()
    if (msg) this.showToast(msg, force ? 4200 : 3200)
  }

  _base_cycleLayoutMode(): void {
    const order: Array<'auto' | 'horizontal' | 'vertical' | 'single'> = ['auto', 'horizontal', 'vertical', 'single']
    const idx = order.indexOf(this._layoutMode)
    this._layoutMode = order[(idx + 1) % order.length]
    try {

      this.sftpConfig?.set('paneState/layout/mode', this._layoutMode)
      const target = this.configService?.store?.['tabby-sftp-plus-plus']
      if (target) { target.layoutMode = this._layoutMode; this.configService?.save() }
    } catch {}
    if (this._layoutMode === 'single') this.activePane = 'remote'
    this._syncNarrowLayout()
    setTimeout(() => {
      this._safeDetect()
      this._applyPaneSplit()
      this._maybeAnnounceLayoutOverride(true)
    }, 50)
    try { window.dispatchEvent(new CustomEvent('sftp-plus-settings-changed')) } catch {}
  }

  private _updateAutoLayout(): void {
    if (this._layoutMode !== 'auto') return
    this._syncNarrowLayout()
  }

  private _measureLayoutWidth(): number {
    const root = this.elRef?.nativeElement as HTMLElement | undefined
    if (!root) return SftpFloatingPanel._AUTO_NARROW_WIDTH

    if (this.displayMode === 'floating') {
      return root.clientWidth > 0 ? root.clientWidth : SftpFloatingPanel._AUTO_NARROW_WIDTH
    }
    const widths: number[] = []
    let el: HTMLElement | null = root
    for (let i = 0; i < 6 && el; i++) {
      if (el.clientWidth > 0) widths.push(el.clientWidth)
      el = el.parentElement
    }
    if (widths.length) return Math.max(...widths)
    return SftpFloatingPanel._AUTO_NARROW_WIDTH
  }

  refreshWorkspaceLayout(): void {
    if (this.displayMode !== 'workspace') return
    this._scheduleLayoutRefresh()
  }

  private _scheduleLayoutRefresh(): void {
    const root = this.elRef?.nativeElement as HTMLElement | undefined
    if (!root) return

    const body = root.querySelector('.sftp-body') as HTMLElement | null
    if (body) {
      const { w, h } = this._measureBodySize(body)
      if (this._layoutMode === 'single') {
        this._effectiveLayout = 'single'
        this._layoutOverrideReason = null
        this._isNarrowLayout = false
      } else {
        this._syncNarrowLayout(w > 0 ? w : undefined, h > 0 ? h : undefined)
      }
      if (
        w === this._lastLayoutBodyW &&
        h === this._lastLayoutBodyH &&
        this._isNarrowLayout === this._lastLayoutNarrow &&
        this._effectiveLayout === this._lastEffectiveLayout &&
        this._layoutOverrideReason === this._lastOverrideReason
      ) return
      this._lastLayoutBodyW = w
      this._lastLayoutBodyH = h
      this._lastLayoutNarrow = this._isNarrowLayout
      this._lastEffectiveLayout = this._effectiveLayout
      this._lastOverrideReason = this._layoutOverrideReason
    } else if (this._layoutMode !== 'single') {
      this._syncNarrowLayout()
    } else {
      this._effectiveLayout = 'single'
      this._layoutOverrideReason = null
      this._isNarrowLayout = false
    }
    this._applyPaneSplit()
    this._maybeAnnounceLayoutOverride(false)
    this._safeDetect()
  }

  private _closeFloatingPanelsOnResize(): void {
    let changed = false
    if (this.showBookmarks) {
      this.closeBookmarks()
      changed = true
    }
    if (this.contextMenuVisible) {
      this.contextMenuVisible = false
      this.contextMenuEntry = null
      changed = true
    }
    if (this.headerMenuVisible) {
      this.headerMenuVisible = false
      this.headerMenuCol = null
      changed = true
    }
    if (changed) this._safeDetect()
  }

  private _bindLayoutObservers(): void {
    const root = this.elRef?.nativeElement as HTMLElement | null
    if (!root) return

    this._ro = new ResizeObserver(() => this._scheduleLayoutRefresh())
    this._ro.observe(root)

    if (this.displayMode === 'workspace') {
      const seen = new Set<HTMLElement>()
      let el: HTMLElement | null = root
      for (let i = 0; i < 6 && el; i++) {
        if (!seen.has(el)) {
          seen.add(el)
          try { this._ro.observe(el) } catch { /* ignore */ }
        }
        el = el.parentElement
      }
    }
    if (!this._winResizeHandler) {
      this._winResizeHandler = () => {
        this._closeFloatingPanelsOnResize()
        this._clampGeometryToParent()
        this._scheduleLayoutRefresh()
      }
      window.addEventListener('resize', this._winResizeHandler)
    }
  }

  private _measureBodySize(body: HTMLElement): { w: number; h: number } {
    let w = body.clientWidth
    let h = body.clientHeight
    if (this.displayMode === 'workspace' && (w <= 0 || h <= 0)) {
      const host = body.closest('sftp-plus-workspace-tab') as HTMLElement | null
      if (host) {
        if (w <= 0) w = host.clientWidth
        if (h <= 0) h = host.clientHeight
      }
    }
    if (w <= 0) w = this._measureLayoutWidth()
    if (h <= 0) h = Math.max(320, (window.innerHeight || 800) - 140)
    return { w, h }
  }

  layoutModeTitle(): string {
    const map: Record<string, string> = {
      auto: this.i18n.t('layout.mode.auto'),
      horizontal: this.i18n.t('layout.mode.horizontal'),
      vertical: this.i18n.t('layout.mode.vertical'),
      single: this.i18n.t('layout.mode.single'),
    }
    const preferred = map[this._layoutMode] || this.i18n.t('layout.mode.auto')
    if (!this._layoutOverrideReason) return preferred
    const actual = map[this._effectiveLayout] || this._effectiveLayout
    const reason =
      this._layoutOverrideReason === 'too-narrow' ? this.i18n.t('layout.override.reasonNarrow')
        : this._layoutOverrideReason === 'too-short' ? this.i18n.t('layout.override.reasonShort')
          : this.i18n.t('layout.override.reasonCramped')
    return this.i18n.t('layout.override.title', { preferred, actual, reason })
  }

  splitterTitle(): string {
    return this._isNarrowLayout
      ? this.i18n.t('pane.splitterHintVertical')
      : this.i18n.t('pane.splitterHintHorizontal')
  }

  private _base__loadSavedPaths(): void {
    this.loadPathMode()
    if (this.pathMode !== 'remember') return
    try {
      const savedLocal = localStorage.getItem(this._profileKey(SftpFloatingPanel.SAVED_LOCAL_PATH_KEY))
      if (savedLocal && typeof savedLocal === 'string') {
        this.localPath = savedLocal; this.localPathInput = savedLocal
      }
      const savedRemote = localStorage.getItem(this._profileKey(SftpFloatingPanel.SAVED_REMOTE_PATH_KEY))
      if (savedRemote && typeof savedRemote === 'string') {
        this.remotePath = savedRemote; this.remotePathInput = savedRemote
      }
    } catch (e) { log.warn('Failed to load saved paths', e) }
  }

  private _base__restoreSavedRemotePath(): void {
    try {
      const savedRemote = this._paneGet(this._profileKey(SftpFloatingPanel.SAVED_REMOTE_PATH_KEY))
      if (savedRemote) {
        this.remotePath = savedRemote
        this.remotePathInput = savedRemote
      }
    } catch {   }
  }

  showTransferLog = false
  transfersMinimized = false
  transfersHidden = false
  paneCustomOrder: Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'> = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']

  paneHiddenItems: string[] = []
  logFilterOp: '' | TransferLogEntry['operation'] = ''
  logFilterStatus: '' | 'success' | 'failed' = ''
  logFilterTimeRange: '' | 'today' | '7d' | '30d' | 'custom' = ''
  logFilterDateFrom = ''
  logFilterDateTo = ''

  showConflictDialog = false
  conflictData: ConflictFileInfo | null = null

  dirMissingVisible = false

  dirMissingDir = ''

  dirMissingIsRemote = false

  dirMissingShowFallback = true

  private _dirMissingResolve: ((c: 'create' | 'fallback' | 'cancel') => void) | null = null

  get conflictFileIconUrl(): string | null {
    const d = this.conflictData
    if (!d) return null
    return this.resolveDetailsIcon({ name: d.fileName, isDirectory: !!d.isDirectory })
  }

  conflictCurrIdx = 1

  conflictTotalIdx = 1

  conflictOriginalTotal = 1

  private _conflictQueue: ConflictQueueItem[] = []

  private _conflictAllMode: string = 'ask'

  _isNarrowLayout = false

  _effectiveLayout: 'horizontal' | 'vertical' | 'single' = 'horizontal'

  _layoutOverrideReason: null | 'too-narrow' | 'too-short' | 'too-cramped' = null
  private _lastAnnouncedOverrideReason: null | 'too-narrow' | 'too-short' | 'too-cramped' = null

  private static readonly _AUTO_NARROW_WIDTH = 960

  private static readonly _HORIZONTAL_FALLBACK_WIDTH = 680

  private static readonly _VERTICAL_FALLBACK_HEIGHT = 360

  _layoutMode: 'auto' | 'horizontal' | 'vertical' | 'single' = 'auto'
  _verticalSplitRatio = 0.5
  _horizontalSplitRatio = 0.5
  private _splitDragStartX = 0
  private _splitDragStartY = 0
  private _splitDragStartRatio = 0.5
  private _splitMoveHandler: ((e: MouseEvent) => void) | null = null
  private _splitUpHandler: ((e: MouseEvent) => void) | null = null

  _cancelRef: { current: any; active?: Set<any> } | null = null

  private _cancelRefs = new Set<{ current: any; active?: Set<any> }>()

  private readonly _dropTmpScope = randomUUID()
  private _remoteDragSession: unknown = null
  private _internalMoveBusy = false

  private _activeDownloadTargets = new Set<string>()

  private _activeUploadTargets = new Set<string>()
  private _splitterDidDrag = false

  constructor(
    protected cdr: ChangeDetectorRef,
    protected elRef: ElementRef,
    protected zone: NgZone,
    private themesService: ThemesService,
    private injector: Injector,
    @Optional() @Inject('BOOTSTRAP_DATA') private bootstrapData?: any,
  ) {
    super()

    try {
      this.configService = injector.get(ConfigService, null as any)
    } catch {

      this.configService = undefined
    }

    try {
      this.sftpConfig = injector.get(SftpConfigService, null as any)
    } catch {
      this.sftpConfig = null
    }

    try {
      this.notifications = injector.get(NotificationsService, null as any)
    } catch {
      this.notifications = null
    }

    this.i18n = new SftpI18nService(this.configService)

    this.bookmarks = new SftpBookmarksService(this.configService)
    this.transferLog = new SftpTransferLogService(this.configService)
    const panel = this
    this._rubberBand = new PanelRubberBand({
      zone: this.zone,
      cdr: this.cdr,
      elRef: this.elRef,
      get selectedLocal() { return panel.selectedLocal },
      set selectedLocal(v) { panel.selectedLocal = v },
      get selectedRemote() { return panel.selectedRemote },
      set selectedRemote(v) { panel.selectedRemote = v },
      get localLastSelectedIndex() { return panel.localLastSelectedIndex },
      set localLastSelectedIndex(v) { panel.localLastSelectedIndex = v },
      get remoteLastSelectedIndex() { return panel.remoteLastSelectedIndex },
      set remoteLastSelectedIndex(v) { panel.remoteLastSelectedIndex = v },
      getFilteredLocalEntries: () => panel.getFilteredLocalEntries(),
      getFilteredRemoteEntries: () => panel.getFilteredRemoteEntries(),
      closeContextMenu: () => panel.closeContextMenu(),
      closeBookmarks: () => panel.closeBookmarks(),
      fixContextMenuPosition: (x, y) => panel.fixContextMenuPosition(x, y),
      get contextMenuX() { return panel.contextMenuX },
      set contextMenuX(v) { panel.contextMenuX = v },
      get contextMenuY() { return panel.contextMenuY },
      set contextMenuY(v) { panel.contextMenuY = v },
      get contextMenuPane() { return panel.contextMenuPane },
      set contextMenuPane(v) { panel.contextMenuPane = v },
      get contextMenuEntry() { return panel.contextMenuEntry },
      set contextMenuEntry(v) { panel.contextMenuEntry = v },
      get contextMenuVisible() { return panel.contextMenuVisible },
      set contextMenuVisible(v) { panel.contextMenuVisible = v },
      get headerMenuVisible() { return panel.headerMenuVisible },
      set headerMenuVisible(v) { panel.headerMenuVisible = v },
      syncPaneSelectionVisual: (p) => panel.syncPaneSelectionVisual(p),
    })
    this._headerReorder = new PanelHeaderReorder({
      cdr: this.cdr,
      elRef: this.elRef,
      get resizing() { return panel.resizing },
      get localVisibleCols() { return panel.localVisibleCols },
      get remoteVisibleCols() { return panel.remoteVisibleCols },
      get localColOrder() { return panel.localColOrder },
      set localColOrder(v) { panel.localColOrder = v },
      get remoteColOrder() { return panel.remoteColOrder },
      set remoteColOrder(v) { panel.remoteColOrder = v },
      saveLocalColSettings: () => panel.saveLocalColSettings(),
      saveRemoteColSettings: () => panel.saveRemoteColSettings(),
      markJustResized: () => { panel._colJustResized = true },
      clearJustResizedSoon: (ms) => { setTimeout(() => { panel._colJustResized = false }, ms ?? 200) },
    })
    this._fileDnd = new PanelFileDnd({
      cdr: this.cdr,
      elRef: this.elRef,
      isHeaderReorderActive: () => !!panel._headerReorder?.active,
      resolveDropDestDir: (ev, side) => panel._resolveDropDestDir(ev, side),
    })
    this._fileDropRuntime = new PanelDropAdapter({
      cdr: this.cdr,
      markViewDirty: () => panel._safeDetect(),

      dropTmpScope: panel._dropTmpScope,
      copyLocalPaths: async (paths, destination) => {
        const entries = await Promise.all(paths.map(async fullPath => { const stat = await fs.lstat(fullPath); return {name:path.basename(fullPath),fullPath,isDirectory:stat.isDirectory(),isSymlink:stat.isSymbolicLink(),size:stat.size,mtimeMs:stat.mtimeMs} }))
        await panel._pasteAdapter.paste(entries,'local',destination,'copy','local')
      },
      moveWithinPane: (payload, side, dest) => panel._moveDroppedEntries(payload, side, dest),
      get connected() { return panel.connected },
      get sftpSession() { return panel.sftpSession },
      get remotePath() { return panel.remotePath },
      get localPath() { return panel.localPath },
      get effectiveLang() { return panel.effectiveLang },
      get i18n() { return panel.i18n },
      get notifications() { return panel.notifications },
      get selectedLocal() { return panel.selectedLocal as any[] },
      set selectedLocal(v) { panel.selectedLocal = v as any },
      get selectedRemote() { return panel.selectedRemote as any[] },
      set selectedRemote(v) { panel.selectedRemote = v as any },
      hasConflictQueue: () => panel._conflictQueue.length > 0,
      resetFileDragState: () => panel._resetFileDragState(),
      uploadPathToRemote: (remoteDir, localPath) => panel.uploadPathToRemote(remoteDir, localPath),
      streamUploadOne: (localPath, destRemoteDir, batch) => panel._streamUploadOne(localPath, destRemoteDir, batch),

      tryUploadBatch: (localPaths, remoteDir) => panel._tryBatchUpload(localPaths, remoteDir),
      streamDownloadOne: (file, targetLocalDir, batch) => panel._streamDownloadOne(file, targetLocalDir, batch),
      refreshLocal: () => panel.refreshLocal(),
      refreshRemote: () => panel.refreshRemote(),
      showConflictDialog: () => panel._showConflictDialog(),
    })
    this._transferCoordinator = new PanelTransferCoordinator({
      get sftpSession() { return panel.sftpSession },

      get sshSession() { return panel.sshSession },
      mtimeToleranceMs: SftpFloatingPanel.MTIME_TOLERANCE_MS,
      get localPath() { return panel.localPath },

      notifyDuplicateTransfer: (displayName: string) => {
        try {
          panel.showToast(panel.i18n.t('notify.duplicateTransfer', { name: displayName }), 4200)
        } catch { /* ignore */ }
      },

      notifyTarChannelFailure: (name: string, code: string, detail: string) => {
        try {
          const reasonKey = TAR_CHANNEL_FAILURE_REASON_KEYS[code] ?? 'tarchan.reason.other'

          const inapplicable = code === 'targetExists'
          panel.showToast(panel.i18n.t(
            inapplicable ? 'notify.tarOnlyInapplicable' : 'notify.tarOnlyFailed',
            { name, reason: panel.i18n.t(reasonKey) },
          ), inapplicable ? 6000 : 7000)
        } catch { /* ignore */ }
        log.warn(`[tar-only] channel ${code === 'targetExists' ? 'not applicable' : 'unusable'} for "${name}" (${code}): ${detail}`)
      },
      enqueueConflict: (item) => {
        panel._conflictQueue.push(item)

        panel.conflictOriginalTotal = Math.max(panel.conflictOriginalTotal, panel._conflictQueue.length)
      },
      showConflictDialog: () => panel._showConflictDialog(),

      scanLocalDir: (p) => panel._scanLocalDir(p),
      scanRemoteDir: (p) => panel._scanRemoteDir(p),
      tarChannelMode: () => panel._transferChannelMode,

      conflictDigestOptions: () => (panel._conflictDigestEnabled ? {
        enabled: true,
        autoSkipSameContent: false,
        maxBytes: panel._conflictDigestMaxSizeMB * 1024 * 1024,
        algo: panel._conflictDigestAlgo,
      } : null),
      downloadTarBall: (remotePath, localPath, size, onProgress, shouldAbort) =>
        panel._downloadTarBall(remotePath, localPath, size, onProgress, shouldAbort),
      startFolderTransfer: (name, direction, remotePath, localPath, totalSize, itemCount, reuseLogEntryId) => {
        const { transferEntry: t, startTime, logEntryId } = panel._startFolderTransfer(
          name, direction, remotePath, localPath, totalSize, itemCount, reuseLogEntryId,
        )
        return { t, startTime, logEntryId, bytesDone: 0, itemDone: 0, session:panel.sftpSession }
      },
      finishFolderTransfer: (ctx, success) => {
        if (ctx.hadConflict && panel._conflictQueue.some(item => item.transferCtx === ctx) && !ctx.t?._aborted) {
          ctx.t.phase = 'waiting'; panel._safeDetect(); return
        }
        panel._finishFolderTransfer(ctx.t, ctx.startTime, ctx.logEntryId, success || (!!ctx.hadConflict && !ctx.failed && !ctx.t?._aborted))
      },
      discardFolderTransfer: (ctx) => {
        panel._transferRuntime.unwatchFolder?.(ctx.t)
        panel.transfers = panel.transfers.filter(x => x !== ctx.t)
        try { panel.transferLog.remove(ctx.logEntryId) } catch { /* ignore */ }
        panel._safeDetect()
      },

      markChannelMode: (ctx, mode) => {
        try {
          panel.transferLog.update(ctx.logEntryId, { transferMode: mode, fileCount: 0 })
        } catch { /* ignore */ }
        try {
          ctx.t.transferMode = mode
          panel._safeDetect()
        } catch { /* ignore */ }
      },
      updateFolderLogSize: (ctx, size) => {
        try { panel.transferLog.update(ctx.logEntryId, { size }) } catch { /* ignore */ }
      },
      updateFolderProgress: (ctx, bytesDone, currentItem, itemDone, currentItemSize) => {
        ctx.t.bytesTransferred = ctx.t.transferMode === 'tar' ? bytesDone : ctx.bytesDone + [...(ctx.liveBytes?.values() || [])].reduce((sum,n)=>sum+n,0)
        panel._updateFolderProgress(ctx.t, bytesDone, currentItem, itemDone, currentItemSize)
      },

      onTransferSkipped: (info) => panel._markTransferAsSkipped(info),
      uploadTopLevel: (remotePath, localPath) => panel._doUpload(remotePath, localPath),
      uploadRaw: (remotePath, localPath, onProgress) => panel._doUploadRaw(remotePath, localPath, onProgress),
      downloadTopLevel: (remotePath, localPath, mode, size) =>
        panel._doDownload(remotePath, localPath, mode, size),
      downloadRaw: (remotePath, localPath, mode, size, onProgress) =>
        panel._doDownloadRaw(remotePath, localPath, mode, size, onProgress),
      refreshRemote: () => panel.refreshRemote(),

      dirUploadConcurrency: () => panel._uploadConcurrency,
      dirDownloadConcurrency: () => panel._downloadConcurrency,
    })
    this._pasteAdapter = new PanelPasteAdapter({
      get sftpSession() { return panel.sftpSession },
      get sshSession() { return panel.sshSession },
      get effectiveLang() { return panel.effectiveLang },
      get i18n() { return panel.i18n },
      get notifications() { return panel.notifications },
      scanLocalDir: (p) => panel._scanLocalDir(p),
      uploadFile: (remotePath, localPath) => panel._doUpload(remotePath, localPath),
      downloadFile: (remotePath, localPath, mode, size) =>
        panel._doDownload(remotePath, localPath, mode, size),
      uploadDirectory: (localSrc, remoteDestParent, batch, moveSource) =>
        panel.uploadPathToRemote(remoteDestParent, localSrc, undefined, batch, moveSource),
      downloadDirectory: (remoteSrc, localDestParent, batch, moveSource) =>
        panel._transferCoordinator.downloadRemoteDir(remoteSrc,localDestParent,undefined,undefined,undefined,batch,moveSource),
      checkRemotePathExists: (remotePath, expectDir) =>
        panel._transferCoordinator.checkRemotePathExists(remotePath, expectDir),
      enqueueConflict: (item) => {
        panel._conflictQueue.push(item)
      },
      showConflictDialog: () => panel._showConflictDialog(),
      getConflictQueueLength: () => panel._conflictQueue.length,
      setConflictOriginalTotal: (count) => { panel.conflictOriginalTotal = count },
      savePendingPaste: (entries, destPane, destPath, mode, source) => {
        panel._pendingPasteEntries = entries as any
        panel._pendingPasteDestPane = destPane
        panel._pendingPasteDestPath = destPath
        panel._pendingPasteMode = mode
        panel._pendingPasteSource = source
      },
      renameRemote: async (src, dest) => {
        if (!panel.sftpSession) return
        await panel.sftpSession.rename(src, dest)
      },
      refreshLocal: () => panel.refreshLocal(),
      refreshRemote: () => panel.refreshRemote(),
    })
    this._conflictResolver = new PanelConflictResolver({
      cleanupMoveFolders: async ctx => {
        for (const folder of [...new Set(ctx.sourceDirectories || [])].sort((a,b)=>b.length-a.length)) {
          try {
            if (ctx.t.direction === 'upload') await fs.rmdir(folder)
            else {
              if (panel.sftpSession !== ctx.session) throw new Error('The SFTP session changed.')
              if ((await panel.sftpSession.readdir(folder)).length) continue
              await (panel.sftpSession as any).rmdir(folder)
            }
          } catch(error:any) { if (!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code) && !/no such file|not empty/i.test(error.message)) throw error }
        }
      },
      notifyConflictError: (name, error) => this.showToast('Could not complete ' + name + ': ' + String((error as any)?.message || error), 7000),
      onConflictResolved: (item, action) => {
        if (item.transferCtx) return
        const queued = this.transfers.filter(row => row.queued && row.remotePath === item.remotePath && row.localPath === item.localPath)
        for (const row of queued) {
          this.transfers = this.transfers.filter(other => other !== row)
          if (row.logEntryId) this.transferLog.update(row.logEntryId, { pending: false, success: false, failReason: 'cancelled', error: action === 'cancel' ? 'Cancelled' : action === 'error' ? 'Transfer failed' : 'Skipped' })
        }
        this._safeDetect()
      },
      cancelBatch: batch => { for (const row of this.transfers.filter(item => item.batch === batch)) this.cancelTransfer(row) },
      get sftpSession() { return panel.sftpSession },
      get cdr() { return panel.cdr },

      isAlive: () => panel._isAlive,
      renameRemote: async (src, dest) => {
        if (!panel.sftpSession) return
        await panel.sftpSession.rename(src, dest)
      },

      get conflictData() { return panel.conflictData },
      set conflictData(v) { panel.conflictData = v },
      get showConflictDialog() { return panel.showConflictDialog },
      set showConflictDialog(v) { panel.showConflictDialog = v },
      get conflictCurrIdx() { return panel.conflictCurrIdx },
      set conflictCurrIdx(v) { panel.conflictCurrIdx = v },
      get conflictTotalIdx() { return panel.conflictTotalIdx },
      set conflictTotalIdx(v) { panel.conflictTotalIdx = v },
      get conflictOriginalTotal() { return panel.conflictOriginalTotal },
      set conflictOriginalTotal(v) { panel.conflictOriginalTotal = v },

      get conflictQueue() { return panel._conflictQueue },
      set conflictQueue(v) { panel._conflictQueue = v },
      get conflictAllMode() { return panel._conflictAllMode as any },
      set conflictAllMode(v) { panel._conflictAllMode = v },
      get conflictResolvedKeys() { return panel._conflictResolvedKeys },
      set conflictResolvedKeys(v) { panel._conflictResolvedKeys = v },

      get selectedLocal() { return panel.selectedLocal },
      set selectedLocal(v) { panel.selectedLocal = v },
      get selectedRemote() { return panel.selectedRemote },
      set selectedRemote(v) { panel.selectedRemote = v },

      get clipboardEntries() { return panel.clipboardEntries as any },
      set clipboardEntries(v) { panel.clipboardEntries = v as any },
      get clipboardSource() { return panel.clipboardSource },
      set clipboardSource(v) { panel.clipboardSource = v },
      get clipboardMode() { return panel.clipboardMode },
      set clipboardMode(v) { panel.clipboardMode = v },
      get pendingPasteEntries() { return panel._pendingPasteEntries as any },
      set pendingPasteEntries(v) { panel._pendingPasteEntries = v as any },
      get pendingPasteDestPane() { return panel._pendingPasteDestPane },
      set pendingPasteDestPane(v) { panel._pendingPasteDestPane = v },
      get pendingPasteDestPath() { return panel._pendingPasteDestPath },
      set pendingPasteDestPath(v) { panel._pendingPasteDestPath = v },
      get pendingPasteMode() { return panel._pendingPasteMode },
      set pendingPasteMode(v) { panel._pendingPasteMode = v },
      get pendingPasteSource() { return panel._pendingPasteSource },
      set pendingPasteSource(v) { panel._pendingPasteSource = v },

      refreshRemote: () => panel.refreshRemote(),
      refreshLocal: () => panel.refreshLocal(),
      executePaste: (entries, destPane, destPath, mode, source, resolvedKeys) =>
        panel._pasteAdapter.executePaste(entries as any, destPane, destPath, mode, source, resolvedKeys),

      doDownload: (remotePath, localPath, mode, size, progress) => progress ? panel._doDownloadRaw(remotePath,localPath,mode,size,progress) : panel._doDownload(remotePath,localPath,mode,size),
      doUpload: (remotePath, localPath, progress) => progress ? panel._doUploadRaw(remotePath,localPath,progress) : panel._doUpload(remotePath,localPath),
      downloadRemoteDir: (remoteDir, localDestDir, targetPane, top, renameTo, forceOverwrite) =>
        panel._transferCoordinator.downloadRemoteDir(remoteDir, localDestDir, top, renameTo, forceOverwrite),

      mergeLocalDirToRemote: (localSrc, remoteDest, reuseLogEntryId) =>
        panel._transferCoordinator.mergeLocalDirToRemote(localSrc, remoteDest, reuseLogEntryId),

      updateFolderProgress:(ctx,bytes,name,done,size)=>{ ctx.t.bytesTransferred=ctx.bytesDone+[...(ctx.liveBytes?.values()||[])].reduce((sum,n)=>sum+n,0); panel._updateFolderProgress(ctx.t,bytes,name,done,size) },
      markTransferSucceeded: (ctx) => { if (!ctx.producing) panel._finishFolderTransfer(ctx.t, ctx.startTime, ctx.logEntryId, !ctx.failed) },
      discardTransferLog: (ctx) => {
        if (ctx.producing) return
        panel._transferRuntime.unwatchFolder?.(ctx.t)
        panel.transfers = panel.transfers.filter(item => item !== ctx.t)
        panel._safeDetect()
        try { panel.transferLog.remove(ctx.logEntryId) } catch { /* ignore */ }
      },
      copyLocalDir: (src, dest) => copyLocalDir(src, dest),
      scanLocalDir: (p) => panel._scanLocalDir(p),
      scanRemoteDir: (p) => panel._scanRemoteDir(p),
      computeConflictDigests: (args) => panel._computeConflictDigests(args),
      shouldAutoSkipSameContent: () =>
        false,
      notifyConflictAutoSkipped: (fileName) => {
        try {
          const tip = panel.i18n.t('transfer.skippedAsDuplicate')
          panel.showToast(`${fileName} — ${tip}`)
        } catch {
          panel.showToast(`${fileName}: skipped (same content)`)
        }
      },
      copyRemoteDir: (srcRemotePath, destRemotePath, isDirectory) => copyRemoteDir(
        srcRemotePath, destRemotePath, isDirectory, {
          hasSession: () => !!panel.sftpSession,
          mkdir: async (p) => { await panel.sftpSession!.mkdir(p) },
          readdir: async (p) => {
            const entries = await panel.sftpSession!.readdir(p)
            return entries.map(e => ({
              name: e.name,
              isDirectory: !!e.isDirectory,
              isSymbolicLink: !!(e as any).isSymlink || !!(e as any).isSymbolicLink,
            }))
          },
          download: (r, l) => panel._doDownload(r, l),
          upload: (r, l) => panel._doUpload(r, l),
          tryServerCopy: (src, dest, isDir) =>
            tryRemoteCpViaSsh(panel.sshSession, src, dest, isDir),
        },
      ),
    })
    this._transferRuntime = new PanelTransferRuntime({
      get connected() { return panel.connected },
      get sftpSession() { return panel.sftpSession },
      get transfers() { return panel.transfers },
      set transfers(v) { panel.transfers = v },
      get transferLog() { return panel.transferLog },
      get profile() { return panel.profile },
      get effectiveLang() { return panel.effectiveLang },
      get notifications() { return panel.notifications },
      get cdr() { return panel.cdr },
      detectChanges: () => panel._safeDetect(),
      get zone() { return panel.zone },
      formatSpeed: (bytes, ms) => panel._formatSpeed(bytes, ms),
    })

    this.loadLocalColSettings()
    this.loadRemoteColSettings()
    this.loadTableSettings()
    this.loadLocalColWidths()
    this.loadRemoteColWidths()

  }

  protected _paneGet(key: string, def?: any): any {
    const newPath = this._mapPaneKey(key)
    if (newPath && this.sftpConfig) {
      const val = this.sftpConfig.get(newPath)
      if (val !== undefined) return val
    }

    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return raw
    } catch {}
    return def
  }

  protected _paneSet(key: string, val: any): void {
    const newPath = this._mapPaneKey(key)
    if (newPath && this.sftpConfig) {
      this.sftpConfig.set(newPath, val)
    } else {

      try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)) } catch {}
    }
  }

  private _mapPaneKey(key: string): string | null {
    const perHostPrefixes = [
      'sftp-plus-path-mode.',
      'sftp-plus-path-mem.',
      'sftp-plus-saved-local-path.',
      'sftp-plus-saved-remote-path.',
    ]
    for (const prefix of perHostPrefixes) {
      if (key.startsWith(prefix)) {
        const host = key.substring(prefix.length)
        const fieldMap: Record<string, string> = {
          'sftp-plus-path-mode.': 'pathMode',
          'sftp-plus-path-mem.': 'rememberPath',
          'sftp-plus-saved-local-path.': 'savedLocalPath',
          'sftp-plus-saved-remote-path.': 'savedRemotePath',
        }
        return `paneState/perHost/${host}/${fieldMap[prefix]}`
      }
    }
    const keyMap: Record<string, string> = {
      'sftp-plus-layout-mode': 'paneState/layout/mode',
      'sftp-plus-settings.layoutMode': 'paneState/layout/mode',
      'sftp-plus-horizontal-split-ratio': 'paneState/layout/horizontalSplitRatio',
      'sftp-plus-vertical-split-ratio': 'paneState/layout/verticalSplitRatio',
      'sftp-plus-local-sort': 'paneState/local/sort',
      'sftp-plus-local-cols': 'paneState/local/cols',
      'sftp-plus-local-cols-order': 'paneState/local/colsOrder',
      'sftp-plus-remote-sort': 'paneState/remote/sort',
      'sftp-plus-remote-cols': 'paneState/remote/cols',
      'sftp-plus-remote-cols-order': 'paneState/remote/colsOrder',
      'sftp-plus-local-col-widths': 'paneState/local/colWidths',
      'sftp-plus-remote-col-widths': 'paneState/remote/colWidths',
      'sftp-plus-pane-custom-order': 'paneCustomOrder',
      'sftp-plus-pane-hidden-items': 'paneHiddenItems',
    }
    return keyMap[key] || null
  }

  private _base__loadPaneToolbarLayout(): void {
    try {
      const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
      if (Array.isArray(cfg?.paneCustomOrder) && cfg.paneCustomOrder.length) {
        this.paneCustomOrder = cfg.paneCustomOrder as any
      } else if (Array.isArray(cfg?.paneHeaderOrder) && Array.isArray(cfg?.paneToolbarOrder)) {
        const header = cfg.paneHeaderOrder as Array<'label' | 'path' | 'toolbar'>
        const toolbar = cfg.paneToolbarOrder as Array<'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark'>
        const items: any[] = []
        for (const part of header) {
          if (part === 'toolbar') items.push(...toolbar)
          else items.push(part)
        }
        this.paneCustomOrder = items as any
      }

      this.paneCustomOrder = this._ensureHiddenItem(this.paneCustomOrder)

      if (Array.isArray(cfg?.paneHiddenItems)) {
        this.paneHiddenItems = cfg.paneHiddenItems as string[]
      }
      return
    } catch { /* ignore */ }
    try {
      const raw = this._paneGet('sftp-plus-pane-custom-order')
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (Array.isArray(parsed) && parsed.length) this.paneCustomOrder = parsed as any
      }
      this.paneCustomOrder = this._ensureHiddenItem(this.paneCustomOrder)
      const hiddenRaw = this._paneGet('sftp-plus-pane-hidden-items')
      if (hiddenRaw) {
        const parsed = typeof hiddenRaw === 'string' ? JSON.parse(hiddenRaw) : hiddenRaw
        if (Array.isArray(parsed)) this.paneHiddenItems = parsed as string[]
      }
    } catch { /* ignore */ }
  }

  private _ensureHiddenItem(order: Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'>): Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'> {

    if (order.join(',') === 'label,back,forward,up,refresh,home,path,filter,bookmark,hidden') {
      return ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
    }
    if (order.includes('hidden')) return order
    const next = [...order]
    const idx = next.indexOf('filter')
    next.splice(idx >= 0 ? idx : next.length, 0, 'hidden')
    return next
  }

  private _paneFlushToConfig(): void {
    this.sftpConfig?.flush()
  }

  protected override _paneFlush(): void {
    this._paneFlushToConfig()
  }

  get effectiveLang(): Locale {
    return this.i18n.getLocale()
  }

  pluginUpdate = { available: false, checking: false, updating: false, restartRequired: false, version: '', error: '' }
  private _stopPluginUpdates?: () => void
  private _pluginUpdater: any

  async updatePlugin(): Promise<void> {
    if (!this._pluginUpdater) return
    let host: HostAppService | null = null
    try { host = this.injector.get(HostAppService, null as any) } catch { /* unsupported host */ }
    if (!host || typeof host.relaunch !== 'function') { this.showToast('Tabby restart API is unavailable.'); return }
    const ok = await this.zone.runOutsideAngular(() => this._pluginUpdater.update(() => host!.relaunch()))
    if (!ok && this._pluginUpdater.state.error) this.showToast(this._pluginUpdater.state.error, 8000)
  }

  _base_ngOnInit(): void {
    this._pluginUpdater = getPluginUpdater(path.resolve(__dirname, '..'))
    this._stopPluginUpdates = this.zone.runOutsideAngular(() => this._pluginUpdater.subscribe((state: any) => {
      if (!this._destroyed) { this.pluginUpdate = state; this._safeDetect() }
    }, () => panelHasWork(this)))
    const panel = this
    this._connLifecycle = new PanelConnectionLifecycle({
      get sshSession() { return panel.sshSession },
      set sshSession(v) { panel.sshSession = v },
      get sftpSession() { return panel.sftpSession },
      set sftpSession(v) { panel.sftpSession = v },
      get connected() { return panel.connected },
      set connected(v) { panel.connected = v },
      get connecting() { return panel.connecting },
      set connecting(v) { panel.connecting = v },
      get reconnecting() { return panel.reconnecting },
      set reconnecting(v) { panel.reconnecting = v },
      get pathMode() { return panel.pathMode },
      get remotePath() { return panel.remotePath },
      set remotePath(v) { panel.remotePath = v },
      get remotePathInput() { return panel.remotePathInput },
      set remotePathInput(v) { panel.remotePathInput = v },
      get terminalRef() { return panel.terminalRef },
      sftpService: this.sftpService,
      notifications: this.notifications,
      getI18n: () => panel.i18n,
      zone: this.zone,
      cdr: this.cdr,
      getDefaultRemotePath: () => panel.getDefaultRemotePath(),
      refreshRemote: () => panel.refreshRemote(),
      restoreSavedRemotePath: () => panel._restoreSavedRemotePath(),
      tryGetTerminalCwd: () => panel.tryGetTerminalCwd(),
      pushRemoteNav: (p) => panel._pushRemoteNav(p),
      clearNavHistory: () => {
        panel._remoteNav.clear()
        panel._localNav.clear()
      },
      clearRemoteListing: () => panel.clearRemoteListing(),
      setRemoteLoading: (loading) => { panel._remoteLoading = loading },
      isAlive: () => panel._isAlive,
      abortInFlightTransfers: () => {
        try { panel.clearTransfers() } catch { /* ignore */ }
      },

      hasActiveTransfers: () => {
        try { return panel.transfers.length > 0 } catch { return false }
      },
    })

    this._loadSavedPaths()
    this._cwdSetupPrompted = false
    if (this.pathMode === 'sync') this._startCwdSync()

    this._pushLocalNav(this.localPath)

    void this.refreshLocal()

    if (this.profile?.options?.host) {
      const user = this.profile.options.username || this.profile.options.user || ''
      this.hostInfo = user ? `${user}@${this.profile.options.host}` : this.profile.options.host
    }
    if (this.sshSession) {
      void this.connect()
    }

    try {

      const vsaved = this._paneGet('sftp-plus-vertical-split-ratio')
      if (vsaved) this._verticalSplitRatio = Math.max(0.15, Math.min(0.85, parseFloat(vsaved) || 0.5))
      const hsaved = this._paneGet('sftp-plus-horizontal-split-ratio')
      if (hsaved) this._horizontalSplitRatio = Math.max(0.15, Math.min(0.85, parseFloat(hsaved) || 0.5))

      const lmode = this.sftpConfig?.get('paneState/layout/mode')
      if (lmode === 'horizontal' || lmode === 'vertical' || lmode === 'single') this._layoutMode = lmode

      this._bindLayoutObservers()
    } catch {   }

    this._applyAutoTheme()
    this._applyFontSize()
    this._loadPaneToolbarLayout()
    this._readBehaviorConfig()

    this._themeSub = this.themesService.themeChanged$.subscribe(() => {
      this._applyAutoTheme()
    })

    this._settingsChangedHandler = () => {
      this.loadLocalColSettings()
    this.loadRemoteColSettings()
      this.loadTableSettings()
      this.loadLocalColWidths()
    this.loadRemoteColWidths()

      this.i18n = new SftpI18nService(this.configService)

      this.bookmarks.reload()
      this.transferLog.reload()
      this._loadPaneToolbarLayout()
      this._readBehaviorConfig()

      this._applyDefaultPathMode()

      const lmode = this.sftpConfig?.get('paneState/layout/mode')
      if (lmode === 'horizontal' || lmode === 'vertical' || lmode === 'single') this._layoutMode = lmode
      else this._layoutMode = 'auto'
      if (this._layoutMode === 'single') {
        this._effectiveLayout = 'single'
        this._layoutOverrideReason = null
        this._isNarrowLayout = false
      } else {
        const bodyEl = this.elRef?.nativeElement?.querySelector('.sftp-body') as HTMLElement | null
        if (bodyEl) {
          const { w, h } = this._measureBodySize(bodyEl)
          this._syncNarrowLayout(w > 0 ? w : undefined, h > 0 ? h : undefined)
        } else {
          this._syncNarrowLayout()
        }
      }
      this._applyPaneSplit()
      this._maybeAnnounceLayoutOverride(true)
      this._applyAutoTheme()
      this._applyFontSize()
      this._safeDetect()
      this.cdr.markForCheck()
    }
    window.addEventListener('sftp-plus-settings-changed', this._settingsChangedHandler)

    this._docClickCapture = (ev: MouseEvent) => {
      // Early return: skip expensive DOM queries when no popup/menu is open
      if (!this.showBookmarks && !this.contextMenuVisible && !this.headerMenuVisible
        && !this.localFilterVisible && !this.remoteFilterVisible) return
      const target = ev.target as HTMLElement | null
      const clickedInFilterUi = !!(target?.closest('.pane-filters') || target?.closest('.filter-toggle-btn'))
      let changed = false
      if (!clickedInFilterUi) {
        if (this.localFilterVisible && !this.localFilterPending.trim()) {
          this.localFilterVisible = false
          changed = true
        }
        if (this.remoteFilterVisible && !this.remoteFilterPending.trim()) {
          this.remoteFilterVisible = false
          changed = true
        }
      }
      if (this.showBookmarks) {
        if (this._bookmarkJustOpened) return
        if (!target?.closest('.bookmark-popup') && !target?.closest('.bm-btn')) {
          this.zone.run(() => {
            this.closeBookmarks()
            if (changed) this._safeDetect()
          })
          return
        }
      }
      if (this.contextMenuVisible) {
        if (!target?.closest('.context-menu')) {
          this.zone.run(() => {
            this.contextMenuVisible = false
            this._safeDetect()
          })
          return
        }
      }
      if (this.headerMenuVisible) {
        if (!target?.closest('.context-menu')) {
          this.zone.run(() => {
            this.headerMenuVisible = false
            this._safeDetect()
          })
          return
        }
      }
      if (changed) {
        this.zone.run(() => this._safeDetect())
      }
    }
    document.addEventListener('click', this._docClickCapture, true)

    this._beforeUnloadFlush = () => {
      try { this._paneFlushToConfig() } catch { /* ignore */ }
      try {
        if (this.displayMode !== 'workspace') this._persistPanelGeometry()
      } catch { /* ignore */ }
    }
    window.addEventListener('beforeunload', this._beforeUnloadFlush)

    this._docWheelCapture = (ev: WheelEvent) => {
      if (!this.showBookmarks && !this.contextMenuVisible && !this.headerMenuVisible) return
      const target = ev.target as HTMLElement | null
      if (this.showBookmarks) {
        if (target?.closest('.bookmark-popup')) return
      }
      if (this.contextMenuVisible) {
        if (target?.closest('.context-menu')) return
      }
      if (this.headerMenuVisible) {
        if (target?.closest('.context-menu')) return
      }

      this.zone.run(() => {
        if (this.showBookmarks) this.closeBookmarks()
        if (this.contextMenuVisible) this.contextMenuVisible = false
        if (this.headerMenuVisible) this.headerMenuVisible = false
        this._safeDetect()
      })
    }
    document.addEventListener('wheel', this._docWheelCapture, true)

    this.zone.runOutsideAngular(() => {
      this._termKeyShieldKeydown = (ev: KeyboardEvent) => this._shieldTerminalClipboardKeys(ev)
      this._termKeyShieldPaste = (ev: Event) => this._shieldTerminalPaste(ev as ClipboardEvent)

      this._panelHotkeyCaptureKeydown = (ev: KeyboardEvent) => this._capturePanelHotkeysBeforeTabby(ev)
      window.addEventListener('keydown', this._termKeyShieldKeydown, true)
      window.addEventListener('keydown', this._panelHotkeyCaptureKeydown, true)
      window.addEventListener('paste', this._termKeyShieldPaste, true)

      this._panelFocusMouseDownCapture = (ev: MouseEvent) => this._handlePanelPointerFocus(ev)
      this._panelFocusInGuard = (ev: FocusEvent) => this._onPanelFocusInGuard(ev)
      this._panelWindowFocusGuard = () => this._onPanelWindowFocusGuard()
      const host = this.elRef?.nativeElement as HTMLElement | undefined
      host?.addEventListener('mousedown', this._panelFocusMouseDownCapture, true)
      document.addEventListener('focusin', this._panelFocusInGuard, true)
      window.addEventListener('focus', this._panelWindowFocusGuard)
    })
  }

  _base_ngAfterViewInit(): void {

    this._applyAutoTheme()

    this._scheduleLayoutRefresh()
    if (this.displayMode === 'workspace') {
      this._layoutRefreshTimers.push(setTimeout(() => this._scheduleLayoutRefresh(), 0))
      this._layoutRefreshTimers.push(setTimeout(() => this._scheduleLayoutRefresh(), 120))
    }

    if (this.displayMode !== 'workspace') {
      this._loadPanelGeometry()
      this._initPanelGeometry()
    }
  }

  _base_ngOnDestroy(): void {
    if (this._folderProgressDetect) clearTimeout(this._folderProgressDetect)
    this._stopPluginUpdates?.()
    this._destroyed = true

    this._cancelRemoteDragCache()
    this._clearCustomDragPreview()
    this._fileDnd?.reset()
    this._headerReorder?.dispose()
    this._rubberBand.dispose()
    this.clearTransfers()
    this._transferRuntime.dispose()
    if (this._geomInitTimer) {
      clearTimeout(this._geomInitTimer)
      this._geomInitTimer = null
    }
    for (const t of this._layoutRefreshTimers) {
      clearTimeout(t)
    }
    this._layoutRefreshTimers = []
    if (this._splitMoveHandler) {
      document.removeEventListener('mousemove', this._splitMoveHandler)
      this._splitMoveHandler = null
    }
    if (this._splitUpHandler) {
      document.removeEventListener('mouseup', this._splitUpHandler)
      this._splitUpHandler = null
    }

    this.disposeColResize()

    document.removeEventListener('mousemove', this._onGeomMoveBound)
    document.removeEventListener('mouseup', this._onGeomUpBound)
    this.saveCurrentPath()

    if (this.displayMode !== 'workspace') {
      try { this._persistPanelGeometry() } catch { /* ignore */ }
    }
    this._stopCwdSync()
    this.cwdSetupVisible = false
    this._cwdSetupPrompted = false
    this._paneFlushToConfig()
    this.disconnect()
    this._clearPanelTimers()
    if (this._docClickCapture) {
      document.removeEventListener('click', this._docClickCapture, true)
      this._docClickCapture = null
    }
    if (this._beforeUnloadFlush) {
      window.removeEventListener('beforeunload', this._beforeUnloadFlush)
      this._beforeUnloadFlush = null
    }
    if (this._docWheelCapture) {
      document.removeEventListener('wheel', this._docWheelCapture, true)
      this._docWheelCapture = null
    }
    if (this._termKeyShieldKeydown) {
      window.removeEventListener('keydown', this._termKeyShieldKeydown, true)
      this._termKeyShieldKeydown = null
    }
    if (this._panelHotkeyCaptureKeydown) {
      window.removeEventListener('keydown', this._panelHotkeyCaptureKeydown, true)
      this._panelHotkeyCaptureKeydown = null
    }
    if (this._termKeyShieldPaste) {
      window.removeEventListener('paste', this._termKeyShieldPaste, true)
      this._termKeyShieldPaste = null
    }
    if (this._panelFocusMouseDownCapture) {
      const host = this.elRef?.nativeElement as HTMLElement | undefined
      host?.removeEventListener('mousedown', this._panelFocusMouseDownCapture, true)
      this._panelFocusMouseDownCapture = null
    }
    if (this._panelFocusInGuard) {
      document.removeEventListener('focusin', this._panelFocusInGuard, true)
      this._panelFocusInGuard = null
    }
    if (this._panelWindowFocusGuard) {
      window.removeEventListener('focus', this._panelWindowFocusGuard)
      this._panelWindowFocusGuard = null
    }
    this._clearPanelFocusStealTimers()
    this._panelFocusWantedUntil = 0
    this._panelOwnsClipboardHotkeys = false
    if (this._themeSub) { this._themeSub.unsubscribe(); this._themeSub = null }
    if (this._settingsChangedHandler) {
      window.removeEventListener('sftp-plus-settings-changed', this._settingsChangedHandler)
    }
    if (this.localClickTimer) clearTimeout(this.localClickTimer)
    if (this.remoteClickTimer) clearTimeout(this.remoteClickTimer)
    this._clearTypeAhead()

    this._transferRuntime.clearTransfers()

    if (this._ro) {
      try { this._ro.disconnect() } catch {}
      this._ro = null
    }
    if (this._winResizeHandler) {
      window.removeEventListener('resize', this._winResizeHandler)
      this._winResizeHandler = null
    }

    void fs.rm(path.join(os.tmpdir(), 'sftp-plus-dragout'), { recursive: true, force: true }).catch(() => {})

    void fs.rm(dragDropTempDir(this._dropTmpScope), { recursive: true, force: true }).catch(() => {})

    if (this._openPathKeyupHandler) {
      window.removeEventListener('keyup', this._openPathKeyupHandler, true)
      this._openPathKeyupHandler = null
    }
    if (this._openPathTimeoutId) {
      clearTimeout(this._openPathTimeoutId)
      this._openPathTimeoutId = null
    }
    void this._cleanupEditorTemp()
    void this._cleanupViewerTemp()

    void this._cleanupSystemOpenTempFiles()
  }

  private _settingsChangedHandler: (() => void) | null = null
  private _themeSub: any = null
  private _docClickCapture: ((ev: MouseEvent) => void) | null = null
  private _beforeUnloadFlush: (() => void) | null = null
  private _docWheelCapture: ((ev: WheelEvent) => void) | null = null

  private _termKeyShieldKeydown: ((ev: KeyboardEvent) => void) | null = null
  private _panelHotkeyCaptureKeydown: ((ev: KeyboardEvent) => void) | null = null

  private _pointerHotkeyLastFire = 0

  private static readonly _POINTER_WHEEL_THROTTLE_MS = 150
  private _termKeyShieldPaste: ((ev: Event) => void) | null = null

  private _panelFocusMouseDownCapture: ((ev: MouseEvent) => void) | null = null
  private _panelFocusInGuard: ((ev: FocusEvent) => void) | null = null
  private _panelWindowFocusGuard: (() => void) | null = null
  private _panelFocusWantedUntil = 0
  private _panelFocusStealTimers: ReturnType<typeof setTimeout>[] = []

  private _panelOwnsClipboardHotkeys = false
  private _ro: ResizeObserver | null = null

  private _lastLayoutBodyW = -1
  private _lastLayoutBodyH = -1
  private _lastEffectiveLayout: 'horizontal' | 'vertical' | 'single' | '' = ''
  private _lastOverrideReason: null | 'too-narrow' | 'too-short' | 'too-cramped' | undefined = undefined
  private _lastLayoutNarrow = false
  private _winResizeHandler: (() => void) | null = null

  autoDetectedThemeName = ''

  private _base__applyFontSize(): void {
    const el = this.elRef?.nativeElement as HTMLElement | undefined
    if (!el) return
    let size = 13
    try {
      const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
      const raw = Number(cfg?.fontSize)
      if (Number.isFinite(raw)) size = Math.max(11, Math.min(18, Math.round(raw)))
    } catch { /* keep default */ }

    el.style.setProperty('--sftp-font-size', `${size}px`)
    el.style.setProperty('--_fs', `${size}px`)
  }

  private _base__applyAutoTheme(): void {
    const el = this.elRef.nativeElement as HTMLElement

    let themeValue = ''
    let themePrimary = ''
    let themeBg = ''
    let themeText = ''
    let themeBorder = ''
    try {
      const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
      if (cfg?.theme) {
        themeValue = cfg.theme
        themePrimary = cfg.colorPrimary || ''
        themeBg = cfg.colorBg || ''
        themeText = cfg.colorText || ''
        themeBorder = cfg.colorBorder || ''
      } else {
        const raw = this._paneGet('sftp-plus-settings.theme')
        themeValue = raw ? JSON.parse(raw) : ''
        if (themeValue) {
          themePrimary = this._paneGet('sftp-plus-settings.primaryColor')
          themeBg = this._paneGet('sftp-plus-settings.bgColor')
          themeText = this._paneGet('sftp-plus-settings.textColor')
          themeBorder = this._paneGet('sftp-plus-settings.borderColor')
          try {
            if (themePrimary) themePrimary = JSON.parse(themePrimary)
            if (themeBg) themeBg = JSON.parse(themeBg)
            if (themeText) themeText = JSON.parse(themeText)
            if (themeBorder) themeBorder = JSON.parse(themeBorder)
          } catch {}
        }
      }
    } catch { /* use empty */ }

    const vars = ['--_bg','--_text','--_primary','--_border','--_content','--_surface','--_hover','--_active','--_input-bg','--_scroll-track','--_scroll-thumb','--_scroll-thumb-hover']
    const hasPreset = !!themeValue

    if (hasPreset && themePrimary && themeBg && themeText) {

      el.style.setProperty('--_bg', themeBg, 'important')
      el.style.setProperty('--_text', themeText, 'important')
      el.style.setProperty('--_primary', themePrimary, 'important')
      el.style.setProperty('--_border', themeBorder || 'rgba(128,128,128,0.2)', 'important')
      el.style.setProperty('--_content', themeBg, 'important')

      const isDark = isColorDark(themeBg)
      if (isDark) {
        el.style.setProperty('--_surface', 'rgba(255,255,255,0.06)', 'important')
        el.style.setProperty('--_hover', 'rgba(255,255,255,0.12)', 'important')
        el.style.setProperty('--_active', 'rgba(255,255,255,0.18)', 'important')
        el.style.setProperty('--_input-bg', 'rgba(255,255,255,0.06)', 'important')
        el.style.setProperty('--_scroll-track', 'rgba(255,255,255,0.05)', 'important')
        el.style.setProperty('--_scroll-thumb', 'rgba(255,255,255,0.2)', 'important')
        el.style.setProperty('--_scroll-thumb-hover', 'rgba(255,255,255,0.35)', 'important')
      } else {
        el.style.setProperty('--_surface', 'rgba(0,0,0,0.04)', 'important')
        el.style.setProperty('--_hover', 'rgba(0,0,0,0.08)', 'important')
        el.style.setProperty('--_active', 'rgba(0,0,0,0.12)', 'important')
        el.style.setProperty('--_input-bg', 'rgba(0,0,0,0.04)', 'important')
        el.style.setProperty('--_scroll-track', 'rgba(0,0,0,0.04)', 'important')
        el.style.setProperty('--_scroll-thumb', 'rgba(0,0,0,0.18)', 'important')
        el.style.setProperty('--_scroll-thumb-hover', 'rgba(0,0,0,0.3)', 'important')
      }
      this.autoDetectedThemeName = ''
      return
    }

    if (hasPreset) {

      vars.forEach(v => el.style.removeProperty(v))
      this.autoDetectedThemeName = ''
      return
    }

    let bodyBg = '#1e1e2e'
    try {
      const computedStyle = getComputedStyle(document.documentElement)
      const cssBg = computedStyle.getPropertyValue('--body-bg').trim()
      if (cssBg && cssBg !== '') {
        bodyBg = cssBg
      } else {

        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        bodyBg = prefersDark ? '#1e1e2e' : '#ffffff'
      }
    } catch {

      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      bodyBg = prefersDark ? '#1e1e2e' : '#ffffff'
    }

    let r = 30, g = 30, b = 46
    if (bodyBg.startsWith('rgb')) {
      const match = bodyBg.match(/\d+/g)
      if (match && match.length >= 3) { r = +match[0]; g = +match[1]; b = +match[2] }
    } else {
      const hex = bodyBg.replace('#', '')
      r = parseInt(hex.substring(0, 2), 16) || 30
      g = parseInt(hex.substring(2, 4), 16) || 30
      b = parseInt(hex.substring(4, 6), 16) || 46
    }

    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const isDark = lum < 128

    this.autoDetectedThemeName = isDark ? 'dark' : 'light'

    if (isDark) {
      const bg = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
      el.style.setProperty('--_bg', bg, 'important')
      el.style.setProperty('--_text', '#e8edf5', 'important')
      el.style.setProperty('--_primary', '#b6b6c3', 'important')
      el.style.setProperty('--_border', '#2d3242', 'important')
      el.style.setProperty('--_content', bg, 'important')
      el.style.setProperty('--_surface', 'rgba(255,255,255,0.06)', 'important')
      el.style.setProperty('--_hover', 'rgba(255,255,255,0.12)', 'important')
      el.style.setProperty('--_active', 'rgba(255,255,255,0.18)', 'important')
      el.style.setProperty('--_input-bg', 'rgba(255,255,255,0.06)', 'important')
      el.style.setProperty('--_scroll-track', 'rgba(255,255,255,0.05)', 'important')
      el.style.setProperty('--_scroll-thumb', 'rgba(255,255,255,0.2)', 'important')
      el.style.setProperty('--_scroll-thumb-hover', 'rgba(255,255,255,0.35)', 'important')
    } else {
      el.style.setProperty('--_bg', '#ffffff', 'important')
      el.style.setProperty('--_text', '#333333', 'important')
      el.style.setProperty('--_primary', '#2563eb', 'important')
      el.style.setProperty('--_border', '#d1d5db', 'important')
      el.style.setProperty('--_content', '#ffffff', 'important')
      el.style.setProperty('--_surface', 'rgba(0,0,0,0.04)', 'important')
      el.style.setProperty('--_hover', 'rgba(0,0,0,0.08)', 'important')
      el.style.setProperty('--_active', 'rgba(0,0,0,0.12)', 'important')
      el.style.setProperty('--_input-bg', 'rgba(0,0,0,0.04)', 'important')
      el.style.setProperty('--_scroll-track', 'rgba(0,0,0,0.04)', 'important')
      el.style.setProperty('--_scroll-thumb', 'rgba(0,0,0,0.18)', 'important')
      el.style.setProperty('--_scroll-thumb-hover', 'rgba(0,0,0,0.3)', 'important')
    }

    this._safeDetect()
  }

  private _formatSpeed(bytes: number, ms: number): string {
    if (bytes <= 0 || ms <= 0) return ''
    const bps = (bytes / ms) * 1000
    if (bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + ' MB/s'
    if (bps >= 1024) return (bps / 1024).toFixed(1) + ' KB/s'
    return Math.round(bps) + ' B/s'
  }

  _base_close(): void {

    if (this.transfers.length > 0) {
      const msg = this.i18n.t('notify.closeWithTransfers', { count: this.transfers.length })
      if (!confirm(msg)) return

      this.clearTransfers()
    }
    this.saveCurrentPath()
    if (this.displayMode !== 'workspace') {
      this.disconnect()
    }
    this.onClose?.()
  }

  private _base__readBehaviorConfig(): void {
    try {
      const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
      if (cfg?.closeBookmarkPanelOnSelect !== undefined) {
        this.closeBookmarkPanelOnSelect = !!cfg.closeBookmarkPanelOnSelect
      }
      if (cfg?.bookmarkPanelGroupByScope !== undefined) {
        this.bookmarkPanelGroupByScope = cfg.bookmarkPanelGroupByScope !== false
      }
      if (Array.isArray(cfg?.bookmarkPanelGroupOrder) && cfg.bookmarkPanelGroupOrder.length) {
        const valid = (cfg.bookmarkPanelGroupOrder as string[]).filter(
          (x): x is 'connection' | 'global' => x === 'connection' || x === 'global',
        )
        if (valid.includes('connection') && valid.includes('global')) {
          this.bookmarkPanelGroupOrder = [valid[0], valid.find(x => x !== valid[0])!]
        }
      }

      const fmt = typeof cfg?.dateFormat === 'string' ? cfg.dateFormat.trim() : ''
      if (fmt !== getDateFormatPattern()) {
        setDateFormatPattern(fmt)
        this._invalidateLocalCache()
        this._invalidateRemoteCache()
      }

      const up = Number(cfg?.transferUploadConcurrency)
      const dl = Number(cfg?.transferDownloadConcurrency)
      this._uploadConcurrency = this._clampConcurrency(Number.isFinite(up) ? up : 3)
      this._downloadConcurrency = this._clampConcurrency(Number.isFinite(dl) ? dl : 3)

      const legacy = (cfg as any)?.transferTarAcceleration
      if ((cfg as any)?.transferChannelMode && ['smart', 'sftpOnly', 'tarOnly', 'preferSftp', 'preferTar'].includes((cfg as any).transferChannelMode)) {
        this._transferChannelMode = (cfg as any).transferChannelMode
      } else if (legacy === false) {
        this._transferChannelMode = 'sftpOnly'
      } else {
        this._transferChannelMode = 'smart'
      }

      this._conflictDigestEnabled = cfg?.conflictDigestEnabled !== false
      this._conflictAutoSkipSameContent = cfg?.conflictAutoSkipSameContent !== false

      const digestMaxMB = Number(cfg?.conflictDigestMaxSizeMB)
      this._conflictDigestMaxSizeMB = Number.isFinite(digestMaxMB) && digestMaxMB > 0
        ? Math.min(4096, Math.max(1, Math.floor(digestMaxMB)))
        : 256
      this._conflictDigestAlgo = cfg?.conflictDigestAlgo === 'sha256' ? 'sha256' : 'sha1'
      this._pumpUploadQueue()
      this._pumpDownloadQueue()
    } catch { /* ignore */ }
  }

  private _clampConcurrency(v: number): number {
    if (!Number.isFinite(v)) return 3
    return Math.min(10, Math.max(1, Math.round(v)))
  }

  private _base__loadPanelGeometry(): void {
    try {
      const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
      let g = cfg?.panelGeometry

      if ((!g || typeof g !== 'object' || !(g.width || g.height)) && typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem('sftp-plus-panel-geometry')
          if (raw) g = JSON.parse(raw)
        } catch { /* ignore */ }
      }
      if (g && typeof g === 'object') {
        this._panelGeom = {
          left: typeof g.left === 'string' ? g.left : undefined,
          top: typeof g.top === 'string' ? g.top : undefined,
          width: typeof g.width === 'string' ? g.width : undefined,
          height: typeof g.height === 'string' ? g.height : undefined,
          maximized: !!g.maximized,
          followWindow: !!g.followWindow,
        }
      }
    } catch { /* ignore */ }
  }

  private _base__persistPanelGeometry(): void {
    if (!this.configService?.store && typeof localStorage === 'undefined') return
    try {

      const g = (this.panelMaximized && this._prevGeom)
        ? this._prevGeom
        : {
            left: this._hostEl?.style.left || '',
            top: this._hostEl?.style.top || '',
            width: this._hostEl?.style.width || '',
            height: this._hostEl?.style.height || '',
          }

      const payload = {
        left: this._toPct(g.left as string, 'x'),
        top: this._toPct(g.top as string, 'y'),
        width: this._toPct(g.width as string, 'w'),
        height: this._toPct(g.height as string, 'h'),
        maximized: !!this.panelMaximized,

        followWindow: true,
      }
      this._panelGeom = { ...payload }

      if (this.configService?.store) {
        if (!this.configService.store['tabby-sftp-plus-plus']) {
          this.configService.store['tabby-sftp-plus-plus'] = {}
        }
        const target = this.configService.store['tabby-sftp-plus-plus']
        target.panelGeometry = payload
        try { this.configService.save() } catch (e) {
          log.warn('[panel-geom] configService.save failed:', e)
        }
      }
      try {
        localStorage.setItem('sftp-plus-panel-geometry', JSON.stringify(payload))
      } catch { /* ignore */ }
    } catch (e) {
      log.warn('[panel-geom] persist failed:', e)
    }
  }

  private _toPct(v: string | undefined, axis: 'x' | 'y' | 'w' | 'h'): string {
    if (!v) return ''
    if (v.includes('%')) return v
    const host = this._hostEl
    const parent = host?.offsetParent as HTMLElement | null
    if (!host || !parent) return v
    const pr = parent.getBoundingClientRect()
    const px = parseFloat(v)
    if (!Number.isFinite(px)) return v
    const base = (axis === 'x' || axis === 'w') ? pr.width : pr.height
    if (base <= 0) return v
    return (px / base * 100).toFixed(2) + '%'
  }

  private _pctOr(v: string | undefined, fallback: string): string {
    return (typeof v === 'string' && v.includes('%')) ? v : fallback
  }

  private _isPctGeom(g: { width?: string; height?: string }): boolean {
    return (typeof g.width === 'string' && g.width.includes('%')) ||
           (typeof g.height === 'string' && g.height.includes('%'))
  }

  _base_minimize(): void {
    this.saveCurrentPath()
    this.minimized = true
    this.onMinimize?.()
  }

  private _initPanelGeometry(): void {
    const host = this.elRef.nativeElement as HTMLElement
    this._hostEl = host
    const parent = host.offsetParent as HTMLElement | null
    if (!parent) {

      if (!this._geomInitRetried) {
        this._geomInitRetried = true
        this._geomInitTimer = setTimeout(() => this._initPanelGeometry(), 50)
      }
      return
    }
    const r = host.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    host.style.position = 'absolute'
    const saved = this._panelGeom
    if (saved.maximized) {

      this._prevGeom = {
        left: this._pctOr(saved.left, '2%'),
        top: this._pctOr(saved.top, '3%'),
        width: this._pctOr(saved.width, '96%'),
        height: this._pctOr(saved.height, '94%'),
        followWindow: true,
      }
      host.style.left = '0px'
      host.style.top = '0px'
      host.style.width = '100%'
      host.style.height = '100%'
      this.panelMaximized = true
    } else if (!saved.width || !saved.height || this._isPctGeom(saved)) {

      this._followWindow = true
      host.style.left = this._pctOr(saved.left, '2%')
      host.style.top = this._pctOr(saved.top, '3%')
      host.style.width = this._pctOr(saved.width, '96%')
      host.style.height = this._pctOr(saved.height, '94%')
    } else {

      this._followWindow = false
      let w = parseFloat(saved.width as string) || r.width
      let h = parseFloat(saved.height as string) || r.height
      let left = saved.left != null ? parseFloat(saved.left) : (r.left - pr.left)
      let top = saved.top != null ? parseFloat(saved.top) : (r.top - pr.top)
      w = Math.max(this._geomMinW, Math.min(w, pr.width))
      h = Math.max(this._geomMinH, Math.min(h, pr.height))
      left = Math.min(Math.max(0, left), pr.width - w)
      top = Math.min(Math.max(0, top), pr.height - h)
      host.style.left = left + 'px'
      host.style.top = top + 'px'
      host.style.width = w + 'px'
      host.style.height = h + 'px'
    }
    this.panelDraggable = true
    this._safeDetect()
  }

  private _applyDefaultGeometry(): void {
    const host = this._hostEl
    if (!host) return
    host.style.left = '2%'
    host.style.top = '3%'
    host.style.width = '96%'
    host.style.height = '94%'
    this._followWindow = true
    this.panelMaximized = false
    this._prevGeom = null
    this._safeDetect()
    this._scheduleLayoutRefresh()
  }

  private _convertFollowToPx(): void {
    const host = this._hostEl
    const parent = host?.offsetParent as HTMLElement | null
    if (!host || !parent) return
    const r = host.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    host.style.left = (r.left - pr.left) + 'px'
    host.style.top = (r.top - pr.top) + 'px'
    host.style.width = r.width + 'px'
    host.style.height = r.height + 'px'
    this._followWindow = false
  }

  private _clampGeometryToParent(): void {
    if (this.displayMode === 'workspace' || this.panelMaximized || this._followWindow) return
    if (this._resizing || this.panelDragging) return
    const host = this._hostEl
    const parent = host?.offsetParent as HTMLElement | null
    if (!host || !parent) return

    if (host.style.width.includes('%') || host.style.height.includes('%')) return
    const pr = parent.getBoundingClientRect()
    let w = parseFloat(host.style.width) || host.offsetWidth
    let h = parseFloat(host.style.height) || host.offsetHeight
    let left = parseFloat(host.style.left) || 0
    let top = parseFloat(host.style.top) || 0
    w = Math.max(this._geomMinW, Math.min(w, pr.width))
    h = Math.max(this._geomMinH, Math.min(h, pr.height))
    left = Math.min(Math.max(0, left), Math.max(0, pr.width - w))
    top = Math.min(Math.max(0, top), Math.max(0, pr.height - h))
    host.style.left = left + 'px'
    host.style.top = top + 'px'
    host.style.width = w + 'px'
    host.style.height = h + 'px'
  }

  onTopBarMouseDown(e: MouseEvent): void {
    if (this.displayMode === 'workspace' || this.panelMaximized || !this.panelDraggable) return

    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('button, input, a, .disconnect-indicator, .reconnect-btn')) return
    const host = this._hostEl
    if (!host) return

    if (this._followWindow) this._convertFollowToPx()
    e.preventDefault()
    const r = host.getBoundingClientRect()
    this._dragOffsetX = e.clientX - r.left
    this._dragOffsetY = e.clientY - r.top
    this._dragStartClientX = e.clientX
    this._dragStartClientY = e.clientY

    this._dragThresholdPassed = false
    this.panelDragging = false
    this._safeDetect()

    document.removeEventListener('mousemove', this._onGeomMoveBound)
    document.removeEventListener('mouseup', this._onGeomUpBound)
    document.addEventListener('mousemove', this._onGeomMoveBound)
    document.addEventListener('mouseup', this._onGeomUpBound)
  }

  onResizeStart(e: MouseEvent, dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'): void {
    if (this.displayMode === 'workspace' || this.panelMaximized || !this.panelDraggable) return
    const host = this._hostEl
    const parent = host?.offsetParent as HTMLElement | null
    if (!host || !parent) return

    if (this._followWindow) this._convertFollowToPx()
    e.preventDefault()
    e.stopPropagation()
    const r = host.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    this._resizing = true
    this._resizeDir = dir
    this._resizeStart = { left: r.left - pr.left, top: r.top - pr.top, w: r.width, h: r.height, mx: e.clientX, my: e.clientY }
    this.panelResizing = true
    this._safeDetect()

    document.removeEventListener('mousemove', this._onGeomMoveBound)
    document.removeEventListener('mouseup', this._onGeomUpBound)
    document.addEventListener('mousemove', this._onGeomMoveBound)
    document.addEventListener('mouseup', this._onGeomUpBound)
  }

  private _onGeomMove(e: MouseEvent): void {
    const host = this._hostEl
    const parent = host?.offsetParent as HTMLElement | null
    if (!host || !parent) return
    const pr = parent.getBoundingClientRect()
    if (this._resizing && this._resizeDir) {
      const dx = e.clientX - this._resizeStart.mx
      const dy = e.clientY - this._resizeStart.my
      let left = this._resizeStart.left
      let top = this._resizeStart.top
      let w = this._resizeStart.w
      let h = this._resizeStart.h
      const dir = this._resizeDir
      if (dir.includes('e')) w = this._resizeStart.w + dx
      if (dir.includes('s')) h = this._resizeStart.h + dy
      if (dir.includes('w')) { w = this._resizeStart.w - dx; left = this._resizeStart.left + dx }
      if (dir.includes('n')) { h = this._resizeStart.h - dy; top = this._resizeStart.top + dy }
      w = Math.max(this._geomMinW, Math.min(w, pr.width))
      h = Math.max(this._geomMinH, Math.min(h, pr.height))
      left = Math.min(Math.max(0, left), pr.width - w)
      top = Math.min(Math.max(0, top), pr.height - h)
      host.style.left = left + 'px'
      host.style.top = top + 'px'
      host.style.width = w + 'px'
      host.style.height = h + 'px'

      this._scheduleLayoutRefresh()
    } else {

      if (!this._dragThresholdPassed) {
        const dx = Math.abs(e.clientX - this._dragStartClientX)
        const dy = Math.abs(e.clientY - this._dragStartClientY)
        if (dx < 4 && dy < 4) return
        this._dragThresholdPassed = true
        this.panelDragging = true
        this._safeDetect()
      }
      let nx = e.clientX - pr.left - this._dragOffsetX
      let ny = e.clientY - pr.top - this._dragOffsetY
      nx = Math.min(Math.max(0, nx), pr.width - host.offsetWidth)
      ny = Math.min(Math.max(0, ny), pr.height - host.offsetHeight)
      host.style.left = nx + 'px'
      host.style.top = ny + 'px'
    }
  }

  private _onGeomUp(): void {
    document.removeEventListener('mousemove', this._onGeomMoveBound)
    document.removeEventListener('mouseup', this._onGeomUpBound)
    this._resizing = false
    this._resizeDir = null
    this.panelDragging = false
    this.panelResizing = false
    this._safeDetect()

    this._persistPanelGeometry()

    this._followWindow = true
  }

  toggleMaximize(): void {
    if (this.displayMode === 'workspace' || !this.panelDraggable) return
    const host = this._hostEl
    if (!host) return
    if (!this.panelMaximized) {
      this._prevGeom = {
        left: host.style.left,
        top: host.style.top,
        width: host.style.width,
        height: host.style.height,
        followWindow: this._followWindow,
      }
      host.style.left = '0px'
      host.style.top = '0px'
      host.style.width = '100%'
      host.style.height = '100%'
      this.panelMaximized = true
    } else {
      if (this._prevGeom) {
        host.style.left = this._prevGeom.left
        host.style.top = this._prevGeom.top
        host.style.width = this._prevGeom.width
        host.style.height = this._prevGeom.height
        this._followWindow = !!this._prevGeom.followWindow
      }
      this.panelMaximized = false

      if (this._layoutMode === 'single') {
        this._isNarrowLayout = false
        this.activePane = 'remote'
      } else {
        this._syncNarrowLayout()
      }
      void host.offsetHeight
      this._applyPaneSplit()
    }
    this._safeDetect()
    this._scheduleLayoutRefresh()
    this._persistPanelGeometry()
  }

  openPluginSettings(): void {
    this.zone.run(() => {
      try {
        const app = this.injector.get(AppService)
        openSftpPlusSettings(app)
      } catch (e) {
        log.error('openPluginSettings failed', e)
      }
    })
  }

  async _base_connect(): Promise<void> {
    await this._connLifecycle.connect()
    if (this.pathMode === 'sync' && this.connected) {
      this._startCwdSync()
      void this._syncRemoteToTerminalCwd(true)
    }
  }

  _base_disconnect(): void {
    this._stopCwdSync()
    this._connLifecycle?.disconnect()
  }

  onReconnect(): Promise<void> {
    return this._reconnectKeepingSync()
  }

  private async _reconnectKeepingSync(): Promise<void> {
    await this._connLifecycle.reconnect()
    if (this.pathMode === 'sync' && this.connected) {
      this._cwdSetupPrompted = false
      this._startCwdSync()
      void this._syncRemoteToTerminalCwd(true)
    }
  }

  clearRemoteListing(): void {

    this._remoteRefreshGen++
    this.remoteEntries = []
    this._remoteError = false
    this._invalidateRemoteCache()
    this.remoteIdResolver.reset()

    this._dropSelection('remote')
    this._lastRemoteListedPath = null
  }

  private _clearPanelTimers(): void {
    if (this.toastTimer) { clearTimeout(this.toastTimer); this.toastTimer = null }
    if (this._remoteLoadingTimer) { clearTimeout(this._remoteLoadingTimer); this._remoteLoadingTimer = null }
    if (this._remoteFlashTimer) { clearTimeout(this._remoteFlashTimer); this._remoteFlashTimer = null }
    if (this._localFlashTimer) { clearTimeout(this._localFlashTimer); this._localFlashTimer = null }
    this._clearQueuedEntryTimers()
  }

  private _scheduleQueuedEntryRemoval(entry: PanelTransferItem, delayMs = 4000): void {
    const timer = setTimeout(() => {
      this._queuedEntryTimers = this._queuedEntryTimers.filter(t => t !== timer)
      if (!this._isAlive) return
      this._removeQueuedEntry(entry)
    }, delayMs)
    this._queuedEntryTimers.push(timer)
  }

  private _clearQueuedEntryTimers(): void {
    for (const timer of this._queuedEntryTimers) clearTimeout(timer)
    this._queuedEntryTimers = []
  }

  async mergeLocalDirToRemote(localSrc: string, remoteDest: string, reuseLogEntryId?: string): Promise<boolean> {

    const cancelRef = { current: null as any, active: new Set<any>() }
    this._cancelRefs.add(cancelRef)
    const prevRef = this._cancelRef
    this._cancelRef = cancelRef
    try {
      return await runInTaskScope(cancelRef, () =>
        this._transferCoordinator.mergeLocalDirToRemote(localSrc, remoteDest, reuseLogEntryId))
    } finally {
      this._cancelRefs.delete(cancelRef)
      if (this._cancelRef === cancelRef) this._cancelRef = prevRef
      if (this._cancelRef && !this._cancelRef.current && !(this._cancelRef.active?.size)) this._cancelRef = null
    }
  }

  private _remoteEnrichOptions(): SftpEnrichOptions {
    const wantOwner = this.remoteShowColOwner || this.remoteShowColGroup
    return {
      atime: this.remoteShowColAccess,
      ownerGroup: wantOwner,
      statFallback: false,
    }
  }

  private _remoteNeedsEnrich(): boolean {
    return this.remoteShowColAccess
      || this.remoteShowColOwner
      || this.remoteShowColGroup
  }

  private async _enrichRemoteMetadata(
    snapshotPath: string,
    baseEntries: SFTPFile[],
    refreshGen: number,
  ): Promise<void> {
    if (!this.connected || !this.sftpSession || this.remotePath !== snapshotPath) return
    if (refreshGen !== this._remoteRefreshGen) return

    let entries = baseEntries
    if (this._remoteNeedsEnrich()) {
      entries = await enrichSftpFilesWithAtime(
        this.sftpSession, snapshotPath, baseEntries, this._remoteEnrichOptions(),
      )
      if (!this.connected || this.remotePath !== snapshotPath || refreshGen !== this._remoteRefreshGen) return
      this.zone.run(() => {
        if (refreshGen !== this._remoteRefreshGen || snapshotPath !== this.remotePath) return
        this.remoteEntries = entries
        this._invalidateRemoteCache()
        this._safeDetect()
      })
    }

    const wantOwner = this.remoteShowColOwner || this.remoteShowColGroup

    const hugeDir = entries.length > SftpFloatingPanel.REMOTE_LISTING_ENRICH_LIMIT
    if (wantOwner && !this.remoteIdResolver.remoteExecDisabled && !hugeDir) {
      entries = await enrichRemoteOwnersViaStat(this.sftpSession, entries)
      if (!this.connected || this.remotePath !== snapshotPath || refreshGen !== this._remoteRefreshGen) return
      this.zone.run(() => {
        if (refreshGen !== this._remoteRefreshGen || snapshotPath !== this.remotePath) return
        this.remoteEntries = entries
        this._invalidateRemoteCache()
        this._safeDetect()
      })
    }

    if (!wantOwner || !this.sshSession) return
    await this.remoteIdResolver.ensureUidMap(this.sshSession)
    if (!this.connected || this.remotePath !== snapshotPath || refreshGen !== this._remoteRefreshGen) return
    const named = this.applyRemoteOwnerGroupNames(entries)
    this.zone.run(() => {
      if (!this.connected || this.remotePath !== snapshotPath || refreshGen !== this._remoteRefreshGen) return
      this.remoteEntries = named
      this._invalidateRemoteCache()
      this._safeDetect()
    })
  }

  private _base_getDefaultRemotePath(): string {
    return '/'
  }

  private applyRemoteOwnerGroupNames(entries: SFTPFile[]): SFTPFile[] {
    const r = this.remoteIdResolver
    return entries.map(e => {
      const ownerUid = e.ownerUid ?? this.numericIdFromLabel(e.owner)
      const groupGid = e.groupGid ?? this.numericIdFromLabel(e.group)
      const ownerLabel = this.nonNumericLabel(e.owner)
      const groupLabel = this.nonNumericLabel(e.group)
      return {
        ...e,
        ownerUid,
        groupGid,
        owner: r.ownerName(ownerLabel, ownerUid),
        group: r.groupName(groupLabel, groupGid),
      }
    })
  }

  private nonNumericLabel(v: unknown): string | undefined {
    if (v == null) return undefined
    const s = String(v).trim()
    return s && !/^\d+$/.test(s) ? s : undefined
  }

  private numericIdFromLabel(v: unknown): number | undefined {
    if (v == null) return undefined
    const s = String(v).trim()
    if (!/^\d+$/.test(s)) return undefined
    const n = parseInt(s, 10)
    return Number.isNaN(n) ? undefined : n
  }

  localNavigationReturnPath = ''
  remoteNavigationReturnPath = ''
  private _navigationMemories: Partial<Record<'local' | 'remote', NavigationMemory>> = {}
  private _navigationPendingReturn: Partial<Record<'local' | 'remote', { folder: string; scope: unknown; item?: string }>> = {}

  private _navigationScope(side: 'local' | 'remote'): unknown {
    if (side === 'local') return 'local'
    const profile = this.profile || this.terminalRef?.profile
    const options = profile?.options
    return options?.host || profile?.id ? JSON.stringify([profile?.id, options?.host, options?.port, options?.username || options?.user]) : this.sftpSession
  }

  private _navigationMemory(side: 'local' | 'remote'): NavigationMemory {
    this._navigationMemories ||= {}
    return this._navigationMemories[side] ||= new NavigationMemory(fileListPolicy.navigationMemoryLimit)
  }

  private _rememberNavigationItem(side: 'local' | 'remote', entry: { fullPath?: string }): void {
    const folder = side === 'local' ? this.localPath : this.remotePath
    const api = side === 'local' ? path : path.posix
    if (!folder || !entry?.fullPath || api.resolve(api.dirname(entry.fullPath)) !== api.resolve(folder)) return
    const memory = this._navigationMemory(side); memory.activate(this._navigationScope(side)); memory.remember(folder, entry.fullPath)
    this._navigationPendingReturn ||= {}; delete this._navigationPendingReturn[side]
    if (side === 'local') { this.localNavigationReturnPath = entry.fullPath; this._localNavFocusKey = entry.fullPath }
    else { this.remoteNavigationReturnPath = entry.fullPath; this._remoteNavFocusKey = entry.fullPath }
  }

  private _prepareNavigationReturn(side: 'local' | 'remote', previous: string | null, folder: string): boolean {
    const memory = this._navigationMemory(side), scope = this._navigationScope(side), changedScope = memory.activate(scope)
    if (!changedScope && previous === folder) return false
    const api = side === 'local' ? path : path.posix
    if (!changedScope && previous) {
      const focus = side === 'local' ? this._localNavFocusKey : this._remoteNavFocusKey
      const selected = side === 'local' ? this.selectedLocal : this.selectedRemote
      const item = focus && !focus.startsWith('\u0000') ? focus : selected[selected.length - 1]?.fullPath
      if (item && api.resolve(api.dirname(item)) === api.resolve(previous)) memory.remember(previous, item)
    }
    const item = memory.get(folder) || (!changedScope && previous && api.resolve(api.dirname(previous)) === api.resolve(folder) ? previous : undefined)
    this._navigationPendingReturn ||= {}; this._navigationPendingReturn[side] = { folder, scope, item }
    if (side === 'local') this.localNavigationReturnPath = ''
    else this.remoteNavigationReturnPath = ''
    return true
  }

  private _restoreNavigationReturn(side: 'local' | 'remote', folder: string): void {
    const pending = this._navigationPendingReturn?.[side]
    if (!pending || pending.folder !== folder || pending.scope !== this._navigationScope(side) || this._destroyed) return
    delete this._navigationPendingReturn[side]
    const list: Array<{ fullPath: string }> = side === 'local' ? this.getFilteredLocalEntries() : this.getFilteredRemoteEntries()
    const entry = pending.item && list.find(e => e.fullPath === pending.item)
    if (!entry) return
    const rows = side === 'local' ? this.getLocalGroupRows() : this.getRemoteGroupRows()
    const group = rows?.find(row => row.kind === 'header' && row.collapsed && row.items?.some(e => e.fullPath === entry.fullPath))
    if (group?.bucketKey) {
      if (side === 'local') { this._localCollapsedGroups.delete(group.bucketKey); this._localCollapsedVersion++ }
      else { this._remoteCollapsedGroups.delete(group.bucketKey); this._remoteCollapsedVersion++ }
    }
    if (side === 'local') {
      this.selectLocal(entry as LocalEntry, {} as MouseEvent, list.indexOf(entry))
      this._localNavAnchorKey = entry.fullPath; this._localNavCursorOn = false
    } else {
      this.selectRemote(entry as SFTPFile, {} as MouseEvent, list.indexOf(entry))
      this._remoteNavAnchorKey = entry.fullPath; this._remoteNavCursorOn = false
    }
    this._safeDetect()
    this._scrollEntryIntoView(side, entry, 'center')
  }

  async _base_refreshLocal(): Promise<void> {
    this.localPathInput = this.localPath
    if (!this.localPath || typeof this.localPath !== 'string') {
      log.warn('refreshLocal skipped: localPath is invalid')
      return
    }
    const gen = ++this._localRefreshGen
    const requestedPath = this.localPath

    if (this._prepareNavigationReturn('local', this._lastLocalListedPath, requestedPath)) {
      this._lastLocalListedPath = requestedPath
      this._dropSelection('local')
    }

    this._localFlash = false

    try {
      const names = await fs.readdir(requestedPath)
      if (gen !== this._localRefreshGen) return
      const needOwner = this.localShowColOwner || this.localShowColGroup

      const BATCH = 100

      const statResults: (import('fs').Stats | null)[] = []
      for (let i = 0; i < names.length; i += BATCH) {
        const batch = names.slice(i, i + BATCH)
        const results = await Promise.all(
          batch.map(name => fs.lstat(path.join(requestedPath, name)).catch(() => null))
        )
        if (gen !== this._localRefreshGen) return
        statResults.push(...results)
      }
      const entries: LocalEntry[] = []
      const isWin = os.platform() === 'win32'
      for (let i = 0; i < names.length; i++) {
        const name = names[i]
        const fp = path.join(requestedPath, name)
        const lst = statResults[i]
        if (lst) {
          let isDirectory = lst.isDirectory()
          let isSymlink = false
          let linkTarget: string | undefined

          let meta: import('fs').Stats = lst
          try { isSymlink = lst.isSymbolicLink() } catch { /* ignore */ }

          if (isWin && name.toLowerCase().endsWith('.lnk')) {

            try {
              const { shell } = require('electron')
              const shortcut = shell.readShortcutLink(fp)
              linkTarget = shortcut.target
              const targetStat = await fs.stat(linkTarget).catch(() => null)
              if (targetStat) isDirectory = targetStat.isDirectory()
            } catch {   }
          } else if (isSymlink) {

            const targetStat = await fs.stat(fp).catch(() => null)
            if (targetStat) { isDirectory = targetStat.isDirectory(); meta = targetStat }
          }
          entries.push({
            name, fullPath: fp,
            isDirectory,
            isSymlink,
            linkTarget,
            mode: meta.mode, size: meta.size,
            mtimeMs: meta.mtimeMs, atimeMs: meta.atimeMs,
            birthtimeMs: meta.birthtimeMs,
            owner: needOwner ? meta.uid : undefined,
            group: needOwner ? meta.gid : undefined,
          })
        } else {
          entries.push({ name, fullPath: fp, isDirectory: true, inaccessible: true })
        }
      }

      if (gen !== this._localRefreshGen) return
      if (this.localPath !== requestedPath) return
      this.zone.run(() => {
        this.localEntries = entries
        this._localError = false
        this._invalidateLocalCache()

        this._pruneSelection('local')
        this._restoreNavigationReturn('local', requestedPath)
      })
      if (needOwner) {
        void this._enrichLocalOwnerNames(entries)
      }
    } catch (e) {
      if (gen !== this._localRefreshGen) return
      log.error('Local listing failed', e)
      this.zone.run(() => {
        this.localEntries = []
        this._localError = true
        this._invalidateLocalCache()
        this._pruneSelection('local')
      })
    }
    if (gen !== this._localRefreshGen) return
    this._localFlash = true
    this._safeDetect()
    if (this._localFlashTimer) clearTimeout(this._localFlashTimer)
    this._localFlashTimer = setTimeout(() => { this._localFlash = false; this._localFlashTimer = null }, 260)
  }

  private async _enrichLocalOwnerNames(baseEntries: LocalEntry[]): Promise<void> {
    const snapshotPath = this.localPath
    await this.localIdResolver.ensureLocalMaps()
    if (this.localPath !== snapshotPath) return
    const enriched = baseEntries.map(e => ({
      ...e,
      owner: typeof e.owner === 'number'
        ? this.localIdResolver.ownerName(undefined, e.owner)
        : e.owner,
      group: typeof e.group === 'number'
        ? this.localIdResolver.groupName(undefined, e.group)
        : e.group,
    }))
    this.zone.run(() => {
      if (this.localPath !== snapshotPath) return
      this.localEntries = enriched
      this._invalidateLocalCache()
      this._safeDetect()
    })
  }

  canLocalUp(): boolean {
    if (!this.localPath || typeof this.localPath !== 'string') return false
    return path.dirname(this.localPath) !== this.localPath
  }

  canRemoteUp(): boolean {
    if (!this.remotePath || typeof this.remotePath !== 'string') return false
    return this.remotePath !== '/'
  }

  localUp(): void { this._paneUp('local') }

  goLocalHome(): void { this._paneGoHome('local') }

  private _paneUp(side: 'local' | 'remote'): void {
    if (side === 'local') {
      const parent = path.dirname(this.localPath)
      if (parent !== this.localPath) {
        const memory = this._navigationMemory('local'); memory.activate(this._navigationScope('local')); memory.remember(parent, this.localPath)
        this._pushLocalNav(parent); this.localPath = parent; this.localPathInput = parent
        this.saveCurrentPath(); void this.refreshLocal()
      }
    } else {
      if (!this.connected || this.remotePath === '/') return
      const next = path.posix.dirname(this.remotePath)
      const dest = next === '.' ? '/' : next
      const memory = this._navigationMemory('remote'); memory.activate(this._navigationScope('remote')); memory.remember(dest, this.remotePath)
      this._pushRemoteNav(dest); this.remotePath = dest; this.remotePathInput = this.remotePath
      this.saveCurrentPath(); void this.refreshRemote()
    }
  }

  private _paneGoHome(side: 'local' | 'remote'): void {
    const home = side === 'local' ? os.homedir() : '/'
    if (side === 'remote' && (!this.connected || !this.sftpSession)) return
    if (side === 'local') this._pushLocalNav(home)
    else this._pushRemoteNav(home)
    if (side === 'local') { this.localPath = home; this.localPathInput = home }
    else { this.remotePath = home; this.remotePathInput = home }
    this.saveCurrentPath()
    if (side === 'local') void this.refreshLocal()
    else void this.refreshRemote()
  }

  goToLocalPathInput(): void {
    const target = this.normalizeLocalPath(this.localPathInput || this.localPath)
    if (target === this.localPath) return
    this._pushLocalNav(target)
    this.localPath = target
    this.localPathInput = this.localPath
    this.saveCurrentPath()
    void this.refreshLocal()
  }

  private normalizeLocalPath(p: string): string {
    if (!p) return this.localPath || ''
    const base = this.localPath || ''
    const joined = path.isAbsolute(p) ? p : path.join(base, p)

    return path.resolve(path.normalize(joined))
  }

  async _base_refreshRemote(): Promise<boolean> {

    return this._refreshRemoteInternal(false)
  }

  private async _refreshRemoteInternal(retriedAfterReopen: boolean): Promise<boolean> {
    if (!this.connected || !this.sftpSession) return false
    const refreshGen = ++this._remoteRefreshGen
    this.remotePathInput = this.remotePath
    if (!this.remotePath || typeof this.remotePath !== 'string') {
      log.warn('refreshRemote skipped: remotePath is invalid, resetting to /')
      this.remotePath = '/'
      this.remotePathInput = '/'
    }
    this._remoteFlash = false

    if (this._remoteLoadingTimer) {
      clearTimeout(this._remoteLoadingTimer)
      this._remoteLoadingTimer = null
    }
    this._remoteLoadingTimer = setTimeout(() => {
      if (refreshGen !== this._remoteRefreshGen) return
      this._remoteLoading = true
      this._safeDetect()
    }, 150)

    const snapshotPath = this.remotePath

    if (this._prepareNavigationReturn('remote', this._lastRemoteListedPath, snapshotPath)) {
      this._lastRemoteListedPath = snapshotPath
      this._dropSelection('remote')
    }
    try {
      const entries = await this.sftpSession.readdir(snapshotPath)
      if (refreshGen !== this._remoteRefreshGen || snapshotPath !== this.remotePath) return true
      if (this._remoteLoadingTimer) {
        clearTimeout(this._remoteLoadingTimer)
        this._remoteLoadingTimer = null
      }
      this._remoteLoading = false
      this.zone.run(() => {
        if (refreshGen !== this._remoteRefreshGen || snapshotPath !== this.remotePath) return
        this.remoteEntries = entries
        this._remoteError = false
        this._invalidateRemoteCache()

        this._pruneSelection('remote')
        this._restoreNavigationReturn('remote', snapshotPath)
      })
      if (this._remoteNeedsEnrich()) {
        void this._enrichRemoteMetadata(snapshotPath, entries, refreshGen)
      }
    } catch (e) {
      if (refreshGen !== this._remoteRefreshGen) return false
      if (this._remoteLoadingTimer) {
        clearTimeout(this._remoteLoadingTimer)
        this._remoteLoadingTimer = null
      }
      this._remoteLoading = false

      if (!retriedAfterReopen && isChannelDeadError(e) && this._connLifecycle?.recoverChannelForListing) {
        const healed = await this._connLifecycle.recoverChannelForListing()

        if (healed && refreshGen === this._remoteRefreshGen && this._isAlive) {
          log.info('Remote listing retried on a freshly reopened SFTP session')
          return this._refreshRemoteInternal(true)
        }
      }
      log.error('Remote listing failed', e)
      this.zone.run(() => {
        if (refreshGen !== this._remoteRefreshGen || snapshotPath !== this.remotePath) return
        this.remoteEntries = []
        this._remoteError = true
        this._invalidateRemoteCache()
        this._pruneSelection('remote')
      })
      this._safeDetect()
      return false
    }
    if (refreshGen !== this._remoteRefreshGen || snapshotPath !== this.remotePath) return true
    this._remoteFlash = true
    this._safeDetect()
    if (this._remoteFlashTimer) clearTimeout(this._remoteFlashTimer)
    this._remoteFlashTimer = setTimeout(() => {
      this._remoteFlash = false
      this._remoteFlashTimer = null
    }, 260)
    return true
  }

  protected _pushRemoteNav(newPath: string): void {
    this._remoteNav.push(newPath, this._ignoreNavPush)
  }

  async remoteBack(): Promise<void> { await this._paneNavToTarget('remote', 'back') }

  async remoteForward(): Promise<void> { await this._paneNavToTarget('remote', 'forward') }

  private async _paneNavToTarget(side: 'local' | 'remote', dir: 'back' | 'forward'): Promise<void> {
    const nav = side === 'local' ? this._localNav : this._remoteNav
    const canGo = side === 'local' ? (dir === 'back' ? this.canLocalBack : this.canLocalForward)
                                   : (dir === 'back' ? this.canRemoteBack : this.canRemoteForward)
    if (!canGo) return
    const target = dir === 'back' ? nav.back() : nav.forward()
    if (!target) {
      log.warn(`${side}Nav ${dir}: history entry invalid, aborting`)
      return
    }
    if (side === 'local') {
      this._ignoreLocalNavPush = true
      this.localPath = target; this.localPathInput = target
      this.saveCurrentPath(); void this.refreshLocal()
      this._ignoreLocalNavPush = false
    } else {
      this._ignoreNavPush = true
      this.remotePath = target; this.remotePathInput = target
      this.saveCurrentPath(); await this.refreshRemote()
      this._ignoreNavPush = false
    }
  }

  remoteUp(): void { this._paneUp('remote') }

  goRemoteHome(): void { this._paneGoHome('remote') }

  goToRemotePathInput(): void {
    if (!this.connected) return
    const target = this.normalizeRemotePath(this.remotePathInput || '/')
    if (target === this.remotePath) return
    this._pushRemoteNav(target)
    this.remotePath = target
    this.remotePathInput = this.remotePath
    this.saveCurrentPath()
    void this.refreshRemote()
  }

  private normalizeRemotePath(p: string): string {
    if (!p) return '/'
    let r = p.trim()
    if (!r.startsWith('/')) r = '/' + r

    r = path.posix.normalize(r.replace(/\/+/g, '/'))
    if (!r.startsWith('/')) r = '/' + r
    return r
  }

  protected _pushLocalNav(newPath: string): void {
    this._localNav.push(newPath, this._ignoreLocalNavPush)
  }

  localBack(): void { this._paneNavToTarget('local', 'back') }

  localForward(): void { this._paneNavToTarget('local', 'forward') }

  private _consumePanePointerHotkey(side: 'local' | 'remote', event: MouseEvent | WheelEvent): boolean {
    if (!this._isPanelActive) return false
    if (this._isPanelModalOpen()) return false

    let hit: PanelHotkeyAction | null = null
    for (const a of PANEL_HOTKEY_ACTIONS) {
      if (!this._panelHotkeyEnabled(a)) continue
      if (matchPointerHotkeySpecs(event, this._panelHotkeyKeys(a))) { hit = a; break }
    }
    if (!hit) return false
    event.preventDefault()
    event.stopPropagation()

    if (typeof (event as WheelEvent).deltaY === 'number') {
      const now = Date.now()
      if (now - this._pointerHotkeyLastFire < SftpFloatingPanel._POINTER_WHEEL_THROTTLE_MS) return true
      this._pointerHotkeyLastFire = now
    }
    this._runPanePointerHotkey(hit, side)
    return true
  }

  private _runPanePointerHotkey(action: PanelHotkeyAction, side: 'local' | 'remote'): void {
    switch (action) {
      case 'up':
        if (side === 'local') this.localUp(); else this.remoteUp()
        return
      case 'back':
        if (side === 'local') this.localBack(); else this.remoteBack()
        return
      case 'forward':
        if (side === 'local') this.localForward(); else this.remoteForward()
        return
      case 'refresh':
        if (side === 'local') void this.refreshLocal(); else void this.refreshRemote()
        return
      case 'delete': {
        const sel = side === 'local' ? this.selectedLocal : this.selectedRemote
        if (!sel.length) return

        this._paneDelete(side, false)
        return
      }
      case 'rename': {
        const sel = side === 'local' ? this.selectedLocal : this.selectedRemote
        if (sel.length !== 1) return
        if (side === 'local') this.localRename(); else this.remoteRename()
        return
      }
      default: {

        const a = action as PanelHotkeyAction
        if (!CONTEXT_ACTION_HOTKEYS.includes(a)) return
        const pane: 'local' | 'remote' =
          (a === 'upload' || a === 'openLocal') ? 'local'
            : a === 'download' ? 'remote'
              : side
        if (!this._contextHotkeyReady(a, pane)) return
        this.contextMenuPane = pane
        if (SftpFloatingPanel._CTX_HOTKEYS_NEED_ENTRY.has(a)) {
          const sel = pane === 'local' ? this.selectedLocal : this.selectedRemote
          this.contextMenuEntry = (sel[0] as any) ?? null
        }
        this.onContextMenuAction(a as ContextMenuAction)
        return
      }
    }
  }

  onPaneWheel(event: WheelEvent, pane: 'local' | 'remote'): void {
    this._consumePanePointerHotkey(pane, event)
  }

  onPaneListClick(event: MouseEvent, pane: 'local' | 'remote'): void {
    this._rubberBand.onPaneListClick(event, pane)
  }

  onPaneMouseDown(event: MouseEvent, pane: 'local' | 'remote'): void {
    this._commitAllPathInputs()

    if (this._consumePanePointerHotkey(pane, event)) return
    this._rubberBand.onPaneMouseDown(event, pane)
  }

  onLocalPathBlur(): void {
    this.localPathInput = this.localPath
  }

  onRemotePathBlur(): void {
    this.remotePathInput = this.remotePath
  }

  private _commitAllPathInputs(): void {
    const root = this.elRef.nativeElement as HTMLElement
    root.querySelectorAll('.path-input').forEach(node => {
      const inp = node as HTMLInputElement
      if (document.activeElement === inp) inp.blur()
    })
    this.localPathInput = this.localPath
    this.remotePathInput = this.remotePath
  }

  private _applyPaneSplit(): void {
    if (!this.elRef?.nativeElement) return
    const body = this.elRef.nativeElement.querySelector('.sftp-body') as HTMLElement | null
    if (!body) return
    const panes: HTMLElement[] = Array.from(body.querySelectorAll(':scope > sftp-file-pane'))
    if (panes.length < 1) return

    const splitterSize = 5
    const { w: bodyW, h: bodyH } = this._measureBodySize(body)

    if (this._layoutMode !== 'single') {
      this._syncNarrowLayout(bodyW > 0 ? bodyW : undefined, bodyH > 0 ? bodyH : undefined)
    } else {
      this._effectiveLayout = 'single'
      this._layoutOverrideReason = null
      this._isNarrowLayout = false
    }

    if (this._effectiveLayout === 'single') {
      body.style.flexDirection = 'row'
      body.classList.remove('narrow-layout')
      panes.forEach((p, i) => {
        const isRemote = i === panes.length - 1
        p.style.display = isRemote ? '' : 'none'
        p.style.flex = isRemote ? '1' : ''
        p.style.width = isRemote ? 'auto' : ''
        p.style.height = ''
        p.style.minWidth = isRemote ? '0' : ''
        p.style.minHeight = ''
      })
      return
    }

    if (panes.length < 2) return

    panes.forEach(p => {
      p.style.display = ''
      p.style.flex = ''
      p.style.width = ''
      p.style.height = ''
      p.style.minWidth = ''
      p.style.minHeight = ''
    })

    body.style.flexDirection = this._isNarrowLayout ? 'column' : 'row'
    body.classList.toggle('narrow-layout', this._isNarrowLayout)

    if (this._isNarrowLayout) {

      const usable = Math.max(0, bodyH - splitterSize)
      const minPaneH = Math.min(140, Math.max(88, Math.floor(usable * 0.3)))
      let h0 = Math.round(usable * this._verticalSplitRatio)
      h0 = Math.max(minPaneH, Math.min(h0, usable - minPaneH))
      if (usable > 0) this._verticalSplitRatio = h0 / usable
      panes[0].style.flex = 'none'
      panes[0].style.height = h0 + 'px'
      panes[1].style.flex = '1'
      panes[1].style.minHeight = minPaneH + 'px'
    } else {

      const usable = Math.max(0, bodyW - splitterSize)
      const minPaneW = Math.min(450, Math.max(160, Math.floor(usable / 2)))
      let w0 = Math.round(usable * this._horizontalSplitRatio)
      w0 = Math.max(minPaneW, Math.min(w0, usable - minPaneW))
      if (usable > 0) this._horizontalSplitRatio = w0 / usable
      panes[0].style.flex = 'none'
      panes[0].style.width = w0 + 'px'
      panes[1].style.flex = '1'
      panes[1].style.minWidth = minPaneW + 'px'
    }
  }

  onSplitterDown(ev: MouseEvent): void {
    ev.preventDefault()
    this._splitterDidDrag = false
    this._splitDragStartX = ev.clientX
    this._splitDragStartY = ev.clientY
    this._splitDragStartRatio = this._isNarrowLayout ? this._verticalSplitRatio : this._horizontalSplitRatio

    const body = this.elRef.nativeElement.querySelector('.sftp-body')
    if (!body) return
    const bodyH = body.clientHeight
    const bodyW = body.clientWidth

    const splitterEl = ev.currentTarget as HTMLElement
    splitterEl.classList.add('active')

    this._splitMoveHandler = (e: MouseEvent): void => {
      if (Math.abs(e.clientX - this._splitDragStartX) > 3 || Math.abs(e.clientY - this._splitDragStartY) > 3) {
        this._splitterDidDrag = true
      }
      if (this._isNarrowLayout) {
        const delta = e.clientY - this._splitDragStartY
        this._verticalSplitRatio = Math.max(0.15, Math.min(0.85, this._splitDragStartRatio + delta / bodyH))
      } else {
        const delta = e.clientX - this._splitDragStartX
        this._horizontalSplitRatio = Math.max(0.15, Math.min(0.85, this._splitDragStartRatio + delta / bodyW))
      }
      this._applyPaneSplit()
    }
    this._splitUpHandler = (_e: MouseEvent): void => {
      splitterEl.classList.remove('active')
      document.removeEventListener('mousemove', this._splitMoveHandler!)
      document.removeEventListener('mouseup', this._splitUpHandler!)
      this._splitMoveHandler = null
      this._splitUpHandler = null

      const key = this._isNarrowLayout ? 'sftp-plus-vertical-split-ratio' : 'sftp-plus-horizontal-split-ratio'
      const val = this._isNarrowLayout ? this._verticalSplitRatio : this._horizontalSplitRatio
      try { this._paneSet(key, String(val)) } catch {}
    }
    document.addEventListener('mousemove', this._splitMoveHandler)
    document.addEventListener('mouseup', this._splitUpHandler)
  }

  onSplitterDblClick(ev: MouseEvent): void {
    ev.preventDefault()
    if (this._splitterDidDrag) {
      this._splitterDidDrag = false
      return
    }
    this.resetSplitter()
  }

  resetSplitter(): void {
    this._verticalSplitRatio = 0.5
    this._horizontalSplitRatio = 0.5
    this._applyPaneSplit()
    try {
      this._paneSet('sftp-plus-vertical-split-ratio', '0.5')
      this._paneSet('sftp-plus-horizontal-split-ratio', '0.5')
    } catch {}
  }

  navFocusKey(pane: 'local' | 'remote'): string | null {
    const on = pane === 'local' ? this._localNavCursorOn : this._remoteNavCursorOn
    if (!on) return null
    return pane === 'local' ? this._localNavFocusKey : this._remoteNavFocusKey
  }

  syncPaneSelectionVisual(pane: 'local' | 'remote'): void {
    const listEl = this.elRef.nativeElement.querySelector(`.pane-list.${pane}-pane`) as HTMLElement | null
    if (!listEl) return
    const paths = pane === 'local' ? this._localSelectedPaths : this._remoteSelectedPaths
    listEl.querySelectorAll('.entry[data-path]').forEach(el => {
      const p = el.getAttribute('data-path')
      const selected = !!p && paths.has(p)
      if (el.classList.contains('selected') !== selected) el.classList.toggle('selected', selected)
    })
  }

  private _stripSelectionVisual(side: 'local' | 'remote', prevPaths: Set<string>): void {
    if (!prevPaths.size) return
    const cur = side === 'local' ? this._localSelectedPaths : this._remoteSelectedPaths
    const stale: string[] = []
    let overflow = false
    for (const p of prevPaths) {
      if (cur.has(p)) continue
      if (stale.length >= STRIP_QUERY_MAX) { overflow = true; break }
      stale.push(p)
    }
    if (overflow) { this.syncPaneSelectionVisual(side); return }
    if (!stale.length) return
    const listEl = this.elRef.nativeElement.querySelector(`.pane-list.${side}-pane`) as HTMLElement | null
    if (!listEl) return
    for (const p of stale) {
      const el = this._findRowEl(listEl, 'data-path', p)
      if (el) el.classList.remove('selected')
    }
  }

  selectLocal(entry: LocalEntry, event: MouseEvent, idx: number): void {
    if (this.selectedRemote.length > 0) this.selectedRemote = []
    const r = computeSelection(this.selectedLocal, entry, event, idx, this.localLastSelectedIndex, this.getFilteredLocalEntries(), this._localSelectedPaths)
    this.selectedLocal = r.selection; this.localLastSelectedIndex = r.lastIndex
    this._rememberNavigationItem('local', entry)
    this.syncPaneSelectionVisual('local')
    this._safeDetect()
  }

  isLocalSelected(e: LocalEntry): boolean { return this._localSelectedPaths.has(e.fullPath) }

  private _scrollEntryIntoView(
    side: 'local' | 'remote',
    entry: { fullPath?: string } | null | undefined,
    align: 'nearest' | 'center' = 'nearest',
  ): void {
    const path = entry && entry.fullPath
    if (!path) return
    this._scrollRowElIntoView(side, 'data-path', path, align)
  }

  private _scrollNavRowIntoView(side: 'local' | 'remote', row: NavRow | null, align: 'nearest' | 'center' = 'nearest'): void {
    if (!row) return
    if (row.kind === 'header') {
      const gk = row.groupKey
      if (!gk) return
      this._scrollRowElIntoView(side, 'data-group-key', gk, align)
      return
    }
    const path = row.entries[0] && row.entries[0].fullPath
    if (!path) return
    this._scrollRowElIntoView(side, 'data-path', path, align)
  }

  private _findRowEl(listEl: HTMLElement, attr: 'data-path' | 'data-group-key', value: string): HTMLElement | null {
    try {

      const escaped = value.replace(/["\\]/g, '\\$&')
      return listEl.querySelector(`[${attr}="${escaped}"]`) as HTMLElement | null
    } catch {
      const els = Array.from(listEl.querySelectorAll(`.entry[${attr}]`)) as HTMLElement[]
      return els.find(el => el.getAttribute(attr) === value) || null
    }
  }

  private _scrollRowElIntoView(
    side: 'local' | 'remote',
    attr: 'data-path' | 'data-group-key',
    value: string,
    align: 'nearest' | 'center' = 'nearest',
  ): void {
    try {
      const listEl = this.elRef.nativeElement.querySelector(`.pane-list.${side}-pane`) as HTMLElement | null
      if (!listEl) return
      ;(listEl as any).sftpRevealRow?.(attr, value)
      const rowEl = this._findRowEl(listEl, attr, value)
      if (!rowEl) return
      const headerEl = listEl.querySelector('.entry.header') as HTMLElement | null
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
      const listRect = listEl.getBoundingClientRect()
      const rowRect = rowEl.getBoundingClientRect()

      const visibleTop = listRect.top + headerH
      const visibleBottom = listRect.bottom

      if (align === 'center') {

        const viewMid = (visibleTop + visibleBottom) / 2
        const rowMid = (rowRect.top + rowRect.bottom) / 2
        listEl.scrollTop += (rowMid - viewMid)
        return
      }

      const edgePad = Math.min(12, Math.max(4, rowRect.height * 0.35))
      if (rowRect.top < visibleTop + edgePad) {
        listEl.scrollTop += (rowRect.top - visibleTop - edgePad)
      } else if (rowRect.bottom > visibleBottom - edgePad) {
        listEl.scrollTop += (rowRect.bottom - visibleBottom + edgePad)
      }
    } catch {}
  }

  private _navRows(side: 'local' | 'remote'): NavRow[] {
    return this._navCacheFor(side).out
  }

  private _navCacheFor(side: 'local' | 'remote'): NavCache {
    const list = side === 'local' ? this.getFilteredLocalEntries() : this.getFilteredRemoteEntries()
    const rows = side === 'local' ? this.getLocalGroupRows() : this.getRemoteGroupRows()
    const cached = side === 'local' ? this._localNavCache : this._remoteNavCache
    if (cached && cached.src === list && cached.rows === rows) return cached

    const out: NavRow[] = []
    if (!rows || !rows.length) {
      const flat = list || []
      for (let i = 0; i < flat.length; i++) {
        const e = flat[i]
        out.push({ kind: 'entry', key: e.fullPath, entries: [e], listIndex: i })
      }
    } else {
      for (const r of rows) {
        if (r.kind === 'header') {
          if (r.bucketKey == null) continue
          out.push({
            kind: 'header',
            key: navHeaderKey(r.bucketKey),
            entries: ((r.items || []) as any[]).slice(),
            listIndex: -1,
            groupKey: r.bucketKey,
          })
        } else if (r.entry) {
          out.push({
            kind: 'entry',
            key: r.entry.fullPath,
            entries: [r.entry],
            listIndex: typeof r.index === 'number' ? r.index : -1,
          })
        }
      }
    }

    const index = new Map<string, number>()
    const headerPrefix: number[] = new Array(out.length + 1)
    headerPrefix[0] = 0
    for (let i = 0; i < out.length; i++) {
      index.set(out[i].key, i)
      headerPrefix[i + 1] = headerPrefix[i] + (out[i].kind === 'header' ? 1 : 0)
    }
    const built: NavCache = { src: list, rows, out, index, headerPrefix }
    if (side === 'local') this._localNavCache = built
    else this._remoteNavCache = built
    return built
  }

  private _resetNavFocus(side: 'local' | 'remote'): void {
    if (side === 'local') {
      this._localNavFocusKey = null
      this._localNavAnchorKey = null
      this._localNavCursorOn = false
    } else {
      this._remoteNavFocusKey = null
      this._remoteNavAnchorKey = null
      this._remoteNavCursorOn = false
    }
  }

  private _handleArrowNav(side: 'local' | 'remote', down: boolean, extend: boolean): boolean {
    const cache = this._navCacheFor(side)
    const nav = cache.out
    if (!nav.length) return false

    const prevPaths = side === 'local' ? this._localSelectedPaths : this._remoteSelectedPaths
    const prevFocus = side === 'local' ? this._localNavFocusKey : this._remoteNavFocusKey
    const prevAnchor = side === 'local' ? this._localNavAnchorKey : this._remoteNavAnchorKey

    let focusIdx = -1
    const candidates = [prevFocus, prevPaths.size ? [...prevPaths][0] : null, prevAnchor]
    for (const probe of candidates) {
      if (!probe) continue
      const hit = cache.index.get(probe)
      if (hit !== undefined) { focusIdx = hit; break }
    }
    const newIdx = down
      ? (focusIdx < 0 ? 0 : Math.min(nav.length - 1, focusIdx + 1))
      : (focusIdx < 0 ? nav.length - 1 : Math.max(0, focusIdx - 1))
    if (newIdx < 0 || newIdx === focusIdx) return false

    const focusRow = nav[newIdx]
    const focusListIdx = focusRow.kind === 'entry' && focusRow.listIndex >= 0 ? focusRow.listIndex : null
    let entries: any[]
    let anchorKey: string
    if (!extend) {

      entries = focusRow.entries.slice()
      anchorKey = focusRow.key
    } else {

      const startKey = prevAnchor || (focusIdx >= 0 ? nav[focusIdx].key : focusRow.key)
      const startHit = cache.index.get(startKey)
      const aIdx = startHit !== undefined ? startHit : newIdx
      const lo = Math.min(aIdx, newIdx)
      const hi = Math.max(aIdx, newIdx)
      entries = []

      if (cache.headerPrefix[hi + 1] - cache.headerPrefix[lo] > 0) {
        const seen = new Set<string>()
        for (let k = lo; k <= hi; k++) {
          for (const e of nav[k].entries) {
            if (!e || seen.has(e.fullPath)) continue
            seen.add(e.fullPath)
            entries.push(e)
          }
        }
      } else {
        for (let k = lo; k <= hi; k++) entries.push(nav[k].entries[0])
      }
      anchorKey = startKey
    }

    if (side === 'local') {
      if (this.selectedRemote.length) this.selectedRemote = []
      this.selectedLocal = entries
      this.localLastSelectedIndex = focusListIdx
      this._localNavFocusKey = focusRow.key
      this._localNavAnchorKey = anchorKey
      this._localNavCursorOn = true
    } else {
      if (this.selectedLocal.length) this.selectedLocal = []
      this.selectedRemote = entries
      this.remoteLastSelectedIndex = focusListIdx
      this._remoteNavFocusKey = focusRow.key
      this._remoteNavAnchorKey = anchorKey
      this._remoteNavCursorOn = true
    }

    this._scrollNavRowIntoView(side, focusRow)
    this._stripSelectionVisual(side, prevPaths)
    this._safeDetect()
    return true
  }

  selectRemote(entry: SFTPFile, event: MouseEvent, idx: number): void {
    if (this.selectedLocal.length > 0) this.selectedLocal = []
    const r = computeSelection(this.selectedRemote, entry, event, idx, this.remoteLastSelectedIndex, this.getFilteredRemoteEntries(), this._remoteSelectedPaths)
    this.selectedRemote = r.selection; this.remoteLastSelectedIndex = r.lastIndex
    this._rememberNavigationItem('remote', entry)
    this.syncPaneSelectionVisual('remote')
    this._safeDetect()
  }

  isRemoteSelected(e: SFTPFile): boolean { return this._remoteSelectedPaths.has(e.fullPath) }

  /** Clear old-path targets before awaiting a listing, including keyboard anchors. */
  private _dropSelection(side: 'local' | 'remote'): void {
    if (side === 'local') {
      if (this._selectedLocal.length) this.selectedLocal = []
      this.localLastSelectedIndex = null
    } else {
      if (this._selectedRemote.length) this.selectedRemote = []
      this.remoteLastSelectedIndex = null
    }

    this._resetNavFocus(side)
  }

  private _pruneSelection(side: 'local' | 'remote'): void {
    if (side === 'local') {
      if (!this._selectedLocal.length) return
      const alive = new Set(this.localEntries.map(e => e.fullPath))
      const kept = this._selectedLocal.filter(e => alive.has(e.fullPath))
      if (kept.length === this._selectedLocal.length) return
      this.selectedLocal = kept
      this.localLastSelectedIndex = null
    } else {
      if (!this._selectedRemote.length) return
      const alive = new Set(this.remoteEntries.map(e => e.fullPath))
      const kept = this._selectedRemote.filter(e => alive.has(e.fullPath))
      if (kept.length === this._selectedRemote.length) return
      this.selectedRemote = kept
      this.remoteLastSelectedIndex = null
    }

    this._resetNavFocus(side)
  }

  setLocalSort(f: 'name' | 'size' | 'modified' | 'birthtime'): void {
    const r = computeSortToggle(this.localSortBy, this.localSortAsc, f, this._colJustResized)
    if (!r) return
    this.localSortBy = r.by; this.localSortAsc = r.asc
    this._invalidateLocalCache()

    try {
      this._paneSet('sftp-plus-local-sort', { by: r.by, asc: r.asc })
      this._paneFlush()
    } catch {}
  }

  setRemoteSort(f: 'name' | 'size' | 'modified' | 'birthtime'): void {
    if (f === 'birthtime') return
    const r = computeSortToggle(this.remoteSortBy, this.remoteSortAsc, f, this._colJustResized)
    if (!r) return
    this.remoteSortBy = r.by; this.remoteSortAsc = r.asc
    this._invalidateRemoteCache()
    try {
      this._paneSet('sftp-plus-remote-sort', { by: r.by, asc: r.asc })
      this._paneFlush()
    } catch {}
  }

  private _applyFilter(side: 'local' | 'remote'): void {
    if (side === 'local') { this.localFilter = this.localFilterPending; this.localFilterVisible = false; this._invalidateLocalCache() }
    else { this.remoteFilter = this.remoteFilterPending; this.remoteFilterVisible = false; this._invalidateRemoteCache() }
  }

  private _clearFilter(side: 'local' | 'remote'): void {
    if (side === 'local') { this.localFilterPending = ''; this.localFilter = ''; this.localFilterVisible = false; this._invalidateLocalCache() }
    else { this.remoteFilterPending = ''; this.remoteFilter = ''; this.remoteFilterVisible = false; this._invalidateRemoteCache() }
  }

  applyLocalFilter(): void { this._applyFilter('local') }

  clearLocalFilter(): void { this._clearFilter('local') }

  applyRemoteFilter(): void { this._applyFilter('remote') }

  clearRemoteFilter(): void { this._clearFilter('remote') }

  private _localFilteredCache: LocalEntry[] | null = null
  private _localFilterDirty = true
  private _remoteFilteredCache: SFTPFile[] | null = null
  private _remoteFilterDirty = true
  private cellEpoch = 0
  private cellCache = new WeakMap<object, { epoch: number; pattern: string; cells: Record<string, string> }>()

  protected _invalidateLocalCache(): void { this._localFilterDirty = true; this.cellEpoch++ }
  protected _invalidateRemoteCache(): void { this._remoteFilterDirty = true; this.cellEpoch++ }
  trackLocalEntryBy(_index: number, item: LocalEntry): string { return item.fullPath }
  trackRemoteEntryBy(_index: number, item: SFTPFile): string { return item.fullPath }

  getFilteredLocalEntries(): LocalEntry[] {
    if (!this._localFilterDirty && this._localFilteredCache) return this._localFilteredCache
    const entries = filterByName(filterByHidden(this.localEntries, this.showHiddenLocal), this.localFilter)
    this._localFilteredCache = sortLocalEntries(entries, this.localSortBy, this.localSortAsc, this.pinFoldersLocal)
    this._localFilterDirty = false
    return this._localFilteredCache
  }

  getFilteredRemoteEntries(): SFTPFile[] {
    if (!this._remoteFilterDirty && this._remoteFilteredCache) return this._remoteFilteredCache
    const entries = filterByName(filterByHidden(this.remoteEntries, this.showHiddenRemote), this.remoteFilter)
    this._remoteFilteredCache = sortRemoteEntries(entries, this.remoteSortBy, this.remoteSortAsc, this.pinFoldersRemote)
    this._remoteFilterDirty = false
    return this._remoteFilteredCache
  }

  private _onPaneClick(side: 'local' | 'remote', entry: { fullPath: string }, event: MouseEvent, idx: number, selectFn: () => void): void {
    this.activePane = side
    this._arrowNavPane = side
    if (this._rubberBand.shouldSuppressEntryClick(entry.fullPath)) return

    if (side === 'local') {
      this._localNavFocusKey = entry.fullPath
      this._localNavCursorOn = false
      if (!event.shiftKey) this._localNavAnchorKey = entry.fullPath
    } else {
      this._remoteNavFocusKey = entry.fullPath
      this._remoteNavCursorOn = false
      if (!event.shiftKey) this._remoteNavAnchorKey = entry.fullPath
    }
    if (side === 'local') {
      if (this.localClickTimer) { clearTimeout(this.localClickTimer); this.localClickTimer = null }
      this.localClickTimer = this.zone.runOutsideAngular(() => setTimeout(() => { this.localClickTimer = null }, 250))
    } else {
      if (this.remoteClickTimer) { clearTimeout(this.remoteClickTimer); this.remoteClickTimer = null }
      this.remoteClickTimer = this.zone.runOutsideAngular(() => setTimeout(() => { this.remoteClickTimer = null }, 250))
    }
    selectFn()
  }

  private get _base__openOnClick(): 'double' | 'single' {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.openOnClick
    return (v === 'single' || v === 'double') ? v : 'double'
  }

  private get _base__openUnsupportedInSystem(): boolean {
    return this.configService?.store?.['tabby-sftp-plus-plus']?.openUnsupportedInSystem === true
  }

  get _base_showTextLineNumbers(): boolean {
    return this.configService?.store?.['tabby-sftp-plus-plus']?.showTextLineNumbers !== false
  }

  get _base_textCaretShape(): CaretShape {
    return normalizeCaretShape(this.configService?.store?.['tabby-sftp-plus-plus']?.textCaretShape)
  }

  protected getCustomEditableExtensions(): string[] {
    const value = this.configService?.store?.['tabby-sftp-plus-plus']?.editableFileExtensions
    return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === 'string') : []
  }

  protected getAllowViewEditAllFiles(): boolean {
    const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
    return cfg?.allowViewEditAllFiles === true
      || cfg?.allowEditAllFiles === true
      || cfg?.allowViewAllAsText === true
      || cfg?.allowViewAllFiles === true
  }

  private get _base__defaultUploadPath(): string {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.defaultUploadPath
    return typeof v === 'string' ? v.trim() : ''
  }

  private get _base__defaultDownloadPath(): string {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.defaultDownloadPath
    return typeof v === 'string' ? v.trim() : ''
  }

  private get _base__iconResourceDir(): string {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.iconResourceDir
    return typeof v === 'string' ? v.trim() : ''
  }

  private get _base__fileTypeIcons(): { ext: string; svg: string; name?: string }[] {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.fileTypeIcons

    return Array.isArray(v) ? v : EMPTY_ICON_RULES
  }

  private get _base__disabledIconSvgs(): string[] {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.disabledIconSvgs
    return Array.isArray(v) ? v : EMPTY_SVG_LIST
  }

  private get _base__folderIconSvg(): string {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.folderIconSvg
    return (typeof v === 'string' && v) ? v : 'folder.svg'
  }

  private _bundledIconDirCache: string | null = null

  private get _bundledIconDir(): string {
    if (this._bundledIconDirCache === null) {
      this._bundledIconDirCache = resolveSftpPlusBundledIconDir(this.bootstrapData)
    }
    return this._bundledIconDirCache
  }

  private get effectiveIconBaseDir(): string {
    const u = (this._iconResourceDir || '').trim()
    return u ? u : this._bundledIconDir
  }

  private get _base__panelHotkeys(): Record<PanelHotkeyAction, { keys: string[]; enabled: boolean }> {
    const cfg = this.configService?.store?.['tabby-sftp-plus-plus']?.panelHotkeys
    const def = defaultPanelHotkeys()
    if (!cfg || typeof cfg !== 'object') return def
    for (const a of PANEL_HOTKEY_ACTIONS) {
      const h = (cfg as any)[a]
      if (!h || typeof h !== 'object') continue

      const keys = normalizePanelHotkeyKeys((h as any).keys ?? (h as any).key, HOTKEY_CLEARED)
      def[a] = { keys, enabled: (h as any).enabled !== false }
    }
    return def
  }

  private _panelHotkeyKeys(action: PanelHotkeyAction): string[] {
    const h = this._panelHotkeys[action]
    if (!h || h.enabled === false) return []
    return Array.isArray(h.keys) ? h.keys : []
  }

  private _isPanelHotkeyBound(action: PanelHotkeyAction): boolean {
    return this._panelHotkeyKeys(action).length > 0
  }

  private _panelHotkeyEnabled(action: PanelHotkeyAction): boolean {
    return this._isPanelHotkeyBound(action)
  }

  private _panelHotkeyKey(action: PanelHotkeyAction): string {
    const kb = keyboardHotkeySpecs(this._panelHotkeyKeys(action))
    return kb.length ? kb[0] : ''
  }

  private _matchPanelHotkeyKeysIgnoreShift(event: KeyboardEvent, specs: string[]): boolean {
    for (const spec of keyboardHotkeySpecs(specs)) {
      const p = parsePanelHotkeyKey(spec)
      if (!p) continue
      if (event.ctrlKey !== p.ctrl) continue
      if (event.altKey !== p.alt) continue
      if (event.metaKey !== p.meta) continue

      const ek = event.key
      if (p.key.length === 1 ? ek.toLowerCase() === p.key.toLowerCase() : ek === p.key) return true
    }
    return false
  }

  private async _base__activateEntry(pane: 'local' | 'remote', entry: any, event?: MouseEvent): Promise<void> {
    let isDir = !!entry?.isDirectory || this.isDirByMode(entry?.mode)

    if (!isDir && pane === 'remote' && (entry?.isSymlink || isSymlinkByMode(entry?.mode))) {
      isDir = await this._resolveRemoteSymlinkIsDir(entry.fullPath)
    }
    if (isDir) {
      if (pane === 'local') this.openLocal(entry, event)
      else void this.openRemote(entry, event)
      return
    }
    const openInSystem = !!(event && (os.platform() === 'darwin' ? event.metaKey : event.ctrlKey))
    if (openInSystem) {
      if (pane === 'local') this._openPathInSystem(entry.linkTarget || entry.fullPath, { waitForModRelease: true })
      else void this._openRemoteInSystem(entry)
      return
    }

    if (this._openUnsupportedInSystem && !isViewableRemoteFileType(
      entry.name,
      this.getCustomEditableExtensions(),
      this.getAllowViewEditAllFiles(),
    )) {
      if (pane === 'local') this._openPathInSystem(entry.linkTarget || entry.fullPath, { waitForModRelease: true })
      else void this._openRemoteInSystem(entry)
      return
    }
    if (pane === 'local') {

      if (entry.linkTarget) {
        this._openPathInSystem(entry.linkTarget, { waitForModRelease: true })
        return
      }
      void this._viewLocalFile(entry)
    }
    else void this._viewRemoteFile(entry)
  }

  onLocalClick(entry: LocalEntry, event: MouseEvent, idx: number): void {
    if (this._openOnClick === 'single') {
      this.selectLocal(entry, event, idx)
      void this._activateEntry('local', entry, event)
      return
    }
    this._onPaneClick('local', entry, event, idx, () => this.selectLocal(entry, event, idx))
  }

  private isDirByMode = isDirByMode

  private async _resolveRemoteSymlinkIsDir(fullPath: string): Promise<boolean> {
    if (!this.connected || !this.sftpSession) return false
    const st = await resolveRemoteSymlinkStat(this.sftpSession, fullPath)
    return !!st?.isDirectory
  }

  openLocal(e: LocalEntry, $event?: MouseEvent): void {

    if (this.localClickTimer) { clearTimeout(this.localClickTimer); this.localClickTimer = null }
    if ($event) $event.preventDefault()

    if (!e.isDirectory && !this.isDirByMode(e.mode)) return

    this._rememberNavigationItem('local', e)
    const targetPath = e.linkTarget || e.fullPath
    this._pushLocalNav(targetPath)
    this.localPath = targetPath
    this.localPathInput = targetPath
    this.saveCurrentPath()
    void this.refreshLocal()
  }

  _base_onLocalEntryDblClick(e: LocalEntry, $event?: MouseEvent): any {

    if (this._openOnClick === 'single') return
    if (this.localClickTimer) { clearTimeout(this.localClickTimer); this.localClickTimer = null }
    if ($event) $event.preventDefault()
    return this._activateEntry('local', e, $event)
  }

  async openRemote(e: SFTPFile, $event?: MouseEvent): Promise<void> {
    if (this.remoteClickTimer) { clearTimeout(this.remoteClickTimer); this.remoteClickTimer = null }
    if ($event) $event.preventDefault()
    if (!this.connected) return
    let isDir = e.isDirectory || this.isDirByMode(e.mode)

    if (!isDir && (e.isSymlink || isSymlinkByMode(e.mode))) {
      isDir = await this._resolveRemoteSymlinkIsDir(e.fullPath)
    }
    if (!isDir) return
    this._rememberNavigationItem('remote', e)
    this._pushRemoteNav(e.fullPath)
    this.remotePath = e.fullPath
    this.remotePathInput = e.fullPath
    this.saveCurrentPath()
    void this.refreshRemote()
  }

  _base_onRemoteEntryDblClick(e: SFTPFile, $event?: MouseEvent): any {

    if (this._openOnClick === 'single') return
    if (this.remoteClickTimer) { clearTimeout(this.remoteClickTimer); this.remoteClickTimer = null }
    if ($event) $event.preventDefault()
    if (!this.connected) return
    return this._activateEntry('remote', e, $event)
  }

  onRemoteClick(entry: SFTPFile, event: MouseEvent, idx: number): void {
    if (this._openOnClick === 'single') {
      this.selectRemote(entry, event, idx)
      void this._activateEntry('remote', entry, event)
      return
    }
    this._onPaneClick('remote', entry, event, idx, () => this.selectRemote(entry, event, idx))
  }

  colHeaderLabelFn = (col: string) => this.colHeaderLabel(col)
  // Format only rendered cells; invalidate on directory/metadata or date-format changes.
  colValueFn = (col: string, e: any): string => this.cachedColumnValue(col, e)

  cachedColumnValue(col: string, e: any): string {
    if (!e) return this.colValue(col, e)
    const pattern = getDateFormatPattern()
    let cached = this.cellCache.get(e)
    if (!cached || cached.epoch !== this.cellEpoch || cached.pattern !== pattern) {
      cached = { epoch: this.cellEpoch, pattern, cells: {} }
      this.cellCache.set(e, cached)
    }
    if (!(col in cached.cells)) cached.cells[col] = this.colValue(col, e)
    return cached.cells[col]
  }
  isLocalSelectedFn = (e: LocalEntry) => this.isLocalSelected(e)
  isRemoteSelectedFn = (e: SFTPFile) => this.isRemoteSelected(e)
  localSortArrowFn = (col: string) => this.sortArrow(col, 'local')
  remoteSortArrowFn = (col: string) => this.sortArrow(col, 'remote')

  private _menuOrderCache: { src: unknown; out: ContextMenuAction[] } | null = null

  get _base_contextMenuOrder(): ContextMenuAction[] {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.contextMenuOrder
    if (this._menuOrderCache && this._menuOrderCache.src === v) return this._menuOrderCache.out
    const out = sanitizeMenuOrder(v)
    this._menuOrderCache = { src: v, out }
    return out
  }

  get _base_contextMenuDisabledEntries(): Set<string> {
    const v = this.configService?.store?.['tabby-sftp-plus-plus']?.contextMenuDisabled
    const arr = v && Array.isArray(v) ? (v as string[]).filter(a => a !== 'groupToggleAll') : []
    return new Set<string>(arr)
  }

  get contextMenuHotkeyShortcuts(): Record<string, string> {
    const out: Record<string, string> = {
      delete: this._panelHotkeyKey('delete'),
      rename: this._panelHotkeyKey('rename'),
      refresh: this._panelHotkeyKey('refresh'),
    }

    for (const a of CONTEXT_ACTION_HOTKEYS) {
      out[a] = this._panelHotkeyKey(a)
    }
    return out
  }

  private resolveDetailsIcon(e: any): string | null {
    if (!e) return null
    const disabled = this._disabledIconSvgs || []
    const base = this.effectiveIconBaseDir
    if (!base) return null
    const joinUrl = (svg: string): string => 'file://' + path.join(base, svg)
    const exists = (svg: string): boolean => {
      try { return fsSync.existsSync(path.join(base, svg)) } catch { return false }
    }

    if (e.isDirectory) {
      const svg = (this._folderIconSvg || '').trim()
      if (svg && !disabled.includes(svg) && exists(svg)) return joinUrl(svg)
      return null
    }
    const name: string = e.name || ''
    const dot = name.lastIndexOf('.')
    if (dot <= 0) {
      const def = 'default.svg'
      if (!disabled.includes(def) && exists(def)) return joinUrl(def)
      return null
    }
    const ext = name.slice(dot).toLowerCase()

    if (this._fileTypeIcons && this._fileTypeIcons.length) {
      const rule = this._fileTypeIcons.find(r => (r.ext || '').toLowerCase() === ext)
      if (rule && rule.svg && !disabled.includes(rule.svg) && exists(rule.svg)) return joinUrl(rule.svg)
    }

    const svg = DEFAULT_ICON_MAP[ext]
    if (svg && !disabled.includes(svg) && exists(svg)) return joinUrl(svg)

    const def = 'default.svg'
    if (!disabled.includes(def) && exists(def)) return joinUrl(def)
    return null
  }

  get detailsDisplay(): DetailsDisplay | null {
    const e = this.detailsEntry
    if (!e) return null
    return {
      name: e.name,
      isFolder: !!e.isDirectory,

      iconUrl: this.resolveDetailsIcon(e),
      type: e.isDirectory ? this.i18n.t('type.folder') : (this.getFileExt(e.name) || this.i18n.t('type.file')),

      location: this.detailsIsLocal ? this.i18n.t('pane.local') : this.i18n.t('pane.remote'),
      path: this.getEntryPath(e),

      size: e.isDirectory ? (this.detailsCalcResult ?? undefined) : this.formatSize(this.getEntrySize(e)),
      sizeCalculable: !!e.isDirectory,
      sizeCalcState: this.detailsCalcState,
      modified: this.formatDate(this.getEntryMtime(e)),
      created: this.getEntryBirthtimeMs(e) ? this.formatDate(this.getEntryBirthtimeMs(e)) : undefined,
      accessed: this.getEntryAtimeMs(e) ? this.formatDate(this.getEntryAtimeMs(e)) : undefined,
      perms: this.getEntryMode(e) != null
        ? this.formatMode(this.getEntryMode(e)) + ' (' + this.formatOctalMode(this.getEntryMode(e)) + ')'
        : undefined,
      owner: this.getEntryOwner(e) != null ? String(this.getEntryOwner(e)) : undefined,
      group: this.getEntryGroup(e) != null ? String(this.getEntryGroup(e)) : undefined,
    }
  }

  getLocalSelectionInfo(): string {
    const count = this.getFilteredLocalEntries().length
    let s = this.i18n.t('pane.items', { count })
    if (this.selectedLocal.length) {
      const sizePart = this.formatSelectedSizeLocal()
        + (this.selectedHasDirLocal() ? this.i18n.t('pane.exclFolders') : '')
      s += this.i18n.t('pane.selectedInfo', { n: this.selectedLocal.length, size: sizePart })
    }
    return s
  }

  getRemoteSelectionInfo(): string {
    const count = this.getFilteredRemoteEntries().length
    let s = this.i18n.t('pane.items', { count })
    if (this.selectedRemote.length) {
      const sizePart = this.formatSelectedSizeRemote()
        + (this.selectedHasDirRemote() ? this.i18n.t('pane.exclFolders') : '')
      s += this.i18n.t('pane.selectedInfo', { n: this.selectedRemote.length, size: sizePart })
    }
    return s
  }

  onLocalPaneNav(action: PaneNavAction): void {
    switch (action) {
      case 'back': this.localBack(); break
      case 'forward': this.localForward(); break
      case 'up': this.localUp(); break
      case 'home': this.goLocalHome(); break
      case 'refresh': void this.refreshLocal(); break
      case 'toggleFilter': this.localFilterVisible = !this.localFilterVisible; break
      case 'toggleHidden': this.toggleShowHidden('local'); break
    }
  }

  onRemotePaneNav(action: PaneNavAction): void {
    switch (action) {
      case 'back': this.remoteBack(); break
      case 'forward': this.remoteForward(); break
      case 'up': this.remoteUp(); break
      case 'home': this.goRemoteHome(); break
      case 'refresh': void this.refreshRemote(); break
      case 'toggleFilter': this.remoteFilterVisible = !this.remoteFilterVisible; break
      case 'toggleHidden': this.toggleShowHidden('remote'); break
    }
  }

  onLocalSort(e: PaneSortAction): void { this.setLocalSort(e.col as any) }
  onRemoteSort(e: PaneSortAction): void { this.setRemoteSort(e.col as any) }

  _base_onContextMenuAction(action: ContextMenuAction): void {
    switch (action) {
      case 'newFolder': this.ctxNewFolder(); break
      case 'newFile': this.ctxNewFile(); break
      case 'rename': this.ctxRename(); break
      case 'delete': this.ctxDelete(); break
      case 'openLocal': this.ctxOpenLocal(); break
      case 'viewFile': void this.ctxViewFile(); break
      case 'editFile': void this.ctxEditFile(); break
      case 'upload': void this.ctxUpload(); break
      case 'download': void this.ctxDownload(); break
      case 'revealInExplorer': this.ctxRevealInExplorer(); break
      case 'chmod': this.ctxChmod(); break
      case 'details': this.ctxDetails(); break
      case 'copy': this.ctxClipboardCopy(); break
      case 'cut': this.ctxClipboardCut(); break
      case 'paste': this.ctxClipboardPaste(); break
      case 'refresh': this.ctxRefresh(); break
      case 'selectAll': this.ctxSelectAll(); break
      case 'selectInvert': this.ctxSelectInvert(); break
      case 'copyPath': this.ctxCopyPath(); break
    }
  }

  onHeaderMenuAction(action: HeaderMenuAction): void {
    if (action === 'adjustCol') { this.adjustColumnWidth(); return }
    if (action === 'adjustAllCols') { this.adjustAllColumnsWidth(); return }
    if (action === 'togglePinFolders') { this.togglePinFolders(this.contextMenuPane); return }
    if (action === 'toggleHidden') { this.toggleShowHidden(this.contextMenuPane); return }
    if (action === 'toggleColBorders') { this.toggleColBorders(); return }
    if (action === 'toggleZebra') { this.toggleZebra(); return }
    if (action.startsWith('toggleCol:')) {
      this.toggleColumn(action.slice('toggleCol:'.length), this.contextMenuPane)
    }
  }

  /** Whitelist of property names allowed for dynamic assignment via permission field changes */
  private static readonly _PERM_PROP_WHITELIST = new Set<string>([
    'permOwnerRead', 'permOwnerWrite', 'permOwnerExec',
    'permGroupRead', 'permGroupWrite', 'permGroupExec',
    'permOtherRead', 'permOtherWrite', 'permOtherExec',
  ])

  onPermFieldChange(e: { field: PermField; value: boolean }): void {
    const map: Record<PermField, string> = {
      ownerRead: 'permOwnerRead', ownerWrite: 'permOwnerWrite', ownerExec: 'permOwnerExec',
      groupRead: 'permGroupRead', groupWrite: 'permGroupWrite', groupExec: 'permGroupExec',
      otherRead: 'permOtherRead', otherWrite: 'permOtherWrite', otherExec: 'permOtherExec',
    }
    const prop = map[e.field]
    if (!SftpFloatingPanel._PERM_PROP_WHITELIST.has(prop)) {
      log.warn('Blocked dynamic assignment to non-whitelisted property:', prop)
      return
    }
    ;(this as any)[prop] = e.value
    this.updatePermMode()
  }

  formatSize = formatSize
  formatDate = formatDate
  formatPercent = formatPercent
  formatLogTime = formatLogTime
  formatLogTimeRange = formatLogTimeRange
  formatDuration = formatDuration
  formatSpeedFromSize = formatSpeedFromSize
  getLogFileName = getLogFileName

  formatFailReason(entry: TransferLogEntry): string {
    return formatFailReasonFn(entry, this.i18n.t.bind(this.i18n))
  }

  formatSelectedSizeLocal(): string {
    const total = this.selectedLocal.reduce((sum, e) => sum + (e.isDirectory ? 0 : (e.size ?? 0)), 0)
    return this.formatSize(total)
  }

  selectedHasDirLocal(): boolean {
    return this.selectedLocal.some(e => e.isDirectory)
  }

  formatSelectedSizeRemote(): string {
    const total = this.selectedRemote.reduce((sum, e) => sum + (e.isDirectory ? 0 : (e.size ?? 0)), 0)
    return this.formatSize(total)
  }

  selectedHasDirRemote(): boolean {
    return this.selectedRemote.some(e => e.isDirectory)
  }

  formatMode(mode: number): string {

    const m = mode & 0o777
    const r = (m & 0o400) ? 'r' : '-'
    const w = (m & 0o200) ? 'w' : '-'
    const x = (m & 0o100) ? 'x' : '-'
    const rg = (m & 0o040) ? 'r' : '-'
    const wg = (m & 0o020) ? 'w' : '-'
    const xg = (m & 0o010) ? 'x' : '-'
    const ro = (m & 0o004) ? 'r' : '-'
    const wo = (m & 0o002) ? 'w' : '-'
    const xo = (m & 0o001) ? 'x' : '-'
    return `${r}${w}${x}${rg}${wg}${xg}${ro}${wo}${xo}`
  }

  formatOctalMode(mode: number): string {
    return (mode & 0o777).toString(8).padStart(3, '0')
  }

  getExt(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot > 0 ? name.substring(dot + 1).toLowerCase() : ''
  }

  private _normRemoteDir(p: string): string {
    const n = path.posix.normalize(p || '/')
    return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n
  }

  private _isInternalSameDirDrag(targetPane: 'local' | 'remote'): boolean {
    return this._fileDnd.isInternalSameDirDrag(targetPane)
  }

  private _resetFileDragState(): void {
    this._fileDnd.reset()
  }

  onEntryDragEnd(): void {

    this._cancelRemoteDragCache()
    this._fileDnd.onEntryDragEnd(() => this._clearCustomDragPreview())
  }

  private _customDragPreviewEl: HTMLElement | null = null

  private static readonly DRAG_CACHE_MAX_BYTES = 4 * 1024 * 1024
  private static readonly DRAG_CACHE_DELAY_MS = 450
  private _dragCacheTimer: ReturnType<typeof setTimeout> | null = null
  private _dragCacheGen = 0
  private _dragCachePending = false
  private _dragCacheTransfers: Array<{ cancel: () => void | Promise<void> }> = []
  private _dragCacheInFlight = new Set<string>()
  private _dragCacheEntries: SFTPFile[] = []
  private _dragCacheContextSession: unknown
  private _dragCacheRoot = ''
  private _dragReadyFiles = new Map<string, string>()

  private _remoteDragCacheKey(entry: SFTPFile): string {
    return JSON.stringify([entry.fullPath, entry.size, entry.modified?.getTime?.() || 0])
  }

  private _remoteDragCacheRoot(): string {
    if (this._dragCacheContextSession !== this.sftpSession || !this._dragCacheRoot) {
      this._dragCacheContextSession = this.sftpSession
      this._dragCacheRoot = path.join(os.tmpdir(), 'sftp-plus-dragout', randomUUID())
      this._dragReadyFiles = new Map()
    }
    return this._dragCacheRoot
  }

  private _clearCustomDragPreview(): void {
    if (this._customDragPreviewEl) {
      try { this._customDragPreviewEl.remove() } catch {}
      this._customDragPreviewEl = null
    }
  }

  private _cancelRemoteDragCache(keepPlan = false): void {
    if (!keepPlan) this._dragCacheEntries = []
    this._dragCachePending = false
    this._dragCacheGen++
    if (this._dragCacheTimer) {
      clearTimeout(this._dragCacheTimer)
    }
    this._dragCacheTimer = null
    const pending = this._dragCacheTransfers.splice(0)
    for (const t of pending) {
      try { void Promise.resolve(t.cancel()).catch(() => {}) } catch { /* ignore */ }
    }
    this._dragCacheInFlight.clear()
  }

  private _scheduleRemoteDragCache(entries: SFTPFile[]): void {
    this._cancelRemoteDragCache()
    this._dragCacheEntries = entries.filter(e => !e.isDirectory && (e.size ?? 0) > 0 && (e.size ?? 0) <= SftpFloatingPanel.DRAG_CACHE_MAX_BYTES)
    this._dragCachePending = this._dragCacheEntries.length > 0
    // Internal drags need only their payload. Warm OS drag-out files after leaving the panel.
  }

  private _armRemoteDragCache(): void {
    if (!this._dragCacheEntries?.length || this._dragCacheTimer) return
    this._dragCachePending = true
    const gen = this._dragCacheGen, entries = this._dragCacheEntries
    this._dragCacheTimer = this.zone.runOutsideAngular(() => setTimeout(() => {
      this._dragCacheTimer = null
      if (gen !== this._dragCacheGen) return
      void this._cacheRemoteFilesForDrag(entries, gen)
    }, SftpFloatingPanel.DRAG_CACHE_DELAY_MS))
  }

  private _setCustomDragPreview(ev: DragEvent, items: Array<{ name: string; isDirectory: boolean }>): void {
    const dt = ev.dataTransfer
    if (!dt || !items.length) return
    this._clearCustomDragPreview()

    const wrap = document.createElement('div')
    wrap.style.position = 'fixed'
    wrap.style.left = '-99999px'
    wrap.style.top = '-99999px'
    wrap.style.pointerEvents = 'none'
    wrap.style.zIndex = '2147483647'
    wrap.style.display = 'inline-flex'
    wrap.style.alignItems = 'center'
    wrap.style.gap = '8px'

    wrap.style.padding = '7px 12px 7px 22px'
    wrap.style.borderRadius = '8px'
    wrap.style.border = '1px solid rgba(128,128,128,0.35)'
    wrap.style.background = 'rgba(20, 20, 22, 0.92)'
    wrap.style.color = '#f3f4f6'
    wrap.style.fontSize = '12px'
    wrap.style.lineHeight = '1'
    wrap.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)'
    wrap.style.boxSizing = 'border-box'
    wrap.style.overflow = 'visible'

    if (items.length === 1) {
      const one = items[0]
      const icon = document.createElement('span')
      icon.textContent = one.isDirectory ? '📁' : '📄'
      icon.style.fontSize = '14px'
      icon.style.lineHeight = '1'
      icon.style.flexShrink = '0'
      const name = document.createElement('span')
      name.textContent = one.name
      name.style.maxWidth = '260px'
      name.style.overflow = 'hidden'
      name.style.textOverflow = 'ellipsis'
      name.style.whiteSpace = 'nowrap'
      wrap.appendChild(icon)
      wrap.appendChild(name)
    } else {
      const iconStack = document.createElement('span')
      iconStack.style.position = 'relative'
      iconStack.style.display = 'inline-block'
      iconStack.style.flexShrink = '0'
      iconStack.style.width = '36px'
      iconStack.style.height = '18px'
      iconStack.style.marginLeft = '4px'
      const uniqueIcons = Array.from(new Set(items.map(i => i.isDirectory ? '📁' : '📄'))).slice(0, 3)
      uniqueIcons.forEach((ic, idx) => {
        const s = document.createElement('span')
        s.textContent = ic
        s.style.position = 'absolute'
        s.style.left = `${6 + idx * 8}px`
        s.style.top = '1px'
        s.style.fontSize = '14px'
        s.style.lineHeight = '1'
        iconStack.appendChild(s)
      })
      const count = document.createElement('span')
      count.textContent = `${items.length}`
      count.style.fontWeight = '600'
      count.style.paddingLeft = '2px'
      wrap.appendChild(iconStack)
      wrap.appendChild(count)
    }

    document.body.appendChild(wrap)
    this._customDragPreviewEl = wrap

    dt.setDragImage(wrap, 8, 14)
  }

  readonly localDragHoverHandler = (kind: 'over' | 'enter' | 'leave', event: DragEvent): void => this._handleDragHover(kind, event, 'local')
  readonly remoteDragHoverHandler = (kind: 'over' | 'enter' | 'leave', event: DragEvent): void => this._handleDragHover(kind, event, 'remote')

  private _handleDragHover(kind: 'over' | 'enter' | 'leave', event: DragEvent, side: 'local' | 'remote'): void {
    if (kind === 'over') this.onDragOver(event, side)
    else if (kind === 'enter') this.onDragEnter(event, side)
    else this.onDragLeave(event, side)
  }

  onDragOver(ev: DragEvent, targetPane: 'local' | 'remote'): void {
    if (this._dragCachePending) {
      const destination = this._resolveDropDestDir(ev, targetPane)
      if (targetPane === 'local' || (destination && this._normRemoteDir(destination) !== this._normRemoteDir(this.remotePath))) this._cancelRemoteDragCache(true)
    }
    this._fileDnd.onDragOver(ev, targetPane)
  }

  onDragEnter(ev: DragEvent, targetPane: 'local' | 'remote'): void {
    if (this._dragCachePending) this._cancelRemoteDragCache(true)
    this._fileDnd.onDragEnter(ev, targetPane)
  }

  onDragLeave(ev: DragEvent, targetPane: 'local' | 'remote'): void {
    this._fileDnd.onDragLeave(ev, targetPane)
    const element = this.elRef?.nativeElement as HTMLElement | undefined
    const host = element?.querySelector?.<HTMLElement>('.sftp-root') || element
    if (!host || !this._dragCacheEntries?.length) return
    if (ev.relatedTarget && host.contains(ev.relatedTarget as Node)) return
    const rect = host.getBoundingClientRect()
    if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) return
    this._armRemoteDragCache()
  }

  onDragStartLocal(ev: DragEvent, entry: LocalEntry): void {
    this._cancelRemoteDragCache()
    const src = this._resolveDragSource(ev, entry, this.selectedLocal)
    if (!src) return
    this._setCustomDragPreview(ev, src.map(e => ({ name: e.name, isDirectory: e.isDirectory })))
    const cur = path.resolve(this.localPath)
    this._fileDnd.setDragSource('local', src.every(e => path.resolve(path.dirname(e.fullPath)) === cur), cur)
    const p: DragPayload = { kind: 'local-paths', sourceScope: this._dropTmpScope, paths: src.map(e => ({ fullPath: e.fullPath, name: e.name, isDirectory: e.isDirectory })) }
    ev.dataTransfer?.setData('application/x-sftp-plus', JSON.stringify(p))
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copyMove'

    const uriList: string[] = []
    for (const e of src) {
      try {
        const file = new File([''], e.name)
        ;(file as any).path = e.fullPath
        ev.dataTransfer?.items.add(file)
        uriList.push(encodeURI(`file:///${e.fullPath.replace(/\\/g, '/')}`))
      } catch {   }
    }
    if (uriList.length) {
      ev.dataTransfer?.setData('text/uri-list', uriList.join('\r\n'))
      ev.dataTransfer!.dropEffect = 'copy'
      ev.dataTransfer!.effectAllowed = 'copyMove'
    }
  }

  onDragStartRemote(ev: DragEvent, entry: SFTPFile): void {
    if (!this.connected) return
    this._cancelRemoteDragCache()
    const src = this._resolveDragSource(ev, entry, this.selectedRemote)
    if (!src) return
    this._setCustomDragPreview(ev, src.map(e => ({ name: e.name, isDirectory: e.isDirectory })))
    const cur = this._normRemoteDir(this.remotePath)
    this._fileDnd.setDragSource('remote', src.every(e => this._normRemoteDir(path.posix.dirname(e.fullPath)) === cur), cur)
    this._remoteDragSession = this.sftpSession
    const p: DragPayload = { kind: 'remote-paths', sourceScope: this._dropTmpScope, paths: src.map(e => ({ remotePath: e.fullPath, name: e.name, isDirectory: e.isDirectory, size: e.size, mode: e.mode, modified: e.modified?.getTime?.() })) }
    ev.dataTransfer?.setData('application/x-sftp-plus', JSON.stringify(p))
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copyMove'

    this._remoteDragCacheRoot()
    const uriList: string[] = []
    for (const entry of src) {
      const cachedPath = this._dragReadyFiles.get(this._remoteDragCacheKey(entry))
      if (!cachedPath) continue
      try { const file = new File([''], entry.name); (file as any).path = cachedPath; ev.dataTransfer?.items.add(file) } catch {}
      uriList.push(encodeURI('file:///' + cachedPath.replace(/\\/g, '/')))
    }

    if (uriList.length > 0 && uriList.length === src.length) {
      ev.dataTransfer?.setData('text/uri-list', uriList.join('\r\n'))
      ev.dataTransfer!.dropEffect = 'copy'
      ev.dataTransfer!.effectAllowed = 'copyMove'
      return
    }

    if (uriList.length < src.length) {
      this._scheduleRemoteDragCache(src)
    }
  }

  private _resolveDragSource<T extends { fullPath: string }>(ev: DragEvent, entry: T, selected: T[]): T[] | null {
    if (!selected.some(e => e.fullPath === entry.fullPath)) {
      ev.preventDefault()
      this._rubberBand.markDragCancelled()
      return null
    }
    this._rubberBand.cleanup()
    return selected.length ? selected : [entry]
  }

  private async _cacheRemoteFilesForDrag(entries: SFTPFile[], gen: number): Promise<void> {
    if (!this.sftpSession || gen !== this._dragCacheGen) return
    const session = this.sftpSession
    const tmpDir = this._remoteDragCacheRoot()
    await fs.mkdir(tmpDir, { recursive: true }).catch(() => {})
    if (gen !== this._dragCacheGen) return

    for (const entry of entries) {
      if (gen !== this._dragCacheGen || !this.sftpSession) return

      const safeName = safeEntryName(entry.name)
      if (!safeName || safeName === '.' || safeName === '..') continue
      if (entry.isDirectory) continue
      if ((entry.size ?? 0) > SftpFloatingPanel.DRAG_CACHE_MAX_BYTES) continue

      const flightKey = entry.fullPath
      if (this._dragCacheInFlight.has(flightKey)) continue
      this._dragCacheInFlight.add(flightKey)
      try {
        const cacheKey = this._remoteDragCacheKey(entry)
        const folder = path.join(tmpDir, createHash('sha256').update(cacheKey).digest('hex').slice(0, 20))
        await fs.mkdir(folder, { recursive: true })
        const tmpPath = path.join(folder, safeName)
        const cached = await fs.stat(tmpPath).then(s => s.size === (entry.size ?? 0)).catch(() => false)
        if (gen !== this._dragCacheGen || this.sftpSession !== session) return
        if (cached) { this._dragReadyFiles.set(cacheKey, tmpPath); continue }

        const dragCancelRef: { current: { cancel?: () => void | Promise<void> } | null } = { current: null }
        const ctx = this._byteTransferCtx(dragCancelRef)
        const ok = await downloadRemoteFile(ctx, entry.fullPath, tmpPath, undefined, entry.size, {
          exposeCancel: true,
          onTransfer: (dl) => {
            if (gen !== this._dragCacheGen) {
              void dl.cancel()
              return
            }
            this._dragCacheTransfers.push(dl)
          },
        })
        if (ok && gen === this._dragCacheGen && this.sftpSession === session) {
          this._dragReadyFiles.set(cacheKey, tmpPath)
          if (this._dragReadyFiles.size > 128) this._dragReadyFiles.delete(this._dragReadyFiles.keys().next().value)
        }
      } catch {

      } finally {
        this._dragCacheInFlight.delete(flightKey)

        this._dragCacheTransfers = this._dragCacheTransfers.filter(t => {
          const anyT = t as { isCancelled?: () => boolean; isComplete?: () => boolean }
          if (typeof anyT.isCancelled === 'function' && anyT.isCancelled()) return false
          if (typeof anyT.isComplete === 'function' && anyT.isComplete()) return false
          return true
        })
      }
    }
  }

  /** Internal moves share Cut/Paste conflict handling; never overwrite a pending operation. */
  private async _moveDroppedEntries(payload: DragPayload, side: 'local' | 'remote', dest: string): Promise<void> {
    if (payload.sourceScope !== this._dropTmpScope ||
        (side === 'remote' && (!this.connected || !this.sftpSession || this._remoteDragSession !== this.sftpSession))) {
      this.showToast('Drag again from this file pane to move files.'); return
    }
    if (this._internalMoveBusy || this._conflictQueue.length || this.showConflictDialog) {
      this.showToast('Resolve the current file conflict before moving more files.'); return
    }
    const api = side === 'local' ? path : path.posix
    const entries = payload.paths.map(e => ({ ...e, fullPath: 'fullPath' in e ? e.fullPath : e.remotePath }))
      .filter(e => api.resolve(api.dirname(e.fullPath)) !== api.resolve(dest))
    const recursive = entries.find(e => e.isDirectory && isPathInside(e.fullPath, api.join(dest, e.name), side === 'remote'))
    if (recursive) { this.showToast(this.i18n.t('op.cannotCopyIntoSelf', { name: recursive.name })); return }
    if (!entries.length) return
    this._internalMoveBusy = true
    try { await this._pasteAdapter.paste(entries, side, dest, 'cut', side) }
    catch (error) {
      log.error('[drop] Internal move failed:', side, dest, error)
      this.showToast(this.i18n.t('notify.pasteFailed'))
    } finally { this._internalMoveBusy = false }
  }

  async _base_onDrop(ev: DragEvent, targetPane: 'local' | 'remote'): Promise<void> {
    const destDir = this._resolveDropDestDir(ev, targetPane)
    await this._fileDropRuntime.onDrop(ev, targetPane, destDir)
  }

  private _resolveDropDestDir(ev: DragEvent, targetPane: 'local' | 'remote'): string | undefined {
    if ((ev.target as HTMLElement | null)?.closest?.('[data-drop-parent]')) {
      return targetPane === 'local' ? path.dirname(this.localPath) : path.posix.dirname(this.remotePath)
    }
    const el = (ev.target as HTMLElement | null)?.closest?.('[data-path]') as HTMLElement | null
    if (!el) return undefined
    const p = el.getAttribute('data-path')
    if (!p) return undefined
    const isDir = el.getAttribute('data-isdir') === '1'
    if (targetPane === 'remote') {
      return isDir ? p : path.posix.dirname(p)
    }
    return isDir ? p : path.dirname(p)
  }

  private async _scanLocalDir(dirPath: string): Promise<{ size: number; count: number }> {
    const limiter = new ConcurrencyLimiter(8)
    const scan = async (dir: string): Promise<{ size: number; count: number }> => {
      let entries: import('fs').Dirent[]
      try {
        entries = await limiter.run(() => fs.readdir(dir, { withFileTypes: true }))
      } catch { return { size: 0, count: 0 } }
      let size = 0
      let count = 0
      const subs: Array<Promise<{ size: number; count: number }>> = []
      const files: string[] = []
      for (const item of entries) {
        if (item.isSymbolicLink()) continue
        const p = path.join(dir, item.name)
        if (item.isDirectory()) {
          subs.push(scan(p))
        } else {
          files.push(p)
        }
      }
      const stats = await mapConcurrent(files, 8, p => limiter.run(() => fs.stat(p)).catch(() => null))
      for (const st of stats) if (st) { size += st.size; count++ }
      for (const r of await Promise.all(subs)) { size += r.size; count += r.count }
      return { size, count }
    }
    return scan(dirPath)
  }

  private async _scanRemoteDir(remotePath: string): Promise<{ size: number; count: number }> {
    const session = this.sftpSession
    if (!session) return { size: 0, count: 0 }
    const limiter = new ConcurrencyLimiter(8)
    const scan = async (dir: string): Promise<{ size: number; count: number }> => {
      let entries: Array<{ name: string; isDirectory: boolean; size?: number }>
      try {
        entries = await limiter.run(() => session.readdir(dir))
      } catch { return { size: 0, count: 0 } }
      let size = 0
      let count = 0
      const subs: Array<Promise<{ size: number; count: number }>> = []
      for (const e of entries) {

        if ((e as any).isSymlink || (e as any).isSymbolicLink) continue
        if (e.isDirectory) {
          subs.push(scan(path.posix.join(dir, e.name)))
        } else {
          size += e.size || 0
          count++
        }
      }
      for (const r of await Promise.all(subs)) { size += r.size; count += r.count }
      return { size, count }
    }
    return scan(remotePath)
  }

  private _blockDuplicateTransfer(
    direction: 'upload' | 'download', remotePath: string, localPath: string, displayName: string,
  ): boolean {
    let active = false
    try { active = this._transferCoordinator.isTransferSlotActive(direction, remotePath, localPath) } catch { /* ignore */ }
    if (!active) return false
    log.warn('[dup-transfer] ignored duplicate request:', direction, remotePath, localPath)
    try {
      this.showToast(this.i18n.t('notify.duplicateTransfer', { name: displayName }), 4200)
    } catch { /* ignore */ }
    return true
  }

  private _startFolderTransfer(
    name: string, direction: 'upload' | 'download',
    remotePath: string, localPath: string,
    totalSize: number, itemCount: number,
    reuseLogEntryId?: string,
  ): { transferEntry: typeof this.transfers[0]; startTime: number; logEntryId: string } {

    const taskRef: TaskCancelRef = { current: null, active: new Set<any>() }

    const queuedEntries = this.transfers.filter(
      e => e.queued && e.direction === direction && e.localPath === localPath,
    )
    const queuedEntry = queuedEntries.find(e => e.remotePath === remotePath)
      ?? queuedEntries.find(e => !e.remotePath)
    if (queuedEntry) {

      if (this._transferRuntime.consumeQueuedCancel(direction, localPath, remotePath)) {
        this.transfers = this.transfers.filter(x => x !== queuedEntry)
        if (queuedEntry.logEntryId != null) {
          try { this.transferLog.remove(queuedEntry.logEntryId) } catch { /* ignore */ }
        }
        ;(queuedEntry as any)._aborted = true
        ;(queuedEntry as any)._taskCancelRef = taskRef
        this._safeDetect()
        return { transferEntry: queuedEntry, startTime: Date.now(), logEntryId: queuedEntry.logEntryId! }
      }
      Object.assign(queuedEntry, {
        transfer: null, name, remotePath,
        percent: 0, speed: '', bytesDone: 0, bytesTotal: totalSize,
        paused: false, queued: false,
        isFolder: true, phase: 'transferring', currentItem: '', itemCount, itemDone: 0,
        _taskCancelRef: taskRef,

        transferMode: 'sftp',
      })
      if (queuedEntry.logEntryId != null) {

        this.transferLog.update(queuedEntry.logEntryId, {
          size: totalSize, startTime: Date.now(),
          transferMode: 'sftp',
          fileCount: itemCount || 0,
        })
      }
      this.transfersMinimized = false
      this.transfersHidden = false
      this._safeDetect()
      this._transferRuntime.watchFolder?.(queuedEntry)
      return { transferEntry: queuedEntry, startTime: Date.now(), logEntryId: queuedEntry.logEntryId! }
    }
    const logEntry = reuseLogEntryId
      ? { id: reuseLogEntryId }
      : this.transferLog.add({
        operation: direction,
        localPath,
        remotePath,
        profileName: this.profile?.name || undefined,
        success: true,
        size: totalSize,
        duration: 0,
        startTime: Date.now(),
        pending: true,

        transferMode: 'sftp',
        fileCount: itemCount || 0,
      })
    if (reuseLogEntryId) {

      try {
        this.transferLog.update(reuseLogEntryId, {
          pending: true, success: true, duration: 0, startTime: Date.now(),
          transferMode: 'sftp',
          fileCount: itemCount || 0,
        })
      } catch { /* ignore */ }
    }
    const transferEntry = {
      transfer: null, direction, name, remotePath, localPath,
      percent: 0, speed: '', bytesDone: 0, bytesTotal: totalSize,
      paused: false, logEntryId: logEntry.id,
      isFolder: true, phase: 'transferring', currentItem: '', itemCount, itemDone: 0,
      _taskCancelRef: taskRef,
      transferMode: 'sftp',
    } as PanelTransferItem
    this.transfers.push(transferEntry)
    this._transferRuntime.watchFolder?.(transferEntry)
    this.transfersMinimized = false
    this.transfersHidden = false
    this._safeDetect()
    return { transferEntry, startTime: Date.now(), logEntryId: logEntry.id }
  }

  private _folderProgressDetect: ReturnType<typeof setTimeout> | null = null

  private _scheduleFolderProgressDetect(): void {
    if (this._folderProgressDetect || this._destroyed) return
    const schedule = () => setTimeout(() => { this._folderProgressDetect = null; this._safeDetect() }, 100)
    this._folderProgressDetect = this.zone?.runOutsideAngular ? this.zone.runOutsideAngular(schedule) : schedule()
  }

  private _updateFolderProgress(
    t: typeof this.transfers[0], bytesDone: number, currentItem: string, itemDone: number,
    currentItemSize?: number,
  ): void {

    if (t.paused) return
    if (bytesDone > t.bytesDone) t.waitingForServer = false
    t.bytesDone = bytesDone
    t.currentItem = currentItem
    t.currentItemSize = currentItemSize
    t.itemDone = itemDone
    t.percent = t.bytesTotal > 0 ? Math.min(99, (bytesDone / t.bytesTotal) * 100) : t.itemCount > 0 ? Math.min(99, itemDone / t.itemCount * 100) : 0

    const now = Date.now()
    const lastUpdate = (t as any)._lastSpeedUpdate || 0
    const lastBytes = (t as any)._lastBytes || 0
    if (now - lastUpdate >= 500) {
      const deltaBytes = (t.bytesTransferred ?? bytesDone) - lastBytes
      const deltaTime = Math.max(1, now - lastUpdate)

      const baselineOk = lastUpdate > 0

      if (!baselineOk || deltaBytes > 0) (t as any)._lastGrowAt = now

      if (baselineOk && deltaBytes > 0) {
        t.speed = this._formatSpeed(deltaBytes, deltaTime)

        const inst = (deltaBytes * 1000) / deltaTime
        const prevBps = Number(t.speedBps) || 0
        t.speedBps = prevBps > 0 ? prevBps * 0.65 + inst * 0.35 : inst
      } else if (baselineOk) {

        const lastGrowAt = Number((t as any)._lastGrowAt) || now
        if (now - lastGrowAt >= SPEED_STALL_ZERO_MS && t.speed !== SPEED_STALL_ZERO_TEXT) {
          t.speed = SPEED_STALL_ZERO_TEXT
          t.speedBps = 0
        }
      }

      ;(t as any)._lastSpeedUpdate = now
      ;(t as any)._lastBytes = t.bytesTransferred ?? bytesDone
    }
    this._scheduleFolderProgressDetect()
  }

  private _finishFolderTransfer(
    t: typeof this.transfers[0], startTime: number, logEntryId: string, success: boolean,
  ): void {
    this._transferRuntime.unwatchFolder?.(t)
    this.transfers = this.transfers.filter(x => x !== t)
    if (this._folderProgressDetect) { clearTimeout(this._folderProgressDetect); this._folderProgressDetect = null }
    this._safeDetect()
    const now = Date.now()

    const patch: { success: boolean; duration: number; endTime: number; pending: boolean; size?: number } =
      { success, duration: now - startTime, endTime: now, pending: false }
    if (!(t.bytesTotal > 0) && t.bytesDone > 0) patch.size = t.bytesDone
    patch.size = t.bytesTransferred ?? t.bytesDone
    this.transferLog.update(logEntryId, patch)
  }

  private async uploadPathToRemote(
    remoteDir: string, localPath: string,
    _top?: FolderTransferCtx,
    batch?: FileOperationBatch,
    moveSource = false,
  ): Promise<boolean> {

    const slotBaseName = path.basename(localPath)
    const slotRemote = path.posix.join(remoteDir, slotBaseName)
    if (!_top && this._blockDuplicateTransfer('upload', slotRemote, localPath, slotBaseName)) return false

    const cancelRef = { current: null as any, active: new Set<any>() }
    this._cancelRefs.add(cancelRef)
    const prevRef = this._cancelRef
    this._cancelRef = cancelRef
    try {

      return await runInTaskScope(cancelRef, () =>
        this._transferCoordinator.uploadPathToRemote(remoteDir, localPath, _top, batch, moveSource))
    } finally {
      this._cancelRefs.delete(cancelRef)
      if (this._cancelRef === cancelRef) this._cancelRef = prevRef
      if (this._cancelRef && !this._cancelRef.current && !(this._cancelRef.active?.size)) this._cancelRef = null
    }
}

  protected async _base__doUpload(
    remotePath: string,
    localPath: string,
    logOperation?: 'upload' | 'edit-upload',
  ): Promise<boolean> {
    if (!this.sftpSession) return false
    return uploadLocalFile(this._byteTransferCtx(), remotePath, localPath, {
      track: true,
      logOperation,
    })
  }

  private async _base__doUploadRaw(remotePath: string, localPath: string, onProgress?: (bytes: number) => void): Promise<boolean> {
    if (!this.sftpSession) return false
    return uploadLocalFile(this._byteTransferCtx((onProgress as any)?.cancelRef), remotePath, localPath, {
      exposeCancel: true,
      onProgress,
    })
  }

  private async _base__doDownload(remotePath: string, localPath: string, mode?: number, size?: number): Promise<boolean> {
    if (!this.sftpSession) return false
    return downloadRemoteFile(this._byteTransferCtx(), remotePath, localPath, mode, size, {
      track: true,
    })
  }

  private async _base__doDownloadRaw(
    remotePath: string, localPath: string, mode?: number, size?: number,
    onProgress?: (bytes: number) => void,
  ): Promise<boolean> {
    if (!this.sftpSession) return false
    let dl: LocalPathFileDownload | null = null
    const timer = onProgress
      ? setInterval(() => { if (dl) onProgress(Number(dl.getCompletedBytes?.()) || 0) }, 400)
      : null
    try {
      return await downloadRemoteFile(this._byteTransferCtx(), remotePath, localPath, mode, size, {
        exposeCancel: true,
        onTransfer: (d) => { dl = d },
      })
    } finally {
      if (timer !== null) clearInterval(timer)
    }
  }

  private async _downloadTarBall(
    remotePath: string,
    localPath: string,
    size: number,
    onProgress?: (bytes: number) => void,
    shouldAbort?: () => boolean,
  ): Promise<boolean> {
    if (!this.sftpSession) return false
    let dl: LocalPathFileDownload | null = null
    const timer = setInterval(() => {
      if (shouldAbort?.() && dl && !dl.isCancelled() && !dl.isPaused()) void dl.cancel()
      if (dl && onProgress) onProgress(dl.getCompletedBytes())
    }, 400)
    try {
      return await downloadRemoteFile(this._byteTransferCtx(), remotePath, localPath, undefined, size, {
        onTransfer: (d) => { dl = d },

        shouldAbort: () => shouldAbort?.() === true,
      })
    } finally {
      clearInterval(timer)
    }
  }

  private _byteTransferCtx(taskRef?: TaskCancelRef | null) {
    return {
      session: this.sftpSession!,
      activeDownloadTargets: this._activeDownloadTargets,

      activeUploadTargets: this._activeUploadTargets,
      cancelRef: taskRef ?? currentTaskScope() ?? this._cancelRef,
      trackTransfer: (
        t: LocalPathFileUpload | LocalPathFileDownload,
        direction: 'upload' | 'download',
        remotePath: string,
        localPath: string,
        logOperation?: 'upload' | 'download' | 'edit-upload' | 'edit-download',
      ) => this.trackTransfer(t, direction, remotePath, localPath, logOperation as any),
      onUploadError: (_remotePath: string, localPath: string) => {
        const name = path.basename(localPath)
        const msg = this.i18n.t('notify.uploadFailed', { name })
        try { this.notifications?.error?.(msg, '') } catch { /* ignore */ }
      },
      onDownloadError: (remotePath: string) => {
        const name = path.basename(remotePath)
        const msg = this.i18n.t('notify.downloadFailed', { name })
        try { this.notifications?.error?.(msg, '') } catch { /* ignore */ }
      },
    }
  }

  private _showConflictDialog(): void {
    this._conflictResolver.showConflictDialog()
  }

  resolveConflict(action: string): void {
    this._conflictResolver.resolveConflict(action)
  }

  private _base_trackTransfer(
    t: any,
    direction: 'upload' | 'download',
    remotePath: string,
    localPath: string,
    logOperation?: 'upload' | 'download' | 'edit-upload' | 'edit-download',
  ): void {
    this._transferRuntime.trackTransfer(t, direction, remotePath, localPath, logOperation)

    if (this.transfers.length <= 1) {
      this.transfersMinimized = false
      this.transfersHidden = false
    }
  }

  protected _logEditorTransfer(
    operation: 'edit-upload' | 'edit-download',
    remotePath: string,
    localPath: string,
    size: number,
    success: boolean,
    startTime: number,
    failReason?: TransferLogEntry['failReason'],
  ): void {
    const now = Date.now()
    this.transferLog.add({
      operation,
      localPath,
      remotePath,
      profileName: this.profile?.name || undefined,
      success,
      size,
      duration: now - startTime,
      startTime,
      endTime: now,
      failReason,
    })
  }

  private _taskRefOf(entry: any): TaskCancelRef | null {
    return (entry?._taskCancelRef as TaskCancelRef | undefined) ?? this._cancelRef
  }

  _base_cancelTransfer(entry: { transfer: any; logEntryId?: string; paused?: boolean; isFolder?: boolean }): void {
    this._transferRuntime.cancelTransfer(entry)
    const removed = this._conflictQueue.filter(item => item.transferCtx?.t === entry || (!item.transferCtx && item.localPath === (entry as any).localPath && item.remotePath === (entry as any).remotePath))
    if (removed.length) {
      const headRemoved = removed.includes(this._conflictQueue[0])
      this._conflictQueue = this._conflictQueue.filter(item => !removed.includes(item))
      for (const item of removed) fileOperation.settle(item)
      if (headRemoved) { this.showConflictDialog = false; this.conflictData = null; if (this._conflictQueue.length) this._showConflictDialog() }
      this._safeDetect()
    }

    if ((entry as any).queued) return

    if (entry.isFolder) cancelAllInFlight(this._taskRefOf(entry))
  }

  cancelCurrentFile(entry: { isFolder?: boolean }): void {
    this._transferRuntime.cancelCurrentFile(entry)

    if (entry.isFolder) cancelAllInFlight(this._taskRefOf(entry))
  }

  _base_pauseTransfer(entry: any): void {
    this._transferRuntime.pauseTransfer(entry)
  }

  async _base_resumeTransfer(entry: any): Promise<void> {

    if (entry?.isFolder) (entry as any)._lastSpeedUpdate = 0
    await this._transferRuntime.resumeTransfer(entry)
  }

  _base_clearTransfers(): void {

    const refs = new Set<TaskCancelRef>()
    if (this._cancelRef) refs.add(this._cancelRef)
    for (const r of this._cancelRefs) refs.add(r)
    for (const t of this.transfers) {
      const r = (t as any)._taskCancelRef as TaskCancelRef | undefined
      if (r) refs.add(r)
    }
    this._transferRuntime.clearTransfers()
    for (const r of refs) cancelAllInFlight(r)
  }

  _base_openPermDialog(entry: SFTPFile): void {

    const rawMode = entry.mode
    if (rawMode == null || !Number.isFinite(Number(rawMode))) {
      if (this.sftpSession && typeof (this.sftpSession as any).stat === 'function') {
        void (this.sftpSession as any).stat(entry.fullPath).then((st: any) => {
          const m = Number(st?.mode ?? st?.attrs?.permissions ?? st?.attrs?.mode)
          if (!Number.isFinite(m)) {
            this.showToast(this.i18n.t('perm.modeUnknown') || 'Could not read permissions. Operation cancelled.')
            return
          }
          this.openPermDialog({ ...entry, mode: m })
        }).catch(() => {
          this.showToast(this.i18n.t('perm.modeUnknown') || 'Could not read permissions. Operation cancelled.')
        })
        return
      }
      this.showToast(this.i18n.t('perm.modeUnknown') || 'Could not read permissions. Operation cancelled.')
      return
    }
    this.permTargetPath = entry.fullPath
    this.permTargetName = entry.name
    const m = Number(rawMode) & 0o777
    this.permOwnerRead = (m & 0o400) !== 0
    this.permOwnerWrite = (m & 0o200) !== 0
    this.permOwnerExec = (m & 0o100) !== 0
    this.permGroupRead = (m & 0o040) !== 0
    this.permGroupWrite = (m & 0o020) !== 0
    this.permGroupExec = (m & 0o010) !== 0
    this.permOtherRead = (m & 0o004) !== 0
    this.permOtherWrite = (m & 0o002) !== 0
    this.permOtherExec = (m & 0o001) !== 0
    this.updatePermMode()
    this.showPermDialog = true
  }

  updatePermMode(): void {
    let m = 0
    if (this.permOwnerRead) m |= 0o400
    if (this.permOwnerWrite) m |= 0o200
    if (this.permOwnerExec) m |= 0o100
    if (this.permGroupRead) m |= 0o040
    if (this.permGroupWrite) m |= 0o020
    if (this.permGroupExec) m |= 0o010
    if (this.permOtherRead) m |= 0o004
    if (this.permOtherWrite) m |= 0o002
    if (this.permOtherExec) m |= 0o001
    this.permModePreview = m.toString(8).padStart(3, '0')
  }

  _base_confirmPermDialog(): void {
    if (!this.permTargetPath || !this.sftpSession) return
    const m = parseInt(this.permModePreview, 8)
    this.sftpSession.chmod(this.permTargetPath, m)
      .then(() => this.refreshRemote())
      .catch(e => {
        log.error('chmod failed', e)
        this.showToast(this.i18n.t('permission.chmodFailed') || 'Could not change permissions.', 3000)
      })
    this.showPermDialog = false
    this.permTargetPath = ''
  }

  cancelPermDialog(): void {
    this.showPermDialog = false
    this.permTargetPath = ''
  }

  private async _base__remoteEntryExists(parentPath: string, name: string): Promise<{exists:boolean;isDirectory:boolean}> {if(!this.sftpSession)throw Error('SFTP is disconnected');const entry=(await this.sftpSession.readdir(parentPath)).find(e=>e.name===name);return {exists:!!entry,isDirectory:!!entry?.isDirectory};}

  localNewFolder(): void { this.openInputDialog('local-mkdir', this.i18n.t('app.newFolder'), '', '', this.localPath) }
  localNewFile(): void { this.openInputDialog('local-touch', this.i18n.t('app.newFile'), '', '', this.localPath) }
  localRename(): void {
    if (this.selectedLocal.length !== 1) return
    this.openInputDialog('local-rename', this.i18n.t('app.rename'), this.selectedLocal[0].name, this.selectedLocal[0].name, this.selectedLocal[0].fullPath)
  }

  onWindowKeyDown(event: KeyboardEvent): void {

    if ((event as any).__sftpPlusPanelHotkeyHandled) return
    this._handlePanelWindowHotkey(event)
  }

  private _capturePanelHotkeysBeforeTabby(event: KeyboardEvent): void {
    if (!this._isPanelActive) return
    if (this._isPanelModalOpen()) return
    if (!this._isPanelDomFocused() && !this._panelOwnsClipboardHotkeys) return
    if (this._isPanelTyping(event)) return

    if (this._isTerminalFocusTarget(event)) return
    if (!this._eventWouldConsumePanelHotkey(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    ;(event as any).__sftpPlusPanelHotkeyHandled = true

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this.zone.runOutsideAngular(() => this._handlePanelWindowHotkey(event))
      return
    }
    this.zone.run(() => this._handlePanelWindowHotkey(event))
  }

  private _resolveContextHotkeyPane(a: PanelHotkeyAction): 'local' | 'remote' {
    if (a === 'upload' || a === 'openLocal') return 'local'
    if (a === 'download') return 'remote'
    return this._resolveTargetPane()
  }

  private _contextHotkeyReady(a: PanelHotkeyAction, pane: 'local' | 'remote'): boolean {
    if (a === 'upload') return this.selectedLocal.length > 0
    if (a === 'download') return this.selectedRemote.length > 0
    if (a === 'newFolder' || a === 'newFile') return true
    const sel = pane === 'local' ? this.selectedLocal : this.selectedRemote
    if (a === 'details' || a === 'copyPath') return sel.length > 0
    if (a === 'openLocal') return pane === 'local' && sel.length === 1
    if (a === 'viewFile' || a === 'editFile') {
      if (sel.length !== 1) return false
      const e = sel[0]
      return a === 'viewFile' ? this.canViewEntry(e) : this.canEditEntry(e)
    }
    return true
  }

  private static readonly _CTX_HOTKEYS_NEED_ENTRY: ReadonlySet<string> = new Set([
    'openLocal', 'viewFile', 'editFile', 'details', 'copyPath',
  ])

  private _eventWouldConsumePanelHotkey(event: KeyboardEvent): boolean {

    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown')
      && !event.ctrlKey && !event.metaKey && !event.altKey
      && this._arrowNavPane) {
      return true
    }
    if (this._panelHotkeyEnabled('up') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('up'))) {
      return true
    }
    if (this._panelHotkeyEnabled('delete') && this._matchPanelHotkeyKeysIgnoreShift(event, this._panelHotkeyKeys('delete'))) {
      const side = this._resolveTargetPane()
      const sel = side === 'local' ? this._selectedLocal : this._selectedRemote
      return !!(sel && sel.length > 0)
    }
    if (this._panelHotkeyEnabled('rename') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('rename'))) {
      const pane = this._resolveTargetPane()
      if (pane === 'local' && this.selectedLocal.length === 1) return true
      if (pane === 'remote' && this.selectedRemote.length === 1) return true
      return false
    }
    if (this._panelHotkeyEnabled('refresh') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('refresh'))) {
      return true
    }
    for (const a of CONTEXT_ACTION_HOTKEYS) {
      if (!this._panelHotkeyEnabled(a)) continue
      if (!matchPanelHotkeyKeys(event, this._panelHotkeyKeys(a))) continue
      const pane = this._resolveContextHotkeyPane(a)
      if (!this._contextHotkeyReady(a, pane)) continue
      return true
    }
    return false
  }

  private _handlePanelWindowHotkey(event: KeyboardEvent): void {

    if (!this._isPanelActive) return

    if (this._isPanelModalOpen()) return

    if (!this._isPanelDomFocused() && !this._panelOwnsClipboardHotkeys) return

    if (this._isPanelTyping(event)) return

    if (this._isTerminalFocusTarget(event)) return

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this._clearTypeAhead()

      if (event.ctrlKey || event.metaKey || event.altKey) return

      const side = this._arrowNavPane
      if (!side) return

      if (!this._handleArrowNav(side, event.key === 'ArrowDown', event.shiftKey)) return
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (this._panelHotkeyEnabled('up') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('up'))) {
      event.preventDefault()
      event.stopPropagation()
      const pane = this._resolveTargetPane()
      if (pane === 'local') this.localUp()
      else this.remoteUp()
      return
    }

    if (this._panelHotkeyEnabled('delete') && this._matchPanelHotkeyKeysIgnoreShift(event, this._panelHotkeyKeys('delete'))) {
      const side = this._resolveTargetPane()
      const sel = side === 'local' ? this._selectedLocal : this._selectedRemote
      if (sel && sel.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        this._paneDelete(side, event.shiftKey)
      }
      return
    }

    if (this._panelHotkeyEnabled('rename') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('rename'))) {
      const pane = this._resolveTargetPane()
      if (pane === 'local' && this.selectedLocal.length === 1) {
        event.preventDefault()
        event.stopPropagation()
        this.localRename()
      } else if (pane === 'remote' && this.selectedRemote.length === 1) {
        event.preventDefault()
        event.stopPropagation()
        this.remoteRename()
      }
      return
    }

    if (this._panelHotkeyEnabled('refresh') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('refresh'))) {
      event.preventDefault()
      event.stopPropagation()
      const pane = this._resolveTargetPane()
      if (pane === 'local') void this.refreshLocal()
      else void this.refreshRemote()
      return
    }

    for (const a of CONTEXT_ACTION_HOTKEYS) {
      if (!this._panelHotkeyEnabled(a)) continue
      if (!matchPanelHotkeyKeys(event, this._panelHotkeyKeys(a))) continue
      const pane = this._resolveContextHotkeyPane(a)
      if (!this._contextHotkeyReady(a, pane)) continue
      event.preventDefault()
      event.stopPropagation()
      this.contextMenuPane = pane
      if (SftpFloatingPanel._CTX_HOTKEYS_NEED_ENTRY.has(a)) {
        const sel = pane === 'local' ? this.selectedLocal : this.selectedRemote
        this.contextMenuEntry = (sel[0] as any) ?? null
      }
      this.onContextMenuAction(a as ContextMenuAction)
      return
    }

    if (this._isPanelDomFocused() && this._tryTypeAheadFind(event)) return
  }

  private _clearTypeAhead(): void {
    this._typeAheadBuf = ''
    this._typeAheadLastHitPrefix = ''
    if (this._typeAheadResetTimer) {
      clearTimeout(this._typeAheadResetTimer)
      this._typeAheadResetTimer = null
    }
  }

  private _bumpTypeAheadTimer(): void {
    if (this._typeAheadResetTimer) clearTimeout(this._typeAheadResetTimer)
    this._typeAheadResetTimer = setTimeout(() => {

      this._typeAheadBuf = ''
      this._typeAheadResetTimer = null
    }, SftpFloatingPanel._TYPE_AHEAD_RESET_MS)
  }

  private _tryTypeAheadFind(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false

    if (event.isComposing || event.key === 'Process') return false
    if (event.key === 'Backspace') return false

    if (event.key.length !== 1) return false
    if (event.key.charCodeAt(0) < 32) return false

    if (event.key.charCodeAt(0) > 127 && Date.now() - this._typeAheadLastComposeAt < 80) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }

    event.preventDefault()
    event.stopPropagation()
    return this._typeAheadConsumeChar(event.key)
  }

  onTypeAheadCompositionEnd(ev: CompositionEvent): void {
    if (!this._isPanelActive) return
    if (this._isPanelModalOpen()) return
    const el = document.activeElement as HTMLElement | null
    if (el && this.elRef?.nativeElement?.contains(el)) {
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as any).isContentEditable) return
    }
    const data = (ev.data || '').normalize('NFC')
    if (!data) return
    this._typeAheadLastComposeAt = Date.now()
    for (const ch of data) {
      if (ch.charCodeAt(0) < 32) continue
      this._typeAheadConsumeChar(ch)
    }
  }

  private _typeAheadConsumeChar(rawCh: string): boolean {
    const side = this._arrowNavPane || this._resolveTargetPane()
    if (!side) return false
    const ch = rawCh.normalize('NFC')
    if (!ch) return false

    const prev = this._typeAheadBuf
    let mode: 'append' | 'cycle' | 'fresh' = 'fresh'
    if (!prev) {
      this._typeAheadBuf = ch
      mode = 'fresh'
    } else if (prev.length === 1 && this._typeAheadNorm(prev) === this._typeAheadNorm(ch)) {
      mode = 'cycle'
    } else {
      this._typeAheadBuf = prev + ch
      mode = 'append'
    }
    this._bumpTypeAheadTimer()
    let hit = this._applyTypeAhead(side, mode)

    if (!hit && mode === 'append') {
      if (prev.length >= 2) {
        this._typeAheadBuf = ch
        this._applyTypeAhead(side, 'fresh')
      } else {
        this._typeAheadBuf = prev
      }
    }
    return true
  }

  private _typeAheadNorm(s: string): string {
    return s.normalize('NFC').toLocaleLowerCase()
  }

  private _applyTypeAhead(side: 'local' | 'remote', mode: 'append' | 'cycle' | 'fresh'): boolean {
    const prefix = this._typeAheadNorm(this._typeAheadBuf)
    if (!prefix) return false

    const pick = <T extends { name: string; fullPath: string }>(
      list: T[],
      selectedPaths: Set<string>,
    ): number => {
      if (!list.length) return -1
      const cur = selectedPaths.size > 0
        ? list.findIndex(e => e.fullPath === [...selectedPaths][0])
        : -1
      const currentMatches = cur >= 0 && this._typeAheadNorm(list[cur].name || '').startsWith(prefix)
      const lastHit = this._typeAheadLastHitPrefix

      const findFrom = (start: number): number => {
        for (let i = start; i < list.length; i++) {
          if (this._typeAheadNorm(list[i].name || '').startsWith(prefix)) return i
        }
        return -1
      }
      const nextAfterCurrent = (): number => {
        if (cur < 0) return findFrom(0)
        let idx = findFrom(cur + 1)
        if (idx < 0) idx = findFrom(0)
        return idx
      }

      if (mode === 'cycle') return nextAfterCurrent()

      if (mode === 'append' && currentMatches) {
        if (prefix === lastHit) return nextAfterCurrent()
        return cur
      }

      if (mode === 'append') return findFrom(0)

      if (currentMatches) return nextAfterCurrent()
      return findFrom(0)
    }

    if (side === 'local') {
      const list = this.getFilteredLocalEntries()
      if (!list || !list.length) return false
      const idx = pick(list, this._localSelectedPaths)
      if (idx < 0) return false
      if (this.selectedRemote.length) this.selectedRemote = []
      this.selectedLocal = [list[idx]]
      this.localLastSelectedIndex = idx
      this._arrowNavPane = 'local'
      this._typeAheadLastHitPrefix = prefix
      this.syncPaneSelectionVisual('local')
      this._safeDetect()
      this._scrollEntryIntoView('local', list[idx], 'center')
      return true
    }

    const list = this.getFilteredRemoteEntries()
    if (!list || !list.length) return false
    const idx = pick(list, this._remoteSelectedPaths)
    if (idx < 0) return false
    if (this.selectedLocal.length) this.selectedLocal = []
    this.selectedRemote = [list[idx]]
    this.remoteLastSelectedIndex = idx
    this._arrowNavPane = 'remote'
    this._typeAheadLastHitPrefix = prefix
    this.syncPaneSelectionVisual('remote')
    this._safeDetect()
    this._scrollEntryIntoView('remote', list[idx], 'center')
    return true
  }

  localDelete(): void { this._paneDelete('local', false) }
  remoteNewFolder(): void {
    if (!this.connected) return
    this.openInputDialog('remote-mkdir', this.i18n.t('app.newFolder'), '', '', this.remotePath)
  }
  remoteNewFile(): void {
    if (!this.connected) return
    this.openInputDialog('remote-touch', this.i18n.t('app.newFile'), '', '', this.remotePath)
  }
  remoteRename(): void {
    if (this.selectedRemote.length !== 1 || !this.connected) return
    this.openInputDialog('remote-rename', this.i18n.t('app.rename'), this.selectedRemote[0].name, this.selectedRemote[0].name, '', this.selectedRemote[0].fullPath)
  }
  remoteDelete(): void { this._paneDelete('remote') }

  private _paneDelete(side: 'local' | 'remote', forcePermanent?: boolean): void {
    const sel = side === 'local' ? this.selectedLocal : this.selectedRemote
    if (!sel.length) return

    this.deleteToTrash = side === 'local' && !(forcePermanent ?? false)
    if (side === 'local') this.pendingLocalDelete = sel.slice() as LocalEntry[]
    else this.pendingRemoteDelete = sel.slice() as SFTPFile[]
    this.prepareDeleteConfirm(sel, side)
    this.deleteConfirmVisible = true
  }
  remoteChmod(): void {
    if (this.selectedRemote.length !== 1) return
    this.openPermDialog(this.selectedRemote[0])
  }

  private _base_openInputDialog(mode: NonNullable<SftpFloatingPanel['inputDialogMode']>, title: string, placeholder: string, value: string, targetPath: string, remotePath?: string): void {
    this.inputDialogMode = mode
    this.inputDialogTitle = title
    this.inputDialogPlaceholder = placeholder
    this.inputDialogValue = value
    this.inputDialogTargetPath = targetPath
    this.inputDialogRemotePath = remotePath ?? null
    this.inputDialogVisible = true

  }

  _base_cancelInputDialog(): void { this.inputDialogVisible = false; this.inputDialogMode = null; this.inputDialogValue = '' }

  private prepareDeleteConfirm(entries: Array<LocalEntry | SFTPFile>, side: 'local' | 'remote'): void {
    this.deleteItemLocation = this._deleteTargetsLocation(entries, side)
    if (entries.length === 1) {
      const e = entries[0]
      this.deleteConfirmBatch = false
      this.deleteItemName = e.name
      this.deleteItemIsDir = e.isDirectory
      this.deleteItemType = e.isDirectory ? '' : this.getFileTypeName(e.name)
      const size = (e as any).size
      this.deleteItemSize = e.isDirectory ? null : (size != null ? this.formatFileSize(size) : null)
      const mtime = (e as SFTPFile).modified ?? ((e as LocalEntry).mtimeMs ? new Date((e as LocalEntry).mtimeMs!) : null)
      this.deleteItemDate = mtime ? this.formatDeleteDate(mtime) : ''
    } else {
      this.deleteConfirmBatch = true
      const count = entries.length
      this.batchDeleteText = this.i18n.t('app.deleteConfirmMultiple').replace('{count}', String(count))
    }
  }

  private _deleteTargetsLocation(entries: Array<LocalEntry | SFTPFile>, side: 'local' | 'remote'): string {
    const dirname = side === 'local' ? path.dirname.bind(path) : path.posix.dirname.bind(path.posix)
    const dirs: string[] = []
    for (const e of entries) {
      if (!e?.fullPath) continue
      const d = dirname(e.fullPath)
      if (!dirs.includes(d)) dirs.push(d)
    }
    if (!dirs.length) return ''
    return dirs.length === 1 ? dirs[0] : dirs.join('  |  ')
  }

  getFileTypeName(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
    const map: Record<string, string> = {
      txt: this.i18n.t('fileType.txt'),
      log: this.i18n.t('fileType.log'),
      md: this.i18n.t('fileType.md'),
      json: this.i18n.t('fileType.json'),
      xml: this.i18n.t('fileType.xml'),
      yml: this.i18n.t('fileType.data'),
      yaml: this.i18n.t('fileType.data'),
      cfg: this.i18n.t('fileType.config'),
      ini: this.i18n.t('fileType.config'),
      toml: this.i18n.t('fileType.config'),
      js: this.i18n.t('fileType.js'),
      ts: this.i18n.t('fileType.ts'),
      jsx: this.i18n.t('fileType.js'),
      tsx: this.i18n.t('fileType.ts'),
      py: this.i18n.t('fileType.code'),
      java: this.i18n.t('fileType.code'),
      cpp: this.i18n.t('fileType.code'),
      c: this.i18n.t('fileType.code'),
      h: this.i18n.t('fileType.code'),
      go: this.i18n.t('fileType.code'),
      rs: this.i18n.t('fileType.code'),
      rb: this.i18n.t('fileType.code'),
      php: this.i18n.t('fileType.code'),
      html: this.i18n.t('fileType.html'),
      htm: this.i18n.t('fileType.html'),
      css: this.i18n.t('fileType.css'),
      scss: this.i18n.t('fileType.css'),
      less: this.i18n.t('fileType.css'),
      vue: this.i18n.t('fileType.code'),
      svelte: this.i18n.t('fileType.code'),
      png: this.i18n.t('fileType.image'),
      jpg: this.i18n.t('fileType.image'),
      jpeg: this.i18n.t('fileType.image'),
      gif: this.i18n.t('fileType.image'),
      svg: this.i18n.t('fileType.image'),
      ico: this.i18n.t('fileType.image'),
      bmp: this.i18n.t('fileType.image'),
      webp: this.i18n.t('fileType.image'),
      pdf: this.i18n.t('fileType.doc'),
      doc: this.i18n.t('fileType.doc'),
      docx: this.i18n.t('fileType.doc'),
      xls: this.i18n.t('fileType.doc'),
      xlsx: this.i18n.t('fileType.doc'),
      ppt: this.i18n.t('fileType.doc'),
      pptx: this.i18n.t('fileType.doc'),
      zip: this.i18n.t('fileType.archive'),
      rar: this.i18n.t('fileType.archive'),
      tar: this.i18n.t('fileType.archive'),
      gz: this.i18n.t('fileType.archive'),
      '7z': this.i18n.t('fileType.archive'),
      bz2: this.i18n.t('fileType.archive'),
      mp3: this.i18n.t('fileType.audio'),
      wav: this.i18n.t('fileType.audio'),
      flac: this.i18n.t('fileType.audio'),
      ogg: this.i18n.t('fileType.audio'),
      mp4: this.i18n.t('fileType.video'),
      avi: this.i18n.t('fileType.video'),
      mkv: this.i18n.t('fileType.video'),
      mov: this.i18n.t('fileType.video'),
      exe: this.i18n.t('fileType.executable'),
      dll: this.i18n.t('fileType.executable'),
      so: this.i18n.t('fileType.executable'),
      sh: this.i18n.t('fileType.executable'),
      bat: this.i18n.t('fileType.executable'),
      sql: this.i18n.t('fileType.data'),
      db: this.i18n.t('fileType.data'),
      sqlite: this.i18n.t('fileType.data'),
      iso: this.i18n.t('fileType.archive'),
      img: this.i18n.t('fileType.archive'),
      env: this.i18n.t('fileType.config'),
      pem: this.i18n.t('fileType.cert'),
      key: this.i18n.t('fileType.cert'),
      crt: this.i18n.t('fileType.cert'),
      lock: this.i18n.t('fileType.config'),
      gitignore: this.i18n.t('fileType.config'),
      dockerfile: this.i18n.t('fileType.config'),
    }
    return map[ext] || (ext ? `${ext.toUpperCase()} ${this.i18n.t('fileType.unknown')}` : this.i18n.t('fileType.unknown'))
  }

  formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = Math.floor(Math.log(bytes) / Math.log(1024))
    if (i >= units.length) i = units.length - 1
    const val = bytes / Math.pow(1024, i)
    return `${val >= 10 ? Math.round(val) : val.toFixed(1)} ${units[i]}`
  }

  formatDeleteDate(d: Date): string {
    return formatDate(d.getTime())
  }

  async _base_confirmInputDialog(): Promise<void> {
    if ((!this.inputDialogVisible && !this._customInlineEdit) || !this.inputDialogMode || this._inputBusy) return
    const mode = this.inputDialogMode
    const rawVal = this.inputDialogValue.trim()
    const tp = this.inputDialogTargetPath
    const rp = this.inputDialogRemotePath
    if (!rawVal || !tp && !rp) return

    const val = mode === 'remote-chmod' ? rawVal : (safeEntryName(rawVal) || '')
    if (mode !== 'remote-chmod' && !val) {
      const message = this.i18n.t('op.failed', { reason: 'invalid name' }) || 'Invalid name'
      if (this._customInlineEdit) this._customInlineUpdate({ error: message })
      this.showToast(message, 3000)
      return
    }

    this._inputBusy = true
    try {
      switch (mode) {
        case 'local-mkdir': {
          const existing = safeJoinUnder(tp!, val, false)
          if (!existing) { this.showToast(this.i18n.t('op.failed', { reason: 'invalid name' }) || 'Invalid name', 3000); break }
          let exType: 'file' | 'dir' | null = null
          try { const st = await fs.stat(existing); exType = st.isDirectory() ? 'dir' : 'file' } catch {   }
          if (exType === 'dir') { this._showInputConflict('dir-dup', val); break }
          if (exType === 'file') { this._showInputConflict('file-when-mkdir', val); break }
          await fs.mkdir(existing, { recursive: true }); this.cancelInputDialog(); await this.refreshLocal(); break
        }
        case 'local-rename': {
          const newPath = safeJoinUnder(this.localPath, val, false)
          if (!newPath) { this.showToast(this.i18n.t('op.failed', { reason: 'invalid name' }) || 'Invalid name', 3000); break }
          const sameLocalFile = process.platform === 'win32' && path.resolve(newPath).toLowerCase() === path.resolve(tp!).toLowerCase()
            && await fs.stat(tp!, { bigint: true }).then(async source => { const target = await fs.stat(newPath, { bigint: true }).catch(() => null); return !!target && source.ino !== BigInt(0) && source.ino === target.ino && source.dev === target.dev })
          if (newPath !== tp && !sameLocalFile) {
            let exType: 'file' | 'dir' | null = null
            try { const st = await fs.stat(newPath); exType = st.isDirectory() ? 'dir' : 'file' } catch {   }
            if (exType === 'dir') { this._showInputConflict('dir-dup', val); break }
            if (exType === 'file') { this._showInputConflict('file-dup', val); break }
          }
          await fs.rename(tp!, newPath); this.cancelInputDialog(); await this.refreshLocal(); break
        }
        case 'remote-mkdir': {
          if (!this.sftpSession) return
          const dest = safeJoinUnder(tp!, val, true)
          if (!dest) { this.showToast(this.i18n.t('op.failed', { reason: 'invalid name' }) || 'Invalid name', 3000); break }
          const r = await this._remoteEntryExists(tp!, val)
          if (r.isDirectory) { this._showInputConflict('dir-dup', val); break }
          if (r.exists) { this._showInputConflict('file-when-mkdir', val); break }
          await this.sftpSession.mkdir(dest); this.cancelInputDialog(); await this.refreshRemote(); break
        }
        case 'local-touch': {
          const newPath = safeJoinUnder(tp!, val, false)
          if (!newPath) { this.showToast(this.i18n.t('op.failed', { reason: 'invalid name' }) || 'Invalid name', 3000); break }
          let exType: 'file' | 'dir' | null = null
          try { const st = await fs.stat(newPath); exType = st.isDirectory() ? 'dir' : 'file' } catch {   }
          if (exType === 'dir') { this._showInputConflict('dir-when-touch', val); break }
          if (exType === 'file') { this._showInputConflict('file-dup', val); break }
          await fs.writeFile(newPath, '', { flag: 'wx' }); this.cancelInputDialog(); await this.refreshLocal(); break
        }
        case 'remote-touch': {
          if(!this.sftpSession)return
          const dest=safeJoinUnder(tp!,val,true)
          if(!dest)throw Error('Invalid filename')
          const r=await this._remoteEntryExists(tp!,val)
          if(r.exists){this._showInputConflict(r.isDirectory?'dir-when-touch':'file-dup',val);break}
          await require('../runtime/new-file.cjs')(this.sftpSession,dest,(file:string)=>this._customSetCreatedFilePermissions(file))
          this.cancelInputDialog();await this.refreshRemote();break
        }
        case 'remote-rename': {
          if (!this.sftpSession) return
          const newPath = safeJoinUnder(this.remotePath, val, true)
          if (!newPath) { this.showToast(this.i18n.t('op.failed', { reason: 'invalid name' }) || 'Invalid name', 3000); break }
          if (newPath !== rp) {
            const r = await this._remoteEntryExists(this.remotePath, val)
            if (r.isDirectory) { this._showInputConflict('dir-dup', val); break }
            if (r.exists) { this._showInputConflict('file-dup', val); break }
          }
          if (newPath !== rp) await this.sftpSession.rename(rp!, newPath); this.cancelInputDialog(); await this.refreshRemote(); break
        }
        case 'remote-chmod':
          if (!this.sftpSession) return
          if (!/^[0-7]{3,4}$/.test(val)) return
          const m = parseInt(val, 8)
          if (!isNaN(m)) { await this.sftpSession.chmod(rp!, m); this.cancelInputDialog(); await this.refreshRemote() }
          break
      }
    } catch (e) {
      log.error('Operation failed', e)
      const reason = (e as Error)?.message || String(e)
      if (this._customInlineEdit) this._customInlineUpdate({ error: reason })
      const mode = this.inputDialogMode || ''

      if (mode.includes('rename')) {
        this.showToast(this.i18n.t('op.renameFailed', { reason }), 4000)
      } else if (mode.includes('mkdir')) {
        this.showToast(this.i18n.t('op.mkdirFailed', { reason }), 4000)
      } else if (mode.includes('touch')) {
        this.showToast(this.i18n.t('op.touchFailed', { reason }), 4000)
      } else if (mode.includes('chmod')) {
        this.showToast(this.i18n.t('op.chmodFailed', { reason }), 4000)
      } else {
        this.showToast(this.i18n.t('op.failed', { reason }), 4000)
      }
    } finally {
      this._inputBusy = false
    }
  }

  private _showInputConflict(kind: 'dir-dup' | 'file-dup' | 'file-when-mkdir' | 'dir-when-touch', val: string): void {
    const key = kind === 'dir-dup' ? 'input.dirExists'
      : kind === 'file-dup' ? 'input.fileExists'
      : kind === 'file-when-mkdir' ? 'input.fileWhenMkdir'
      : 'input.dirWhenTouch'

    const message = this.i18n.t(key, { val })
    if (this._customInlineEdit) this._customInlineUpdate({ error: message })
    this.showToast(message, 3000)
  }

  async _base_confirmDelete(): Promise<void> {

    if (this._deleteBusy) return
    this._deleteBusy = true
    this.deleteConfirmVisible = false
    const localPending = this.pendingLocalDelete.slice()
    const remotePending = this.pendingRemoteDelete.slice()
    this.pendingLocalDelete = []
    this.pendingRemoteDelete = []
    const failed: string[] = []
    const trashFailed: string[] = []
    try {
      if (localPending.length) {
        if (this.deleteToTrash) {

          for (const e of localPending) {
            try {
              await trashLocalPath(e.fullPath, !!(e as any).isDirectory)
            } catch (err) {
              trashFailed.push(e.fullPath)
              log.error('trash failed for', e.fullPath, err)
            }
          }
        } else {

          const delLim = new ConcurrencyLimiter(8)
          await Promise.all(localPending.map(async (e) => {
            if ((e as any).isDirectory) {
              try { await fs.rm(e.fullPath, { recursive: true, force: true }); return }
              catch (err) { log.warn('fs.rm failed, fallback to recursive:', e.fullPath, err) }
            }
            await deleteLocalRecursive(e.fullPath, failed, 0, delLim)
          }))
        }
        await this.refreshLocal(); this.selectedLocal = []
      }
      if (remotePending.length && this.sftpSession) {

        const delLim = new ConcurrencyLimiter(8)
        await Promise.all(remotePending.map(async (e) => {
          if ((e as any).isDirectory && await tryRemoteRmViaSsh(this.sshSession, e.fullPath)) return
          await deleteRemoteRecursive(this.sftpSession, e.fullPath, failed, 0, delLim)
        }))
        await this.refreshRemote(); this.selectedRemote = []
      }
    } catch (e) { log.error('Delete failed', e) }
    finally { this._deleteBusy = false }
    if (failed.length) {
      this.showToast(this.i18n.t('notify.deleteFailed', { n: failed.length }), 4000)
    }
    if (trashFailed.length) {
      this.showToast(
        this.i18n.t('notify.trashFailed', { n: trashFailed.length })
          || `Could not move ${trashFailed.length} items to the Recycle Bin. Files were retained; use Shift+Delete to delete permanently.`,
        6000,
      )
    }
  }

  cancelDelete(): void {
    this.deleteConfirmVisible = false
    this.pendingLocalDelete = []
    this.pendingRemoteDelete = []
    this._deleteBusy = false
  }

  get transferLogTotalCount(): number {
    return this.transferLog.filter({
      profileName: this.profile?.name || undefined,
    }).length
  }

  get transferLogClearableCount(): number {
    return this.transferLog.countClearable(this.profile?.name || undefined)
  }

  get filteredTransferLogs(): TransferLogEntry[] {
    const filter: {
      operation?: TransferLogEntry['operation']
      success?: boolean
      profileName?: string
      since?: number
      until?: number
    } = {
      operation: this.logFilterOp || undefined,
      profileName: this.profile?.name || undefined,
      ...this._getLogTimeBounds(),
    }
    if (this.logFilterStatus === 'success') filter.success = true
    else if (this.logFilterStatus === 'failed') filter.success = false
    return this.transferLog.filter(filter)
  }

  private _getLogTimeBounds(): { since?: number; until?: number } {
    const now = Date.now()
    switch (this.logFilterTimeRange) {
      case 'today': {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        return { since: start.getTime(), until: now }
      }
      case '7d':
        return { since: now - 7 * 24 * 60 * 60 * 1000, until: now }
      case '30d':
        return { since: now - 30 * 24 * 60 * 60 * 1000, until: now }
      case 'custom': {
        const bounds: { since?: number; until?: number } = {}
        if (this.logFilterDateFrom) bounds.since = this._parseLogDateStart(this.logFilterDateFrom)
        if (this.logFilterDateTo) bounds.until = this._parseLogDateEnd(this.logFilterDateTo)
        return bounds
      }
      default:
        return {}
    }
  }

  private _parseLogDateStart(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }

  private _parseLogDateEnd(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
  }

  toggleTransferLog(): void {
    if (!this.showTransferLog) {

      this.transferLog.reload()
      this._safeDetect()
    }
    this.showTransferLog = !this.showTransferLog
  }

  exportLog(): void {
    const json = this.transferLog.exportAsJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `sftp-plus-log-${new Date().toISOString().slice(0, 10)}.json`
    a.click()

    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  _base_clearLog(): void {
    const profileName = this.profile?.name

    if (this.transferLogClearableCount <= 0) return
    if (!confirm(this.i18n.t('transfer.clearConfirm'))) return
    if (profileName) {
      this.transferLog.clearProfile(profileName)
    } else {
      this.transferLog.clear()
    }
  }

  onLocalContextMenu(entry: LocalEntry, ev: MouseEvent): void { this._onPaneContextMenu('local', entry, ev) }
  onRemoteContextMenu(entry: SFTPFile, ev: MouseEvent): void { this._onPaneContextMenu('remote', entry, ev) }

  private _onPaneContextMenu(side: 'local' | 'remote', entry: { fullPath: string }, ev: MouseEvent): void {
    this._rubberBand.clearContextMenuSuppress()
    if (this._rubberBand.active) { ev.preventDefault(); return }
    if (this._rubberBand.skipNextContextMenu) { ev.preventDefault(); return }
    ev.preventDefault()
    ev.stopPropagation()
    this.headerMenuVisible = false
    this.headerMenuCol = null
    if (side === 'local') {
      if (this.localClickTimer) { clearTimeout(this.localClickTimer); this.localClickTimer = null }
      if (!this._localSelectedPaths.has(entry.fullPath)) {
        this.selectedLocal = [entry as any]; this.selectedRemote = []
        this.localLastSelectedIndex = this.getFilteredLocalEntries().findIndex(e => e.fullPath === entry.fullPath)
      }
    } else {
      if (this.remoteClickTimer) { clearTimeout(this.remoteClickTimer); this.remoteClickTimer = null }
      if (!this._remoteSelectedPaths.has(entry.fullPath)) {
        this.selectedRemote = [entry as any]; this.selectedLocal = []
        this.remoteLastSelectedIndex = this.getFilteredRemoteEntries().findIndex(e => e.fullPath === entry.fullPath)
      }
    }
    this.syncPaneSelectionVisual(side)
    this.zone.run(() => {
      this.closeBookmarks()
      this.contextMenuPane = side
      this.contextMenuEntry = entry as any
      this.contextMenuX = ev.clientX
      this.contextMenuY = ev.clientY
      this.contextMenuVisible = true
      this._safeDetect()
      this.fixContextMenuPosition(ev.clientX, ev.clientY)
    })
  }

  private fixContextMenuPosition(anchorX: number, anchorY: number): void {

    setTimeout(() => {
      const menuEl = this.elRef.nativeElement.querySelector('.context-menu') as HTMLElement | null
      if (!menuEl || !this.contextMenuVisible) return
      const rect = menuEl.getBoundingClientRect()
      const margin = 8
      let x = anchorX
      let y = anchorY

      const vv = (window as any).visualViewport
      const vw = vv ? vv.width : window.innerWidth
      const vh = vv ? vv.height : window.innerHeight

      if (x + rect.width > vw - margin) {
        x = Math.max(margin, vw - rect.width - margin)
      }

      if (y + rect.height > vh - margin) {
        y = Math.max(margin, vh - rect.height - margin)
      }

      if (x < margin) x = margin
      if (y < margin) y = margin

      if (x !== this.contextMenuX || y !== this.contextMenuY) {
        this.contextMenuX = x
        this.contextMenuY = y
        this._safeDetect()
      }
    }, 0)
  }

  onPaneScroll(): void {
    if (this.contextMenuVisible) {
      this.contextMenuVisible = false
      this.contextMenuEntry = null
    }
    if (this.headerMenuVisible) {
      this.headerMenuVisible = false
      this.headerMenuCol = null
    }
  }

  closeContextMenu(): void {
    this.contextMenuVisible = false
    this.contextMenuEntry = null
  }

  ctxNewFolder(): void {
    this.closeContextMenu()
    if (this.contextMenuPane === 'local') this.localNewFolder()
    else this.remoteNewFolder()
  }

  ctxNewFile(): void {
    this.closeContextMenu()
    if (this.contextMenuPane === 'local') this.localNewFile()
    else this.remoteNewFile()
  }

  ctxRename(): void {
    this.closeContextMenu()
    if (this.contextMenuPane === 'local') this.localRename()
    else this.remoteRename()
  }

  ctxDelete(): void {
    this.closeContextMenu()
    if (this.contextMenuPane === 'local') this.localDelete()
    else this.remoteDelete()
  }

  ctxRefresh(): void {
    this.closeContextMenu()
    if (this.contextMenuPane === 'local') this.refreshLocal()
    else this.refreshRemote()
  }

  ctxSelectAll(): void {
    this.closeContextMenu()
    if (this.contextMenuPane === 'local') {
      const all = this.getFilteredLocalEntries()
      this.selectedLocal = this.selectedLocal.length === all.length ? [] : [...all]
    } else {
      const all = this.getFilteredRemoteEntries()
      this.selectedRemote = this.selectedRemote.length === all.length ? [] : [...all]
    }
  }

  ctxSelectInvert(): void {
    this.closeContextMenu()
    if (this.contextMenuPane === 'local') {
      const all = this.getFilteredLocalEntries()
      this.selectedLocal = all.filter(e => !this._localSelectedPaths.has(e.fullPath))
    } else {
      const all = this.getFilteredRemoteEntries()
      this.selectedRemote = all.filter(e => !this._remoteSelectedPaths.has(e.fullPath))
    }
    this.syncPaneSelectionVisual(this.contextMenuPane)
  }

  ctxCopyPath(): void {
    const pane = this.contextMenuPane
    const selected = pane === 'local' ? this.selectedLocal : this.selectedRemote
    const paths = (selected.length > 0 ? selected : (this.contextMenuEntry ? [this.contextMenuEntry] : []))
      .map(e => this.getEntryPath(e))
      .filter(Boolean)
    if (paths.length && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(paths.join(' ')).then(() => {
        this._notifyPathCopied(paths.length)
      }).catch(() => {})
    }
    this.closeContextMenu()
  }

  private _notifyPathCopied(count: number): void {
    this.showToast(this.i18n.t('notify.pathCopied', { n: count }))
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = null
    this.toastMessage = ''
  }

  showToast(message: string, ms?: number): void {
    this.toastMessage = message
    const base = ms ?? (message.length > 40 ? 4500 : 2200)
    this._toastDurationMs = Math.max(1500, Math.min(5000, base))
    this._armToastDismiss()
    try { this._safeDetect() } catch {}
  }

  _base_showTopNotification(message: string, kind: 'error' | 'warning' = 'error', detail = ''): void {
    try {
      this.notifications?.[kind]?.(message, detail)
    } catch {
      this.showToast(message, 3000)
    }
  }

  private _toastDurationMs = 2200

  private _armToastDismiss(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toastMessage = ''
      this.toastTimer = null
      try { this._safeDetect() } catch {}
    }, this._toastDurationMs)
  }

  ctxChmod(): void {
    this.closeContextMenu()
    if (this.selectedRemote.length === 1) {
      this.openPermDialog(this.selectedRemote[0])
    }
  }

  ctxOpenLocal(): void {

    const entry = (this.contextMenuEntry as LocalEntry | null)
      || (this.selectedLocal.length === 1 ? this.selectedLocal[0] : null)
    this.closeContextMenu()
    if (!entry?.fullPath) return
    if (entry.isDirectory || this.isDirByMode(entry.mode)) {
      this.openLocal(entry)
      return
    }
    this._openPathInSystem(entry.linkTarget || entry.fullPath)
  }

  ctxOpenLocalFile(): void {
    this.ctxOpenLocal()
  }

  ctxRevealInExplorer(): void {
    const entry = this.contextMenuEntry as LocalEntry
    const filePath = entry?.linkTarget || entry?.fullPath
    this.closeContextMenu()
    if (!filePath) return
    log.info('Reveal in explorer:', filePath)
    try {
      const { shell } = require('electron')
      shell.showItemInFolder(filePath)
    } catch (e) {
      log.error('Reveal in explorer failed:', e)
    }
  }

  hasContextSelection(): boolean {
    return this.contextMenuPane === 'local' ? this.selectedLocal.length > 0 : this.selectedRemote.length > 0
  }

  private getContextSelection(): (LocalEntry | SFTPFile)[] {
    return this.contextMenuPane === 'local' ? this.selectedLocal : this.selectedRemote
  }

  get modKey(): string {
    return os.platform() === 'darwin' ? '⌘' : 'Ctrl+'
  }

  getEntryPath(e: LocalEntry | SFTPFile): string { return (e as LocalEntry).fullPath ?? (e as SFTPFile).fullPath ?? '' }

  getEntrySize(e: LocalEntry | SFTPFile): number | undefined { return (e as LocalEntry).size ?? (e as SFTPFile).size ?? undefined }

  getEntryMtime(e: LocalEntry | SFTPFile): number | undefined {
    if (this.detailsIsLocal) return (e as LocalEntry).mtimeMs
    const m = (e as SFTPFile).modified
    return m ? m.getTime() : undefined
  }

  getEntryMode(e: LocalEntry | SFTPFile): number | undefined { return (e as LocalEntry).mode ?? (e as SFTPFile).mode ?? undefined }

  getEntryOwner(e: LocalEntry | SFTPFile): string | undefined {
    const o = (e as LocalEntry).owner ?? (e as SFTPFile).owner
    return o != null ? String(o) : undefined
  }

  getEntryGroup(e: LocalEntry | SFTPFile): string | undefined {
    const g = (e as LocalEntry).group ?? (e as SFTPFile).group
    return g != null ? String(g) : undefined
  }

  getEntryBirthtimeMs(e: LocalEntry | SFTPFile): number | undefined {
    if (!this.detailsIsLocal) return undefined
    return (e as LocalEntry).birthtimeMs ?? undefined
  }

  getEntryAtimeMs(e: LocalEntry | SFTPFile): number | undefined {
    const local = (e as LocalEntry).atimeMs
    if (local != null) return local
    return (e as SFTPFile).atimeMs
  }

  getFileExt(name: string): string {
    const i = name.lastIndexOf('.')
    return i > 0 ? name.substring(i + 1).toUpperCase() : ''
  }

  ctxDetails(): void {

    const pane = this.contextMenuPane
    const selected = pane === 'local' ? this.selectedLocal : this.selectedRemote
    const entry = (this.contextMenuEntry as LocalEntry | SFTPFile | null)
      || (selected.length ? selected[0] : null)
    if (!entry) return
    this.detailsEntry = entry
    this.detailsIsLocal = pane === 'local'

    this.detailsCalcState = 'idle'
    this.detailsCalcResult = null
    this.detailsCalcToken++
    this.detailsVisible = true
    this.closeContextMenu()
  }

  async onDetailsCalcSize(): Promise<void> {
    const e = this.detailsEntry
    if (!e || !e.isDirectory || this.detailsCalcState === 'calculating') return
    const target = this.getEntryPath(e)
    const isLocal = this.detailsIsLocal
    const token = ++this.detailsCalcToken
    this.detailsCalcState = 'calculating'
    this.detailsCalcResult = null
    this._safeDetect()
    try {
      const r = isLocal ? await this._scanLocalDir(target) : await this._scanRemoteDir(target)
      if (token !== this.detailsCalcToken || !this.detailsVisible) return
      this.detailsCalcResult = this.i18n.t('file.folderSizeDetail', { size: this.formatSize(r.size), count: r.count })
      this.detailsCalcState = 'idle'
    } catch {
      if (token !== this.detailsCalcToken || !this.detailsVisible) return
      this.detailsCalcState = 'error'
    }
    this._safeDetect()
  }

  _base_canViewEntry(entry: LocalEntry | SFTPFile | null): boolean {
    if (!entry || (entry as any).isDirectory) return false
    return isViewableRemoteFileType(
      entry.name,
      this.getCustomEditableExtensions(),
      this.getAllowViewEditAllFiles(),
    )
  }

  _base_canEditEntry(entry: LocalEntry | SFTPFile | null): boolean {
    if (!entry || (entry as any).isDirectory) return false
    return this.isFileNameEditable(entry.name)
  }

  get viewerShowSystemAction(): boolean {
    return !!this.viewerSystemPath && !this.viewerError && !this.viewerLoading
  }

  get editorShowSystemAction(): boolean {
    return !!this.editorLocalPath && !this.editorError && !this.editorLoading
  }

  private async _ensureTransferTargetDir(direction: 'upload' | 'download', requestedDir: string): Promise<string | null> {
    const isRemote = direction === 'upload'
    const fallbackDir = isRemote ? this.remotePath : this.localPath
    const dir = requestedDir?.trim() || fallbackDir
    let exists = false
    let isDir = false
    try {
      if (isRemote) {

        const st = this.sftpSession ? await statRemotePath(this.sftpSession, dir) : null
        exists = !!st
        isDir = !!st?.isDirectory
      } else {
        const st = await fs.stat(dir).catch(() => null)
        exists = !!st
        isDir = !!st?.isDirectory()
      }
    } catch {
      exists = false
    }
    if (exists && isDir) return dir
    if (exists && !isDir) {

      this.showToast(this.i18n.t('app.targetNotDir', { dir }), 4000)
      return null
    }
    const choice = await this._askDirMissing(dir, isRemote, dir !== fallbackDir)
    if (choice === 'cancel') return null
    if (choice === 'fallback') return fallbackDir

    try {
      if (isRemote) {
        await this._remoteMkdirp(dir)
      } else {
        await fs.mkdir(dir, { recursive: true })
      }
      this.showToast(this.i18n.t('app.dirCreated', { dir }))
      return dir
    } catch (e) {
      const reason = (e as Error)?.message || String(e)
      log.error('create target dir failed:', dir, reason)
      this.showToast(this.i18n.t('app.mkdirpFailed', { reason }), 4000)
      return null
    }
  }

  private _askDirMissing(dir: string, isRemote: boolean, showFallback: boolean): Promise<'create' | 'fallback' | 'cancel'> {
    return new Promise((resolve) => {
      this.dirMissingDir = dir
      this.dirMissingIsRemote = isRemote
      this.dirMissingShowFallback = showFallback
      this.dirMissingVisible = true
      this._dirMissingResolve = resolve
      this._safeDetect()
    })
  }

  resolveDirMissing(c: 'create' | 'fallback' | 'cancel'): void {
    this.dirMissingVisible = false
    const resolve = this._dirMissingResolve
    this._dirMissingResolve = null
    resolve?.(c)
    this._safeDetect()
  }

  private async _remoteMkdirp(dir: string): Promise<void> {
    const session = this.sftpSession
    if (!session) throw new Error('no sftp session')
    const norm = path.posix.normalize(String(dir).replace(/\/+$/, '') || '/')
    if (!norm || norm === '/') return
    const parts = norm.split('/').filter(Boolean)
    let cur = ''
    for (const seg of parts) {
      cur += '/' + seg
      const st = await statRemotePath(session, cur).catch(() => null)
      if (st?.isDirectory) continue
      if (st) throw new Error(`not a directory: ${cur}`)
      await session.mkdir(cur)
    }
    const finalSt = await statRemotePath(session, norm).catch(() => null)
    if (!finalSt?.isDirectory) throw new Error(`verify failed: ${norm}`)
  }

  async ctxUpload(): Promise<void> {
    this.closeContextMenu()
    if (!this.connected || !this.sftpSession) {
      this.showToast(this.i18n.t('notify.notConnectedUpload'))
      return
    }
    const items = this.getContextSelection() as LocalEntry[]
    if (!items.length) return

    const requestedUploadDir = this._defaultUploadPath || this.remotePath
    const uploadDir = await this._ensureTransferTargetDir('upload', requestedUploadDir)
    if (!uploadDir) return

    if (await this._tryBatchUpload(items.map(e => e.fullPath), uploadDir)) {
      await this.refreshRemote()
      this._safeDetect()
      return
    }
    const batch = fileOperation.create(items.length)
    await Promise.all(items.map(e => this._streamUploadOne(e.fullPath, uploadDir, batch)))
    await this.refreshRemote()
    this._safeDetect()
  }

  async _base_ctxDownload(): Promise<void> {
    this.closeContextMenu()
    if (!this.connected || !this.sftpSession) {
      this.showToast(this.i18n.t('notify.notConnectedDownload'))
      return
    }
    const items = this.getContextSelection() as SFTPFile[]
    if (!items.length) return

    const requestedDownloadDir = this._defaultDownloadPath || this.localPath
    const downloadDir = await this._ensureTransferTargetDir('download', requestedDownloadDir)
    if (!downloadDir) return
    const batch = fileOperation.create(items.length)
    await Promise.all(items.map(p => this._streamDownloadOne(p, downloadDir, batch)))
    if (this._conflictQueue.length) this._showConflictDialog()

    await this.refreshLocal()
    this._safeDetect()
  }

  private _downloadConcurrency = 3
  private _dlActiveCount = 0
  private _dlQueue: Array<{ file: SFTPFile; entry: PanelTransferItem; finish: () => void }> = []

  private async _base__streamDownloadOne(p: SFTPFile, targetLocalDir?: string, batch: FileOperationBatch = fileOperation.create()): Promise<void> {
    const safeName = safeEntryName(p.name)
    if (!safeName) {
      log.warn('skip download with unsafe name:', p.name)
      return Promise.resolve()
    }

    const localDir = (targetLocalDir?.trim()) || this._defaultDownloadPath || this.localPath
    const localTarget = path.join(localDir, safeName)
    const logEntry = this.transferLog.add({
      operation: 'download',
      localPath: localTarget,
      remotePath: p.fullPath,
      profileName: this.profile?.name || undefined,
      success: true,
      size: p.size ?? 0,
      duration: 0,
      startTime: Date.now(),
      pending: true,
    })
    const entry: PanelTransferItem = {
      batch, transfer: null, direction: 'download', name: safeName,
      remotePath: p.fullPath, localPath: localTarget,
      percent: 0, speed: '', bytesDone: 0, bytesTotal: p.size ?? 0,
      paused: false, queued: true, logEntryId: logEntry.id,
      isFolder: p.isDirectory,
    }
    ;(entry as any)._customDiagnosticContext=this._customTraceQueueEntry?.(entry)
    this.transfers.push(entry)
    this.transfersMinimized = false
    this.transfersHidden = false
    this._safeDetect()
    return new Promise<void>((resolve) => {
      const finish = () => {

        if (entry.queued && this.transfers.includes(entry)) {
          if (entry.skippedAsDuplicate) {
            entry.queued = false
            entry.percent = 100
            entry.speed = ''

            this._scheduleQueuedEntryRemoval(entry)
          } else {
            this._removeQueuedEntry(entry)
          }
        }
        resolve()
      }
      this._dlQueue.push({ file: p, entry, finish })
      this._pumpDownloadQueue()
    })
  }

  private _pumpDownloadQueue(): void {
    while (this._dlActiveCount < this._downloadConcurrency && this._dlQueue.length) {
      const item = this._dlQueue.shift()!
      this._dlActiveCount++
      void this._runQueuedDownload(item)
    }
  }

  private async _base__runQueuedDownload(
    item: { file: SFTPFile; entry: PanelTransferItem; finish: () => void },
  ): Promise<void> {
    try {
      if (item.entry.isFolder) { item.entry.phase = 'preparing'; this._safeDetect() }
      if (this.transfers.includes(item.entry)) {

        const targetDir = item.entry.localPath ? path.dirname(item.entry.localPath) : undefined
        await this._transferCoordinator.streamDownloadOne(item.file, targetDir, item.entry.batch)
      }
    } catch (e) {
      log.error('Queued download failed for', item.file.fullPath, e)
    } finally {

      fileOperation.finish(item.entry.batch)
      this._dlActiveCount--
      item.finish()
      try { this._pumpDownloadQueue() } catch (e) { log.error('Pump download queue failed', e) }
    }
  }

  private _removeQueuedEntry(entry: PanelTransferItem): void {

    if (!this._isAlive) return
    if (!this.transfers.includes(entry)) return
    this.transfers = this.transfers.filter(x => x !== entry)

    if (entry.logEntryId != null && !entry.skippedAsDuplicate) {
      try { this.transferLog.remove(entry.logEntryId) } catch { /* ignore */ }
    }
    this._safeDetect()
  }

  private _markTransferAsSkipped(info: AutoSkippedInfo): void {
    const entry = this.transfers.find(e =>
      e.direction === info.direction
      && e.remotePath === info.remotePath
      && e.localPath === info.localPath,
    )
    if (!entry) {

      log.warn('[auto-skip] no matching transfer entry for:', info.remotePath)
      try {
        const now = Date.now()
        this.transferLog.add({
          operation: info.direction,
          localPath: info.localPath,
          remotePath: info.remotePath,
          profileName: this.profile?.name || undefined,
          success: true,
          duration: 0,
          startTime: now,
          endTime: now,
          pending: false,
          skippedAsDuplicate: {
            reason: 'content-identical',
            algo: this._conflictDigestAlgo,
            at: now,
          },
        })
      } catch (e) {
        log.warn('[auto-skip] fallback log add failed:', e)
      }
      return
    }
    entry.skippedAsDuplicate = true
    if (entry.logEntryId != null) {
      try {
        const now = Date.now()
        const start = this.transferLog.getAll().find(l => l.id === entry.logEntryId)?.startTime ?? now
        this.transferLog.update(entry.logEntryId, {
          success: true,
          pending: false,
          endTime: now,
          duration: Math.max(0, now - start),
          skippedAsDuplicate: {
            reason: 'content-identical',
            algo: this._conflictDigestAlgo,
            at: now,
          },
        })
      } catch (e) {
        log.warn('[auto-skip] transferLog.update failed:', e)
      }
    }
    this._safeDetect()
  }

  private _uploadConcurrency = 3

  private _transferChannelMode = 'smart'

  private _conflictDigestEnabled = true
  private _conflictAutoSkipSameContent = true
  private _conflictDigestMaxSizeMB = 256
  private _conflictDigestAlgo: 'sha1' | 'sha256' = 'sha1'

  private _panelDigestSvc: ContentDigestService | null = null
  private _panelDigestSvcKey = ''
  private _upActiveCount = 0
  private _upQueue: Array<{ localPath: string; entry: PanelTransferItem; finish: () => void; remoteDir: string }> = []

  private async _computeConflictDigests(args: {
    localPath: string
    remotePath: string
    localSize?: number
    localMtime?: number
    remoteSize?: number
    remoteMtime?: number

    samePaneSource?: 'local' | 'remote'
  }): Promise<{ localDigest: string | null; remoteDigest: string | null }> {
    if (!this._conflictDigestEnabled) return { localDigest: null, remoteDigest: null }
    const key = `${this._conflictDigestAlgo}|${this._conflictDigestMaxSizeMB}`
    if (!this._panelDigestSvc || this._panelDigestSvcKey !== key) {
      this._panelDigestSvc = new ContentDigestService(() => this.sshSession ?? null, {
        algo: this._conflictDigestAlgo,
        maxBytes: this._conflictDigestMaxSizeMB * 1024 * 1024,
      })
      this._panelDigestSvcKey = key
    }
    const svc = this._panelDigestSvc

    const samePaneSource = args.samePaneSource
    const hashSource = (p: string, size?: number, mtime?: number) =>
      samePaneSource === 'local' ? svc.localDigest(p, size, mtime) : svc.remoteDigest(p, size, mtime)
    const hashTarget = (p: string, size?: number, mtime?: number) =>
      samePaneSource === 'remote' ? svc.remoteDigest(p, size, mtime) : svc.localDigest(p, size, mtime)
    try {
      const [localDigest, remoteDigest] = await Promise.all([
        args.localPath ? hashTarget(args.localPath, args.localSize, args.localMtime) : Promise.resolve(null),
        args.remotePath ? hashSource(args.remotePath, args.remoteSize, args.remoteMtime) : Promise.resolve(null),
      ])
      return { localDigest, remoteDigest }
    } catch (e) {
      log.warn('[conflict-digest] compute failed:', e)
      return { localDigest: null, remoteDigest: null }
    }
  }

  private async _tryBatchUpload(localPaths: string[], remoteDir: string): Promise<boolean> {
    if (localPaths.length < 2) return false

    for (const p of localPaths) {
      if (!safeEntryName(path.basename(p))) return false
    }
    let label: string
    try {
      label = this.i18n.t('transfer.batchUpload', {
        n: localPaths.length,
        dir: path.basename(path.dirname(localPaths[0])) || path.dirname(localPaths[0]),
      })
    } catch {

      label = `${path.basename(remoteDir)} (${localPaths.length})`
    }
    try {
      return await this._transferCoordinator.uploadBatchToRemote(localPaths, remoteDir, label)
    } catch (e) {
      log.warn('[batch-upload] batch path unavailable, using per-file flow:', e)
      return false
    }
  }

  private async _base__streamUploadOne(localPath: string, targetRemoteDir?: string, batch: FileOperationBatch = fileOperation.create()): Promise<void> {
    const sourceSession=this.sftpSession,capturedRemoteDir=targetRemoteDir||this.remotePath
    const base = path.basename(localPath)
    const safeName = safeEntryName(base)
    if (!safeName) {
      log.warn('skip upload with unsafe name:', base)
      return Promise.resolve()
    }
    let isFolder = false
    let size = 0
    try {
      const st = await fs.stat(localPath)
      isFolder = st.isDirectory()
      size = isFolder ? 0 : (st.size || 0)
    } catch(error) { throw Error('Cannot read upload source: '+error.message) }
    if(this._destroyed||!this.connected||this.sftpSession!==sourceSession)throw Error('Connection changed before queuing upload')

    const remoteDir = targetRemoteDir?.trim() || capturedRemoteDir
    const remoteTarget = path.posix.join(remoteDir, safeName)
    const logEntry = this.transferLog.add({
      operation: 'upload',
      localPath,
      remotePath: remoteTarget,
      profileName: this.profile?.name || undefined,
      success: true,
      size,
      duration: 0,
      startTime: Date.now(),
      pending: true,
    })
    const entry: PanelTransferItem = {
      batch, transfer: null, direction: 'upload', name: safeName,
      remotePath: remoteTarget, localPath,
      percent: 0, speed: '', bytesDone: 0, bytesTotal: size,
      paused: false, queued: true, logEntryId: logEntry.id,
      isFolder,
    }
    ;(entry as any)._customDiagnosticContext=this._customTraceQueueEntry?.(entry)
    this.transfers.push(entry)
    this.transfersMinimized = false
    this.transfersHidden = false
    this._safeDetect()
    return new Promise<void>((resolve) => {
      const finish = () => {

        if (entry.queued && this.transfers.includes(entry)) {
          if (entry.skippedAsDuplicate) {
            entry.queued = false
            entry.percent = 100
            entry.speed = ''

            this._scheduleQueuedEntryRemoval(entry)
          } else {
            this._removeQueuedEntry(entry)
          }
        }
        resolve()
      }
      this._upQueue.push({ localPath, entry, finish, remoteDir })
      this._pumpUploadQueue()
    })
  }

  private _pumpUploadQueue(): void {
    while (this._upActiveCount < this._uploadConcurrency && this._upQueue.length) {
      const item = this._upQueue.shift()!
      this._upActiveCount++
      void this._runQueuedUpload(item)
    }
  }

  private async _base__runQueuedUpload(
    item: { localPath: string; entry: PanelTransferItem; finish: () => void; remoteDir: string },
  ): Promise<void> {
    try {

      if (this.transfers.includes(item.entry)) {

        await this.uploadPathToRemote(item.remoteDir, item.localPath, undefined, item.entry.batch)
      }
    } catch (e) {
      log.error('Queued upload failed for', item.localPath, e)
    } finally {

      fileOperation.finish(item.entry.batch)
      this._upActiveCount--
      item.finish()
      try { this._pumpUploadQueue() } catch (e) { log.error('Pump upload queue failed', e) }
    }
  }

  ctxClipboardCopy(): void {
    this.clipboardEntries = this.getContextSelection().slice()
    this.clipboardSource = this.contextMenuPane
    this.clipboardMode = 'copy'
    this.closeContextMenu()
    const count = this.clipboardEntries.length
    this.showToast(this.i18n.t('notify.copied', { n: count }))
    log.info(`Copy ${count} items from ${this.clipboardSource}`)
  }

  ctxClipboardCut(): void {
    this.clipboardEntries = this.getContextSelection().slice()
    this.clipboardSource = this.contextMenuPane
    this.clipboardMode = 'cut'
    this.closeContextMenu()
    const count = this.clipboardEntries.length
    this.showToast(this.i18n.t('notify.cut', { n: count }))
    log.info(`Cut ${count} items from ${this.clipboardSource}`)
  }

  async _base_ctxClipboardPaste(): Promise<void> {
    if (!this.clipboardEntries.length) return
    this.closeContextMenu()
    const destPane = this.contextMenuPane
    const destPath = destPane === 'local' ? this.localPath : this.remotePath
    const entries = this.clipboardEntries.slice()
    const mode = this.clipboardMode
    const source = this.clipboardSource

    log.info(`Paste ${entries.length} items (${mode}) from ${source} to ${destPane}`)
    if (mode === 'cut') this.clipboardEntries = []

    await this._pasteAdapter.paste(
      entries.map(e => ({
        name: e.name,
        fullPath: (e as LocalEntry).fullPath ?? (e as SFTPFile).fullPath,
        isDirectory: e.isDirectory,
        mode: (e as SFTPFile).mode,
        size: (e as any).size,
        mtimeMs: (e as any).mtimeMs,
      })),
      destPane, destPath, mode, source,
    )
  }

  private _pendingPasteEntries: (LocalEntry | SFTPFile)[] = []
  private _pendingPasteDestPane: 'local' | 'remote' = 'local'
  private _pendingPasteDestPath = ''
  private _pendingPasteMode: 'copy' | 'cut' = 'copy'
  private _pendingPasteSource: 'local' | 'remote' = 'local'

  private _conflictResolvedKeys = new Set<string>()

  private async _executePaste(
    entries: (LocalEntry | SFTPFile)[],
    destPane: 'local' | 'remote',
    destPath: string,
    mode: 'copy' | 'cut',
    source: 'local' | 'remote',
  ): Promise<void> {
    return this._pasteAdapter.executePaste(
      entries.map(e => ({
        name: e.name,
        fullPath: (e as LocalEntry).fullPath ?? (e as SFTPFile).fullPath,
        isDirectory: e.isDirectory,
        mode: (e as SFTPFile).mode,
        size: (e as any).size,
        mtimeMs: (e as any).mtimeMs,
      })),
      destPane, destPath, mode, source,
    )
  }

  private async downloadRemoteDir(
    remoteSrc: string, localDest: string, destPane: 'local' | 'remote',
    _top?: FolderTransferCtx,
    _localName?: string,

    _forceOverwrite?: boolean,
  ): Promise<boolean> {

    const slotName = _localName || path.posix.basename(remoteSrc)
    const slotLocal = path.join(localDest, slotName)
    if (!_top && this._blockDuplicateTransfer('download', remoteSrc, slotLocal, slotName)) return false

    const cancelRef = { current: null as any, active: new Set<any>() }
    this._cancelRefs.add(cancelRef)
    const prevRef = this._cancelRef
    this._cancelRef = cancelRef
    try {

      return await runInTaskScope(cancelRef, () =>
        this._transferCoordinator.downloadRemoteDir(remoteSrc, localDest, _top, _localName, _forceOverwrite))
    } finally {
      this._cancelRefs.delete(cancelRef)
      if (this._cancelRef === cancelRef) this._cancelRef = prevRef
      if (this._cancelRef && !this._cancelRef.current && !(this._cancelRef.active?.size)) this._cancelRef = null
    }
  }

  private get _isPanelActive(): boolean {

    if (this.minimized) return false

    const el = this.elRef?.nativeElement as HTMLElement | null
    if (!el || el.getClientRects().length === 0) return false
    return true
  }

  private _isPanelModalOpen(): boolean {
    return !!(
      this.viewerVisible ||
      this.editorVisible ||
      this.deleteConfirmVisible ||
      this.inputDialogVisible ||
      this.showConflictDialog ||
      this.detailsVisible ||
      this.showTransferLog ||
      this.showBookmarks ||

      this.showPermDialog ||
      this.cwdSetupVisible
    )
  }

  private _isFocusInPanelEditable(): boolean {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    const editable = tag === 'TEXTAREA' || tag === 'INPUT' || !!(el as any).isContentEditable
    if (!editable) return false
    if (el.closest?.('.xterm')) return false
    return !!this.elRef?.nativeElement?.contains(el)
  }

  private _isPanelDomFocused(): boolean {
    const a = document.activeElement as HTMLElement | null
    const r = this.elRef?.nativeElement as HTMLElement | null
    return !!(a && r && r.contains(a))
  }

  private _shieldTerminalClipboardKeys(ev: KeyboardEvent): void {
    if (!this._isPanelActive) return
    const isMod = os.platform() === 'darwin' ? ev.metaKey : ev.ctrlKey
    if (!isMod) return
    const k = ev.key
    if (!['c', 'C', 'x', 'X', 'v', 'V', 'a', 'A'].includes(k)) return
    const kLower = k.toLowerCase()

    const inPanelEditable = this._isFocusInPanelEditable()
    const textUiOpen = !!(this.editorVisible || this.viewerVisible || this.inputDialogVisible)
    const panelFocused = this._isPanelDomFocused()
    const panelOwns = this._panelOwnsClipboardHotkeys

    if (!panelFocused && !panelOwns && !textUiOpen && !inPanelEditable) return

    if (!panelFocused && panelOwns && !textUiOpen && !inPanelEditable) {
      if (kLower === 'c' || kLower === 'x') {
        const hasSel = this.selectedLocal.length > 0 || this.selectedRemote.length > 0
        if (!hasSel) {
          this._panelOwnsClipboardHotkeys = false
          return
        }
      } else if (kLower === 'v' && !this.clipboardEntries.length) {

        return
      }

    }

    if (inPanelEditable) {
      ev.stopImmediatePropagation()
      return
    }

    ev.stopImmediatePropagation()
    ev.preventDefault()

    if ((panelFocused || panelOwns) && !textUiOpen) {
      this.zone.run(() => this._runPanelClipboardHotkey(k))
    }
  }

  private _runPanelClipboardHotkey(key: string): void {
    if (this._isPanelModalOpen()) return
    const k = key.toLowerCase()

    if (k === 'v' || k === 'a') {
      this.contextMenuPane = this.activePane
      if (k === 'v') void this.ctxClipboardPaste()
      else this.ctxSelectAll()
      return
    }
    this.contextMenuPane = this._resolveTargetPane()
    if (k === 'c') this.ctxClipboardCopy()
    else if (k === 'x') this.ctxClipboardCut()
  }

  private _shieldTerminalPaste(ev: ClipboardEvent): void {
    if (!this._isPanelActive) return
    const textUiOpen = !!(this.editorVisible || this.viewerVisible || this.inputDialogVisible)
    if (!textUiOpen && !this._isFocusInPanelEditable()) return
    const t = ev.target as HTMLElement | null
    if (t && this.elRef?.nativeElement?.contains(t)) {
      const tag = t.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || (t as any).isContentEditable) return
    }

    ev.preventDefault()
    ev.stopImmediatePropagation()
  }

  private _isPanelTyping(event: KeyboardEvent): boolean {
    const el = event.target as HTMLElement | null
    if (!el) return false
    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as any).isContentEditable
    if (!isInput) return false

    if (this.elRef?.nativeElement?.contains(el)) return true

    return !(typeof el.closest === 'function' && el.closest('.xterm'))
  }

  private _isTerminalFocusTarget(event: KeyboardEvent): boolean {
    const el = (event.target as HTMLElement | null)
      ?? (document.activeElement as HTMLElement | null)
    if (!el) return false
    return typeof el.closest === 'function' && !!el.closest('.xterm')
  }

  private _resolveTargetPane(): 'local' | 'remote' {
    if (this.selectedLocal.length > 0 && this.selectedRemote.length === 0) return 'local'
    if (this.selectedRemote.length > 0 && this.selectedLocal.length === 0) return 'remote'
    return this.activePane
  }

  _base_onPanelMouseDown(event: MouseEvent): void {

    if (this.topBarMenuVisible && !(event.target as HTMLElement)?.closest?.('.sftp-title-menu')) {
      this.topBarMenuVisible = false
    }

    this._handlePanelPointerFocus(event)
  }

  private _handlePanelPointerFocus(event: MouseEvent): void {
    if (event.button !== 0 && event.button !== 2) return
    const root = this.elRef?.nativeElement as HTMLElement | undefined
    if (!root) return

    this._panelOwnsClipboardHotkeys = true

    const target = event.target as HTMLElement | null
    const tag = target?.tagName ?? ''
    const isInteractiveTarget = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      tag === 'BUTTON' || !!(target as any)?.isContentEditable ||
      !!target?.closest?.('button, [role="button"], a, input, textarea, select, [contenteditable="true"]')

    const active = document.activeElement as HTMLElement | null
    const isFocusOnInput = !!active && (
      active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
      active.tagName === 'SELECT' || !!(active as any).isContentEditable
    )
    const focusOutside = !active || (active !== root && !root.contains(active))

    if (isInteractiveTarget && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(target as any)?.isContentEditable)) {
      this._markPanelFocusWanted()
      this._scheduleEnsurePanelFocus()
      return
    }

    if (focusOutside) {
      this._stealFocusToPanelRoot()
      this._markPanelFocusWanted()
      this._scheduleEnsurePanelFocus()
      return
    }
    const inDialog = !!target?.closest?.('.overlay, .file-dialog-shell, .dialog, .conflict-dialog, sftp-editor-dialog, sftp-viewer-dialog, sftp-input-dialog, sftp-perm-dialog')
    if (isFocusOnInput && !isInteractiveTarget && !!active && root.contains(active) && !inDialog) {
      this._stealFocusToPanelRoot()
      this._markPanelFocusWanted()
      this._scheduleEnsurePanelFocus()
    }
  }

  private _markPanelFocusWanted(): void {
    this._panelFocusWantedUntil = Date.now() + 450
    this._panelOwnsClipboardHotkeys = true
  }

  private _clearPanelFocusStealTimers(): void {
    for (const t of this._panelFocusStealTimers) clearTimeout(t)
    this._panelFocusStealTimers = []
  }

  private _stealFocusToPanelRoot(): void {
    const root = this.elRef?.nativeElement as HTMLElement | undefined
    if (!root) return
    const active = document.activeElement as HTMLElement | null
    if (active && active !== root && !root.contains(active)) {
      try { active.blur() } catch { /* ignore */ }
    }
    try { root.focus({ preventScroll: true }) } catch { /* ignore */ }
  }

  private _ensurePanelFocusIfWanted(): void {
    if (Date.now() > this._panelFocusWantedUntil) return
    if (!this._isPanelActive) return
    const root = this.elRef?.nativeElement as HTMLElement | undefined
    if (!root) return
    const active = document.activeElement as HTMLElement | null
    if (active && root.contains(active)) return
    this._stealFocusToPanelRoot()
  }

  private _scheduleEnsurePanelFocus(): void {
    this._clearPanelFocusStealTimers()
    const run = (): void => this._ensurePanelFocusIfWanted()
    run()
    try { requestAnimationFrame(run) } catch { /* ignore */ }
    for (const delay of [0, 32, 80, 160]) {
      this._panelFocusStealTimers.push(setTimeout(run, delay))
    }
  }

  private _onPanelFocusInGuard(ev: FocusEvent): void {
    if (Date.now() > this._panelFocusWantedUntil) return
    if (!this._isPanelActive) return
    const root = this.elRef?.nativeElement as HTMLElement | undefined
    const target = ev.target as HTMLElement | null
    if (!root || !target) return

    if (root.contains(target)) return
    this._stealFocusToPanelRoot()
  }

  private _onPanelWindowFocusGuard(): void {
    if (Date.now() > this._panelFocusWantedUntil) return
    this._scheduleEnsurePanelFocus()
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDownForMenu(event: MouseEvent): void {
    if (this.topBarMenuVisible) this.topBarMenuVisible = false
    const root = this.elRef?.nativeElement as HTMLElement | undefined
    const target = event.target as HTMLElement | null
    if (root && target && !root.contains(target)) {
      this._panelFocusWantedUntil = 0
      this._panelOwnsClipboardHotkeys = false
      this._clearPanelFocusStealTimers()
    }
  }

  onTopBarContextMenu(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    this.topBarMenuX = e.clientX
    this.topBarMenuY = e.clientY
    this.topBarMenuVisible = true
    this._safeDetect()
  }

  closeTopBarMenu(): void {
    this.topBarMenuVisible = false
  }

  restoreDefaultSize(): void {
    this.topBarMenuVisible = false
    if (this.displayMode === 'workspace' || !this._hostEl) return
    this._applyDefaultGeometry()
    this._persistPanelGeometry()
  }

  @HostListener('keydown', ['$event'])
  @HostListener('keyup', ['$event'])
  onTextInputKeyEvent(event: KeyboardEvent): void {
    if (!this._isPanelActive || event.key === 'Escape') return
    const target = event.target as HTMLElement | null
    if (!target || !this.elRef.nativeElement.contains(target)) return
    if (!this._isPanelTyping(event)) return

    event.stopPropagation()
  }

  _base_onGlobalKeyDown(event: KeyboardEvent): void {
    if (!this._isPanelActive) return

    const panelFocused = (() => {
      const a = document.activeElement as HTMLElement | null
      const r = this.elRef?.nativeElement as HTMLElement | null
      return !!(a && r && r.contains(a))
    })()
    if (panelFocused && (os.platform() === 'darwin' ? event.metaKey : event.ctrlKey) && ['c','C','x','X','v','V','a','A'].includes(event.key)) {
      event.stopImmediatePropagation()
    }

    if (this._isPanelTyping(event) && event.key !== 'Escape') {

      const isMod = os.platform() === 'darwin' ? event.metaKey : event.ctrlKey
      if (isMod && ['c','C','x','X','v','V','a','A'].includes(event.key)) {
        const el = event.target as HTMLElement | null
        if (el && this.elRef?.nativeElement?.contains(el)) {
          event.stopImmediatePropagation()
        }
      }
      return
    }

    const isMod = os.platform() === 'darwin' ? event.metaKey : event.ctrlKey
    if (!isMod) {

      if (this.deleteConfirmVisible) {
        if (event.key === 'Escape') { event.preventDefault(); this.cancelDelete(); return }
        return
      }

      if (panelFocused && !event.shiftKey) {

        if (event.key === 'Backspace' && this._typeAheadBuf) {
          event.preventDefault()
          event.stopPropagation()
          this._typeAheadBuf = this._typeAheadBuf.slice(0, -1)
          this._bumpTypeAheadTimer()
          const side = this._arrowNavPane || this._resolveTargetPane()
          if (this._typeAheadBuf && side) this._applyTypeAhead(side, 'append')
          return
        }
        const navPane = this._resolveTargetPane()
        if (this._panelHotkeyEnabled('back') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('back'))) {
          event.preventDefault()
          event.stopPropagation()
          this._clearTypeAhead()
          if (navPane === 'local') this.localBack()
          else this.remoteBack()
          return
        }
        if (this._panelHotkeyEnabled('forward') && matchPanelHotkeyKeys(event, this._panelHotkeyKeys('forward'))) {
          event.preventDefault()
          event.stopPropagation()
          this._clearTypeAhead()
          if (navPane === 'local') this.localForward()
          else this.remoteForward()
          return
        }
      }
      if (event.key === 'Escape') {

        if (this._typeAheadBuf) {
          event.preventDefault()
          this._clearTypeAhead()
          return
        }

        if (event.defaultPrevented) return
        if (this._customInlineEdit) { event.preventDefault(); this.customInlineCancel(); return }
        if (this.viewerVisible) {
          event.preventDefault()
          this.closeViewer()
          return
        }
        if (this.editorVisible) {
          event.preventDefault()
          this.closeEditor()
          return
        }

        if (this.showConflictDialog) { event.preventDefault(); this.resolveConflict('cancel'); return }
        if (this.cwdSetupVisible) { this.onCwdSetupChoice('cancel'); return }
        if (this.inputDialogVisible) { this.cancelInputDialog(); return }
        if (this.showBookmarks) { this.closeBookmarks(); return }
        if (this.showTransferLog) { this.showTransferLog = false; return }
        if (this.detailsVisible) { this.detailsVisible = false; return }
        if (this.showPermDialog) { this.showPermDialog = false; return }
        this.close(); return
      }
      return
    }

    if (this._isPanelTyping(event)) return

    if (this.viewerVisible || this.editorVisible) {
      if ((os.platform() === 'darwin' ? event.metaKey : event.ctrlKey) && ['c','C','x','X','v','V','a','A'].includes(event.key)) {
        event.stopImmediatePropagation()
      }
      return
    }

    const isClipboardMod = os.platform() === 'darwin' ? event.metaKey : event.ctrlKey
    if (!isClipboardMod || !['c', 'C', 'x', 'X', 'v', 'V', 'a', 'A'].includes(event.key)) return
    if (!panelFocused && !this._panelOwnsClipboardHotkeys) return

    event.preventDefault()
    event.stopImmediatePropagation()
    this._runPanelClipboardHotkey(event.key)
  }

  // Controller facade: named source methods, one explicit composition root.
  _readDefaultShowHidden(...args: any[]): any { return invokeFeature("Panel","_readDefaultShowHidden",this,args) }
  loadPathMode(...args: any[]): any { return invokeFeature("Panel","loadPathMode",this,args) }
  _readDefaultPathMode(...args: any[]): any { return invokeFeature("Panel","_readDefaultPathMode",this,args) }
  _applyDefaultPathMode(...args: any[]): any { return invokeFeature("Panel","_applyDefaultPathMode",this,args) }
  savePathMode(...args: any[]): any { return invokeFeature("Panel","savePathMode",this,args) }
  saveCurrentPath(...args: any[]): any { return invokeFeature("Panel","saveCurrentPath",this,args) }
  pathModeTitle(...args: any[]): any { return invokeFeature("Panel","pathModeTitle",this,args) }
  cyclePathMode(...args: any[]): any { return invokeFeature("Panel","cyclePathMode",this,args) }
  setPathMode(...args: any[]): any { return invokeFeature("Panel","setPathMode",this,args) }
  tryGetTerminalCwd(...args: any[]): any { return invokeFeature("Panel","tryGetTerminalCwd",this,args) }
  _startCwdSync(...args: any[]): any { return invokeFeature("Panel","_startCwdSync",this,args) }
  _syncRemoteToTerminalCwd(...args: any[]): any { return invokeFeature("Panel","_syncRemoteToTerminalCwd",this,args) }
  _enableCwdReporterSession(...args: any[]): any { return invokeFeature("Panel","_enableCwdReporterSession",this,args) }
  _enableCwdReporterPermanent(...args: any[]): any { return invokeFeature("Panel","_enableCwdReporterPermanent",this,args) }
  cycleLayoutMode(...args: any[]): any { return invokeFeature("Panel","cycleLayoutMode",this,args) }
  _loadSavedPaths(...args: any[]): any { return invokeFeature("Panel","_loadSavedPaths",this,args) }
  _restoreSavedRemotePath(...args: any[]): any { return invokeFeature("Panel","_restoreSavedRemotePath",this,args) }
  _loadPaneToolbarLayout(...args: any[]): any { return invokeFeature("Panel","_loadPaneToolbarLayout",this,args) }
  ngOnInit(...args: any[]): any { return invokeFeature("Panel","ngOnInit",this,args) }
  ngAfterViewInit(...args: any[]): any { return invokeFeature("Panel","ngAfterViewInit",this,args) }
  ngOnDestroy(...args: any[]): any { return invokeFeature("Panel","ngOnDestroy",this,args) }
  _applyFontSize(...args: any[]): any { return invokeFeature("Panel","_applyFontSize",this,args) }
  _applyAutoTheme(...args: any[]): any { return invokeFeature("Panel","_applyAutoTheme",this,args) }
  close(...args: any[]): any { return invokeFeature("Panel","close",this,args) }
  _readBehaviorConfig(...args: any[]): any { return invokeFeature("Panel","_readBehaviorConfig",this,args) }
  _loadPanelGeometry(...args: any[]): any { return invokeFeature("Panel","_loadPanelGeometry",this,args) }
  _persistPanelGeometry(...args: any[]): any { return invokeFeature("Panel","_persistPanelGeometry",this,args) }
  minimize(...args: any[]): any { return invokeFeature("Panel","minimize",this,args) }
  connect(...args: any[]): any { return invokeFeature("Panel","connect",this,args) }
  disconnect(...args: any[]): any { return invokeFeature("Panel","disconnect",this,args) }
  getDefaultRemotePath(...args: any[]): any { return invokeFeature("Panel","getDefaultRemotePath",this,args) }
  refreshLocal(...args: any[]): any { return invokeFeature("Panel","refreshLocal",this,args) }
  refreshRemote(...args: any[]): any { return invokeFeature("Panel","refreshRemote",this,args) }
  get _openOnClick(): any { return readFeature("Panel","_openOnClick",this) }
  get _openUnsupportedInSystem(): any { return readFeature("Panel","_openUnsupportedInSystem",this) }
  get showTextLineNumbers(): any { return readFeature("Panel","showTextLineNumbers",this) }
  get textCaretShape(): any { return readFeature("Panel","textCaretShape",this) }
  get _defaultUploadPath(): any { return readFeature("Panel","_defaultUploadPath",this) }
  get _defaultDownloadPath(): any { return readFeature("Panel","_defaultDownloadPath",this) }
  get _iconResourceDir(): any { return readFeature("Panel","_iconResourceDir",this) }
  get _fileTypeIcons(): any { return readFeature("Panel","_fileTypeIcons",this) }
  get _disabledIconSvgs(): any { return readFeature("Panel","_disabledIconSvgs",this) }
  get _folderIconSvg(): any { return readFeature("Panel","_folderIconSvg",this) }
  get _panelHotkeys(): any { return readFeature("Panel","_panelHotkeys",this) }
  _activateEntry(...args: any[]): any { return invokeFeature("Panel","_activateEntry",this,args) }
  onLocalEntryDblClick(...args: any[]): any { return invokeFeature("Panel","onLocalEntryDblClick",this,args) }
  onRemoteEntryDblClick(...args: any[]): any { return invokeFeature("Panel","onRemoteEntryDblClick",this,args) }
  get contextMenuOrder(): any { return readFeature("Panel","contextMenuOrder",this) }
  get contextMenuDisabledEntries(): any { return readFeature("Panel","contextMenuDisabledEntries",this) }
  onContextMenuAction(...args: any[]): any { return invokeFeature("Panel","onContextMenuAction",this,args) }
  onDrop(...args: any[]): any { return invokeFeature("Panel","onDrop",this,args) }
  _doUpload(...args: any[]): any { return invokeFeature("Panel","_doUpload",this,args) }
  _doUploadRaw(...args: any[]): any { return invokeFeature("Panel","_doUploadRaw",this,args) }
  _doDownload(...args: any[]): any { return invokeFeature("Panel","_doDownload",this,args) }
  _doDownloadRaw(...args: any[]): any { return invokeFeature("Panel","_doDownloadRaw",this,args) }
  trackTransfer(...args: any[]): any { return invokeFeature("Panel","trackTransfer",this,args) }
  cancelTransfer(...args: any[]): any { return invokeFeature("Panel","cancelTransfer",this,args) }
  pauseTransfer(...args: any[]): any { return invokeFeature("Panel","pauseTransfer",this,args) }
  resumeTransfer(...args: any[]): any { return invokeFeature("Panel","resumeTransfer",this,args) }
  clearTransfers(...args: any[]): any { return invokeFeature("Panel","clearTransfers",this,args) }
  openPermDialog(...args: any[]): any { return invokeFeature("Panel","openPermDialog",this,args) }
  confirmPermDialog(...args: any[]): any { return invokeFeature("Panel","confirmPermDialog",this,args) }
  _remoteEntryExists(...args: any[]): any { return invokeFeature("Panel","_remoteEntryExists",this,args) }
  openInputDialog(...args: any[]): any { return invokeFeature("Panel","openInputDialog",this,args) }
  cancelInputDialog(...args: any[]): any { return invokeFeature("Panel","cancelInputDialog",this,args) }
  confirmInputDialog(...args: any[]): any { return invokeFeature("Panel","confirmInputDialog",this,args) }
  confirmDelete(...args: any[]): any { return invokeFeature("Panel","confirmDelete",this,args) }
  clearLog(...args: any[]): any { return invokeFeature("Panel","clearLog",this,args) }
  showTopNotification(...args: any[]): any { return invokeFeature("Panel","showTopNotification",this,args) }
  canViewEntry(...args: any[]): any { return invokeFeature("Panel","canViewEntry",this,args) }
  canEditEntry(...args: any[]): any { return invokeFeature("Panel","canEditEntry",this,args) }
  ctxDownload(...args: any[]): any { return invokeFeature("Panel","ctxDownload",this,args) }
  _streamDownloadOne(...args: any[]): any { return invokeFeature("Panel","_streamDownloadOne",this,args) }
  _runQueuedDownload(...args: any[]): any { return invokeFeature("Panel","_runQueuedDownload",this,args) }
  _streamUploadOne(...args: any[]): any { return invokeFeature("Panel","_streamUploadOne",this,args) }
  _runQueuedUpload(...args: any[]): any { return invokeFeature("Panel","_runQueuedUpload",this,args) }
  ctxClipboardPaste(...args: any[]): any { return invokeFeature("Panel","ctxClipboardPaste",this,args) }
  onPanelMouseDown(...args: any[]): any { return invokeFeature("Panel","onPanelMouseDown",this,args) }
  onGlobalKeyDown(...args: any[]): any { return invokeFeature("Panel","onGlobalKeyDown",this,args) }
  _customHasPartial(...args: any[]): any { return invokeFeature("Panel","_customHasPartial",this,args) }
  _customPartialStatus(...args: any[]): any { return invokeFeature("Panel","_customPartialStatus",this,args) }
  _customPendingEditUpload(...args: any[]): any { return invokeFeature("Panel","_customPendingEditUpload",this,args) }
  _customRetrySavedEditUpload(...args: any[]): any { return invokeFeature("Panel","_customRetrySavedEditUpload",this,args) }
  _customResumeLocalForEdit(...args: any[]): any { return invokeFeature("Panel","_customResumeLocalForEdit",this,args) }
  _customAutoResumeTransfers(...args: any[]): any { return invokeFeature("Panel","_customAutoResumeTransfers",this,args) }
  _customDiscardPartial(...args: any[]): any { return invokeFeature("Panel","_customDiscardPartial",this,args) }
  _customSetCreatedFilePermissions(...args: any[]): any { return invokeFeature("Panel","_customSetCreatedFilePermissions",this,args) }
  _customQueueEditTransfer(...args: any[]): any { return invokeFeature("Panel","_customQueueEditTransfer",this,args) }
  _customDownloadForEdit(...args: any[]): any { return invokeFeature("Panel","_customDownloadForEdit",this,args) }
  _customUploadForEdit(...args: any[]): any { return invokeFeature("Panel","_customUploadForEdit",this,args) }
  _customPersistEdit(...args: any[]): any { return invokeFeature("Panel","_customPersistEdit",this,args) }
  _customBlockResumedEdit(...args: any[]): any { return invokeFeature("Panel","_customBlockResumedEdit",this,args) }
  _customResumeUploadedEdit(...args: any[]): any { return invokeFeature("Panel","_customResumeUploadedEdit",this,args) }
  _customEditStatus(...args: any[]): any { return invokeFeature("Panel","_customEditStatus",this,args) }
  _customRestoreEdits(...args: any[]): any { return invokeFeature("Panel","_customRestoreEdits",this,args) }
  customRetryEdit(...args: any[]): any { return invokeFeature("Panel","customRetryEdit",this,args) }
  customOpenEdit(...args: any[]): any { return invokeFeature("Panel","customOpenEdit",this,args) }
  customStopEdit(...args: any[]): any { return invokeFeature("Panel","customStopEdit",this,args) }
  ctxEditFile(...args: any[]): any { return invokeFeature("Panel","ctxEditFile",this,args) }
  _customExternalEdit(...args: any[]): any { return invokeFeature("Panel","_customExternalEdit",this,args) }
  _customSyncExternal(...args: any[]): any { return invokeFeature("Panel","_customSyncExternal",this,args) }
  _customRememberFolder(...args: any[]): any { return invokeFeature("Panel","_customRememberFolder",this,args) }
  _customSuggestPaths(...args: any[]): any { return invokeFeature("Panel","_customSuggestPaths",this,args) }
  get customLocalPathProvider(): any { return readFeature("Panel","customLocalPathProvider",this) }
  get customRemotePathProvider(): any { return readFeature("Panel","customRemotePathProvider",this) }
  get customCwdState(): any { return readFeature("Panel","customCwdState",this) }
  get customCwdTooltip(): any { return readFeature("Panel","customCwdTooltip",this) }
  _customCwdExec(...args: any[]): any { return invokeFeature("Panel","_customCwdExec",this,args) }
  customSyncNow(...args: any[]): any { return invokeFeature("Panel","customSyncNow",this,args) }
  _customLoadTransfers(...args: any[]): any { return invokeFeature("Panel","_customLoadTransfers",this,args) }
  _customRunTransfer(...args: any[]): any { return invokeFeature("Panel","_customRunTransfer",this,args) }
  _customHookFolderTransfers(...args: any[]): any { return invokeFeature("Panel","_customHookFolderTransfers",this,args) }
  _customCaptureQueued(...args: any[]): any { return invokeFeature("Panel","_customCaptureQueued",this,args) }
  customRetryTransfer(...args: any[]): any { return invokeFeature("Panel","customRetryTransfer",this,args) }
  customCancelTransfer(...args: any[]): any { return invokeFeature("Panel","customCancelTransfer",this,args) }
  customClearFinishedTransfers(...args: any[]): any { return invokeFeature("Panel","customClearFinishedTransfers",this,args) }
  get customEditRows(): any { return readFeature("Panel","customEditRows",this) }
  get customTransferRows(): any { return readFeature("Panel","customTransferRows",this) }
  get customHistoryOwner(): any { return readFeature("Panel","customHistoryOwner",this) }
  get customHistoryRecoveryRows(): any { return readFeature("Panel","customHistoryRecoveryRows",this) }
  customLogTransfer(...args: any[]): any { return invokeFeature("Panel","customLogTransfer",this,args) }
  customCanRetryTransfer(...args: any[]): any { return invokeFeature("Panel","customCanRetryTransfer",this,args) }
  get customActivityCount(): any { return readFeature("Panel","customActivityCount",this) }
  customTrackActivity(...args: any[]): any { return invokeFeature("Panel","customTrackActivity",this,args) }
  customActivityName(...args: any[]): any { return invokeFeature("Panel","customActivityName",this,args) }
  customTransferDetails(...args: any[]): any { return invokeFeature("Panel","customTransferDetails",this,args) }
  _customActivityTick(...args: any[]): any { return invokeFeature("Panel","_customActivityTick",this,args) }
  get customSidebarPinned(): any { return readFeature("Panel","customSidebarPinned",this) }
  get customSidebarMode(): any { return readFeature("Panel","customSidebarMode",this) }
  toggleCustomSidebarPin(...args: any[]): any { return invokeFeature("Panel","toggleCustomSidebarPin",this,args) }
  toggleCustomSidebarMode(...args: any[]): any { return invokeFeature("Panel","toggleCustomSidebarMode",this,args) }
  get customSidebarFull(): any { return readFeature("Panel","customSidebarFull",this) }
  toggleCustomSidebarFull(...args: any[]): any { return invokeFeature("Panel","toggleCustomSidebarFull",this,args) }
  customRecentFolders(...args: any[]): any { return invokeFeature("Panel","customRecentFolders",this,args) }
  _customRecordRecent(...args: any[]): any { return invokeFeature("Panel","_customRecordRecent",this,args) }
  _customStopRecent(...args: any[]): any { return invokeFeature("Panel","_customStopRecent",this,args) }
  _customArmRecent(...args: any[]): any { return invokeFeature("Panel","_customArmRecent",this,args) }
  _customVisitRecent(...args: any[]): any { return invokeFeature("Panel","_customVisitRecent",this,args) }
  _customRecentFileAction(...args: any[]): any { return invokeFeature("Panel","_customRecentFileAction",this,args) }
  _customDeferDrop(...args: any[]): any { return invokeFeature("Panel","_customDeferDrop",this,args) }
  _customUploadLocalPaths(...args: any[]): any { return invokeFeature("Panel","_customUploadLocalPaths",this,args) }
  customPasteImage(...args: any[]): any { return invokeFeature("Panel","customPasteImage",this,args) }
  _customStageDropFile(...args: any[]): any { return invokeFeature("Panel","_customStageDropFile",this,args) }
  @HostListener("mouseup",["$event"])
  customContextMouseUp(...args: any[]): any { return invokeFeature("Panel","customContextMouseUp",this,args) }
  _customDeferContextAction(...args: any[]): any { return invokeFeature("Panel","_customDeferContextAction",this,args) }
  _customContextDownload(...args: any[]): any { return invokeFeature("Panel","_customContextDownload",this,args) }
  _customDownloadToDirectory(...args: any[]): any { return invokeFeature("Panel","_customDownloadToDirectory",this,args) }
  _customOpenWithFile(...args: any[]): any { return invokeFeature("Panel","_customOpenWithFile",this,args) }
  _customPickApplication(...args: any[]): any { return invokeFeature("Panel","_customPickApplication",this,args) }
  _customLaunchApplication(...args: any[]): any { return invokeFeature("Panel","_customLaunchApplication",this,args) }
  ctxOpenWith(...args: any[]): any { return invokeFeature("Panel","ctxOpenWith",this,args) }
  ctxCopyFileName(...args: any[]): any { return invokeFeature("Panel","ctxCopyFileName",this,args) }
  ctxOpenTerminalHere(...args: any[]): any { return invokeFeature("Panel","ctxOpenTerminalHere",this,args) }
  get customInlineOwner(): any { return readFeature("Panel","customInlineOwner",this) }
  _customInlineUpdate(...args: any[]): any { return invokeFeature("Panel","_customInlineUpdate",this,args) }
  customInlineCancel(...args: any[]): any { return invokeFeature("Panel","customInlineCancel",this,args) }
  customInlineValue(...args: any[]): any { return invokeFeature("Panel","customInlineValue",this,args) }
  customInlineBlur(...args: any[]): any { return invokeFeature("Panel","customInlineBlur",this,args) }
  customInlineCommit(...args: any[]): any { return invokeFeature("Panel","customInlineCommit",this,args) }
  get _customTraceClipboard(): any { const fn=featureApis.Panel?._customTraceClipboard; return typeof fn === "function" ? fn.bind(this) : undefined }
  get _customTraceTransfer(): any { const fn=featureApis.Panel?._customTraceTransfer; return typeof fn === "function" ? fn.bind(this) : undefined }
  get _customTraceQueueEntry(): any { const fn=featureApis.Panel?._customTraceQueueEntry; return typeof fn === "function" ? fn.bind(this) : undefined }
}

export interface SftpFloatingPanel { [key: string]: any }
