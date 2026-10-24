import { featureApis, invokeFeature, readFeature, writeFeature } from "../features/api"
﻿

import { Injectable, Injector, ComponentFactoryResolver, ApplicationRef, NgZone, Optional } from '@angular/core'
import { TerminalDecorator } from 'tabby-terminal'
import { NotificationsService, ConfigService, AppService, HotkeysService } from 'tabby-core'
import { SftpFloatingPanel } from '../sftp/sftp-floating-panel.component'
import { SftpWorkspaceTabComponent } from '../sftp/sftp-workspace-tab.component'
import { SFTP_PLUS_TOGGLE_HOTKEY } from './hotkey-provider'
import { isHotkeyRecordingActive } from './hotkey-util'
import { SftpConfigService } from '../services/sftp-config.service'

import { log } from '../services/sftp-logger'

const FOLDER_SVG = '<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" style="vertical-align:middle"><path d="M120 344h291.6l112-112H736v224h56V176H500.4l-112 112H64v560l56-130.6z"/><path d="M792 456H232L120 717.4 64 848h728l168-392z"/></svg>'

let _toolbarBtnStateStyleInjected = false
function ensureToolbarBtnStateStyle(): void {
  if (_toolbarBtnStateStyleInjected) return
  _toolbarBtnStateStyleInjected = true
  try {
    if (document.querySelector('style[data-sftp-plus="toolbar-btn-state"]')) return
    const style = document.createElement('style')
    style.setAttribute('data-sftp-plus', 'toolbar-btn-state')
    style.textContent = `

      button[data-tabby-sftp-plus-plus-button="1"].sftp-plus-btn-open {
        color: #64748b !important;
        background: rgba(100, 116, 139, 0.10) !important;
        border: 1px solid rgba(100, 116, 139, 0.55) !important;
        border-radius: 4px;
        opacity: 0.92;
      }
      button[data-tabby-sftp-plus-plus-button="1"].sftp-plus-btn-open:hover {
        color: #475569 !important;
        background: rgba(100, 116, 139, 0.18) !important;
        border-color: rgba(71, 85, 105, 0.7) !important;
        opacity: 1;
      }
      button[data-tabby-sftp-plus-plus-button="1"].sftp-plus-btn-minimized {
        color: #64748b !important;
        background: rgba(100, 116, 139, 0.10) !important;
        border: 1px dashed rgba(100, 116, 139, 0.55) !important;
        border-radius: 4px;
        opacity: 0.92;
      }
      button[data-tabby-sftp-plus-plus-button="1"].sftp-plus-btn-minimized:hover {
        color: #475569 !important;
        background: rgba(100, 116, 139, 0.18) !important;
        border-color: rgba(71, 85, 105, 0.7) !important;
        opacity: 1;
      }
    `
    document.head.appendChild(style)
  } catch { /* ignore */ }
}

function bringFloatToFront(el: HTMLElement): void {
  const w = window as any
  if (!w.__tabbyFloatZ || w.__tabbyFloatZ < 900) w.__tabbyFloatZ = 900
  w.__tabbyFloatZ += 1
  el.style.zIndex = String(w.__tabbyFloatZ)
}

@Injectable()
export class SftpTerminalDecorator extends TerminalDecorator {
  private _hideStyleEl: HTMLStyleElement | null = null
  private _hideObserver: MutationObserver | null = null

  private _hideNativeTimers: ReturnType<typeof setTimeout>[] = []

  private _toolbars = new Set<ParentNode>()
  private static _hotkeySubscribed = false
  private static _hotkeySub: { unsubscribe(): void } | null = null
  private sftpConfig: SftpConfigService | null = null

  private static _noTransitionStyleInjected = false

  constructor(
    private notifications: NotificationsService,
    private resolver: ComponentFactoryResolver,
    private appRef: ApplicationRef,
    private zone: NgZone,
    private injector: Injector,
    private app: AppService,
    @Optional() private config?: ConfigService,
  ) {
    super()
    try { this.sftpConfig = this.injector.get(SftpConfigService, null as any) } catch { this.sftpConfig = null }
    log.info('Decorator ready')
    this._applyNativeBtnHideRule()
    this._subscribeHotkeys()
  }

