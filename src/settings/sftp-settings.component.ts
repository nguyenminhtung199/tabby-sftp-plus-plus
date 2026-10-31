import { featureApis, invokeFeature, readFeature, writeFeature } from "../features/api"
﻿

import { Component, Injectable, Optional, OnDestroy, Inject, NgZone, ChangeDetectorRef } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { ConfigService, HotkeysService, PlatformService, HostAppService } from 'tabby-core'
import { defaultSftpPlusConfig, normalizeCaretShape, type CaretShape } from '../tabby/config-provider'
import { SftpI18nService } from '../services/sftp-i18n.service'
import type { Locale } from '../services/sftp-i18n.service'
import { SftpConfigService } from '../services/sftp-config.service'
import { SftpTransferLogService } from '../services/sftp-transfer-log.service'
import { normalizeBookmarkPath } from '../services/sftp-bookmarks.service'
import { SFTP_PLUS_TOGGLE_HOTKEY } from '../tabby/hotkey-provider'
import {
  findHotkeyConflicts,
  formatHotkeyBinding,
  getKeystrokeNameFromEvent,
  isHotkeyRecordingActive,
  readToggleHotkeyBindings,
  setHotkeyRecordingActive,
  eventToPanelHotkeySpec,
  isMouseHotkeySpec,
  isWheelHotkeySpec,
  isPointerHotkeySpec,
  isBareWheelSpec,
  pointerSpecFromEvent,
  normalizePanelHotkeyKeys,
  panelHotkeySpecToTabbyBinding,
  MOUSE_BACK_SPEC,
  MOUSE_FORWARD_SPEC,
  MOUSE_MIDDLE_SPEC,
  WHEEL_UP_SPEC,
  WHEEL_DOWN_SPEC,
  type HotkeyBinding,
} from '../tabby/hotkey-util'
import {
  defaultPanelHotkeys,
  PANEL_HOTKEY_ACTIONS,
  type FileTypeIconRule,
  type PanelHotkeyAction,
} from '../tabby/config-provider'
import { isColorDark, parseColorLuminance } from '@common/utils'
import { DEFAULT_DATE_FORMAT, formatTextExtensionsForInput, normalizeEditableExtensions, setDateFormatPattern } from '../sftp/core/file-utils'
import { DEFAULT_ICON_MAP, BUILTIN_ICON_FILES, BUILTIN_ICON_EXTS, FOLDER_ICON_SVG, resolveSftpPlusBundledIconDir } from '../sftp/core/icon-defaults'
import { ContextMenuAction, FILE_MENU_REGISTRY, DEFAULT_FILE_MENU_ORDER, GROUP_BY_MODES } from '../sftp/components/sftp-context-menu.component'

export type ContextMenuCustomId = ContextMenuAction | 'groupBy'

import * as fs from 'fs'
import * as path from 'path'
import { log } from '../services/sftp-logger'

export const SFTP_PLUS_SETTINGS_TAB_ID = 'sftp-settings'

declare const __SFTP_PLUS_BUILD_TIME__: string

const {getPluginUpdater}=require('../runtime/plugin-updater.cjs')

const PREFIX = 'sftp-plus-settings'

