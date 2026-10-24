import { AfterViewInit, Component, ComponentFactoryResolver, ComponentRef, Injector, ViewChild, ViewContainerRef } from '@angular/core'
import { AppService, BaseTabComponent } from 'tabby-core'
import { SftpFloatingPanel } from './sftp-floating-panel.component'
import { log } from '../services/sftp-logger'

@Component({
  selector: 'sftp-plus-workspace-tab',
  template: require('./sftp-workspace-tab.component.view.html'),
  styles: [require('./sftp-workspace-tab.component.view.css')],
})
export class SftpWorkspaceTabComponent extends BaseTabComponent implements AfterViewInit {

  readonly sftpPlusWorkspace = true

  sshSession: any = null
  profile: any = null
  terminalRef: any = null
  sourceTabKey = ''

  @ViewChild('panelHost', { read: ViewContainerRef, static: true })
  private panelHost!: ViewContainerRef

  private panelRef: ComponentRef<SftpFloatingPanel> | null = null
  private closingFromPanel = false
  private app: AppService
  private _layoutTimeout: ReturnType<typeof setTimeout> | null = null
  private _layoutRaf: number | null = null

  constructor(injector: Injector, private resolver: ComponentFactoryResolver) {
    super(injector)
    this.app = injector.get(AppService)
    this.title = this._buildTabTitle()
  }

  ngAfterViewInit(): void {
    let factory: ReturnType<ComponentFactoryResolver['resolveComponentFactory']> | null = null
    try {
      factory = this.resolver.resolveComponentFactory(SftpFloatingPanel)
    } catch (e) {
      log.error('Failed to resolve SftpFloatingPanel component factory:', e)
      return
    }
    let ref: ComponentRef<SftpFloatingPanel> | null = null
    try {
      ref = this.panelHost.createComponent(factory) as ComponentRef<SftpFloatingPanel>
    } catch (e) {
      log.error('Failed to create SftpFloatingPanel component:', e)
      return
    }
    const panel = ref.instance
    this.panelRef = ref

    panel.displayMode = 'workspace'
    panel.sshSession = this.sshSession
    panel.profile = this.profile
    panel.terminalRef = this.terminalRef
    panel.onMinimize = null
    panel.onClose = () => {
      this.closingFromPanel = true
      const parent = this.app.getParentTab(this)
      void this.app.closeTab(parent ?? this, true)
    }

    this.title = this._buildTabTitle()

    ref.changeDetectorRef.detectChanges()

    this._layoutTimeout = setTimeout(() => panel.refreshWorkspaceLayout(), 0)
    this._layoutRaf = requestAnimationFrame(() => panel.refreshWorkspaceLayout())
  }

  private _buildTabTitle(): string {
    const terminal = this.terminalRef
    const base = String(terminal?.customTitle || terminal?.title || '').trim()
    if (base) return `${base} - SFTP++`

    const host = this.profile?.options?.host || this.profile?.name || ''
    const user = this.profile?.options?.username || this.profile?.options?.user || ''
    const profileTitle = user ? `${user}@${host}` : host
    return profileTitle ? `${profileTitle} - SFTP++` : 'SFTP++'
  }

  async canClose(): Promise<boolean> {
    if (this.closingFromPanel) return true
    const panel = this.panelRef?.instance
    if (panel && (panel as any).transfers?.length > 0) {

      const count = (panel as any).transfers.length
      return window.confirm((panel as any).i18n?.t('notify.closeWithTransfers', { count }) || 'Transfers are still running. Close anyway?')
    }
    return true
  }

  override destroy(): void {
    if (this._layoutTimeout != null) { clearTimeout(this._layoutTimeout); this._layoutTimeout = null }
    if (this._layoutRaf != null) { cancelAnimationFrame(this._layoutRaf); this._layoutRaf = null }
    try { this.panelRef?.instance?.disconnect?.() } catch { /* ignore */ }
    try { this.panelRef?.destroy?.() } catch { /* ignore */ }
    this.panelRef = null as any
    super.destroy()
  }

  override async getRecoveryToken(): Promise<null> {

    return null
  }
}