  private _subscribeHotkeys(): void {

    if (SftpTerminalDecorator._hotkeySubscribed) return
    let hotkeys: HotkeysService | null = null
    try {
      hotkeys = this.injector.get(HotkeysService as any, null) as HotkeysService | null
    } catch {
      hotkeys = null
    }

    const stream = hotkeys?.unfilteredHotkey$ || hotkeys?.hotkey$
    if (!stream?.subscribe) {
      log.warn('HotkeysService unavailable, panel hotkey disabled')
      return
    }
    SftpTerminalDecorator._hotkeySubscribed = true
    try {
      try { SftpTerminalDecorator._hotkeySub?.unsubscribe() } catch { /* ignore */ }
      SftpTerminalDecorator._hotkeySub = stream.subscribe((id: string) => {
        if (id !== SFTP_PLUS_TOGGLE_HOTKEY) return

        if (isHotkeyRecordingActive()) return
        log.info('Panel hotkey triggered')
        this.zone.run(() => this.togglePanelForActiveTerminal())
      })
      log.info('Panel hotkey subscribed')
    } catch (e) {
      SftpTerminalDecorator._hotkeySubscribed = false
      SftpTerminalDecorator._hotkeySub = null
      log.warn('Hotkey subscribe failed', e)
    }
  }

  _base_togglePanelForActiveTerminal(forceTerminal?: any): void {
    const terminal = forceTerminal ?? this._getActiveSshTerminal()
    if (!terminal) {
      this.notifications.error('SFTP++', 'No active SSH session')
      return
    }

    const hostEl = this._resolveHostEl(terminal)
    if (!hostEl) {
      this.notifications.error('SFTP++', 'Cannot find terminal element')
      return
    }

    if (this._openInNewTabByDefault()) {
      this.openWorkspaceTab(terminal)
      return
    }

    if ((hostEl as any).__sftpPlusOpen && (hostEl as any).__sftpPlusMinimized) {
      this.restoreFloatingPanel(hostEl)
      return
    }
    if ((hostEl as any).__sftpPlusOpen) {
      this.closeFloatingPanel(hostEl)
      return
    }
    this.openFloatingPanel(terminal)
  }

  private _isSshTerminal(tab: any): boolean {
    if (!tab) return false
    if (tab.sshSession || tab._sshSession) return true
    const profile = tab.profile ?? tab._profile ?? null
    if (!profile) return false
    if (profile.type === 'ssh') return true
    if (profile.options?.host) return true
    return false
  }

  private _collectLeafTabs(): any[] {
    const out: any[] = []
    const visit = (tab: any): void => {
      if (!tab) return
      if (tab.root?.getAllTabs) {
        for (const child of tab.root.getAllTabs()) visit(child)
        return
      }
      if (typeof tab.getAllTabs === 'function') {
        for (const child of tab.getAllTabs()) visit(child)
        return
      }
      out.push(tab)
    }
    for (const top of this.app.tabs || []) visit(top)
    return out
  }

  private _getActiveSshTerminal(): any | null {
    try {
      const leaves = this._collectLeafTabs()

      const focused = leaves.find(t => t?.hasFocus && this._isSshTerminal(t))
      if (focused?.element?.nativeElement) return focused

      let tab: any = this.app.activeTab
      if (!tab) return null
      if (typeof tab.getFocusedTab === 'function') {
        tab = tab.getFocusedTab() ?? tab
      }
      if (tab?.root && typeof tab.getFocusedTab === 'function') {
        tab = tab.getFocusedTab() ?? tab
      }
      if (this._isSshTerminal(tab) && tab?.element?.nativeElement) return tab

      const anySsh = leaves.find(t => this._isSshTerminal(t) && t?.element?.nativeElement)
      return anySsh || null
    } catch {
      return null
    }
  }

  private closeFloatingPanel(hostEl: HTMLElement): void {
    const cmpRef = (hostEl as any).__sftpPlusCmpRef

    const closeFn = cmpRef?.instance?.close
    if (typeof closeFn === 'function') {
      try {
        this.zone.run(() => cmpRef.instance.close())
        return
      } catch {   }
    }
    const onClose = cmpRef?.instance?.onClose
    if (typeof onClose === 'function') {
      onClose()
      return
    }

    try { (hostEl as any).__sftpPlusStopRectSync?.() } catch { /* ignore */ }
    try { delete (hostEl as any).__sftpPlusStopRectSync } catch { /* ignore */ }
    try { (hostEl as any).__sftpPlusResizeCleanup?.() } catch { /* ignore */ }
    try { delete (hostEl as any).__sftpPlusResizeCleanup } catch { /* ignore */ }
    try { cmpRef?.destroy() } catch { /* ignore */ }
    try { (hostEl as any).__sftpPlusOverlay?.remove() } catch { /* ignore */ }
    try { delete (hostEl as any).__sftpPlusOpen } catch { /* ignore */ }
    try { delete (hostEl as any).__sftpPlusMinimized } catch { /* ignore */ }
    try { delete (hostEl as any).__sftpPlusOverlay } catch { /* ignore */ }
    try { delete (hostEl as any).__sftpPlusCmpRef } catch { /* ignore */ }
    this._syncToolbarBtnState(hostEl)
  }

