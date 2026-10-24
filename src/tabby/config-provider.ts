import { ConfigProvider } from 'tabby-core'
import { MOUSE_BACK_SPEC, MOUSE_FORWARD_SPEC } from './hotkey-util'

export type FileTypeIconRule = { ext: string; svg: string; name?: string }

export type CaretShape = 'block' | 'beam' | 'underline'

export function normalizeCaretShape(value: unknown): CaretShape {
  return value === 'block' || value === 'underline' ? value : 'beam'
}

export const PANEL_HOTKEY_ACTIONS = [
  'delete', 'rename', 'refresh', 'up', 'back', 'forward',

  'upload', 'download', 'openLocal', 'viewFile', 'editFile',
  'newFolder', 'newFile', 'details', 'copyPath',
] as const

export type PanelHotkeyAction = typeof PANEL_HOTKEY_ACTIONS[number]

export const CONTEXT_ACTION_HOTKEYS: PanelHotkeyAction[] = [
  'upload', 'download', 'openLocal', 'viewFile', 'editFile',
  'newFolder', 'newFile', 'details', 'copyPath',
]

export function defaultPanelHotkeys(): Record<PanelHotkeyAction, { keys: string[]; enabled: boolean }> {
  return {
    delete: { keys: ['Delete'], enabled: true },
    rename: { keys: ['F2'], enabled: true },
    refresh: { keys: ['F5'], enabled: true },
    up: { keys: ['Shift+Backspace'], enabled: true },
    back: { keys: ['Backspace', MOUSE_BACK_SPEC], enabled: true },
    forward: { keys: [MOUSE_FORWARD_SPEC], enabled: true },

    upload: { keys: [], enabled: false },
    download: { keys: [], enabled: false },
    openLocal: { keys: [], enabled: false },
    viewFile: { keys: [], enabled: false },
    editFile: { keys: [], enabled: false },
    newFolder: { keys: [], enabled: false },
    newFile: { keys: [], enabled: false },
    details: { keys: [], enabled: false },
    copyPath: { keys: [], enabled: false },
  }
}

export interface SftpPlusPluginConfig {
  layoutMode: string

  fontSize: number
  theme: string
  colorPrimary: string
  colorBg: string
  colorText: string
  colorSurface: string
  colorBorder: string
  colorMuted: string
  tableColBorders: boolean
  tableZebra: boolean
  hideNativeSFTPButton: boolean

  defaultPathMode: 'off' | 'remember' | 'sync'

  defaultShowHidden: boolean
  openInNewTabByDefault: boolean

  openOnClick: 'double' | 'single'

  openUnsupportedInSystem: boolean

  editableFileExtensions: string[]

  allowViewEditAllFiles: boolean

  allowViewAllAsText?: boolean

  allowEditAllFiles?: boolean

  showTextLineNumbers: boolean

  textCaretShape: CaretShape

  panelHotkeys: {
    delete: { keys: string[]; enabled: boolean }
    rename: { keys: string[]; enabled: boolean }
    refresh: { keys: string[]; enabled: boolean }
    up: { keys: string[]; enabled: boolean }
    back: { keys: string[]; enabled: boolean }
    forward: { keys: string[]; enabled: boolean }
  }

  contextMenuOrder: string[]

  contextMenuDisabled: string[]
  singleWorkspaceInstance: boolean

  closeBookmarkPanelOnSelect: boolean

  bookmarkPanelGroupByScope: boolean

  bookmarkPanelGroupOrder: Array<'connection' | 'global'>

  dateFormat: string

  transferUploadConcurrency: number

  transferDownloadConcurrency: number

  transferChannelMode: string

  defaultUploadPath: string

  defaultDownloadPath: string

  iconResourceDir: string

  fileTypeIcons: FileTypeIconRule[]

  disabledIconSvgs: string[]

  folderIconSvg: string

  hideAuthorInfo: boolean

  conflictDigestEnabled: boolean


  conflictDigestMaxSizeMB: number

  conflictDigestAlgo: 'sha1' | 'sha256'
  paneCustomOrder: Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'>

  paneHiddenItems: string[]
  bookmarks: any[]
  pathMemory: Record<string, any>
  transferLogs: any[]