const PANEL_HOTKEY_CLEARED = '__NONE__'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}.${key}`)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (parsed === null || parsed === undefined) return fallback
    // Basic type guard: if fallback is a primitive, ensure parsed matches
    if (typeof fallback === 'string' && typeof parsed !== 'string') return fallback
    if (typeof fallback === 'boolean' && typeof parsed !== 'boolean') return fallback
    if (typeof fallback === 'number' && typeof parsed !== 'number') return fallback
    return parsed
  } catch { return fallback }
}

function resolveAllowViewEditAllFiles(cfg: Record<string, unknown> | null | undefined): boolean {
  if (!cfg || typeof cfg !== 'object') return false
  return cfg['allowViewEditAllFiles'] === true
    || cfg['allowEditAllFiles'] === true
    || cfg['allowViewAllAsText'] === true
    || cfg['allowViewAllFiles'] === true
}

function loadAllowViewEditAllFiles(): boolean {
  if (load('allowViewEditAllFiles', false)) return true
  if (load('allowEditAllFiles', false)) return true
  if (load('allowViewAllAsText', false)) return true
  if (load('allowViewAllFiles', false)) return true
  return false
}

const TABLE_SETTINGS_KEY = 'sftp-plus-table'

function loadTableSetting(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(`${TABLE_SETTINGS_KEY}.${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

const EXPORT_CATEGORY_FIELDS: Record<string, string[]> = {

  theme: ['theme', 'colorPrimary', 'colorBg', 'colorText', 'colorBorder'],

  layout: [
    'layoutMode', 'fontSize', 'tableColBorders', 'tableZebra',
    'paneCustomOrder', 'paneHiddenItems',
    'bookmarkPanelGroupByScope', 'bookmarkPanelGroupOrder',
    'contextMenuOrder', 'contextMenuDisabled',
  ],

  icons: ['iconResourceDir', 'fileTypeIcons', 'disabledIconSvgs', 'folderIconSvg'],

  other: [
    'hideAuthorInfo', 'hideNativeSFTPButton', 'defaultPathMode', 'defaultShowHidden',
    'openInNewTabByDefault', 'singleWorkspaceInstance', 'closeBookmarkPanelOnSelect',
    'openOnClick', 'dateFormat', 'openUnsupportedInSystem',
    'allowViewEditAllFiles', 'allowEditAllFiles', 'allowViewAllAsText', 'editableFileExtensions',
    'showTextLineNumbers', 'textCaretShape',
  ],

  transfer: [
    'transferUploadConcurrency', 'transferDownloadConcurrency', 'transferChannelMode',
    'conflictDigestEnabled',
    'conflictDigestMaxSizeMB', 'conflictDigestAlgo',
    'defaultUploadPath', 'defaultDownloadPath',
  ],

  hotkeys: ['panelHotkeys'],

  data: ['bookmarks', 'pathMemory', 'paneState'],

  logs: ['transferLogs'],
}

const WINDOWS_BUILD_RELEASES: Array<[number, string]> = [
  [10240, '1507'], [10586, '1511'], [14393, '1607'], [15063, '1703'], [16299, '1709'],
  [17134, '1803'], [17763, '1809'], [18362, '1903'], [18363, '1909'], [19041, '2004'],
  [19042, '20H2'], [19043, '21H1'], [19044, '21H2'], [19045, '22H2'],
  [22000, '21H2'], [22621, '22H2'], [22631, '23H2'], [26100, '24H2'], [26200, '25H2'],
]

const MACOS_BY_DARWIN: Record<number, string> = {
  19: '10.15', 20: '11', 21: '12', 22: '13', 23: '14', 24: '15', 25: '26',
}

@Component({
  template: require('./sftp-settings.component.view.html'),
  styles: [require('./sftp-settings.component.view.css')],
})
export class SftpSettingsTabComponent implements OnDestroy {

  readonly pkgVersion: string = require('../../package.json').version

  readonly pkgBuildTime: string = typeof __SFTP_PLUS_BUILD_TIME__ !== 'undefined' ? __SFTP_PLUS_BUILD_TIME__ : ''

  formatBuildTime(): string {
    if (!this.pkgBuildTime) return '—'
    const d = new Date(this.pkgBuildTime)
    if (isNaN(d.getTime())) return this.pkgBuildTime
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  readonly i18n: SftpI18nService

  private readonly themeLabelKeys: Record<string, string> = {
    '':       'theme.auto',
    dark:     'theme.dark',
    light:    'theme.light',
    blue:     'theme.blue',
    green:    'theme.green',
    purple:   'theme.purple',
    red:      'theme.red',
    custom:   'theme.custom',
  }

  themeLabel(c: { value: string; label: string }): string {
    const key = this.themeLabelKeys[c.value]
    return key ? this.i18n.t(key) : c.label
  }

  swatchPreviewBg(c: { value: string; bg: string }): string {
    if (c.value === '') return 'linear-gradient(135deg, var(--body-bg, #1e1e2e), var(--text-color, #cdd6f4))'
    if (c.value === 'custom') {

      const savedBg = load('bgColor', '')
      return savedBg || c.bg
    }
    return c.bg
  }

  swatchCustomPrimary(c: { value: string; primary?: string }): string {
    if (c.value === 'custom') {
      const saved = load('primaryColor', '')
      return saved || c.primary || 'var(--primary-color, #3b82f6)'
    }
    return c.primary || 'var(--primary-color, #3b82f6)'
  }

  swatchCustomSurface(c: { value: string; surface?: string; bg?: string }): string {
    if (c.value === 'custom') return c.bg || '#313244'
    return c.surface || c.bg || '#313244'
  }

  swatchCustomText(c: { value: string; text: string }): string {
    if (c.value === 'custom') {
      const saved = load('textColor', '')
      return saved || c.text
    }
    return c.text
  }

  swatchCustomMuted(c: { value: string; muted?: string; text: string }): string {
    if (c.value === 'custom') return c.text
    return c.muted || c.text
  }

  swatchCustomBorder(c: { value: string; border?: string }): string {
    if (c.value === 'custom') {
      const saved = load('borderColor', '')
      return saved || c.border || ''
    }
    return c.border || ''
  }

  get effectiveLang(): Locale { return 'en-US' }

  colorThemes = [
    { value: '',       label: 'Auto',   bg: '#1e1e2e', text: '#cdd6f4', primary: '#b4befe', surface: '#313244', border: '#585b70', muted: '#6c7086' },
    { value: 'dark',  label: 'Dark',  bg: '#1a1d23', text: '#e8edf5', primary: '#b6b6c3', surface: '#252830', border: '#2d3242', muted: '#5a5f6f' },
    { value: 'light', label: 'Light', bg: '#f0f4f8', text: '#333333', primary: '#2563eb', surface: '#e5e7eb', border: '#d1d5db', muted: '#9ca3af' },
    { value: 'blue',  label: 'Blue',  bg: '#0b1929', text: '#e6f0ff', primary: '#3b9eff', surface: '#0f2035', border: '#1e3a5f', muted: '#5a7ea0' },
    { value: 'green', label: 'Green', bg: '#0a2016', text: '#e8fce8', primary: '#4ade80', surface: '#0e281a', border: '#1a5030', muted: '#4a8a60' },
    { value: 'purple',label: 'Purple',bg: '#160e23', text: '#ebe0fc', primary: '#b794f4', surface: '#1c1430', border: '#3a2558', muted: '#7a5aa0' },
    { value: 'red',   label: 'Red',    bg: '#1a0808', text: '#ffe0dd', primary: '#f87171', surface: '#220a0a', border: '#502020', muted: '#904040' },
    { value: 'custom',label: 'Custom', bg: '#313244', text: '#cdd6f4', primary: '#b4befe', surface: '#45475a', border: '#585b70', muted: '#6c7086' },
  ]

  theme: string = load('theme', '')

  detectedAutoTheme: 'dark' | 'light' | '' = ''

  get isDarkMode(): boolean {
    try {
      const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim()
      if (textColor) {
        const lum = parseColorLuminance(textColor)
        if (lum >= 0) return lum > 128
      }

      const bodyBg = getComputedStyle(document.documentElement).getPropertyValue('--body-bg').trim()
      if (bodyBg) {
        const lum = parseColorLuminance(bodyBg)
        if (lum >= 0) return lum < 128
      }
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  detectAutoTheme(): void {
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

    this.detectedAutoTheme = isColorDark(bodyBg) ? 'dark' : 'light'
  }

  get autoThemeLabel(): string {
    if (this.detectedAutoTheme === 'dark') return this.i18n.t('settings.dark')
    if (this.detectedAutoTheme === 'light') return this.i18n.t('settings.light')
    return ''
  }

  themePrimary = load('primaryColor', '')
  themeBg = load('bgColor', '')
  themeText = load('textColor', '')
  themeBorder = load('borderColor', '')

  layoutMode: string = 'auto'

  fontSize = 13

  showColBorders = loadTableSetting('colBorders', false)
  showZebra = loadTableSetting('zebra', false)

  hideNativeBtn = load('hideNativeBtn', false)

  defaultPathMode: 'off' | 'remember' | 'sync' = load('defaultPathMode', 'off') as 'off' | 'remember' | 'sync'

  defaultShowHidden = load('defaultShowHidden', false)

  hotkeyRecording = false
  hotkeyRecordingPreview = ''
  hotkeyConflictNames = ''
  hotkeySaveMessage = ''
  private _hotkeyStrokeSub: { unsubscribe(): void } | null = null
  private _hotkeyKeyEventSub: { unsubscribe(): void } | null = null
  private _hotkeyDomHandler: ((ev: KeyboardEvent) => void) | null = null
  private _hotkeyCommitTimer: ReturnType<typeof setTimeout> | null = null
  private _hotkeySafetyTimer: ReturnType<typeof setTimeout> | null = null
  private _hotkeyMsgTimer: ReturnType<typeof setTimeout> | null = null
  private _hotkeyDescCache: Record<string, string> = {}
  private _pendingHotkeyStrokes: string[] = []
  private _hotkeyDisableHeld = false

  get hotkeyBindingLabel(): string {
    try {
      const list = readToggleHotkeyBindings(this.configService?.store?.hotkeys)
      return list.map(formatHotkeyBinding).filter(Boolean).join(' / ')
    } catch {
      return ''
    }
  }

  openInNewTabByDefault = load('openInNewTabByDefault', false)

  singleWorkspaceInstance = load('singleWorkspaceInstance', true)

  closeBookmarkPanelOnSelect = load('closeBookmarkPanelOnSelect', false)

  bookmarkPanelGroupByScope = load('bookmarkPanelGroupByScope', true)

  bookmarkPanelGroupOrder: Array<'connection' | 'global'> = (() => {
    try {
      const raw = load<unknown>('bookmarkPanelGroupOrder', ['connection', 'global'])
      if (Array.isArray(raw) && raw.length) {
        const valid = raw.filter((x): x is 'connection' | 'global' => x === 'connection' || x === 'global')
        if (valid.includes('connection') && valid.includes('global')) {
          return [valid[0], valid.find(x => x !== valid[0])!]
        }
      }
    } catch {}
    return ['connection', 'global']
  })()
  draggingBookmarkGroup: 'connection' | 'global' | null = null

  dateFormat = load('dateFormat', '') || DEFAULT_DATE_FORMAT

  readonly defaultDateFormat = DEFAULT_DATE_FORMAT

  uploadConcurrency = 3
  downloadConcurrency = 3

  transferChannelMode = 'smart'

  conflictDigestEnabled = true
  conflictDigestMaxSizeMB = 256

  defaultUploadPath = ''

  defaultDownloadPath = ''

  iconResourceDir = ''

  fileTypeIcons: FileTypeIconRule[] = []

  disabledIconSvgs: string[] = []

  folderIconSvg = 'folder.svg'

  _editingRuleKey: string | null = null
  _editingRuleName: string = ''
  _editingIconExts: string = ''
  _editingIconSvgName: string = ''
  _editingFolderIcon = false
  _folderIconDraft = ''
  _folderIconError = ''
  _addingCustomRule = false
  _newRuleName = ''
  _newRuleExt = ''
  _newRuleSvg = ''
  _iconRuleError = ''

  hideAuthorInfo = false

  showHideAuthorConfirm = false
  paneCustomOrder: Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'> = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']

  paneHiddenItems: string[] = []
  draggingCustomItem: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden' | null = null

  openOnClick: 'double' | 'single' = load('openOnClick', 'double')

  openUnsupportedInSystem = load('openUnsupportedInSystem', true)

  editableFileExtensionsText = formatTextExtensionsForInput(load<unknown>('editableFileExtensions', []))

  allowViewEditAllFiles = loadAllowViewEditAllFiles()

  showTextLineNumbers = load('showTextLineNumbers', true)
  textCaretShape: CaretShape = normalizeCaretShape(load<unknown>('textCaretShape', 'beam'))

  caretShapeOptions: { shape: CaretShape; glyph: string; labelKey: string }[] = [
    { shape: 'block', glyph: '█', labelKey: 'settings.caretShapeBlock' },
    { shape: 'beam', glyph: '|', labelKey: 'settings.caretShapeBeam' },
    { shape: 'underline', glyph: '▁', labelKey: 'settings.caretShapeUnderline' },
  ]

  contextMenuOrder: ContextMenuCustomId[] = [...DEFAULT_FILE_MENU_ORDER, 'groupBy']

  contextMenuDisabled: ContextMenuCustomId[] = []

  draggingMenuItem: ContextMenuCustomId | null = null

  panelHotkeys: Record<PanelHotkeyAction, { keys: string[]; enabled: boolean }> = defaultPanelHotkeys()

  panelHotkeyRecording: PanelHotkeyAction | null = null

  panelHotkeyRecordingPreview = ''

  private _panelHotkeyDomHandler: ((ev: KeyboardEvent) => void) | null = null

  private _panelHotkeyMouseHandler: ((ev: MouseEvent) => void) | null = null

  private _panelHotkeyWheelHandler: ((ev: WheelEvent) => void) | null = null

  private _panelHotkeyPendingSpec = ''
  private _panelHotkeyTimer: any = null
  private _panelHotkeySafeTimer: any = null

  panelHotkeyActions: PanelHotkeyAction[] = [...PANEL_HOTKEY_ACTIONS]

  showThemeColorConfirm = false

  private _pendingColorKey = ''
  private _pendingColorVal = ''

  private _pendingOrigTheme = ''

  storageMode = 'config'
  private readonly transferLogImport: SftpTransferLogService

  constructor(
    @Optional() public configService?: ConfigService,
    @Optional() private hotkeys?: HotkeysService,
    @Optional() private sftpConfig?: SftpConfigService,
    @Optional() @Inject('BOOTSTRAP_DATA') private bootstrapData?: any,

    @Optional() private platformService?: PlatformService,
    @Optional() private hostApp?: HostAppService,
    @Optional() private updateZone?: NgZone,
    @Optional() private updateDetector?: ChangeDetectorRef,
  ) {

    this.i18n = new SftpI18nService(configService)
    this.transferLogImport = new SftpTransferLogService(configService)
  }

  pluginUpdate = { available: false, checking: false, updating: false, restartRequired: false, version: '', error: '' }
  pluginUpdateMessage = ''
  private _settingsUpdater: any
  private _stopSettingsUpdater?: () => void
  private _settingsUpdaterDestroyed = false
  private _settingsUpdaterSubscribed = false

  private _outsideSettingsUpdate<T>(work: () => T): T {
    return this.updateZone ? this.updateZone.runOutsideAngular(work) : work()
  }

  private _ensureSettingsUpdater(): any {
    if (!this._settingsUpdater) {
      this._settingsUpdater = getPluginUpdater(path.resolve(__dirname, '..'))
      this._stopSettingsUpdater = this._outsideSettingsUpdate(() => this._settingsUpdater.subscribe((state: any) => {
        if (this._settingsUpdaterDestroyed) return
        this.pluginUpdate = state
        try { if (this._settingsUpdaterSubscribed) this.updateDetector?.detectChanges() } catch { /* settings view may be closing */ }
      }))
      this._settingsUpdaterSubscribed = true
    }
    return this._settingsUpdater
  }

  async checkPluginUpdates(): Promise<void> {
    const updater = this._ensureSettingsUpdater()
    if (updater.state.checking || updater.state.updating) return
    this.pluginUpdateMessage = ''
    await this._outsideSettingsUpdate(() => updater.check())
    if (this._settingsUpdaterDestroyed) return
    this.pluginUpdate = updater.state
    this.pluginUpdateMessage = updater.state.restartRequired ? 'Restart Tabby to load the installed update.' : updater.state.available ? 'Update available: ' + updater.state.version : updater.state.error ? '' : 'SFTP++ is up to date.'
    this.updateDetector?.detectChanges()
  }

  async applyPluginUpdate(): Promise<void> {
    const updater = this._ensureSettingsUpdater()
    if (updater.state.checking || updater.state.updating) return
    if (!this.hostApp?.relaunch) { this.pluginUpdateMessage = 'Tabby restart API is unavailable.'; return }
    await this._outsideSettingsUpdate(() => updater.update(() => this.hostApp!.relaunch()))
    if (!this._settingsUpdaterDestroyed) { this.pluginUpdate = updater.state; this.updateDetector?.detectChanges() }
  }

  private _settingsChangedHandler: (() => void) | null = null

  _base_ngOnInit(): void {
    this._ensureSettingsUpdater()

    this._refreshFromConfig()

    if (!this._settingsChangedHandler) {
      this._settingsChangedHandler = () => {

        const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
        if (cfg?.layoutMode) this.layoutMode = cfg.layoutMode as string
        if (typeof cfg?.fontSize === 'number') this.fontSize = this._clampFontSize(cfg.fontSize)
      }
      window.addEventListener('sftp-plus-settings-changed', this._settingsChangedHandler)
    }
  }

  ngOnDestroy(): void {
    this._settingsUpdaterDestroyed = true
    this._stopSettingsUpdater?.()
    this.cancelHotkeyRecording()

    if (this.panelHotkeyRecording) this._teardownPanelHotkeyRecording()
    if (this._settingsChangedHandler) {
      window.removeEventListener('sftp-plus-settings-changed', this._settingsChangedHandler)
      this._settingsChangedHandler = null
    }
    if (this._hotkeyMsgTimer) {
      clearTimeout(this._hotkeyMsgTimer)
      this._hotkeyMsgTimer = null
    }
  }

  startHotkeyRecording(): void {
    if (!this.configService?.store || this.hotkeyRecording) return
    this.hotkeyConflictNames = ''
    this.hotkeySaveMessage = ''
    this.hotkeyRecording = true
    this.hotkeyRecordingPreview = ''
    this._pendingHotkeyStrokes = []
    setHotkeyRecordingActive(true)
    void this._ensureHotkeyDescriptions()

    try { this.hotkeys?.clearCurrentKeystrokes?.() } catch { /* ignore */ }
    try {
      this.hotkeys?.disable?.()
      this._hotkeyDisableHeld = true
    } catch {
      this._hotkeyDisableHeld = false
    }

    this._hotkeyDomHandler = (ev: KeyboardEvent) => {
      if (!this.hotkeyRecording) return
      ev.preventDefault()
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        this.cancelHotkeyRecording()
        return
      }
      if (ev.repeat) return
      if (ev.key === 'Control' || ev.key === 'Meta' || ev.key === 'Alt' || ev.key === 'Shift') return
      const stroke = getKeystrokeNameFromEvent(ev)
      if (!stroke) return
      this._pendingHotkeyStrokes = [stroke]
      this.hotkeyRecordingPreview = stroke
      this._scheduleHotkeyCommit()
    }
    window.addEventListener('keydown', this._hotkeyDomHandler, true)

    if (this.hotkeys?.keystroke$?.subscribe) {
      this._hotkeyStrokeSub = this.hotkeys.keystroke$.subscribe((stroke: string) => {
        if (!stroke || !this.hotkeyRecording) return

        if (this._pendingHotkeyStrokes.length === 1 && this._pendingHotkeyStrokes[0] === stroke) {
          this._scheduleHotkeyCommit()
          return
        }
        if (!this._pendingHotkeyStrokes.includes(stroke)) {
          this._pendingHotkeyStrokes.push(stroke)
        }
        this.hotkeyRecordingPreview = this._pendingHotkeyStrokes.join(' › ')
        this._scheduleHotkeyCommit()
      })
    }
    if (this.hotkeys?.keyEvent$?.subscribe) {
      this._hotkeyKeyEventSub = this.hotkeys.keyEvent$.subscribe((ev: any) => {
        if (ev instanceof KeyboardEvent) {
          ev.preventDefault()
          ev.stopPropagation()
        }
      })
    }

    if (this._hotkeySafetyTimer) clearTimeout(this._hotkeySafetyTimer)
    this._hotkeySafetyTimer = setTimeout(() => {
      if (this.hotkeyRecording) {
        this.cancelHotkeyRecording()
        this._flashHotkeyMessage(this.i18n.t('settings.hotkeyRecordTimeout'))
      }
    }, 12000)
  }

  cancelHotkeyRecording(): void {
    this._teardownHotkeyRecording(false)
  }

  async clearHotkeyBinding(): Promise<void> {
    if (!this.configService?.store) return
    this.cancelHotkeyRecording()
    try {
      if (!this.configService.store.hotkeys) this.configService.store.hotkeys = {}
      this.configService.store.hotkeys[SFTP_PLUS_TOGGLE_HOTKEY] = []
      await this.configService.save()
      this.hotkeyConflictNames = ''
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeyCleared'))
    } catch (e) {
      log.warn('clear hotkey failed', e)
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeySaveFailed'))
    }
  }

  private _scheduleHotkeyCommit(): void {
    if (this._hotkeyCommitTimer) clearTimeout(this._hotkeyCommitTimer)

    const delay = this._pendingHotkeyStrokes.length > 1 ? 800 : 350
    this._hotkeyCommitTimer = setTimeout(() => {
      this._hotkeyCommitTimer = null
      void this._commitHotkeyRecording()
    }, delay)
  }

  private async _base__commitHotkeyRecording(): Promise<void> {
    const strokes = [...this._pendingHotkeyStrokes]
    this._teardownHotkeyRecording(true)
    if (!strokes.length || !this.configService?.store) return

    const binding: HotkeyBinding = strokes.length === 1 ? strokes[0] : strokes
    const current = readToggleHotkeyBindings(this.configService.store.hotkeys)
    const sameAsCurrent = current.length === 1
      && formatHotkeyBinding(current[0]) === formatHotkeyBinding(binding)
    if (sameAsCurrent) {

      this.hotkeyConflictNames = ''
      return
    }

    const conflicts = findHotkeyConflicts(binding, this.configService.store.hotkeys, SFTP_PLUS_TOGGLE_HOTKEY)
    if (conflicts.length) {
      const names = await this._resolveHotkeyNames(conflicts)
      this.hotkeyConflictNames = names.join(', ')
      const ok = confirm(this.i18n.t('settings.hotkeyConflictConfirm', {
        keys: formatHotkeyBinding(binding),
        names: this.hotkeyConflictNames,
      }))
      if (!ok) {
        this.hotkeyConflictNames = ''
        return
      }
    } else {
      this.hotkeyConflictNames = ''
    }

    try {
      if (!this.configService.store.hotkeys) this.configService.store.hotkeys = {}
      this.configService.store.hotkeys[SFTP_PLUS_TOGGLE_HOTKEY] = [binding]
      await this.configService.save()
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeySaved', {
        keys: formatHotkeyBinding(binding),
      }))
    } catch (e) {
      log.warn('save hotkey failed', e)
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeySaveFailed'))
    }
  }

  private _teardownHotkeyRecording(_keepPreview: boolean): void {
    if (this._hotkeyCommitTimer) {
      clearTimeout(this._hotkeyCommitTimer)
      this._hotkeyCommitTimer = null
    }
    if (this._hotkeySafetyTimer) {
      clearTimeout(this._hotkeySafetyTimer)
      this._hotkeySafetyTimer = null
    }
    try { this._hotkeyStrokeSub?.unsubscribe() } catch { /* ignore */ }
    try { this._hotkeyKeyEventSub?.unsubscribe() } catch { /* ignore */ }
    this._hotkeyStrokeSub = null
    this._hotkeyKeyEventSub = null
    if (this._hotkeyDomHandler) {
      window.removeEventListener('keydown', this._hotkeyDomHandler, true)
      this._hotkeyDomHandler = null
    }
    try { this.hotkeys?.clearCurrentKeystrokes?.() } catch { /* ignore */ }
    if (this._hotkeyDisableHeld) {
      try { this.hotkeys?.enable?.() } catch { /* ignore */ }
      this._hotkeyDisableHeld = false
    }
    setHotkeyRecordingActive(false)
    this.hotkeyRecording = false
    this._pendingHotkeyStrokes = []
    this.hotkeyRecordingPreview = ''
  }

  private _flashHotkeyMessage(msg: string): void {
    this.hotkeySaveMessage = msg
    if (this._hotkeyMsgTimer) clearTimeout(this._hotkeyMsgTimer)
    this._hotkeyMsgTimer = setTimeout(() => {
      this.hotkeySaveMessage = ''
      this._hotkeyMsgTimer = null
    }, 2500)
  }

  startPanelHotkeyRecording(action: PanelHotkeyAction): void {
    if (this.panelHotkeyRecording) this._teardownPanelHotkeyRecording()
    this.panelHotkeyRecording = action
    this.panelHotkeyRecordingPreview = ''
    setHotkeyRecordingActive(true)
    try { this.hotkeys?.disable?.() } catch { /* ignore */ }

    const commit = (spec: string | null) => {
      if (!spec) return
      this.panelHotkeyRecordingPreview = this.panelHotkeyLabel(spec)

      if (spec === this._panelHotkeyPendingSpec && this._panelHotkeyTimer) return
      if (this._panelHotkeyTimer) clearTimeout(this._panelHotkeyTimer)
      this._panelHotkeyPendingSpec = spec
      this._panelHotkeyTimer = setTimeout(() => {
        this._panelHotkeyTimer = null
        this._commitPanelHotkey(action, spec)
      }, 250)
    }

    this._panelHotkeyDomHandler = (ev: KeyboardEvent) => {
      if (!this.panelHotkeyRecording) return
      ev.preventDefault()
      ev.stopPropagation()
      if (ev.key === 'Escape') { this._teardownPanelHotkeyRecording(); return }
      if (ev.repeat) return
      commit(eventToPanelHotkeySpec(ev))
    }

    this._panelHotkeyMouseHandler = (ev: MouseEvent) => {
      if (!this.panelHotkeyRecording) return
      const spec = pointerSpecFromEvent(ev)
      if (!spec) return
      ev.preventDefault()
      ev.stopPropagation()
      commit(spec)
    }

    this._panelHotkeyWheelHandler = (ev: WheelEvent) => {
      if (!this.panelHotkeyRecording) return
      ev.preventDefault()
      ev.stopPropagation()
      commit(pointerSpecFromEvent(ev))
    }
    window.addEventListener('keydown', this._panelHotkeyDomHandler, true)
    window.addEventListener('mousedown', this._panelHotkeyMouseHandler, true)
    window.addEventListener('wheel', this._panelHotkeyWheelHandler, { capture: true, passive: false })

    if (this._panelHotkeySafeTimer) clearTimeout(this._panelHotkeySafeTimer)
    this._panelHotkeySafeTimer = setTimeout(() => {
      if (this.panelHotkeyRecording) {
        this._teardownPanelHotkeyRecording()
        this._flashHotkeyMessage(this.i18n.t('settings.hotkeyRecordTimeout'))
      }
    }, 12000)
  }

  private _teardownPanelHotkeyRecording(): void {
    if (this._panelHotkeyTimer) { clearTimeout(this._panelHotkeyTimer); this._panelHotkeyTimer = null }
    if (this._panelHotkeySafeTimer) { clearTimeout(this._panelHotkeySafeTimer); this._panelHotkeySafeTimer = null }
    if (this._panelHotkeyDomHandler) {
      window.removeEventListener('keydown', this._panelHotkeyDomHandler, true)
      this._panelHotkeyDomHandler = null
    }
    if (this._panelHotkeyMouseHandler) {
      window.removeEventListener('mousedown', this._panelHotkeyMouseHandler, true)
      this._panelHotkeyMouseHandler = null
    }
    if (this._panelHotkeyWheelHandler) {

      window.removeEventListener('wheel', this._panelHotkeyWheelHandler, { capture: true })
      this._panelHotkeyWheelHandler = null
    }
    this._panelHotkeyPendingSpec = ''
    try { this.hotkeys?.enable?.() } catch { /* ignore */ }
    setHotkeyRecordingActive(false)
    this.panelHotkeyRecording = null
    this.panelHotkeyRecordingPreview = ''
  }

  private async _commitPanelHotkey(action: PanelHotkeyAction, spec: string): Promise<void> {
    this._teardownPanelHotkeyRecording()

    for (const a of this.panelHotkeyActions) {
      if (a !== action && this.panelHotkeyKeys(a).includes(spec)) {
        this._flashHotkeyMessage(this.i18n.t('settings.panelHotkeyConflict', { keys: this.panelHotkeyLabel(spec) }))
        return
      }
    }
    const list = this.panelHotkeys[action]
    if (list.keys.includes(spec)) {
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeyDuplicate'))
      return
    }

    const tabbyStroke = panelHotkeySpecToTabbyBinding(spec)
    if (tabbyStroke && this.configService?.store?.hotkeys) {
      const conflicts = findHotkeyConflicts(tabbyStroke, this.configService.store.hotkeys, '')
      if (conflicts.length) {
        const names = await this._resolveHotkeyNames(conflicts)
        this.hotkeyConflictNames = names.join(', ')
        const ok = confirm(this.i18n.t('settings.hotkeyConflictConfirm', {
          keys: this.panelHotkeyLabel(spec),
          names: this.hotkeyConflictNames,
        }))
        if (!ok) {
          this.hotkeyConflictNames = ''
          return
        }
        this.hotkeyConflictNames = ''
      }
    }
    list.keys = [...list.keys, spec]
    list.enabled = true
    this._saveToConfig()
    this.notifyPanels()

    this._flashHotkeyMessage(isBareWheelSpec(spec)
      ? this.i18n.t('settings.panelHotkeyWheelBareWarning', { keys: this.panelHotkeyLabel(spec) })
      : this.i18n.t('settings.hotkeySaved', { keys: this.panelHotkeyLabel(spec) }))
  }

  removePanelHotkeyAt(action: PanelHotkeyAction, index: number): void {
    const list = this.panelHotkeys[action]
    if (!list || index < 0 || index >= list.keys.length) return
    list.keys = list.keys.filter((_, i) => i !== index)

    if (!list.keys.length) list.enabled = false
    this._saveToConfig()
    this.notifyPanels()
    this._flashHotkeyMessage(this.i18n.t('settings.hotkeyCleared'))
  }

  clearPanelHotkey(action: PanelHotkeyAction): void {
    this.panelHotkeys[action] = { keys: [], enabled: false }
    this._saveToConfig()
    this.notifyPanels()
    this._flashHotkeyMessage(this.i18n.t('settings.hotkeyCleared'))
  }

  isPanelHotkeyBound(action: PanelHotkeyAction): boolean {
    return this.panelHotkeyKeys(action).length > 0
  }

  panelHotkeyKeys(action: PanelHotkeyAction): string[] {
    const h = (this.panelHotkeys as any)[action]
    if (!h || h.enabled === false) return []
    return normalizePanelHotkeyKeys(h.keys, PANEL_HOTKEY_CLEARED)
  }

  panelHotkeyLabel(spec: string): string {
    if (!spec) return ''
    if (spec === ' ') return 'Space'

    const cut = spec.lastIndexOf('+')
    const mods = cut >= 0 ? spec.slice(0, cut + 1) : ''
    const main = cut >= 0 ? spec.slice(cut + 1) : spec
    const special: Record<string, string> = {
      [MOUSE_MIDDLE_SPEC]: 'Mouse1',
      [MOUSE_BACK_SPEC]: 'Mouse3',
      [MOUSE_FORWARD_SPEC]: 'Mouse4',
      [WHEEL_UP_SPEC]: 'Wheel↑',
      [WHEEL_DOWN_SPEC]: 'Wheel↓',
    }
    return mods + (special[main] ?? main)
  }

  isPanelPointerHotkey(spec: string): boolean {
    return isPointerHotkeySpec(spec)
  }

  hotkeyChipHint(spec: string): string {
    if (isWheelHotkeySpec(spec)) return this.i18n.t('settings.hotkeyWheelHint')
    if (isMouseHotkeySpec(spec)) return this.i18n.t('settings.hotkeyMouseHint')
    return this.i18n.t('settings.hotkeyClickToSet')
  }

  resetPanelHotkeys(): void {
    this.panelHotkeys = defaultPanelHotkeys()
    this._saveToConfig()
    this.notifyPanels()
  }

  private readonly panelHotkeyLabelKeys: Record<PanelHotkeyAction, string> = {
    delete: 'settings.phk.delete',
    rename: 'settings.phk.rename',
    refresh: 'settings.phk.refresh',
    up: 'settings.phk.up',
    back: 'settings.phk.back',
    forward: 'settings.phk.forward',
    upload: 'app.upload',
    download: 'app.download',
    openLocal: 'file.open',
    viewFile: 'file.view',
    editFile: 'file.edit',
    newFolder: 'file.newFolder',
    newFile: 'file.newFile',
    details: 'file.properties',
    copyPath: 'pane.copyPath',
  }

  panelHotkeyLabelKey(action: PanelHotkeyAction): string {
    return this.panelHotkeyLabelKeys[action] ?? action
  }

  get modKeyText(): string {
    const p = (typeof navigator !== 'undefined' ? navigator.platform : '') || ''
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || ''
    return /Mac|iPod|iPhone|iPad/.test(p || ua) ? '⌘' : 'Ctrl'
  }

  formatOccupiedKeys(keys: string): string {
    return String(keys).replace('${mod}', this.modKeyText)
  }

  occupiedHotkeysExpanded = false

  toggleOccupiedHotkeys(): void {
    this.occupiedHotkeysExpanded = !this.occupiedHotkeysExpanded
  }

  readonly occupiedHotkeyGroups: Array<{
    titleKey: string
    items: Array<{ keys: string; descKey: string }>
  }> = [
    {
      titleKey: 'settings.occupied.groupPanel',
      items: [
        { keys: '${mod}+A', descKey: 'pane.selectAll' },
        { keys: '${mod}+C', descKey: 'file.copy' },
        { keys: '${mod}+X', descKey: 'file.cut' },
        { keys: '${mod}+V', descKey: 'file.paste' },
        { keys: '↑ ↓', descKey: 'settings.occupied.moveSelection' },
        { keys: '${mod}+Click', descKey: 'settings.occupied.multiSelect' },
        { keys: 'A–Z …', descKey: 'settings.occupied.typeAhead' },
      ],
    },
    {
      titleKey: 'settings.occupied.groupViewer',
      items: [
        { keys: '← →', descKey: 'settings.occupied.prevNextImage' },
      ],
    },
    {
      titleKey: 'settings.occupied.groupDialog',
      items: [
        { keys: 'Esc', descKey: 'settings.occupied.closeDialog' },
        { keys: 'Enter', descKey: 'settings.occupied.confirmDelete' },
      ],
    },
  ]

  private async _ensureHotkeyDescriptions(): Promise<void> {
    if (Object.keys(this._hotkeyDescCache).length) return
    try {
      const list = await this.hotkeys?.getHotkeyDescriptions?.()
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id) this._hotkeyDescCache[item.id] = item.name || item.id
        }
      }
    } catch { /* ignore */ }
  }

  private async _resolveHotkeyNames(ids: string[]): Promise<string[]> {
    await this._ensureHotkeyDescriptions()
    return ids.map(id => this._hotkeyDescCache[id] || id)
  }

  private _refreshFromConfig(): void {
    const root = document.documentElement

    this._readFromConfig()

    if (!this.theme) {
      this.detectAutoTheme()
      const autoPreset = this.detectedAutoTheme === 'light' ? this.getPreset('light') : this.getPreset('dark')
      if (autoPreset) {
        this.themePrimary = autoPreset.primary
        this.themeBg = autoPreset.bg
        this.themeText = autoPreset.text
        this.themeBorder = autoPreset.border
      }
      this.clearColorVars()
    } else if (this.theme !== 'custom') {
      const p = this.getPreset(this.theme)
      if (p) {
        this.themePrimary = p.primary
        this.themeBg = p.bg
        this.themeText = p.text
        this.themeBorder = p.border
        this.applyColors(root)
      }
    } else {

      this._restoreCustomColors()
      this.applyColors(root)
    }
  }

  private _base__readFromConfig(): void {
    try {
      const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
      if (!cfg) return
      if (cfg.layoutMode !== undefined) this.layoutMode = cfg.layoutMode as string
      if (typeof cfg.fontSize === 'number' && Number.isFinite(cfg.fontSize)) {
        this.fontSize = this._clampFontSize(cfg.fontSize)
      }
      if (cfg.theme !== undefined) this.theme = cfg.theme as string
      if (cfg.colorPrimary !== undefined) this.themePrimary = cfg.colorPrimary as string
      if (cfg.colorBg !== undefined) this.themeBg = cfg.colorBg as string
      if (cfg.colorText !== undefined) this.themeText = cfg.colorText as string
      if (cfg.colorBorder !== undefined) this.themeBorder = cfg.colorBorder as string
      if (cfg.tableColBorders !== undefined) this.showColBorders = cfg.tableColBorders as boolean
      if (cfg.tableZebra !== undefined) this.showZebra = cfg.tableZebra as boolean
      if (cfg.hideNativeSFTPButton !== undefined) this.hideNativeBtn = cfg.hideNativeSFTPButton as boolean
      if (cfg.defaultPathMode === 'off' || cfg.defaultPathMode === 'remember' || cfg.defaultPathMode === 'sync') this.defaultPathMode = cfg.defaultPathMode
      if (cfg.defaultShowHidden !== undefined) this.defaultShowHidden = cfg.defaultShowHidden === true
      if (cfg.openInNewTabByDefault !== undefined) this.openInNewTabByDefault = cfg.openInNewTabByDefault as boolean
      if (cfg.singleWorkspaceInstance !== undefined) this.singleWorkspaceInstance = cfg.singleWorkspaceInstance as boolean
      if (cfg.closeBookmarkPanelOnSelect !== undefined) this.closeBookmarkPanelOnSelect = cfg.closeBookmarkPanelOnSelect as boolean
      if (cfg.bookmarkPanelGroupByScope !== undefined) this.bookmarkPanelGroupByScope = cfg.bookmarkPanelGroupByScope !== false
      if (Array.isArray(cfg.bookmarkPanelGroupOrder) && cfg.bookmarkPanelGroupOrder.length) {
        const valid = (cfg.bookmarkPanelGroupOrder as string[]).filter(
          (x): x is 'connection' | 'global' => x === 'connection' || x === 'global',
        )
        if (valid.includes('connection') && valid.includes('global')) {
          this.bookmarkPanelGroupOrder = [valid[0], valid.find(x => x !== valid[0])!]
        }
      }
      if (cfg.dateFormat !== undefined) {
        this.dateFormat = (cfg.dateFormat as string) || DEFAULT_DATE_FORMAT
        setDateFormatPattern(this.dateFormat)
      }
      if (typeof cfg.transferUploadConcurrency === 'number') this.uploadConcurrency = this._clampConcurrency(cfg.transferUploadConcurrency)
      if (typeof cfg.transferDownloadConcurrency === 'number') this.downloadConcurrency = this._clampConcurrency(cfg.transferDownloadConcurrency)

      if ((cfg as any).transferChannelMode && ['smart', 'sftpOnly', 'tarOnly', 'preferSftp', 'preferTar'].includes((cfg as any).transferChannelMode)) {
        this.transferChannelMode = (cfg as any).transferChannelMode
      } else if ((cfg as any).transferTarAcceleration === false) {
        this.transferChannelMode = 'sftpOnly'
      } else {
        this.transferChannelMode = 'smart'
      }

      if (cfg.conflictDigestEnabled !== undefined) this.conflictDigestEnabled = cfg.conflictDigestEnabled !== false
      if (cfg.conflictDigestMaxSizeMB !== undefined) {
        this.conflictDigestMaxSizeMB = this._clampDigestMaxMB(cfg.conflictDigestMaxSizeMB)
      }
      if (typeof cfg.defaultUploadPath === 'string') this.defaultUploadPath = cfg.defaultUploadPath
      if (typeof cfg.defaultDownloadPath === 'string') this.defaultDownloadPath = cfg.defaultDownloadPath
      if (typeof cfg.iconResourceDir === 'string') this.iconResourceDir = cfg.iconResourceDir
      if (Array.isArray(cfg.fileTypeIcons)) {
        this.fileTypeIcons = cfg.fileTypeIcons
          .filter((r: any) => r && typeof r.ext === 'string' && typeof r.svg === 'string')
          .map((r: any) => {
            const rule: FileTypeIconRule = { ext: r.ext, svg: r.svg }
            if (typeof r.name === 'string' && r.name.trim()) rule.name = r.name.trim()
            return rule
          })
      }
      if (Array.isArray(cfg.disabledIconSvgs)) this.disabledIconSvgs = cfg.disabledIconSvgs.filter((s: any) => typeof s === 'string')
      if (typeof cfg.folderIconSvg === 'string') this.folderIconSvg = cfg.folderIconSvg || 'folder.svg'

      this._autoCleanInvalidRules()
      if (cfg.hideAuthorInfo !== undefined) this.hideAuthorInfo = cfg.hideAuthorInfo === true
      if (Array.isArray(cfg.paneCustomOrder) && cfg.paneCustomOrder.length) this.paneCustomOrder = cfg.paneCustomOrder as any

      if (this.paneCustomOrder.join(',') === 'label,back,forward,up,refresh,home,path,filter,bookmark,hidden') {
        this.paneCustomOrder = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
      }

      if (!this.paneCustomOrder.includes('hidden')) {
        const next = [...this.paneCustomOrder]
        const idx = next.indexOf('filter')
        next.splice(idx >= 0 ? idx : next.length, 0, 'hidden')
        this.paneCustomOrder = next
      }

      if (Array.isArray(cfg.paneHiddenItems)) {
        this.paneHiddenItems = cfg.paneHiddenItems as string[]
      } else {
        try {
          const raw = localStorage.getItem('sftp-plus-pane-hidden-items')
          if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) this.paneHiddenItems = parsed as string[] }
        } catch { /* ignore */ }
      }

      if (cfg.openOnClick === 'single' || cfg.openOnClick === 'double') this.openOnClick = cfg.openOnClick
      if (cfg.openUnsupportedInSystem !== undefined) this.openUnsupportedInSystem = cfg.openUnsupportedInSystem === true
      if (cfg.editableFileExtensions !== undefined) {
        this.editableFileExtensionsText = formatTextExtensionsForInput(cfg.editableFileExtensions)
      }
      this.allowViewEditAllFiles = resolveAllowViewEditAllFiles(cfg as Record<string, unknown>)
      if (cfg.showTextLineNumbers !== undefined) this.showTextLineNumbers = cfg.showTextLineNumbers !== false
      if (cfg.textCaretShape !== undefined) this.textCaretShape = normalizeCaretShape(cfg.textCaretShape)
      if (Array.isArray(cfg.contextMenuOrder) && cfg.contextMenuOrder.length) {
        const valid = (cfg.contextMenuOrder as string[]).filter(a => (a in FILE_MENU_REGISTRY)) as ContextMenuAction[]

        for (const a of DEFAULT_FILE_MENU_ORDER) if (!valid.includes(a)) valid.push(a)
        this.contextMenuOrder = [...valid, 'groupBy'] as ContextMenuCustomId[]
      }
      if (Array.isArray(cfg.contextMenuDisabled)) {

        this.contextMenuDisabled = (cfg.contextMenuDisabled as string[])
          .filter(a => (a in FILE_MENU_REGISTRY) || a === 'groupBy') as ContextMenuCustomId[]
      }

      if (cfg.panelHotkeys && typeof cfg.panelHotkeys === 'object') {
        const ph = cfg.panelHotkeys as any
        const def = this.panelHotkeys
        for (const a of PANEL_HOTKEY_ACTIONS) {
          if (ph[a] && typeof ph[a] === 'object') {
            const isDisabled = ph[a].enabled === false

            const raw = (ph[a] as any).keys ?? (ph[a] as any).key

            if (raw === undefined && !isDisabled) continue
            const keys = isDisabled ? [] : normalizePanelHotkeyKeys(raw, PANEL_HOTKEY_CLEARED)
            def[a] = { keys, enabled: !isDisabled }
          }
        }
        this.panelHotkeys = def
      }
    } catch { /* ignore */ }
  }

  private async _base__saveToConfig(): Promise<void> {
    try { localStorage.setItem('sftp-plus-pane-custom-order', JSON.stringify(this.paneCustomOrder)) } catch {}
    try { localStorage.setItem('sftp-plus-pane-hidden-items', JSON.stringify(this.paneHiddenItems)) } catch {}
    try { localStorage.setItem('sftp-plus-context-menu-order', JSON.stringify(this.contextMenuOrder)) } catch {}
    try { localStorage.setItem('sftp-plus-context-menu-disabled', JSON.stringify(this.contextMenuDisabled)) } catch {}
    if (!this.configService) return
    try {
      const target = this.configService.store['tabby-sftp-plus-plus']
      if (!target) return
      target.layoutMode = this.layoutMode
      target.fontSize = this.fontSize

      this.sftpConfig?.set('paneState/layout/mode', this.layoutMode)
      target.theme = this.theme
      target.colorPrimary = this.themePrimary
      target.colorBg = this.themeBg
      target.colorText = this.themeText
      target.colorBorder = this.themeBorder
      target.tableColBorders = this.showColBorders
      target.tableZebra = this.showZebra
      target.hideNativeSFTPButton = this.hideNativeBtn
      target.defaultPathMode = this.defaultPathMode
      target.defaultShowHidden = this.defaultShowHidden
      target.openInNewTabByDefault = this.openInNewTabByDefault
      target.singleWorkspaceInstance = this.singleWorkspaceInstance
      target.closeBookmarkPanelOnSelect = this.closeBookmarkPanelOnSelect
      target.bookmarkPanelGroupByScope = this.bookmarkPanelGroupByScope
      target.bookmarkPanelGroupOrder = this.bookmarkPanelGroupOrder
      target.dateFormat = this.dateFormat
      target.transferUploadConcurrency = this.uploadConcurrency
      target.transferDownloadConcurrency = this.downloadConcurrency
      target.transferChannelMode = this.transferChannelMode

      target.conflictDigestEnabled = this.conflictDigestEnabled
      target.conflictDigestMaxSizeMB = this.conflictDigestMaxSizeMB
      target.defaultUploadPath = this.defaultUploadPath
      target.defaultDownloadPath = this.defaultDownloadPath
      target.iconResourceDir = this.iconResourceDir
      target.fileTypeIcons = this.fileTypeIcons
      target.disabledIconSvgs = this.disabledIconSvgs
      target.folderIconSvg = this.folderIconSvg
      target.hideAuthorInfo = this.hideAuthorInfo
      target.paneCustomOrder = this.paneCustomOrder
      target.paneHiddenItems = this.paneHiddenItems
      target.openOnClick = this.openOnClick
      target.openUnsupportedInSystem = this.openUnsupportedInSystem
      target.editableFileExtensions = normalizeEditableExtensions(this.editableFileExtensionsText)
      target.allowViewEditAllFiles = this.allowViewEditAllFiles
      target.showTextLineNumbers = this.showTextLineNumbers
      target.textCaretShape = this.textCaretShape

      target.allowEditAllFiles = this.allowViewEditAllFiles
      target.allowViewAllAsText = this.allowViewEditAllFiles
      target.contextMenuOrder = this.contextMenuOrder
      target.contextMenuDisabled = this.contextMenuDisabled

      const ph = (target as any).panelHotkeys
      if (ph) {
        for (const a of PANEL_HOTKEY_ACTIONS) {
          const dst = ph[a]
          if (dst) {
            const keys = this.panelHotkeyKeys(a)
            dst.keys = keys
            dst.enabled = keys.length > 0 && this.panelHotkeys[a].enabled !== false
            dst.key = PANEL_HOTKEY_CLEARED
          }
        }
      }
      await this.configService.save()
    } catch (e) {
      log.error('Failed to save to config', e)
    }
  }

  private getPreset(value: string): typeof this.colorThemes[0] | undefined {
    return this.colorThemes.find(t => t.value === value)
  }

  private applyColors(root: HTMLElement): void {
    if (!this.themePrimary || !this.themeBg || !this.themeText) return
    root.style.setProperty('--sftp-primary', this.themePrimary)
    root.style.setProperty('--sftp-bg', this.themeBg)
    root.style.setProperty('--sftp-text', this.themeText)
    root.style.setProperty('--sftp-border', this.themeBorder || '')
  }

  private clearColorVars(): void {
    const root = document.documentElement
    root.style.removeProperty('--sftp-primary')
    root.style.removeProperty('--sftp-bg')
    root.style.removeProperty('--sftp-text')
    root.style.removeProperty('--sftp-border')
  }

  setTheme(value: string): void {
    this.theme = value

    const root = document.documentElement
    if (!value) {
      this.clearColorVars()
      this.detectAutoTheme()

      const autoPreset = this.detectedAutoTheme === 'light' ? this.getPreset('light') : this.getPreset('dark')
      if (autoPreset) {
        this.themePrimary = autoPreset.primary
        this.themeBg = autoPreset.bg
        this.themeText = autoPreset.text
        this.themeBorder = autoPreset.border

      }
      this._saveToConfig()
      this.notifyPanels()
      return
    }

    if (value === 'custom') {

      this._restoreCustomColors()
      this.applyColors(root)
      this.saveAllColors()
    } else {
      const p = this.getPreset(value)
      if (p) {
        this.themePrimary = p.primary
        this.themeBg = p.bg
        this.themeText = p.text
        this.themeBorder = p.border

        this.applyColors(root)
      }
      this._saveToConfig()
    }
    this.notifyPanels()
  }

  onColorChange(key: string, val: string): void {
    if (this.theme !== 'custom') {

      this._pendingColorKey = key
      this._pendingColorVal = val
      this._pendingOrigTheme = this.theme
      this.showThemeColorConfirm = true
      return
    }
    // Update the specific color field
    const updates: Record<string, string> = { primary: this.themePrimary, bg: this.themeBg, text: this.themeText, border: this.themeBorder }
    updates[key] = val
    this.themePrimary = updates.primary
    this.themeBg = updates.bg
    this.themeText = updates.text
    this.themeBorder = updates.border
    this.saveAllColors()
    this.applyColors(document.documentElement)
    this.notifyPanels()
  }

  private saveAllColors(): void {

    try { localStorage.setItem(`${PREFIX}.primaryColor`, JSON.stringify(this.themePrimary)) } catch {}
    try { localStorage.setItem(`${PREFIX}.bgColor`, JSON.stringify(this.themeBg)) } catch {}
    try { localStorage.setItem(`${PREFIX}.textColor`, JSON.stringify(this.themeText)) } catch {}
    try { localStorage.setItem(`${PREFIX}.borderColor`, JSON.stringify(this.themeBorder)) } catch {}
    this._saveToConfig()
  }

  private _restoreCustomColors(): void {
    const savedPrimary = load('primaryColor', '')
    if (savedPrimary) {
      this.themePrimary = savedPrimary
      this.themeBg = load('bgColor', '#313244')
      this.themeText = load('textColor', '#cdd6f4')
      this.themeBorder = load('borderColor', '#585b70')
    }
  }

  saveTableSettings(): void {

    try { localStorage.setItem('sftp-plus-table.colBorders', JSON.stringify(this.showColBorders)) } catch {}
    try { localStorage.setItem('sftp-plus-table.zebra', JSON.stringify(this.showZebra)) } catch {}
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleHideNativeBtn(): void {
    this.hideNativeBtn = !this.hideNativeBtn
    try { localStorage.setItem('sftp-plus-settings.hideNativeBtn', JSON.stringify(this.hideNativeBtn)) } catch {}
    this._saveToConfig()
    this.notifyPanels()
  }

  _base_saveDefaultPathMode(): void {
    if (this.defaultPathMode !== 'off' && this.defaultPathMode !== 'remember' && this.defaultPathMode !== 'sync') this.defaultPathMode = 'off'
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleDefaultShowHidden(): void {
    this.defaultShowHidden = !this.defaultShowHidden
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleOpenUnsupportedInSystem(): void {
    this.openUnsupportedInSystem = !this.openUnsupportedInSystem
    this._saveToConfig()
    this.notifyPanels()
  }

  saveEditorOptions(): void {
    this.editableFileExtensionsText = formatTextExtensionsForInput(this.editableFileExtensionsText)
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleAllowViewEditAllFiles(): void {
    this.allowViewEditAllFiles = !this.allowViewEditAllFiles
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleShowTextLineNumbers(): void {
    this.showTextLineNumbers = !this.showTextLineNumbers
    this._saveToConfig()
    this.notifyPanels()
  }

  onTextCaretShapeChange(shape: CaretShape): void {
    this.textCaretShape = normalizeCaretShape(shape)
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleOpenInNewTabByDefault(): void {
    this.openInNewTabByDefault = !this.openInNewTabByDefault
    if (this.openInNewTabByDefault) {
      this.singleWorkspaceInstance = true
    }
    this._saveToConfig()
  }

  toggleSingleWorkspaceInstance(): void {
    if (!this.openInNewTabByDefault) return
    this.singleWorkspaceInstance = !this.singleWorkspaceInstance
    this._saveToConfig()
  }

  private defaultIconRuleName(svg: string): string {
    const s = (svg || '').trim()

    if (s === FOLDER_ICON_SVG || s === 'folder.svg') return 'folder'
    if (s === 'default.svg') return 'file'
    return s.replace(/\.svg$/i, '') || s
  }

  private _ruleNameOf(r: FileTypeIconRule): string {
    const n = (r.name || '').trim()

    if (r.svg === 'default.svg' && (!n || n === 'default')) return 'file'
    if ((r.svg === FOLDER_ICON_SVG || r.svg === 'folder.svg') && (!n || n === 'folder.svg')) return 'folder'
    return n || this.defaultIconRuleName(r.svg)
  }

  trackByIcon(_index: number, item: { key: string }): string {
    return item.key
  }

  get iconGridItems(): { key: string; name: string; svg: string; isBuiltin: boolean; exts: string[] }[] {
    const items: { key: string; name: string; svg: string; isBuiltin: boolean; exts: string[] }[] = []

    const byName = new Map<string, { svg: string; exts: string[] }>()
    for (const r of this.fileTypeIcons) {
      if (!r.svg || r.svg === FOLDER_ICON_SVG) continue
      const name = this._ruleNameOf(r)
      if (!byName.has(name)) byName.set(name, { svg: r.svg, exts: [] })
      const g = byName.get(name)!
      g.svg = r.svg || g.svg
      const e = (r.ext || '').trim().toLowerCase()
      if (e) g.exts.push(e)
    }

    const ordered = [...BUILTIN_ICON_FILES].filter(f => f !== FOLDER_ICON_SVG)
    const defaultIdx = ordered.indexOf('default.svg')
    if (defaultIdx > 0) {
      ordered.splice(defaultIdx, 1)
      ordered.unshift('default.svg')
    }
    const consumed = new Set<string>()
    for (const f of ordered) {
      const key = this.defaultIconRuleName(f)
      const group = byName.get(key)
      const exts = group
        ? [...new Set(group.exts)]
        : [...(BUILTIN_ICON_EXTS[f] || [])]
      items.push({
        key,
        name: key,
        svg: group?.svg || f,
        isBuiltin: true,
        exts,
      })
      consumed.add(key)
    }

    for (const [name, g] of byName) {
      if (consumed.has(name)) continue
      if (!g.svg) continue
      items.push({
        key: name,
        name,
        svg: g.svg,
        isBuiltin: false,
        exts: [...new Set(g.exts)],
      })
    }
    return items
  }

  isIconDisabled(svg: string): boolean {
    return this.disabledIconSvgs.includes(svg)
  }

  toggleIconDisable(svg: string): void {
    if (this.isLockedIcon(svg)) return
    if (this.disabledIconSvgs.includes(svg)) {
      this.disabledIconSvgs = this.disabledIconSvgs.filter(s => s !== svg)
    } else {
      this.disabledIconSvgs = [...this.disabledIconSvgs, svg]
    }
    this._saveToConfig()
  }

  isBuiltinSvg(svg: string): boolean {
    return BUILTIN_ICON_FILES.includes(svg)
  }

  isLockedIcon(svg: string): boolean {
    return svg === 'default.svg'
  }

  isSystemRuleName(key: string | null | undefined): boolean {
    return key === 'file' || key === 'folder'
  }

  private svgExists(svgName: string): boolean {
    const dir = this.effectiveIconBaseDir
    if (!dir || !svgName) return false
    try { return fs.existsSync(path.join(dir, svgName)) } catch { return false }
  }

  private _extsForRuleName(ruleName: string, fallbackSvg?: string): string[] {
    const key = (ruleName || '').trim()
    const fromRules = this.fileTypeIcons
      .filter(r => this._ruleNameOf(r) === key)
      .map(r => (r.ext || '').trim().toLowerCase())
      .filter(Boolean)
    if (fromRules.length) return [...new Set(fromRules)]
    const svg = fallbackSvg || ''
    if (svg && this.defaultIconRuleName(svg) === key) {
      return [...(BUILTIN_ICON_EXTS[svg] || [])]
    }
    return []
  }

  private _svgForRuleName(ruleName: string, fallbackSvg = ''): string {
    const key = (ruleName || '').trim()
    const hit = this.fileTypeIcons.find(r => this._ruleNameOf(r) === key && r.svg)
    return hit?.svg || fallbackSvg
  }

  startEditIcon(item: { key: string; name: string; svg: string }): void {
    this._addingCustomRule = false
    this._editingFolderIcon = false
    this._iconRuleError = ''
    this._editingRuleKey = item.key
    this._editingRuleName = item.name
    this._editingIconSvgName = item.svg
    this._editingIconExts = this._extsForRuleName(item.key, item.svg).join(' ')
  }

  cancelEditIcon(): void {
    this._editingRuleKey = null
    this._editingRuleName = ''
    this._editingIconExts = ''
    this._editingIconSvgName = ''
    this._iconRuleError = ''
  }

  private _parseIconExtensions(raw: string): { valid: string[]; invalid: string[] } {
    const normalized = String(raw || '')
      .replace(/[。．]/g, '.')
      .replace(/[，、]/g, ',')
      .replace(/[；;]/g, ';')
      .trim()
    const tokens = normalized.split(/[\s,;|]+/).map(t => t.trim()).filter(Boolean)
    const valid: string[] = []
    const invalid: string[] = []
    const seen = new Set<string>()
    for (const token of tokens) {
      const withDot = token.startsWith('.') ? token : `.${token}`
      const ext = withDot.toLowerCase()

      if (!/^\.[a-z0-9][a-z0-9._+-]*$/i.test(ext) || ext.length > 32) {
        invalid.push(token)
        continue
      }
      if (!seen.has(ext)) {
        seen.add(ext)
        valid.push(ext)
      }
    }
    return { valid, invalid }
  }

  private checkExtConflict(extList: string[], excludeRuleName?: string): { ext: string; ownerSvg: string } | null {
    const extMap = new Map<string, string>()

    for (const [ext, svg] of Object.entries(DEFAULT_ICON_MAP)) {
      const key = ext.toLowerCase()
      if (!extMap.has(key)) extMap.set(key, svg)
    }

    for (const r of this.fileTypeIcons) {
      if (excludeRuleName && this._ruleNameOf(r) === excludeRuleName) continue
      const e = (r.ext || '').trim().toLowerCase()
      if (!e) continue
      extMap.set(e, r.svg)
    }

    if (excludeRuleName) {
      for (const [ext, svg] of Object.entries(DEFAULT_ICON_MAP)) {
        if (this.defaultIconRuleName(svg) === excludeRuleName) {
          const key = ext.toLowerCase()
          if (extMap.get(key) === svg) extMap.delete(key)
        }
      }
    }
    for (const ext of extList) {
      const key = (ext || '').trim().toLowerCase()
      const owner = extMap.get(key)
      if (owner) return { ext: key, ownerSvg: owner }
    }
    return null
  }

  confirmEditIcon(): void {
    if (!this._editingRuleKey) return
    const oldKey = this._editingRuleKey

    const newName = this.isSystemRuleName(oldKey)
      ? oldKey
      : (this._editingRuleName || '').trim()
    const newSvg = this._editingIconSvgName.trim()
    if (!newName) {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmptyName')
      return
    }
    if (!this.svgExists(newSvg)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorMissingSvg')
      return
    }

    if (newName !== oldKey && this.iconGridItems.some(i => i.key === newName)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorNameConflict')
        .replace('{name}', newName)
      return
    }
    const { valid: extList, invalid } = this._parseIconExtensions(this._editingIconExts)
    if (invalid.length) {
      this._iconRuleError = this.i18n.t('settings.iconErrorInvalidExt')
        .replace('{ext}', invalid.join(', '))
      return
    }

    if (!extList.length && newSvg !== 'default.svg') {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    const conflict = this.checkExtConflict(extList, oldKey)
    if (conflict) {
      this._iconRuleError = this.i18n.t('settings.iconErrorExtConflict')
        .replace('{ext}', conflict.ext).replace('{svg}', conflict.ownerSvg)
      return
    }
    const others = this.fileTypeIcons.filter(r => this._ruleNameOf(r) !== oldKey)
    const newRules: FileTypeIconRule[] = extList.map(ext => ({ ext, svg: newSvg, name: newName }))
    this.fileTypeIcons = [...others, ...newRules]
    this._editingRuleKey = null
    this._editingRuleName = ''
    this._editingIconExts = ''
    this._editingIconSvgName = ''
    this._iconRuleError = ''
    this._saveToConfig()
  }

  toggleAddCustomRule(): void {
    if (this._addingCustomRule) {
      this.cancelAddCustomRule()
    } else {
      this._editingRuleKey = null
      this._editingFolderIcon = false
      this._iconRuleError = ''
      this._addingCustomRule = true
      this._newRuleName = ''
      this._newRuleExt = ''
      this._newRuleSvg = ''
    }
  }

  showAddCustomRule(): void {
    this._iconRuleError = ''
    this._addingCustomRule = true
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
  }

  cancelAddCustomRule(): void {
    this._addingCustomRule = false
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
    this._iconRuleError = ''
  }

  confirmAddCustomRule(): void {
    const name = (this._newRuleName || '').trim()
    const svg = (this._newRuleSvg || '').trim()
    if (!name || !svg || !(this._newRuleExt || '').trim()) {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    if (!this.svgExists(svg)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorMissingSvg')
      return
    }
    const { valid: extList, invalid } = this._parseIconExtensions(this._newRuleExt)
    if (invalid.length) {
      this._iconRuleError = this.i18n.t('settings.iconErrorInvalidExt')
        .replace('{ext}', invalid.join(', '))
      return
    }
    if (!extList.length) {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    const conflict = this.checkExtConflict(extList, name)
    if (conflict) {
      this._iconRuleError = this.i18n.t('settings.iconErrorExtConflict')
        .replace('{ext}', conflict.ext).replace('{svg}', conflict.ownerSvg)
      return
    }

    const existingSvg = this._svgForRuleName(name, svg)

    if (existingSvg && existingSvg !== svg && this.fileTypeIcons.some(r => this._ruleNameOf(r) === name)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorNameSvgMismatch')
        .replace('{name}', name).replace('{svg}', existingSvg)
      return
    }

    const isBuiltinDefault = this.isBuiltinSvg(svg) && this.defaultIconRuleName(svg) === name
    const builtin = isBuiltinDefault ? [...(BUILTIN_ICON_EXTS[svg] || [])] : []
    const existing = this._extsForRuleName(name, svg)
    const merged = [...new Set([
      ...builtin.map(e => e.toLowerCase()),
      ...existing.map(e => e.toLowerCase()),
      ...extList,
    ])]
    const others = this.fileTypeIcons.filter(r => this._ruleNameOf(r) !== name)
    this.fileTypeIcons = [
      ...others,
      ...merged.map(ext => ({ ext, svg, name } as FileTypeIconRule)),
    ]
    this._addingCustomRule = false
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
    this._iconRuleError = ''
    this._saveToConfig()
  }

  deleteIcon(item: { key: string; svg: string; isBuiltin: boolean }): void {
    if (this.isLockedIcon(item.svg)) return
    if (item.isBuiltin) {
      this.toggleIconDisable(item.svg)
    } else {
      const ok = confirm(this.i18n.t('settings.iconDeleteConfirm', { name: item.key }))
      if (!ok) return
      this.fileTypeIcons = this.fileTypeIcons.filter(r => this._ruleNameOf(r) !== item.key)
      this._saveToConfig()
    }

    if (this._editingRuleKey === item.key) {
      this._editingRuleKey = null
      this._editingRuleName = ''
      this._editingIconSvgName = ''
      this._editingIconExts = ''
      this._iconRuleError = ''
    }
  }

  startEditFolderIcon(): void {
    this._addingCustomRule = false
    this._editingRuleKey = null
    this._folderIconError = ''
    this._editingFolderIcon = true
    this._folderIconDraft = this.folderIconSvg || ''
  }

  confirmEditFolderIcon(): void {
    const svg = (this._folderIconDraft || '').trim()
    if (!svg) {
      this._folderIconError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    if (!this.svgExists(svg)) {
      this._folderIconError = this.i18n.t('settings.iconErrorMissingSvg')
      return
    }
    this.folderIconSvg = svg
    this._editingFolderIcon = false
    this._folderIconDraft = ''
    this._folderIconError = ''
    this._saveToConfig()
  }

  cancelEditFolderIcon(): void {
    this._editingFolderIcon = false
    this._folderIconDraft = ''
    this._folderIconError = ''
  }

  restoreFolderIcon(): void {
    this.folderIconSvg = FOLDER_ICON_SVG
    this._editingFolderIcon = false
    this._folderIconError = ''
    this._saveToConfig()
  }

  resetIconSettings(): void {
    this.iconResourceDir = ''
    this.fileTypeIcons = []
    this.disabledIconSvgs = []
    this.folderIconSvg = FOLDER_ICON_SVG
    this._editingRuleKey = null
    this._editingRuleName = ''
    this._editingIconExts = ''
    this._editingIconSvgName = ''
    this._editingFolderIcon = false
    this._folderIconDraft = ''
    this._folderIconError = ''
    this._addingCustomRule = false
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
    this._iconRuleError = ''
    this._saveToConfig()
    this.notifyPanels()
  }

  private _autoCleanInvalidRules(): void {
    const dir = this.effectiveIconBaseDir
    if (!dir) return
    let readable = false
    try { readable = Array.isArray(fs.readdirSync(dir)) && fs.readdirSync(dir).some((f: string) => f.toLowerCase().endsWith('.svg')) } catch { return }
    if (!readable) return
    const before = this.fileTypeIcons.length
    this.fileTypeIcons = this.fileTypeIcons.filter(r => r && r.svg && r.ext && this.svgExists(r.svg))
    if (this.fileTypeIcons.length !== before) this._saveToConfig()
  }

  addIconRule(): void {
    this.showAddCustomRule()
  }

  removeIconRule(i: number): void {
    this.fileTypeIcons = this.fileTypeIcons.filter((_, idx) => idx !== i)
    this._saveToConfig()
  }

  private get _bundledIconDir(): string {
    return resolveSftpPlusBundledIconDir(this.bootstrapData)
  }

  private get effectiveIconBaseDir(): string {
    const u = (this.iconResourceDir || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return u ? u : this._bundledIconDir
  }

  iconPreviewPath(svg: string): string {
    const dir = this.effectiveIconBaseDir
    const file = (svg || '').trim().replace(/^\/+/, '')
    if (!dir || !file) return ''
    return dir + '/' + file
  }

  bundledIconPreviewPath(svg: string): string {
    const dir = this._bundledIconDir
    const file = (svg || '').trim().replace(/^\/+/, '')
    if (!dir || !file) return ''
    return dir + '/' + file
  }

  get builtinIconFiles(): string[] { return BUILTIN_ICON_FILES }

  get builtinIconExts(): Record<string, string[]> { return BUILTIN_ICON_EXTS }

  get bundledIconDirPlaceholder(): string {
    return this._bundledIconDir
      ? this._bundledIconDir
      : this.i18n.t('settings.iconResourceDirPh')
  }

  get iconDirDisplay(): string {
    const v = (this.iconResourceDir || '').trim()
    if (v) return v
    return this._bundledIconDir || ''
  }
  set iconDirDisplay(v: string) {
    const s = (v || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const bundled = (this._bundledIconDir || '').replace(/\\/g, '/').replace(/\/+$/, '')

    this.iconResourceDir = (!s || s === bundled) ? '' : s
  }

  toggleCloseBookmarkPanelOnSelect(): void {
    this.closeBookmarkPanelOnSelect = !this.closeBookmarkPanelOnSelect
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleBookmarkPanelGroupByScope(): void {
    this.bookmarkPanelGroupByScope = !this.bookmarkPanelGroupByScope
    this._saveToConfig()
    this.notifyPanels()
  }

  bookmarkGroupLabel(g: 'connection' | 'global'): string {
    return g === 'connection'
      ? this.i18n.t('bookmark.forConnection')
      : this.i18n.t('bookmark.global')
  }

  onBookmarkGroupDragStart(g: 'connection' | 'global', event: DragEvent): void {
    this.draggingBookmarkGroup = g
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', g)
    }
  }

  onBookmarkGroupDragOver(_g: 'connection' | 'global', event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  onBookmarkGroupDrop(target: 'connection' | 'global', event: DragEvent): void {
    event.preventDefault()
    const source = this.draggingBookmarkGroup
    this.draggingBookmarkGroup = null
    if (!source || source === target) return
    const next = this.bookmarkPanelGroupOrder.filter(x => x !== source)
    const ti = next.indexOf(target)
    if (ti < 0) next.push(source)
    else next.splice(ti, 0, source)
    if (!next.includes('connection')) next.push('connection')
    if (!next.includes('global')) next.push('global')
    this.bookmarkPanelGroupOrder = next.slice(0, 2) as Array<'connection' | 'global'>
    this._saveToConfig()
    this.notifyPanels()
  }

  onBookmarkGroupDragEnd(): void {
    this.draggingBookmarkGroup = null
  }

  resetBookmarkPanel(): void {
    this.bookmarkPanelGroupByScope = true
    this.bookmarkPanelGroupOrder = ['connection', 'global']
    this._saveToConfig()
    this.notifyPanels()
  }

  saveDateFormat(): void {
    this.dateFormat = (this.dateFormat || '').trim() || DEFAULT_DATE_FORMAT
    setDateFormatPattern(this.dateFormat)
    this._saveToConfig()
    this.notifyPanels()
  }

  private _clampConcurrency(v: unknown): number {
    const n = Number(v)
    if (!Number.isFinite(n)) return 3
    return Math.min(10, Math.max(1, Math.round(n)))
  }

  saveConcurrency(): void {
    this.uploadConcurrency = this._clampConcurrency(this.uploadConcurrency)
    this.downloadConcurrency = this._clampConcurrency(this.downloadConcurrency)
    this._saveToConfig()
    this.notifyPanels()
  }

  saveChannelMode(): void {
    if (!['smart', 'sftpOnly', 'tarOnly', 'preferSftp', 'preferTar'].includes(this.transferChannelMode)) {
      this.transferChannelMode = 'smart'
    }
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleConflictDigest(): void {
    this.conflictDigestEnabled = !this.conflictDigestEnabled
    this._saveToConfig()
    this.notifyPanels()
  }


  private _clampDigestMaxMB(v: unknown): number {
    const mb = Number(v)
    if (!Number.isFinite(mb) || mb <= 0) return 256
    return Math.min(4096, Math.max(1, Math.floor(mb)))
  }

  saveConflictDigestMaxSize(): void {
    this.conflictDigestMaxSizeMB = this._clampDigestMaxMB(this.conflictDigestMaxSizeMB)
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleHideAuthorInfo(): void {
    if (this.hideAuthorInfo) {
      this.hideAuthorInfo = false
      this._saveToConfig()
      return
    }
    this.openGithub()
    this.showHideAuthorConfirm = true
  }

  confirmHideAuthor(): void {
    this.showHideAuthorConfirm = false
    this.hideAuthorInfo = true
    this._saveToConfig()
  }

  cancelHideAuthor(): void { this.showHideAuthorConfirm = false }

  resetDateFormat(): void {
    this.dateFormat = DEFAULT_DATE_FORMAT
    setDateFormatPattern(this.dateFormat)
    this._saveToConfig()
    this.notifyPanels()
  }

  confirmThemeColorOverwrite(): void {

    const orig = this._pendingOrigTheme
    let p: typeof this.colorThemes[0] | undefined
    if (!orig) {

      const themeName = this.detectedAutoTheme === 'light' ? 'light' : 'dark'
      p = this.getPreset(themeName)
    } else {
      p = this.getPreset(orig)
    }
    if (p) {
      this.themePrimary = p.primary
      this.themeBg = p.bg
      this.themeText = p.text
      this.themeBorder = p.border
    }
    this.theme = 'custom'

    const updates: Record<string, string> = { primary: this.themePrimary, bg: this.themeBg, text: this.themeText, border: this.themeBorder }
    updates[this._pendingColorKey] = this._pendingColorVal
    this.themePrimary = updates.primary
    this.themeBg = updates.bg
    this.themeText = updates.text
    this.themeBorder = updates.border
    this.saveAllColors()
    this.applyColors(document.documentElement)
    this.notifyPanels()
    this.showThemeColorConfirm = false
  }

  cancelThemeColorOverwrite(): void {
    this.showThemeColorConfirm = false
    this._pendingColorKey = ''
    this._pendingColorVal = ''

    this._refreshColorInputs()
  }

  private _refreshColorInputs(): void {

    if (!this.theme || this.theme === 'custom') {

      this.themePrimary = load('primaryColor', this.themePrimary)
      this.themeBg = load('bgColor', this.themeBg)
      this.themeText = load('textColor', this.themeText)
      this.themeBorder = load('borderColor', this.themeBorder)
    } else {

      const p = this.getPreset(this.theme)
      if (p) {
        this.themePrimary = p.primary
        this.themeBg = p.bg
        this.themeText = p.text
        this.themeBorder = p.border
      }
    }
  }

  setLayoutMode(mode: string): void {
    this.layoutMode = mode
    this.saveLayoutMode()
  }

  saveLayoutMode(): void {
    try { localStorage.setItem('sftp-plus-layout-mode', this.layoutMode) } catch {}
    this._saveToConfig()
    this.notifyPanels()
  }

  private _clampFontSize(val: number): number {
    const n = Math.round(Number(val) || 13)
    return Math.max(11, Math.min(18, n))
  }

  onFontSizeChange(val: number): void {
    this.fontSize = this._clampFontSize(val)
    void this._saveToConfig().then(() => this.notifyPanels())
  }

  resetFontSize(): void {
    this.fontSize = 13
    void this._saveToConfig().then(() => this.notifyPanels())
  }

  paneCustomItemLabel(item: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'): string {
    if (item === 'label') return this.i18n.t('settings.paneLabel')
    if (item === 'path') return this.i18n.t('settings.addressBar')
    if (item === 'hidden') return this.i18n.t('pane.showHidden')
    return this.i18n.t(`settings.toolbarItem.${item}`)
  }

  isPaneItemHidden(item: string): boolean {
    return this.paneHiddenItems.includes(item)
  }

  togglePaneItemHidden(item: string): void {
    if (this.paneHiddenItems.includes(item)) {
      this.paneHiddenItems = this.paneHiddenItems.filter(i => i !== item)
    } else {
      this.paneHiddenItems = [...this.paneHiddenItems, item]
    }
    this._saveToConfig()
    this.notifyPanels()
  }

  onCustomDragStart(item: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden', event: DragEvent): void {
    this.draggingCustomItem = item
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', item)
    }
  }

  onCustomDragOver(_target: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden', event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  onCustomDrop(target: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden', event: DragEvent): void {
    event.preventDefault()
    const source = this.draggingCustomItem || (event.dataTransfer?.getData('text/plain') as any)
    if (!source || source === target) return
    const next = this.paneCustomOrder.filter(i => i !== source)
    const targetIndex = next.indexOf(target)
    if (targetIndex < 0) return
    let insertIndex = targetIndex
    const targetEl = event.currentTarget as HTMLElement | null
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      const placeAfter = event.clientX > (rect.left + rect.width / 2)
      if (placeAfter) insertIndex = targetIndex + 1
    }
    next.splice(insertIndex, 0, source)
    this.paneCustomOrder = next as any
    this._saveToConfig()
    this.notifyPanels()
  }

  onCustomDragEnd(): void { this.draggingCustomItem = null }

  resetPaneLayout(): void {
    this.paneCustomOrder = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
    this.paneHiddenItems = []
    this._saveToConfig()
    this.notifyPanels()
  }

  private async saveInteraction(): Promise<void> {
    await this._saveToConfig()
    this.notifyPanels()
  }

  contextMenuItemLabel(a: ContextMenuCustomId): string {
    if (a === 'groupBy') return this.i18n.t('pane.groupBy')
    const def = FILE_MENU_REGISTRY[a]
    return def ? this.i18n.t(def.labelKey) : (a as string)
  }

  isMenuEnabled(a: ContextMenuCustomId): boolean {
    return !this.contextMenuDisabled.includes(a)
  }

  toggleMenuEnabled(a: ContextMenuCustomId): void {
    if (this.contextMenuDisabled.includes(a)) {
      this.contextMenuDisabled = this.contextMenuDisabled.filter(x => x !== a)
    } else {
      this.contextMenuDisabled = [...this.contextMenuDisabled, a]
    }
    void this.saveInteraction()
  }

  onMenuDragStart(a: ContextMenuCustomId, event: DragEvent): void {
    this.draggingMenuItem = a
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', a)
    }
  }

  onMenuDragOver(_target: ContextMenuCustomId, event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  onMenuDrop(target: ContextMenuCustomId, event: DragEvent): void {
    event.preventDefault()
    const source = this.draggingMenuItem || (event.dataTransfer?.getData('text/plain') as ContextMenuCustomId)
    if (!source || source === target) return
    const next = this.contextMenuOrder.filter(i => i !== source)
    const targetIndex = next.indexOf(target)
    if (targetIndex < 0) return
    let insertIndex = targetIndex
    const targetEl = event.currentTarget as HTMLElement | null
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      const placeAfter = event.clientX > (rect.left + rect.width / 2)
      if (placeAfter) insertIndex = targetIndex + 1
    }
    next.splice(insertIndex, 0, source)
    this.contextMenuOrder = next
    void this.saveInteraction()
  }

  onMenuDragEnd(): void { this.draggingMenuItem = null }

  resetMenuOrder(): void {
    this.contextMenuOrder = [...DEFAULT_FILE_MENU_ORDER, 'groupBy']
    this.contextMenuDisabled = []
    void this.saveInteraction()
  }

  private notifyPanels(): void {

    try {
      window.dispatchEvent(new CustomEvent('sftp-plus-settings-changed'))
    } catch (e) {   }
  }

  private _cloneBackupValue(value: unknown, depth = 0): unknown {
    if (depth > 20 || value == null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => this._cloneBackupValue(item, depth + 1))
    const out: Record<string, unknown> = Object.create(null)
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || key === '__nonStructural') continue
      out[key] = this._cloneBackupValue(item, depth + 1)
    }
    return out
  }

  private _base_collectAllData(): Record<string, unknown> {
    const data: Record<string, unknown> = {}

    if (this.configService?.store) {
      try {
        const cfg = this.configService.store['tabby-sftp-plus-plus']
        if (cfg) {
          data.layoutMode = cfg.layoutMode ?? 'auto'
          data.fontSize = cfg.fontSize ?? 13
          data.theme = cfg.theme ?? ''
          data.colorPrimary = cfg.colorPrimary ?? ''
          data.colorBg = cfg.colorBg ?? ''
          data.colorText = cfg.colorText ?? ''
          data.colorBorder = cfg.colorBorder ?? ''
          data.tableColBorders = cfg.tableColBorders ?? true
          data.tableZebra = cfg.tableZebra ?? true
          data.hideNativeSFTPButton = cfg.hideNativeSFTPButton ?? false
          data.defaultPathMode = cfg.defaultPathMode ?? 'off'
          data.defaultShowHidden = cfg.defaultShowHidden ?? false
          data.openInNewTabByDefault = cfg.openInNewTabByDefault ?? false
          data.singleWorkspaceInstance = cfg.singleWorkspaceInstance ?? true
          data.closeBookmarkPanelOnSelect = cfg.closeBookmarkPanelOnSelect ?? false
          data.bookmarkPanelGroupByScope = cfg.bookmarkPanelGroupByScope !== false
          data.bookmarkPanelGroupOrder = cfg.bookmarkPanelGroupOrder ?? ['connection', 'global']
          data.dateFormat = cfg.dateFormat ?? ''
          data.transferUploadConcurrency = cfg.transferUploadConcurrency ?? 3
          data.transferDownloadConcurrency = cfg.transferDownloadConcurrency ?? 3
          data.transferChannelMode = (cfg as any).transferChannelMode ?? 'smart'
          data.conflictDigestEnabled = cfg.conflictDigestEnabled ?? true
          data.conflictDigestMaxSizeMB = cfg.conflictDigestMaxSizeMB ?? 256
          data.conflictDigestAlgo = cfg.conflictDigestAlgo === 'sha256' ? 'sha256' : 'sha1'
          data.defaultUploadPath = cfg.defaultUploadPath ?? ''
          data.defaultDownloadPath = cfg.defaultDownloadPath ?? ''
          data.iconResourceDir = cfg.iconResourceDir ?? ''
          data.fileTypeIcons = cfg.fileTypeIcons ?? []
          data.disabledIconSvgs = cfg.disabledIconSvgs ?? []
          data.folderIconSvg = cfg.folderIconSvg ?? 'folder.svg'
          data.openOnClick = cfg.openOnClick ?? 'double'
          data.openUnsupportedInSystem = cfg.openUnsupportedInSystem ?? true
          data.editableFileExtensions = cfg.editableFileExtensions ?? []
          data.allowViewEditAllFiles = resolveAllowViewEditAllFiles(cfg as Record<string, unknown>)
          data.allowEditAllFiles = data.allowViewEditAllFiles
          data.allowViewAllAsText = data.allowViewEditAllFiles
          data.showTextLineNumbers = cfg.showTextLineNumbers !== false
          data.textCaretShape = normalizeCaretShape(cfg.textCaretShape)
          data.contextMenuOrder = cfg.contextMenuOrder ?? [...DEFAULT_FILE_MENU_ORDER, 'groupBy']
          data.panelHotkeys = cfg.panelHotkeys ?? defaultPanelHotkeys()
          data.hideAuthorInfo = cfg.hideAuthorInfo ?? false
          data.paneCustomOrder = cfg.paneCustomOrder ?? ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
          data.paneHiddenItems = cfg.paneHiddenItems ?? []

          if (cfg.bookmarks?.length) data.bookmarks = cfg.bookmarks
          if (cfg.pathMemory && Object.keys(cfg.pathMemory).length) data.pathMemory = cfg.pathMemory
          if (cfg.paneState && typeof cfg.paneState === 'object') {
            data.paneState = this._cloneBackupValue(cfg.paneState)
          }

          try {
            const logs = localStorage.getItem('sftp-plus-transfer-logs')
            if (logs) data.transferLogs = JSON.parse(logs)
          } catch {}
          return data
        }
      } catch { /* ignore */ }
    }

    data.layoutMode = load('layoutMode', 'auto')
    data.fontSize = 13
    data.theme = load('theme', '')
    data.colorPrimary = load('primaryColor', '')
    data.colorBg = load('bgColor', '')
    data.colorText = load('textColor', '')
    data.colorBorder = load('borderColor', '')
    data.tableColBorders = loadTableSetting('colBorders', false)
    data.tableZebra = loadTableSetting('zebra', true)
    data.hideNativeSFTPButton = load('hideNativeBtn', false)
    data.defaultPathMode = load('defaultPathMode', 'off')
    data.defaultShowHidden = load('defaultShowHidden', false)
    data.openInNewTabByDefault = load('openInNewTabByDefault', false)
    data.singleWorkspaceInstance = load('singleWorkspaceInstance', true)
    data.closeBookmarkPanelOnSelect = load('closeBookmarkPanelOnSelect', false)
    data.bookmarkPanelGroupByScope = load('bookmarkPanelGroupByScope', true)
    data.bookmarkPanelGroupOrder = load('bookmarkPanelGroupOrder', ['connection', 'global'])
    data.dateFormat = load('dateFormat', '')
    data.transferUploadConcurrency = 3
    data.transferDownloadConcurrency = 3
    data.hideAuthorInfo = false
    data.openOnClick = load('openOnClick', 'double')
    data.openUnsupportedInSystem = load('openUnsupportedInSystem', true)
    data.editableFileExtensions = normalizeEditableExtensions(load<unknown>('editableFileExtensions', []))
    data.allowViewEditAllFiles = loadAllowViewEditAllFiles()
    data.allowEditAllFiles = data.allowViewEditAllFiles
    data.allowViewAllAsText = data.allowViewEditAllFiles
    data.showTextLineNumbers = load('showTextLineNumbers', true)
    data.textCaretShape = normalizeCaretShape(load<unknown>('textCaretShape', 'beam'))
    data.conflictDigestEnabled = load('conflictDigestEnabled', true)
    data.conflictDigestMaxSizeMB = load('conflictDigestMaxSizeMB', 256)
    data.conflictDigestAlgo = load<'sha1' | 'sha256'>('conflictDigestAlgo', 'sha1')
    try { data.contextMenuOrder = JSON.parse(localStorage.getItem('sftp-plus-context-menu-order') || '[]') } catch { data.contextMenuOrder = [] }
    try { data.contextMenuDisabled = JSON.parse(localStorage.getItem('sftp-plus-context-menu-disabled') || '[]') } catch { data.contextMenuDisabled = [] }
    data.panelHotkeys = defaultPanelHotkeys()
    try { data.paneCustomOrder = JSON.parse(localStorage.getItem('sftp-plus-pane-custom-order') || '["label","back","forward","up","refresh","home","path","hidden","filter","bookmark"]') } catch { data.paneCustomOrder = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark'] }
    try { data.paneHiddenItems = JSON.parse(localStorage.getItem('sftp-plus-pane-hidden-items') || '[]') } catch { data.paneHiddenItems = [] }

    try {
      const bkm = localStorage.getItem('sftp-plus-bookmarks-v2')
      if (bkm) data.bookmarks = JSON.parse(bkm)
    } catch {}
    try {
      const logs = localStorage.getItem('sftp-plus-transfer-logs')
      if (logs) data.transferLogs = JSON.parse(logs)
    } catch {}
    return data
  }

  /** Partial backups omit unselected categories rather than resetting their settings. */
  private filterExportData(all: Record<string, unknown>): Record<string, unknown> {

    const picks: Array<[boolean, string]> = [
      [this.exportPickTheme, 'theme'],
      [this.exportPickLayout, 'layout'],
      [this.exportPickIcons, 'icons'],
      [this.exportPickOther, 'other'],
      [this.exportPickTransfer, 'transfer'],
      [this.exportPickHotkeys, 'hotkeys'],
      [this.exportPickData, 'data'],
      [this.exportPickLogs, 'logs'],
    ]
    const out: Record<string, unknown> = {}
    for (const [enabled, category] of picks) {
      if (!enabled) continue
      for (const field of EXPORT_CATEGORY_FIELDS[category] ?? []) {
        if (field in all) out[field] = all[field]
      }
    }
    return out
  }

  _base_exportData(): void {
    const all = this.collectAllData()
    const data = this.filterExportData(all)
    if (!Object.keys(data).length) {

      this.showExportDialog = false
      return
    }
    this.showExportDialog = false
    const json = JSON.stringify({ 'tabby-sftp-plus-plus': data }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    a.download = `sftp-plus_backup_${ts}.json`
    a.click()

    setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  _base_importData(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input?.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result as string)

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error(this.i18n.t('settings.invalidFormat'))
        }
        const json: Record<string, any> = Object.create(null)
        for (const k of Object.keys(raw)) {
          if (k === '__proto__' || k === 'constructor') continue
          json[k] = raw[k]
        }

        let data = json['tabby-sftp-plus-plus']
        if (!data || typeof data !== 'object') {

          if (json['tabby-quick-command-plus'] || json['commands'] || json['groups'] || Object.keys(json).some(k => k.startsWith('qc-plus-'))) {
            throw new Error(this.i18n.t('settings.invalidFormat'))
          }

          if (Object.keys(json).some(k => k.startsWith('sftp-plus-'))) {
            data = this._convertOldPrefixedFormat(json)
          } else {
            data = json
          }
        }

        if (this.configService?.store) {
          const target = this.configService.store['tabby-sftp-plus-plus']
          if (data.layoutMode !== undefined) target.layoutMode = data.layoutMode
          if (data.fontSize !== undefined) target.fontSize = this._clampFontSize(Number(data.fontSize))
          if (data.theme !== undefined) target.theme = data.theme
          if (data.colorPrimary !== undefined) target.colorPrimary = data.colorPrimary
          if (data.colorBg !== undefined) target.colorBg = data.colorBg
          if (data.colorText !== undefined) target.colorText = data.colorText
          if (data.colorBorder !== undefined) target.colorBorder = data.colorBorder
          if (data.tableColBorders !== undefined) target.tableColBorders = data.tableColBorders
          if (data.tableZebra !== undefined) target.tableZebra = data.tableZebra
          if (data.hideNativeSFTPButton !== undefined) target.hideNativeSFTPButton = data.hideNativeSFTPButton
          if (data.defaultPathMode !== undefined) target.defaultPathMode = data.defaultPathMode
          if (data.defaultShowHidden !== undefined) target.defaultShowHidden = data.defaultShowHidden
          if (data.openInNewTabByDefault !== undefined) target.openInNewTabByDefault = data.openInNewTabByDefault
          if (data.singleWorkspaceInstance !== undefined) target.singleWorkspaceInstance = data.singleWorkspaceInstance
          if (data.closeBookmarkPanelOnSelect !== undefined) target.closeBookmarkPanelOnSelect = data.closeBookmarkPanelOnSelect
          if (data.bookmarkPanelGroupByScope !== undefined) target.bookmarkPanelGroupByScope = data.bookmarkPanelGroupByScope !== false
          if (Array.isArray(data.bookmarkPanelGroupOrder) && data.bookmarkPanelGroupOrder.length) {
            const valid = (data.bookmarkPanelGroupOrder as string[]).filter(
              (x): x is 'connection' | 'global' => x === 'connection' || x === 'global',
            )
            if (valid.includes('connection') && valid.includes('global')) {
              target.bookmarkPanelGroupOrder = [valid[0], valid.find(x => x !== valid[0])!]
            }
          }
          if (data.dateFormat !== undefined) target.dateFormat = data.dateFormat
          if (data.transferUploadConcurrency !== undefined) target.transferUploadConcurrency = data.transferUploadConcurrency
          if (data.transferDownloadConcurrency !== undefined) target.transferDownloadConcurrency = data.transferDownloadConcurrency
          if ((data as any).transferChannelMode !== undefined) target.transferChannelMode = (data as any).transferChannelMode
          if (data.conflictDigestEnabled !== undefined) target.conflictDigestEnabled = data.conflictDigestEnabled !== false
          if (data.conflictDigestMaxSizeMB !== undefined) {

            target.conflictDigestMaxSizeMB = this._clampDigestMaxMB(data.conflictDigestMaxSizeMB)
          }
          if (data.conflictDigestAlgo !== undefined) target.conflictDigestAlgo = data.conflictDigestAlgo === 'sha256' ? 'sha256' : 'sha1'
          if (data.defaultUploadPath !== undefined) target.defaultUploadPath = data.defaultUploadPath
          if (data.defaultDownloadPath !== undefined) target.defaultDownloadPath = data.defaultDownloadPath
          if (data.iconResourceDir !== undefined) target.iconResourceDir = data.iconResourceDir
          if (data.fileTypeIcons !== undefined) target.fileTypeIcons = data.fileTypeIcons
          if (data.disabledIconSvgs !== undefined) target.disabledIconSvgs = data.disabledIconSvgs
          if (data.folderIconSvg !== undefined) target.folderIconSvg = data.folderIconSvg || 'folder.svg'
          if (data.hideAuthorInfo !== undefined) target.hideAuthorInfo = data.hideAuthorInfo
          if (data.openOnClick !== undefined) target.openOnClick = data.openOnClick
          if (data.openUnsupportedInSystem !== undefined) target.openUnsupportedInSystem = data.openUnsupportedInSystem
          if (data.editableFileExtensions !== undefined) target.editableFileExtensions = normalizeEditableExtensions(data.editableFileExtensions)
          if (data.allowViewEditAllFiles !== undefined || data.allowEditAllFiles !== undefined || data.allowViewAllAsText !== undefined) {
            const on = data.allowViewEditAllFiles === true || data.allowEditAllFiles === true || data.allowViewAllAsText === true
            target.allowViewEditAllFiles = on
            target.allowEditAllFiles = on
            target.allowViewAllAsText = on
          }
          if (data.showTextLineNumbers !== undefined) target.showTextLineNumbers = data.showTextLineNumbers !== false
          if (data.textCaretShape !== undefined) target.textCaretShape = normalizeCaretShape(data.textCaretShape)
          if (data.contextMenuOrder !== undefined) target.contextMenuOrder = data.contextMenuOrder
          if (data.contextMenuDisabled !== undefined) target.contextMenuDisabled = data.contextMenuDisabled

          if (data.panelHotkeys !== undefined) {
            const ph = (target as any).panelHotkeys
            if (ph) {
              for (const a of PANEL_HOTKEY_ACTIONS) {
                const src = (data.panelHotkeys as any)[a]
                const dst = ph[a]
                if (src && dst) {

                  const keys = normalizePanelHotkeyKeys((src as any).keys ?? (src as any).key, PANEL_HOTKEY_CLEARED)
                  dst.keys = keys
                  dst.enabled = keys.length > 0 && src.enabled !== false
                  dst.key = PANEL_HOTKEY_CLEARED
                }
              }
            }
          }
          if (data.paneCustomOrder !== undefined) target.paneCustomOrder = data.paneCustomOrder
          if (data.paneHiddenItems !== undefined) target.paneHiddenItems = data.paneHiddenItems

          if (data.pathMemory !== undefined) target.pathMemory = data.pathMemory

          if (Array.isArray(data.bookmarks)) {
            const ids = new Set<string>()
            target.bookmarks = data.bookmarks.flatMap((raw: any, index: number) => {
              if (!raw || (raw.type !== 'local' && raw.type !== 'remote')) return []
              const normalizedPath = normalizeBookmarkPath(raw.path, raw.type)
              if (!normalizedPath) return []
              let id = typeof raw.id === 'string' ? raw.id.slice(0, 256) : ''
              if (!id || ids.has(id)) id = `import-${Date.now().toString(36)}-${index.toString(36)}`
              ids.add(id)
              return [{
                id,
                name: String(raw.name ?? path.basename(normalizedPath) ?? normalizedPath).slice(0, 512),
                path: normalizedPath,
                type: raw.type,
                connectionKey: raw.connectionKey == null ? undefined : String(raw.connectionKey).slice(0, 512),
                createdAt: Number(raw.createdAt) || Date.now(),
              }]
            })
          }
          if (data.paneState && typeof data.paneState === 'object' && !Array.isArray(data.paneState)) {
            const incoming = data.paneState as Record<string, unknown>
            const paneState = target.paneState && typeof target.paneState === 'object'
              ? target.paneState
              : (target.paneState = {})
            for (const section of ['layout', 'local', 'remote'] as const) {
              const clean = this._cloneBackupValue(incoming[section])
              if (clean && typeof clean === 'object' && !Array.isArray(clean)) {
                paneState[section] = { ...(paneState[section] ?? {}), ...(clean as Record<string, unknown>) }
              }
            }
          }
          this.configService.save()

          if (data.transferLogs !== undefined) {
            if (!this.transferLogImport.replaceFromImport(data.transferLogs)) {
              log.warn('Import transfer logs ignored: expected an array')
            }
          }

          if (data.paneState?.perHost) {
            const paneState = target.paneState && typeof target.paneState === 'object'
              ? target.paneState
              : (target.paneState = {})
            const perHost = paneState.perHost && typeof paneState.perHost === 'object'
              ? paneState.perHost
              : (paneState.perHost = {})
            for (const [host, entry] of Object.entries(data.paneState.perHost)) {

              if (!/^[a-zA-Z0-9._:-]+$/.test(host)) continue
              const localRaw = typeof (entry as any).savedLocalPath === 'string' ? (entry as any).savedLocalPath.trim() : ''
              if (localRaw && !/[\0-\x1f]/.test(localRaw)) {
                const localNormalized = path.normalize(localRaw)
                if (path.isAbsolute(localNormalized)) {
                  localStorage.setItem(`sftp-plus-saved-local-path.${host}`, localNormalized)
                  const hostState = perHost[host] && typeof perHost[host] === 'object'
                    ? perHost[host]
                    : (perHost[host] = {})
                  hostState.savedLocalPath = localNormalized
                }
              }
              const remoteRaw = typeof (entry as any).savedRemotePath === 'string' ? (entry as any).savedRemotePath.trim() : ''
              if (remoteRaw.startsWith('/') && !/[\0-\x1f]/.test(remoteRaw)) {
                const remoteNormalized = path.posix.normalize(remoteRaw.replace(/\/+/g, '/'))
                localStorage.setItem(`sftp-plus-saved-remote-path.${host}`, remoteNormalized)
                const hostState = perHost[host] && typeof perHost[host] === 'object'
                  ? perHost[host]
                  : (perHost[host] = {})
                hostState.savedRemotePath = remoteNormalized
              }
              const importedMode = (entry as any).pathMode
              if (importedMode === 'off' || importedMode === 'remember' || importedMode === 'sync') {
                localStorage.setItem(`sftp-plus-path-mode.${host}`, importedMode)
                const hostState = perHost[host] && typeof perHost[host] === 'object'
                  ? perHost[host]
                  : (perHost[host] = {})
                hostState.pathMode = importedMode
              }
            }
            this.configService.save()
          }
          alert(this.i18n.t('settings.importComplete'))
        } else {
          alert(this.i18n.t('settings.importUnavailable'))
        }

        this._refreshFromConfig()
        this.notifyPanels()
      } catch (e: any) {
        alert(e?.message || this.i18n.t('settings.importFailed'))
      }
    }
    reader.readAsText(file)
    input.value = ''
  }

  showExportDialog = false

  exportPickTheme = true
  exportPickLayout = true
  exportPickIcons = true
  exportPickOther = true
  exportPickTransfer = true
  exportPickHotkeys = true
  exportPickData = true
  exportPickLogs = true

  get exportPickTotal(): number { return 8 }

  private _exportPicks(): boolean[] {
    return [
      this.exportPickTheme, this.exportPickLayout, this.exportPickIcons,
      this.exportPickOther, this.exportPickTransfer, this.exportPickHotkeys,
      this.exportPickData, this.exportPickLogs,
    ]
  }

  private _setAllExportPicks(v: boolean): void {
    this.exportPickTheme = v
    this.exportPickLayout = v
    this.exportPickIcons = v
    this.exportPickOther = v
    this.exportPickTransfer = v
    this.exportPickHotkeys = v
    this.exportPickData = v
    this.exportPickLogs = v
  }

  get exportPickCount(): number {
    return this._exportPicks().filter(Boolean).length
  }

  get exportAllPicked(): boolean {
    return this.exportPickCount === this.exportPickTotal
  }

  openExportDialog(): void {
    this._setAllExportPicks(true)
    this.showExportDialog = true
  }

  closeExportDialog(): void {
    this.showExportDialog = false
  }

  toggleExportAll(): void {
    this._setAllExportPicks(!this.exportAllPicked)
  }

  showClearConfirm = false
  clearConfirmInput = ''

  openClearConfirm(): void {
    this.clearConfirmInput = ''
    this.showClearConfirm = true
    setTimeout(() => {
      const input = document.querySelector('.ss-edit-modal .ss-edit-input') as HTMLInputElement | null
      if (input) input.focus()
    }, 50)
  }
  closeClearConfirm(): void { this.showClearConfirm = false; this.clearConfirmInput = '' }

  private _resetConfigKey(target: any, key: string, def: unknown): void {
    const isStructural = def instanceof Object && !(def instanceof Array)
      && Object.keys(def as object).length > 0 && !(def as { __nonStructural?: boolean }).__nonStructural
    if (isStructural) {
      const cur = target[key]
      if (!cur || typeof cur !== 'object') throw new Error(`structural member "${key}" unavailable`)
      for (const sub of Object.keys(def as object)) {
        this._resetConfigKey(cur, sub, (def as Record<string, unknown>)[sub])
      }
      return
    }
    target[key] = def
  }

  async _base_doClearData(): Promise<void> {
    if (this.clearConfirmInput !== 'DELETE') return
    this.showClearConfirm = false
    this.clearConfirmInput = ''
    const failed: string[] = []

    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('sftp-plus-')) keysToRemove.push(k)
      }
      for (const k of keysToRemove) localStorage.removeItem(k)
    } catch (e) {
      failed.push('localStorage')
      log.error('Clear data: localStorage failed', e)
    }

    try {
      const target = this.configService?.store?.['tabby-sftp-plus-plus']
      if (target) {
        const defaults = defaultSftpPlusConfig()
        for (const k of Object.keys(defaults)) {
          try {
            this._resetConfigKey(target, k, (defaults as unknown as Record<string, unknown>)[k])
          } catch (e) {
            failed.push(k)
            log.error(`Clear data: reset "${k}" failed`, e)
          }
        }
      }
    } catch (e) {
      failed.push('config')
      log.error('Clear data: config reset failed', e)
    }

    try {
      const hk = this.configService?.store?.hotkeys as Record<string, unknown> | undefined
      if (hk && hk[SFTP_PLUS_TOGGLE_HOTKEY]) hk[SFTP_PLUS_TOGGLE_HOTKEY] = []
    } catch (e) {
      failed.push('hotkeys')
      log.error('Clear data: hotkeys failed', e)
    }

    try { await this.configService?.save() } catch (e) { log.error('Clear data: save failed', e) }

    try { this._refreshFromConfig() } catch (e) { log.error('Clear data: refresh failed', e) }
    this.notifyPanels()

    const msg = this.i18n.t('settings.dataCleared')

    alert(failed.length ? `${msg}\n\n⚠ ${failed.join(', ')}` : msg)
  }

  openGithub(): void {
    const url = 'https://github.com/10D24D/Tabby-SFTP-Plus'
    try {
      ;(window as any).require('electron').shell.openExternal(url)
    } catch {
      try { window.open(url, '_blank') } catch { /* ignore */ }
    }
  }

  _base_openNpm(): void {
    const url = 'https://www.npmjs.com/package/tabby-sftp-plus-plus'
    try {
      ;(window as any).require('electron').shell.openExternal(url)
    } catch {
      try { window.open(url, '_blank') } catch { /* ignore */ }
    }
  }

  openBugReport(): void {
    this._openIssue('bug')
  }

  openFeatureRequest(): void {
    this._openIssue('feature')
  }

  private _openIssue(kind: 'bug' | 'feature'): void {
    const url = this._buildIssueUrl(kind)
    try {
      ;(window as any).require('electron').shell.openExternal(url)
    } catch {
      try { window.open(url, '_blank') } catch { /* ignore */ }
    }
  }

  private _buildIssueUrl(kind: 'bug' | 'feature'): string {
    const template = kind === 'bug'
      ? 'bug_report_en.yml'
      : 'feature_request_en.yml'
    const base = `https://github.com/10D24D/Tabby-SFTP-Plus/issues/new?template=${template}`
    try {
      const params: string[] = []
      const add = (key: string, value: string): void => {
        if (value) params.push(`${key}=${encodeURIComponent(value)}`)
      }
      add('os_version', this._platformLabel())
      add('tabby_version', this._safeStr(() => this.platformService?.getAppVersion?.(), ''))
      add('sftp_plus_version', this.pkgVersion)
      add('tabby_frontend', this._safeStr(() => this.configService?.store?.terminal?.frontend, ''))
      add('installed_plugins', this._pluginsLabel())

      return params.length ? `${base}&${params.join('&')}` : base
    } catch {
      return base
    }
  }

  private _platformLabel(): string {
    const host = this._safeStr(() => this.hostApp?.platform, '')
    const arch = (typeof process !== 'undefined' && (process as any)?.arch) ? String((process as any).arch) : ''
    const raw = this._safeStr(() => this.platformService?.getOSRelease?.(), '')

    const ver = raw.replace(/^(Windows|macOS|Linux|Darwin)\s+/i, '').trim()

    const build = this._windowsBuild(ver)
    if (build != null) {

      if (/server/i.test(this._osProductName())) {
        return this._platformTail('Windows Server', `build ${build}`, arch)
      }
      const release = this._windowsReleaseName(build)
      const name = `Windows ${build >= 22000 ? 11 : 10}${release ? ` ${release}` : ''}`
      return this._platformTail(name, `build ${build}`, arch)
    }

    const darwin = /^(\d+)\.(\d+)/.exec(ver)
    if (darwin && Number(darwin[1]) >= 18) {
      const mac = MACOS_BY_DARWIN[Number(darwin[1])]
      return this._platformTail(mac ? `macOS ${mac}` : 'macOS', `Darwin ${ver}`, arch)
    }

    return this._platformTail(host || 'unknown', ver || undefined, arch)
  }

  private _windowsBuild(ver: string): number | null {
    const m = /^10\.0\.(\d+)(?:\.|$)/.exec(ver || '')
    return m ? Number(m[1]) : null
  }

  private _windowsReleaseName(build: number): string {
    let name = ''
    for (const [b, n] of WINDOWS_BUILD_RELEASES) {
      if (build >= b) name = n
      else break
    }
    return name
  }

  private _osProductName(): string {
    try {
      const req = (typeof window !== 'undefined') ? (window as any).require : null
      return String(req ? req('os')?.version?.() ?? '' : '')
    } catch { return '' }
  }

  private _platformTail(name: string, detail?: string, arch?: string): string {
    const extras = [detail, arch].filter(x => !!x && x !== 'unknown') as string[]
    return extras.length ? `${name || 'unknown'} (${extras.join(', ')})` : (name || 'unknown')
  }

  private _pluginsLabel(): string {
    try {
      const list = (this.bootstrapData?.installedPlugins || []).filter((p: any) => p && !p.isBuiltin)
      const names = list
        .map((p: any) => (p.version ? `${p.name}@${p.version}` : String(p.name || '')))
        .filter(Boolean)
      return names.join(', ') || 'none'
    } catch { return '' }
  }

  private _safeStr(fn: () => any, fallback = 'unknown'): string {
    try {
      const v = fn()
      return (v === undefined || v === null || v === '') ? fallback : String(v)
    } catch { return fallback }
  }

  private _convertOldPrefixedFormat(old: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {}
    const map: Record<string, string> = {
      'sftp-plus-settings.theme': 'theme',
      'sftp-plus-settings.layoutMode': 'layoutMode',
      'sftp-plus-settings.primaryColor': 'colorPrimary',
      'sftp-plus-settings.bgColor': 'colorBg',
      'sftp-plus-settings.textColor': 'colorText',
      'sftp-plus-settings.paneCustomOrder': 'paneCustomOrder',
      'sftp-plus-settings.surfaceColor': 'colorSurface',
      'sftp-plus-settings.borderColor': 'colorBorder',
      'sftp-plus-settings.customPrimaryColor': 'customPrimaryColor',
      'sftp-plus-settings.customBgColor': 'customBgColor',
      'sftp-plus-settings.customTextColor': 'customTextColor',
      'sftp-plus-settings.customBorderColor': 'customBorderColor',
      'sftp-plus-settings.customMutedColor': 'customMutedColor',
      'sftp-plus-layout-mode': 'layoutMode',
      'sftp-plus-table.colBorders': 'tableColBorders',
      'sftp-plus-table.zebra': 'tableZebra',
    }
    for (const [oldKey, newKey] of Object.entries(map)) {
      if (old[oldKey] !== undefined) out[newKey] = old[oldKey]
    }

    if (old['sftp-plus-bookmarks-v2']) out.bookmarks = old['sftp-plus-bookmarks-v2']

    if (old['sftp-plus-transfer-logs']) out.transferLogs = old['sftp-plus-transfer-logs']
    else if (old['sftp-plus-transfer-log']) out.transferLogs = old['sftp-plus-transfer-log']
    return out
  }

  // Controller facade: named source methods, one explicit composition root.
  ngOnInit(...args: any[]): any { return invokeFeature("Settings","ngOnInit",this,args) }
  _commitHotkeyRecording(...args: any[]): any { return invokeFeature("Settings","_commitHotkeyRecording",this,args) }
  _readFromConfig(...args: any[]): any { return invokeFeature("Settings","_readFromConfig",this,args) }
  _saveToConfig(...args: any[]): any { return invokeFeature("Settings","_saveToConfig",this,args) }
  saveDefaultPathMode(...args: any[]): any { return invokeFeature("Settings","saveDefaultPathMode",this,args) }
  collectAllData(...args: any[]): any { return invokeFeature("Settings","collectAllData",this,args) }
  exportData(...args: any[]): any { return invokeFeature("Settings","exportData",this,args) }
  importData(...args: any[]): any { return invokeFeature("Settings","importData",this,args) }
  doClearData(...args: any[]): any { return invokeFeature("Settings","doClearData",this,args) }
  openNpm(...args: any[]): any { return invokeFeature("Settings","openNpm",this,args) }
  get customFolderAutocomplete(): any { return readFeature("Settings","customFolderAutocomplete",this) }
  toggleCustomFolderAutocomplete(...args: any[]): any { return invokeFeature("Settings","toggleCustomFolderAutocomplete",this,args) }
  get customSidebarEnabled(): any { return readFeature("Settings","customSidebarEnabled",this) }
  toggleCustomSidebar(...args: any[]): any { return invokeFeature("Settings","toggleCustomSidebar",this,args) }
  get customSidebarSide(): any { return readFeature("Settings","customSidebarSide",this) }
  setCustomSidebarSide(...args: any[]): any { return invokeFeature("Settings","setCustomSidebarSide",this,args) }
  _customCleanConfig(...args: any[]): any { return invokeFeature("Settings","_customCleanConfig",this,args) }
  get customPanelToggleBindings(): any { return readFeature("Settings","customPanelToggleBindings",this) }
  customToggleBindingLabel(...args: any[]): any { return invokeFeature("Settings","customToggleBindingLabel",this,args) }
  customStartToggleRecording(...args: any[]): any { return invokeFeature("Settings","customStartToggleRecording",this,args) }
  _customMergeToggleBinding(...args: any[]): any { return invokeFeature("Settings","_customMergeToggleBinding",this,args) }
  customRemoveToggleBinding(...args: any[]): any { return invokeFeature("Settings","customRemoveToggleBinding",this,args) }
  get customRecentFolderLimit(): any { return readFeature("Settings","customRecentFolderLimit",this) }
  setCustomRecentFolderLimit(...args: any[]): any { return invokeFeature("Settings","setCustomRecentFolderLimit",this,args) }
  get customRecentFolderDwellSeconds(): any { return readFeature("Settings","customRecentFolderDwellSeconds",this) }
  setCustomRecentFolderDwellSeconds(...args: any[]): any { return invokeFeature("Settings","setCustomRecentFolderDwellSeconds",this,args) }
  _customNormalizeOpenMenu(...args: any[]): any { return invokeFeature("Settings","_customNormalizeOpenMenu",this,args) }
}

@Injectable()
export class SftpSettingsTabProvider extends SettingsTabProvider {
  id = SFTP_PLUS_SETTINGS_TAB_ID
  icon = 'folder-open'
  title = 'SFTP++'

  getComponentType(): any {
    return SftpSettingsTabComponent
  }

  async getSettingsTabs(): Promise<Array<{
    title: string
    icon?: string
    weight?: number
    component: any
  }>> {
    return [
      {
        title: 'SFTP++',
        icon: 'folder-open',
        weight: 99,
        component: SftpSettingsTabComponent,
      },
    ]
  }
}

export interface SftpSettingsTabComponent { [key: string]: any }