  _base_attach(terminal: any): void {
    super.attach(terminal)
    log.info('attach called')

    // Best-effort DOM injection: place button near the existing Reconnect button if present.

    const findToolbar = (): HTMLElement | null => {
      try {
        const host = terminal.element?.nativeElement ?? null
        if (!host) return null
        const toolbar =
          host.querySelector('.terminal-toolbar') ??
          host.querySelector('terminal-toolbar') ??
          host.querySelector('.btn-toolbar')
        return (toolbar as HTMLElement) ?? host
      } catch { return null }
    }

    const tryInsert = (): boolean => {
      try {

        const profile = terminal?.profile ?? (terminal as any)?._profile ?? null
        const isSSH = !!(profile?.options?.host) || profile?.type === 'ssh'
        if (!isSSH) return false

        const container = findToolbar()
        if (!container) return false

        this._toolbars.add(container)

        // Already injected?
        const existingBtn = container.querySelector('[data-tabby-sftp-plus-plus-button="1"]') as HTMLButtonElement | null
        if (existingBtn) {
          try {
            const he = this._resolveHostEl(terminal)
            if (he) {
              ;(he as any).__sftpPlusBtn = existingBtn
              this._syncToolbarBtnState(he)
            }
          } catch { /* ignore */ }
          return true
        }

        const btn = document.createElement('button')
        btn.type = 'button'
        // Match Tabby's terminal toolbar buttons styling
        btn.className = 'btn btn-sm btn-link me-2'
        btn.setAttribute('data-tabby-sftp-plus-plus-button', '1')
        btn.title = 'SFTP++'
        btn.innerHTML = FOLDER_SVG + ' SFTP++'
        btn.style.pointerEvents = 'auto'
        btn.style.zIndex = '10'
        btn.style.position = 'relative'
        ensureToolbarBtnStateStyle()

        try {
          const he = this._resolveHostEl(terminal)
          if (he) {
            ;(he as any).__sftpPlusBtn = btn
            this._syncToolbarBtnState(he)
          }
        } catch { /* ignore */ }

        btn.addEventListener('mousedown', (ev: MouseEvent) => {
          ev.stopPropagation()
        })
        btn.addEventListener('click', (ev: MouseEvent) => {
          ev.preventDefault()
          ev.stopPropagation()

          const ssh = terminal?.sshSession ?? (terminal as any)?._sshSession ?? terminal?._session ?? null
          if (!ssh) {
            this.notifications.error('SFTP++', 'The SSH connection is closed. Reconnect the terminal first.')
            return
          }
          if (ssh.closed$ && typeof ssh.closed$.subscribe === 'function' && ssh.open === false) {
            this.notifications.error('SFTP++', 'The SSH connection is closed. Reconnect the terminal first.')
            return
          }

          if (btn.disabled) {
            btn.disabled = false
            btn.style.opacity = ''
            btn.style.cursor = ''
            btn.title = 'SFTP++'
          }
          if (this._openInNewTabByDefault()) {
            this.openWorkspaceTab(terminal)
          } else {
            this.togglePanelForActiveTerminal(terminal)
          }
        })

        // If there's a Reconnect button, insert next to it.
        const allButtons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
        const reconnectButton = allButtons.find(b => {
          const t = `${b.textContent ?? ''} ${b.title ?? ''} ${b.getAttribute('aria-label') ?? ''}`.toLowerCase()
          return t.includes('reconnect') || t.includes('переподключ')
        })

        if (reconnectButton?.parentElement) {
          reconnectButton.parentElement.insertBefore(btn, reconnectButton.nextSibling)
        } else {
          container.appendChild(btn)
        }

        log.info('Button injected into', container.className || container.tagName)

        if (this._shouldHideNativeBtn()) {
          this._hideNativeBtnsOnce(container)

          this._scheduleHideNativeBtns(container, [0, 300, 1000, 2500])
        }

        try {
          const ssh = terminal?.sshSession ?? (terminal as any)?._sshSession ?? terminal?._session ?? null
          if (ssh) {

            if (ssh.closed$ && typeof ssh.closed$.subscribe === 'function') {
              const sub = ssh.closed$.subscribe(() => {
                btn.disabled = true
                btn.style.opacity = '0.4'
                btn.style.cursor = 'not-allowed'
                btn.title = 'SFTP++ (SSH disconnected)'
                log.info('SSH disconnected, SFTP++ button disabled')
              })

              this.subscribeUntilDetached(terminal, { unsubscribe: () => { try { sub.unsubscribe() } catch {} } })
            }

            else if (typeof ssh.closed?.then === 'function') {
              (ssh.closed as Promise<void>).then(() => {
                btn.disabled = true
                btn.style.opacity = '0.4'
                btn.style.cursor = 'not-allowed'
                btn.title = 'SFTP++ (SSH disconnected)'
                log.info('SSH disconnected, SFTP++ button disabled')
              }).catch(() => {})
            }
          }
        } catch { /* ignore */ }

        return true
      } catch (err) {
        log.warn('tryInsert error', err)
        return false
      }
    }

    // try a few times while the view is settling and SSH session establishes
    let attempts = 0
    let btnInjected = false
    const timer = setInterval(() => {
      attempts++
      if (tryInsert()) {
        btnInjected = true
        clearInterval(timer)

        const container = findToolbar()
        if (container) {
          const obs = new MutationObserver(() => {
            if (!container.querySelector('[data-tabby-sftp-plus-plus-button="1"]')) {
              log.info('Button removed from toolbar, re-injecting...')
              tryInsert()
            }

            if (this._shouldHideNativeBtn()) {
              this._hideNativeBtnsOnce(container)
              this._scheduleHideNativeBtns(container, [300, 1000])
            }
          })
          obs.observe(container, { childList: true, subtree: true })
          this.subscribeUntilDetached(terminal, { unsubscribe: () => obs.disconnect() })
        }
        return
      }
      if (attempts > 20) {
        clearInterval(timer)
        log.info('No SSH session found on this tab after 20 attempts, hiding SFTP++ button')
      }
    }, 500)

    this.subscribeUntilDetached(terminal, { unsubscribe: () => clearInterval(timer) })

    const handler = () => this._applyNativeBtnHideRule()
    window.addEventListener('sftp-plus-settings-changed', handler)
    this.subscribeUntilDetached(terminal, { unsubscribe: () => window.removeEventListener('sftp-plus-settings-changed', handler) })
  }