  paneState: Record<string, any>

  panelGeometry?: { left?: string; top?: string; width?: string; height?: string; maximized?: boolean; followWindow?: boolean }
}

export function defaultSftpPlusConfig(): SftpPlusPluginConfig {
  return {
  "recentFolderLimit": 5,
  "recentFolderDwellSeconds": 10,
  "recentFolderEntries": [],
  "folderAutocomplete": true,
  "sidebarEnabled": true,
  "sidebarSide": "left",
  "sidebarSessions": {
    "__nonStructural": true
  },
  "pathModes": {
    "__nonStructural": true
  },
  "cwdSetupServers": {
    "__nonStructural": true
  },
  "layoutMode": "auto",
  "fontSize": 13,
  "theme": "",
  "colorPrimary": "",
  "colorBg": "",
  "colorText": "",
  "colorSurface": "",
  "colorBorder": "",
  "colorMuted": "",
  "tableColBorders": false,
  "tableZebra": false,
  "hideNativeSFTPButton": false,
  "defaultPathMode": "remember",
  "defaultShowHidden": false,
  "openOnClick": "double",
  "panelHotkeys": {
    "delete": {
      "keys": [
        "Delete"
      ],
      "enabled": true
    },
    "rename": {
      "keys": [
        "F2"
      ],
      "enabled": true
    },
    "refresh": {
      "keys": [
        "F5"
      ],
      "enabled": true
    },
    "up": {
      "keys": [
        "Shift+Backspace"
      ],
      "enabled": true
    },
    "back": {
      "keys": [
        "Backspace",
        "Mouse3"
      ],
      "enabled": true
    },
    "forward": {
      "keys": [
        "Mouse4"
      ],
      "enabled": true
    },
    "upload": {
      "keys": [],
      "enabled": false
    },
    "download": {
      "keys": [],
      "enabled": false
    },
    "openLocal": {
      "keys": [],
      "enabled": false
    },
    "editFile": {
      "keys": [],
      "enabled": false
    },
    "newFolder": {
      "keys": [],
      "enabled": false
    },
    "newFile": {
      "keys": [],
      "enabled": false
    },
    "details": {
      "keys": [],
      "enabled": false
    },
    "copyPath": {
      "keys": [],
      "enabled": false
    }
  },
  "contextMenuOrder": [
    "upload",
    "download",
    "openLocal",
    "editFile",
    "revealInExplorer",
    "copy",
    "cut",
    "paste",
    "rename",
    "delete",
    "chmod",
    "details",
    "newFolder",
    "newFile",
    "refresh",
    "selectAll",
    "selectInvert",
    "copyPath"
  ],
  "contextMenuDisabled": [],
  "closeBookmarkPanelOnSelect": false,
  "bookmarkPanelGroupByScope": true,
  "bookmarkPanelGroupOrder": [
    "connection",
    "global"
  ],
  "dateFormat": "",
  "transferUploadConcurrency": 3,
  "transferDownloadConcurrency": 3,
  "transferChannelMode": "smart",
  "defaultUploadPath": "",
  "defaultDownloadPath": "",
  "iconResourceDir": "",
  "fileTypeIcons": [],
  "disabledIconSvgs": [],
  "folderIconSvg": "folder.svg",
  "conflictDigestEnabled": true,
  "conflictDigestMaxSizeMB": 256,
  "conflictDigestAlgo": "sha1",
  "paneCustomOrder": [
    "label",
    "back",
    "forward",
    "up",
    "refresh",
    "home",
    "path",
    "hidden",
    "filter",
    "bookmark"
  ],
  "paneHiddenItems": [],
  "bookmarks": [],
  "pathMemory": {
    "__nonStructural": true
  },
  "transferLogs": [],
  "paneState": {
    "__nonStructural": true
  },
  "panelGeometry": {}
} as any
}

export class SftpPlusConfigProvider extends ConfigProvider {
  defaults = {
    'tabby-sftp-plus-plus': defaultSftpPlusConfig(),

    hotkeys: {
      'sftp-plus-plus-toggle-panel': [],
    },
  }
}
