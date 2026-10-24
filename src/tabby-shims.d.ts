declare module 'tabby-core' {
  const TabbyCoreModule: any
  export default TabbyCoreModule
  export class AppService {
    activeTab: any
    tabs: any[]
    openNewTab(options: any): any
    openNewTabRaw(options: any): any
    selectTab(tab: any): void
    getParentTab(tab: any): any
    closeTab(tab: any, checkCanClose?: boolean): Promise<void>
  }
  export class NotificationsService {
    error(title: string, message: string): void
    notice(title: string, message?: string): void
  }
  export class Logger {
    debug(...args: any[]): void
    info(...args: any[]): void
    warn(...args: any[]): void
    error(...args: any[]): void
    log(...args: any[]): void
  }
  export class LogService {
    create(name: string): Logger
  }
  export class HotkeysService {
    hotkey$: any
    unfilteredHotkey$?: any
    keystroke$?: any
    keyEvent$?: any
    disable?(): void
    enable?(): void
    clearCurrentKeystrokes?(): void
    getHotkeyDescriptions?(): Promise<Array<{ id: string; name: string }>>
  }
  export abstract class HotkeyProvider {
    abstract provide(): Promise<Array<{ id: string; name: string }>>
  }
  export abstract class TabContextMenuItemProvider {
    abstract getItems(): Promise<Array<{ label: string; click: () => void }>>
  }
  export abstract class TabRecoveryProvider<T = any> {
    abstract recover(token: unknown): Promise<T | null>
  }
  export interface RecoveredTab {
    type: string
    [key: string]: any
  }
  export interface RecoveryToken {
    type: string
    version: number
    state?: any
  }
  export class BaseTabComponent {
    parent: any
    title: string
    customTitle: string
    hasActivity: boolean
    icon?: string
    _injector: any
    constructor(injector: any)
    destroy(): void
    getRecoveryToken(): Promise<RecoveryToken | null>
  }
  export class SplitTabComponent extends BaseTabComponent {
    getFocusedTab?(): any
  }

  export interface FileTransfer {
    getName(): string
    getSize?(): number
    getCompletedBytes?(): number
    getSpeed?(): number
    isComplete?(): boolean
    isCancelled?(): boolean
    cancel?(): void
  }
  export class FileUpload implements FileTransfer {
    getName(): string
    getMode(): number
    getSize(): number
    read(): Promise<Buffer>
    close(): void
    increaseProgress(bytes: number): void
    getCompletedBytes?(): number
    getSpeed?(): number
    isComplete?(): boolean
    isCancelled?(): boolean
    cancel?(): void
  }
  export class FileDownload implements FileTransfer {
    getName(): string
    getMode(): number
    getSize(): number
    write(buffer: Buffer): Promise<void>
    close(): void
    increaseProgress(bytes: number): void
    getCompletedBytes?(): number
    getSpeed?(): number
    isComplete?(): boolean
    isCancelled?(): boolean
    cancel?(): void
  }
  export class PlatformService {

    getAppVersion(): string
    getOSRelease(): string
    openExternal(url: string): void
  }

  export class HostAppService {
    relaunch(): void
    get platform(): string
  }
  export class ProfilesService {

  }
  export abstract class Theme {
    name: string
    css: string
    terminalBackground: string
  }
  export class ThemesService {
    findCurrentTheme(): Theme
    findTheme(name: string): Theme | null
    applyTheme(theme: Theme): void
    get themeChanged$(): import('rxjs').Observable<Theme>
  }

  export class ConfigService {

    store: any

    readonly ready$: import('rxjs').Observable<boolean>

    readonly changed$: import('rxjs').Observable<void>

    save(): Promise<void>

    load(): Promise<void>
  }

  export abstract class ConfigProvider {

    defaults: any

    platformDefaults: Record<string, any>
  }
}

declare module 'tabby-terminal' {
  export class TerminalDecorator {
    attach(terminal: any): void
    detach(terminal: any): void
    subscribeUntilDetached(terminal: any, sub: any): void
  }
  export class BaseTerminalTabComponent {
    element?: any
    sshSession?: any
    profile?: any
    customTitle?: string
    title?: string
  }
}

declare module 'tabby-settings' {
  export class SettingsTabComponent {
    activeTab: string
  }
  export abstract class SettingsTabProvider {
    abstract getSettingsTabs(): Promise<Array<{
      title: string
      icon?: string
      weight?: number
      component: any
    }>>
  }
}