  _base_detach(terminal: any): void {
    try {
      const hostEl = this._resolveHostEl(terminal)
      const cmpRef = hostEl ? (hostEl as any).__sftpPlusCmpRef : null
      if (hostEl && cmpRef) {
        this.zone.run(() => {
          try { (hostEl as any).__sftpPlusStopRectSync?.() } catch { /* ignore */ }
          try { delete (hostEl as any).__sftpPlusStopRectSync } catch { /* ignore */ }
          try { (hostEl as any).__sftpPlusResizeCleanup?.() } catch { /* ignore */ }
          try { delete (hostEl as any).__sftpPlusResizeCleanup } catch { /* ignore */ }
          try { cmpRef.destroy() } catch { /* ignore */ }
          try { (hostEl as any).__sftpPlusOverlay?.remove() } catch { /* ignore */ }
          try { delete (hostEl as any).__sftpPlusOpen } catch { /* ignore */ }
          try { delete (hostEl as any).__sftpPlusMinimized } catch { /* ignore */ }
          try { delete (hostEl as any).__sftpPlusOverlay } catch { /* ignore */ }
          try { delete (hostEl as any).__sftpPlusCmpRef } catch { /* ignore */ }
          this._syncToolbarBtnState(hostEl)
        })
        log.info('Panel destroyed on terminal detach')
      }
    } catch (e) {
      log.warn('detach cleanup failed', e)
    }
    super.detach(terminal)
  }

  private _base__openInNewTabByDefault(): boolean {
    return this._readBoolConfig('openInNewTabByDefault', 'sftp-plus-settings.openInNewTabByDefault', false)
  }

  private _singleWorkspaceInstance(): boolean {
    return this._readBoolConfig('singleWorkspaceInstance', 'sftp-plus-settings.singleWorkspaceInstance', true)
  }

  private _base__readBoolConfig(cfgKey: string, lsKey: string, fallback: boolean): boolean {

    const newPath = this._mapCfgToNewPath(cfgKey)
    if (newPath && this.sftpConfig) {
      const val = this.sftpConfig.get(newPath)
      if (typeof val === 'boolean') return val
    }

    let fromConfig = false
    let value = fallback
    if (this.config?.store) {
      try {
        const cfgVal = this.config.store['tabby-sftp-plus-plus']?.[cfgKey]
        if (cfgVal !== undefined) {
          value = !!cfgVal
          fromConfig = true
        }
      } catch {}
    }
    if (!fromConfig) {
      try {
        const raw = localStorage.getItem(lsKey)
        if (raw !== null) value = JSON.parse(raw)
      } catch {}
    }
    return value
  }

  private _mapCfgToNewPath(cfgKey: string): string | null {
    const map: Record<string, string> = {
      openInNewTabByDefault: 'openInNewTabByDefault',
      singleWorkspaceInstance: 'singleWorkspaceInstance',
      hideNativeSFTPButton: 'hideNativeSFTPButton',
    }
    return map[cfgKey] || null
  }

  private _base__applyNativeBtnHideRule(): void {
    const hide = this._shouldHideNativeBtn()

    if (this._hideObserver) {
      this._hideObserver.disconnect()
      this._hideObserver = null
    }

    if (hide) {
      if (!this._hideStyleEl || !document.head.contains(this._hideStyleEl)) {
        this._hideStyleEl = document.createElement('style')
        this._hideStyleEl.setAttribute('data-sftp-plus-hide-native', '1')
        this._hideStyleEl.textContent = `

          button[data-tabby-sftp-ui-button],
          button[data-sftp-plus-hidden-native="1"],
          button[title="SFTP"],
          button[title="sftp"] {
            display: none !important;
          }
        `
        document.head.appendChild(this._hideStyleEl)
      }

      this._hideNativeBtnsOnce()

      this._scheduleHideNativeBtns(null, [0, 300, 1000, 2500])
    } else {
      if (this._hideStyleEl && document.head.contains(this._hideStyleEl)) {
        this._hideStyleEl.remove()
      }
      this._hideStyleEl = null
      try {
        document.querySelectorAll<HTMLElement>('[data-sftp-plus-hidden-native="1"]').forEach(el => {
          el.style.display = ''
          el.removeAttribute('data-sftp-plus-hidden-native')
        })
      } catch {}
    }
  }

  private _base__isNativeSftpToolbarButton(el: HTMLElement): boolean {
    if (el.getAttribute('data-tabby-sftp-plus-plus-button') === '1') return false
    if (el.hasAttribute('data-tabby-sftp-ui-button')) return true

    const title = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim().toLowerCase()
    if (title === 'sftp') return true

    const spanLabels = Array.from(el.querySelectorAll('span'))
      .map(s => (s.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(Boolean)
    if (spanLabels.some(t => t === 'sftp')) return true

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (text === 'sftp') return true

    if (
      !text.includes('sftp+') &&
      /(^|[^a-z0-9+])sftp([^a-z0-9+]|$)/i.test(text) &&
      !!el.querySelector('.fa-folder-open, .fa-folder')
    ) {
      return true
    }
    return false
  }

  private _liveToolbars(): ParentNode[] {
    const out: ParentNode[] = []
    for (const tb of this._toolbars) {
      if ((tb as unknown as { isConnected?: boolean }).isConnected === false) {
        this._toolbars.delete(tb)
        continue
      }
      out.push(tb)
    }
    return out
  }

  private _base__hideNativeBtnsOnce(root?: ParentNode): void {
    try {
      const roots: ParentNode[] = root ? [root] : this._liveToolbars()
      for (const r of roots) {
        r.querySelectorAll<HTMLElement>('button').forEach(el => {
          if (el.getAttribute('data-sftp-plus-hidden-native') === '1') return
          if (!this._isNativeSftpToolbarButton(el)) return
          el.style.display = 'none'
          el.setAttribute('data-sftp-plus-hidden-native', '1')
        })
      }
    } catch { /* ignore */ }
  }

  private _base__shouldHideNativeBtn(): boolean {
    return this._readBoolConfig('hideNativeSFTPButton', 'sftp-plus-settings.hideNativeBtn', false)
  }

  private _clearHideNativeTimers(): void {
    for (const t of this._hideNativeTimers) {
      try { clearTimeout(t) } catch { /* ignore */ }
    }
    this._hideNativeTimers = []
  }

  private _scheduleHideNativeBtns(container: ParentNode | null = null, delays: number[] = [300]): void {
    this._clearHideNativeTimers()
    const runAt = (index: number): void => {
      if (index >= delays.length) return
      const wait = Math.max(0, delays[index])
      const t = setTimeout(() => {
        try {
          if (this._shouldHideNativeBtn()) this._hideNativeBtnsOnce(container ?? undefined)
        } catch { /* ignore */ }
        runAt(index + 1)
      }, wait)
      this._hideNativeTimers.push(t)
    }
    runAt(0)
  }

  _base_ngOnDestroy(): void {
    this._clearHideNativeTimers()
  }

  private _ensureNoTransitionStyle(): void {
    if (SftpTerminalDecorator._noTransitionStyleInjected) return
    const style = document.createElement('style')
    style.setAttribute('data-sftp-plus', 'no-transition')
    style.textContent = `
      html.sftp-plus-suppress-transition,
      html.sftp-plus-suppress-transition * {
        transition: none !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
      }
    `
    document.head.appendChild(style)
    SftpTerminalDecorator._noTransitionStyleInjected = true
  }

  private _bindResizeSuppression(hostEl: HTMLElement): void {
    this._ensureNoTransitionStyle()
    let settleTimer: any = null
    const onResize = () => {
      document.documentElement.classList.add('sftp-plus-suppress-transition')
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        document.documentElement.classList.remove('sftp-plus-suppress-transition')
      }, 250)
    }
    window.addEventListener('resize', onResize)
    ;(hostEl as any).__sftpPlusResizeCleanup = () => {
      window.removeEventListener('resize', onResize)
      if (settleTimer) clearTimeout(settleTimer)
      document.documentElement.classList.remove('sftp-plus-suppress-transition')
    }
  }

  private _resolveHostEl(terminal: any): HTMLElement | null {
    const frontendEl = terminal?.frontend?.element?.nativeElement as HTMLElement | null
    return (frontendEl || terminal?.element?.nativeElement) as HTMLElement | null
  }

  private _base_openFloatingPanel(terminal: any): void {

    const hostEl = this._resolveHostEl(terminal)
    if (!hostEl) {
      this.notifications.error('SFTP++', 'Cannot find terminal element')
      return
    }

    if ((hostEl as any).__sftpPlusOpen && (hostEl as any).__sftpPlusMinimized) {
      this.restoreFloatingPanel(hostEl)
      return
    }

    if ((hostEl as any).__sftpPlusOpen) {
      log.info('Panel already open for this tab')
      return
    }

    const sshSession =
      terminal?.sshSession ??
      (terminal as any)?._sshSession ??
      terminal?._session ??
      null
    const profile = terminal?.profile ?? terminal?._profile ?? null

    if (!sshSession) {
      this.notifications.error('SFTP++', 'No active SSH session found on this tab')
      return
    }

    this.zone.run(() => {
      try {
        const overlay = document.createElement('div')
        overlay.className = 'sftp-plus-overlay'

        overlay.style.cssText = `
          position: fixed;
          background: transparent; pointer-events: none;
          display: flex; align-items: center; justify-content: center;
          transition: none !important; isolation: isolate;
        `

        const panelHost = document.createElement('div')
        panelHost.style.cssText = `
          width: 96%; height: 94%; max-width: 100%;
          border-radius: 10px; overflow: hidden;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
          pointer-events: auto;
          transition: none !important;
        `
        overlay.appendChild(panelHost)
        document.body.appendChild(overlay)

        bringFloatToFront(overlay)

        panelHost.addEventListener('mousedown', () => bringFloatToFront(overlay), true)

        let rafId: number | null = null
        let visible = true
        const syncRect = () => {
          if (!document.body.contains(overlay)) return
          if (!hostEl.isConnected) {
            if (visible) { overlay.style.display = 'none'; visible = false }
            rafId = requestAnimationFrame(syncRect)
            return
          }
          const rect = hostEl.getBoundingClientRect()
          const hidden = rect.width === 0 && rect.height === 0
          if (hidden) {
            if (visible) { overlay.style.display = 'none'; visible = false }
          } else {
            overlay.style.left = `${rect.left}px`
            overlay.style.top = `${rect.top}px`
            overlay.style.width = `${rect.width}px`
            overlay.style.height = `${rect.height}px`
            if (!visible && !(hostEl as any).__sftpPlusMinimized) {
              overlay.style.display = 'flex'
              visible = true
            }
          }
          rafId = requestAnimationFrame(syncRect)
        }
        ;(hostEl as any).__sftpPlusStopRectSync = () => {
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        }
        syncRect()

        this._bindResizeSuppression(hostEl)
        ;(hostEl as any).__sftpPlusOpen = true
        ;(hostEl as any).__sftpPlusMinimized = false
        ;(hostEl as any).__sftpPlusOverlay = overlay

        const factory = this.resolver.resolveComponentFactory(SftpFloatingPanel)
        const cmpRef = factory.create(this.injector, [], panelHost)
        const cmp = cmpRef.instance
        ;(hostEl as any).__sftpPlusCmpRef = cmpRef

        cmp.sshSession = sshSession
        cmp.terminalRef = terminal
        cmp.profile = profile
        cmp.onClose = () => {
          this.zone.run(() => {
            try { (hostEl as any).__sftpPlusStopRectSync?.() } catch { /* ignore */ }
            try { delete (hostEl as any).__sftpPlusStopRectSync } catch { /* ignore */ }
            try { (hostEl as any).__sftpPlusResizeCleanup?.() } catch { /* ignore */ }
            try { delete (hostEl as any).__sftpPlusResizeCleanup } catch { /* ignore */ }
            try { cmpRef.destroy() } catch { /* ignore */ }
            try { overlay.remove() } catch { /* ignore */ }
            try { delete (hostEl as any).__sftpPlusOpen } catch { /* ignore */ }
            try { delete (hostEl as any).__sftpPlusMinimized } catch { /* ignore */ }
            try { delete (hostEl as any).__sftpPlusOverlay } catch { /* ignore */ }
            try { delete (hostEl as any).__sftpPlusCmpRef } catch { /* ignore */ }
            this._syncToolbarBtnState(hostEl)
          })
        }

        cmp.onMinimize = () => {
          this.zone.run(() => {
            overlay.style.display = 'none'
            ;(hostEl as any).__sftpPlusMinimized = true
            cmp.minimized = true
            this._syncToolbarBtnState(hostEl)
          })
        }

        this.appRef.attachView(cmpRef.hostView)
        cmpRef.changeDetectorRef.detectChanges()
        this._syncToolbarBtnState(hostEl)

        panelHost.addEventListener('mousedown', (ev: MouseEvent) => {
          ev.stopPropagation()
        })
        panelHost.addEventListener('click', (ev: MouseEvent) => {
          ev.stopPropagation()
        })

        log.info('Panel opened for tab')
      } catch (e) {
        log.error('Panel error', e)
        this.notifications.error('SFTP++', 'Failed to open: ' + (e as Error).message)
      }
    })
  }

  private restoreFloatingPanel(hostEl: HTMLElement): void {
    const overlay = (hostEl as any).__sftpPlusOverlay as HTMLElement | null
    const cmpRef = (hostEl as any).__sftpPlusCmpRef as any

    if (overlay) {
      overlay.style.display = 'flex'

      bringFloatToFront(overlay)
      ;(hostEl as any).__sftpPlusMinimized = false
      if (cmpRef?.instance) {
        cmpRef.instance.minimized = false
      }
      this._syncToolbarBtnState(hostEl)
      log.info('Panel restored from minimized state')
    }
  }

  private _base__syncToolbarBtnState(hostEl: HTMLElement): void {
    try {
      ensureToolbarBtnStateStyle()
      let btn = (hostEl as any).__sftpPlusBtn as HTMLButtonElement | null
      if (!btn || !btn.isConnected) {
        btn = hostEl.querySelector?.('[data-tabby-sftp-plus-plus-button="1"]') as HTMLButtonElement | null
        if (btn) (hostEl as any).__sftpPlusBtn = btn
      }
      if (!btn) return

      btn.classList.remove('sftp-plus-btn-open', 'sftp-plus-btn-minimized')
      if (btn.disabled) return

      const open = !!(hostEl as any).__sftpPlusOpen
      const minimized = !!(hostEl as any).__sftpPlusMinimized
      if (!open) {
        btn.title = 'SFTP++'
        return
      }
      if (minimized) {
        btn.classList.add('sftp-plus-btn-minimized')
        btn.title = 'SFTP++ (minimized; click to restore)'
      } else {
        btn.classList.add('sftp-plus-btn-open')
        btn.title = 'SFTP++ (open; click to close)'
      }
    } catch { /* ignore */ }
  }

  private _base_openWorkspaceTab(terminal: any): void {
    const sshSession = terminal?.sshSession ?? (terminal as any)?._sshSession ?? terminal?._session ?? null
    const profile = terminal?.profile ?? terminal?._profile ?? null
    if (!sshSession) {
      this.notifications.error('SFTP++', 'No active SSH session found on this tab')
      return
    }

    this.zone.run(() => {
      if (this._singleWorkspaceInstance()) {
        const existing = this._findWorkspaceTabForTerminal(terminal)
        if (existing) {
          this._focusWorkspaceTab(existing)
          return
        }
      }

      this.app.openNewTab({
        type: SftpWorkspaceTabComponent,
        inputs: {
          sshSession,
          profile,
          terminalRef: terminal,
          sourceTabKey: this._getTerminalSourceKey(terminal),
        },
      })
    })
  }

  private _focusWorkspaceTab(tab: any): void {
    const parent = this.app.getParentTab(tab)
    if (parent) {
      this.app.selectTab(parent)
      if (typeof parent.focus === 'function') {
        parent.focus(tab)
      }
    } else {
      this.app.selectTab(tab)
    }
    try { tab.emitFocused?.() } catch { /* ignore */ }
  }

  private _getTerminalSourceKey(terminal: any): string {
    if (!terminal) return ''
    if (terminal.__sftpPlusSourceKey) return String(terminal.__sftpPlusSourceKey)
    const key = `sftp-src-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    terminal.__sftpPlusSourceKey = key
    return key
  }

  private _findWorkspaceTabForTerminal(terminal: any): any | null {
    const sourceKey = this._getTerminalSourceKey(terminal)
    let found: any = null
    const visit = (tab: any): void => {
      if (found || !tab) return
      if (!tab.sftpPlusWorkspace) return
      if (tab.sourceTabKey && tab.sourceTabKey === sourceKey) {
        found = tab
        return
      }
      if (tab.terminalRef === terminal) {
        if (!tab.sourceTabKey) tab.sourceTabKey = sourceKey
        found = tab
      }
    }

    for (const top of this.app.tabs || []) {
      if (top?.root?.getAllTabs) {
        for (const child of top.root.getAllTabs()) visit(child)
      } else if (typeof top?.getAllTabs === 'function') {
        for (const child of top.getAllTabs()) visit(child)
      } else {
        visit(top)
      }
    }
    return found
  }

  // Controller facade: named source methods, one explicit composition root.
  togglePanelForActiveTerminal(...args: any[]): any { return invokeFeature("Decorator","togglePanelForActiveTerminal",this,args) }
  attach(...args: any[]): any { return invokeFeature("Decorator","attach",this,args) }
  detach(...args: any[]): any { return invokeFeature("Decorator","detach",this,args) }
  _openInNewTabByDefault(...args: any[]): any { return invokeFeature("Decorator","_openInNewTabByDefault",this,args) }
  _readBoolConfig(...args: any[]): any { return invokeFeature("Decorator","_readBoolConfig",this,args) }
  _applyNativeBtnHideRule(...args: any[]): any { return invokeFeature("Decorator","_applyNativeBtnHideRule",this,args) }
  _isNativeSftpToolbarButton(...args: any[]): any { return invokeFeature("Decorator","_isNativeSftpToolbarButton",this,args) }
  _hideNativeBtnsOnce(...args: any[]): any { return invokeFeature("Decorator","_hideNativeBtnsOnce",this,args) }
  _shouldHideNativeBtn(...args: any[]): any { return invokeFeature("Decorator","_shouldHideNativeBtn",this,args) }
  ngOnDestroy(...args: any[]): any { return invokeFeature("Decorator","ngOnDestroy",this,args) }
  openFloatingPanel(...args: any[]): any { return invokeFeature("Decorator","openFloatingPanel",this,args) }
  _syncToolbarBtnState(...args: any[]): any { return invokeFeature("Decorator","_syncToolbarBtnState",this,args) }
  openWorkspaceTab(...args: any[]): any { return invokeFeature("Decorator","openWorkspaceTab",this,args) }
  _customMountSidebar(...args: any[]): any { return invokeFeature("Decorator","_customMountSidebar",this,args) }
}
export interface SftpTerminalDecorator { [key: string]: any }
