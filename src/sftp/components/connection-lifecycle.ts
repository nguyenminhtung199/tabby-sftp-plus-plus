import { ChangeDetectorRef, NgZone } from '@angular/core'
import { NotificationsService } from 'tabby-core'

import { SftpConnectionService, SFTPSessionLike, SSHSessionLike, getRusshSftp } from '../../services/sftp.service'
import { SftpI18nService } from '../../services/sftp-i18n.service'
import { getTransferProgressAgeMs } from '../core/transfer-progress'

import { log } from '../../services/sftp-logger'
export type PathFollowMode = 'off' | 'remember' | 'sync'

export interface ConnectionLifecycleCtx {
  sshSession: SSHSessionLike | null
  sftpSession: SFTPSessionLike | null
  connected: boolean
  connecting: boolean
  reconnecting: boolean
  pathMode: PathFollowMode
  remotePath: string
  remotePathInput: string
  terminalRef: any
  sftpService: SftpConnectionService
  notifications: NotificationsService | null
  getI18n(): SftpI18nService
  zone: NgZone
  cdr: ChangeDetectorRef
  getDefaultRemotePath(): string
  refreshRemote(): Promise<boolean>
  restoreSavedRemotePath(): void
  tryGetTerminalCwd(): Promise<string | null>
  pushRemoteNav(path: string): void
  clearNavHistory(): void
  clearRemoteListing(): void
  setRemoteLoading(loading: boolean): void
  isAlive?(): boolean

  abortInFlightTransfers?(): void

  hasActiveTransfers?(): boolean
}

export class PanelConnectionLifecycle {
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _sshCloseHandler: (() => void) | null = null
  private _heartbeatRecovering = false
  private _heartbeatDisposed = false

  private _heartbeatProbeInFlight = false
  private _heartbeatRecoverCount = 0
  private _heartbeatRecoverWindowStart = 0

  private _heartbeatFailStreak = 0
  private static readonly HEARTBEAT_RECOVER_WINDOW_MS = 120_000
  private static readonly HEARTBEAT_RECOVER_MAX = 3

  private static readonly HEARTBEAT_FAIL_STREAK_IDLE = 3
  private static readonly HEARTBEAT_FAIL_STREAK_BUSY = 12

  private static readonly HEARTBEAT_PROBE_TIMEOUT_MS = 6000

  private static readonly HEARTBEAT_PROGRESS_GRACE_MS = 30_000

  private _heartbeatRecoverStreak = 0
  private _heartbeatLastRecoverAt = 0
  private static readonly HEARTBEAT_RECOVER_HEALTHY_RESET_MS = 600_000
  private static readonly HEARTBEAT_RECOVER_BACKOFF_MAX = 4

  private _heartbeatRecoverLogCount = 0
  private static readonly HEARTBEAT_RECOVER_LOG_VERBOSE = 3
  private static readonly HEARTBEAT_RECOVER_LOG_EVERY = 10

  private _silentReopen: Promise<SFTPSessionLike | null> | null = null
  private _lastSilentReopenAt = 0
  private static readonly SILENT_REOPEN_MIN_INTERVAL_MS = 3000

  private static readonly SILENT_REOPEN_TIMEOUT_MS = 10_000

  constructor(private readonly ctx: ConnectionLifecycleCtx) {}

  private isAlive(): boolean {
    try { return this.ctx.isAlive?.() ?? true } catch { return false }
  }

  private detectChanges(): void {
    if (!this.isAlive()) return
    try { this.ctx.cdr.detectChanges() } catch { /* destroyed view */ }
  }

  private releaseSftp(): void {
    const c = this.ctx
    if (!c.sftpSession) return
    const held = c.sftpSession
    if (c.sshSession) {
      c.sftpService.closeForSSHSession(c.sshSession, held)
    }
    c.sftpSession = null
  }

  async recoverChannelForListing(): Promise<boolean> {
    const c = this.ctx
    if (!c.connected || !c.sshSession) return false
    try {
      if ((c.sshSession as { open?: boolean }).open === false) {
        this.handleSessionLost('[SFTP++] SSH session closed (detected while listing)')
        return false
      }
    } catch { /* ignore */ }

    let busy = false
    try { busy = !!c.hasActiveTransfers?.() } catch { busy = false }
    if (busy) {
      log.warn('listing hit a dead channel while transfers are in flight, deferring to heartbeat')
      return false
    }
    if (this._silentReopen) return !!(await this._silentReopen.catch(() => null))
    const p = this._reopenSftpSilently()
    this._silentReopen = p
    try {
      return !!(await p)
    } finally {
      if (this._silentReopen === p) this._silentReopen = null
    }
  }

  private async _reopenSftpSilently(): Promise<SFTPSessionLike | null> {
    const c = this.ctx
    const sshAtOpen = c.sshSession
    if (!sshAtOpen) return null
    if (Date.now() - this._lastSilentReopenAt < PanelConnectionLifecycle.SILENT_REOPEN_MIN_INTERVAL_MS) {
      return null
    }
    this._lastSilentReopenAt = Date.now()
    try {

      if (c.sftpSession) {
        c.sftpService.forceInvalidate(sshAtOpen)
        c.sftpSession = null
      }
    } catch (e) {
      log.warn('Silent SFTP reopen: invalidate failed', e)
    }
    const openPromise = c.sftpService.openFromSSHSession(sshAtOpen)
    let timedOut = false
    const timedOutResult = new Promise<null>(resolve => {
      setTimeout(() => { timedOut = true; resolve(null) }, PanelConnectionLifecycle.SILENT_REOPEN_TIMEOUT_MS)
    })
    const fresh = await Promise.race([
      openPromise.catch((e) => { log.warn('Silent SFTP reopen failed', e); return null }),
      timedOutResult,
    ])
    if (fresh) {
      if (!this.isAlive() || !c.connected || c.sshSession !== sshAtOpen) {
        c.sftpService.closeForSSHSession(sshAtOpen, fresh)
        return null
      }
      c.sftpSession = fresh
      log.info('SFTP session silently reopened for retry (channel was reported closed)')
      return fresh
    }
    if (timedOut) {

      void openPromise.then((late) => {
        if (!late) return
        const usable = this.isAlive() && c.connected && c.sshSession === sshAtOpen && !c.sftpSession
        if (usable) {
          c.sftpSession = late
          log.info('late SFTP channel installed after silent reopen timeout')
        } else {
          c.sftpService.closeForSSHSession(sshAtOpen, late)
        }
      }).catch(() => {   })
    }
    return null
  }

  private handleSessionLost(logMsg?: string): void {
    const c = this.ctx
    c.zone.run(() => {
      c.connected = false
      this.releaseSftp()
      c.clearRemoteListing()
      this.stopHeartbeat()
      this.detectChanges()
      if (logMsg) log.info(logMsg)
    })
  }

  private notifyConnectFailed(e: unknown): void {
    const c = this.ctx
    const msg = c.getI18n().t('notify.sftpConnectFailed')
    const detail = e instanceof Error ? e.message : String(e ?? '')
    try { c.notifications?.error?.(msg, detail) } catch { /* ignore */ }
  }

  async connect(): Promise<void> {
    const c = this.ctx
    if (c.connecting || c.connected || !c.sshSession) return
    c.connecting = true
    c.setRemoteLoading(true)
    this.detectChanges()
    try {

      if (c.sftpSession) this.releaseSftp()
      const sshAtOpen = c.sshSession
      const acquired = await c.sftpService.openFromSSHSession(sshAtOpen)
      if (!this.isAlive() || c.sshSession !== sshAtOpen) {
        c.sftpService.closeForSSHSession(sshAtOpen, acquired)
        return
      }
      c.sftpSession = acquired
      c.connected = true
      this.startHeartbeat()
      await this.applyInitialRemotePath()
      const ok = await c.refreshRemote()
      if (!ok && c.remotePath !== '/') {
        log.warn('Initial remote path invalid, falling back to /')
        c.remotePath = '/'
        c.remotePathInput = '/'
        await c.refreshRemote()
      }
      c.pushRemoteNav(c.remotePath)
    } catch (e) {
      log.error('Connection failed', e)
      c.connected = false
      this.releaseSftp()
      this.stopHeartbeat()
      c.clearRemoteListing()
      if (this.isAlive()) this.notifyConnectFailed(e)
    } finally {
      c.connecting = false
      c.setRemoteLoading(false)
      this.detectChanges()
    }
  }

  disconnect(): void {
    const c = this.ctx
    c.connected = false
    this.releaseSftp()
    c.clearRemoteListing()
    this.stopHeartbeat()
    c.clearNavHistory()
  }

  stopHeartbeat(): void {
    this._heartbeatDisposed = true
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
    if (this._sshCloseHandler !== null) {
      try { this._sshCloseHandler() } catch { /* ignore */ }
      this._sshCloseHandler = null
    }

    this._heartbeatRecovering = false
    this._heartbeatProbeInFlight = false
    this._heartbeatRecoverCount = 0
    this._heartbeatRecoverWindowStart = 0
    this._heartbeatFailStreak = 0

    this._heartbeatRecoverStreak = 0
    this._heartbeatLastRecoverAt = 0
    this._heartbeatRecoverLogCount = 0
    this._silentReopen = null
  }

  private _shouldGiveUpRecovery(): boolean {
    const now = Date.now()
    if (now - this._heartbeatRecoverWindowStart > PanelConnectionLifecycle.HEARTBEAT_RECOVER_WINDOW_MS) {
      this._heartbeatRecoverWindowStart = now
      this._heartbeatRecoverCount = 0
    }
    this._heartbeatRecoverCount++
    return this._heartbeatRecoverCount > PanelConnectionLifecycle.HEARTBEAT_RECOVER_MAX
  }

  startHeartbeat(): void {
    this.stopHeartbeat()
    this._heartbeatDisposed = false
    const c = this.ctx

    try {
      const ssh = c.sshSession as {
        closed$?: { subscribe: (o: { next?: () => void }) => { unsubscribe: () => void } }
        closed?: Promise<void>
      } | null
      if (ssh) {
        if (ssh.closed$ && typeof ssh.closed$.subscribe === 'function') {
          const sub = ssh.closed$.subscribe({
            next: () => {
              if (this._heartbeatDisposed) return
              this.handleSessionLost('[SFTP++] SSH session closed (detected via closed$)')
            },
          })
          this._sshCloseHandler = () => {
            try { sub.unsubscribe() } catch { /* ignore */ }
          }
        } else if (typeof ssh.closed?.then === 'function') {
          void (ssh.closed as Promise<void>).then(() => {
            if (this._heartbeatDisposed) return
            this.handleSessionLost('[SFTP++] SSH session closed (detected via .closed Promise)')
          }).catch(() => { /* ignore */ })
        }
      }
    } catch { /* ignore */ }

    this._heartbeatTimer = setInterval(() => {
      if (!c.connected || !c.sftpSession) return

      try {
        const ssh = c.sshSession as { open?: boolean } | null
        if (ssh?.open === false) {
          this.handleSessionLost('[SFTP++] SSH session closed (detected via open=false)')
          return
        }
      } catch { /* ignore */ }

      try {
        if (c.terminalRef?.session === null) {
          this.handleSessionLost('[SFTP++] SSH session closed (detected via terminal.session=null)')
          return
        }
      } catch { /* ignore */ }

      if (this._heartbeatProbeInFlight) return

      if (getTransferProgressAgeMs() < PanelConnectionLifecycle.HEARTBEAT_PROGRESS_GRACE_MS) {
        this._heartbeatFailStreak = 0
        return
      }

      const sftp = c.sftpSession

      const probePath = '.'
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('heartbeat-timeout')),
          PanelConnectionLifecycle.HEARTBEAT_PROBE_TIMEOUT_MS,
        )
      })

      const clearProbeTimeout = (): void => {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      }
      const buildProbe = (): Promise<unknown> => {
        const raw = getRusshSftp(sftp)
        if (raw?.stat) return Promise.resolve(raw.stat(probePath)).then(clearProbeTimeout)
        if (typeof sftp.stat === 'function') return Promise.resolve(sftp.stat(probePath)).then(clearProbeTimeout)
        return Promise.resolve(sftp.readdir(probePath)).then(clearProbeTimeout)
      }
      let probe: Promise<unknown>
      try {
        probe = buildProbe()
      } catch {
        probe = Promise.reject(new Error('heartbeat-probe-construct-failed'))
      }

      this._heartbeatProbeInFlight = true
      Promise.race([probe, timeoutPromise]).then(() => {

        this._heartbeatRecoverCount = 0
        this._heartbeatFailStreak = 0
      }).catch(async () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId)

        if (this._heartbeatDisposed) return
        if (this._heartbeatRecovering) return

        if (getTransferProgressAgeMs() < PanelConnectionLifecycle.HEARTBEAT_PROGRESS_GRACE_MS) {
          this._heartbeatFailStreak = 0
          return
        }

        this._heartbeatFailStreak++
        const busy = (() => { try { return !!c.hasActiveTransfers?.() } catch { return false } })()
        const base = busy
          ? PanelConnectionLifecycle.HEARTBEAT_FAIL_STREAK_BUSY
          : PanelConnectionLifecycle.HEARTBEAT_FAIL_STREAK_IDLE

        if (this._heartbeatRecoverStreak > 0
          && Date.now() - this._heartbeatLastRecoverAt > PanelConnectionLifecycle.HEARTBEAT_RECOVER_HEALTHY_RESET_MS) {
          this._heartbeatRecoverStreak = 0
        }
        const backoff = Math.min(
          PanelConnectionLifecycle.HEARTBEAT_RECOVER_BACKOFF_MAX,
          1 + this._heartbeatRecoverStreak,
        )
        const need = base * backoff
        if (this._heartbeatFailStreak < need) {

          log.debug(`[SFTP++] heartbeat probe failed (${this._heartbeatFailStreak}/${need}${busy ? ', transfers in flight' : ''}), keeping current session`)
          return
        }

        if (this._shouldGiveUpRecovery()) {
          log.warn('[SFTP++] heartbeat recovery attempted too often, giving up automatic recovery')
          this.handleSessionLost('[SFTP++] heartbeat recovery ineffective, disconnecting')
          return
        }
        this._heartbeatRecovering = true
        try {

          if (this._heartbeatDisposed) return
          if (!c.sshSession) throw new Error('no ssh session')

          const interrupted = (() => { try { return !!c.hasActiveTransfers?.() } catch { return false } })()

          try { c.abortInFlightTransfers?.() } catch { /* ignore */ }

          if (c.sftpSession) {
            c.sftpService.forceInvalidate(c.sshSession)
            c.sftpSession = null
          }
          const fresh = await c.sftpService.openFromSSHSession(c.sshSession)

          if (this._heartbeatDisposed) {
            c.sftpService.closeForSSHSession(c.sshSession, fresh)
            return
          }
          c.sftpSession = fresh

          this._heartbeatFailStreak = 0

          this._heartbeatRecoverStreak++
          this._heartbeatLastRecoverAt = Date.now()
          this._heartbeatRecoverLogCount++
          const n = this._heartbeatRecoverLogCount
          if (n <= PanelConnectionLifecycle.HEARTBEAT_RECOVER_LOG_VERBOSE
            || n % PanelConnectionLifecycle.HEARTBEAT_RECOVER_LOG_EVERY === 0) {
            log.info(`Heartbeat recovered with new SFTP session${n > 1 ? ` (total ${n})` : ''}`)
          } else {
            log.debug('Heartbeat recovered with new SFTP session (no. ' + n + ')')
          }
          c.zone.run(() => {

            if (this._heartbeatDisposed) return

            if (interrupted) {
              try {
                const msg = c.getI18n().t('notify.sftpRecovered') || 'SFTP session recovered; please retry interrupted transfers'
                ;(c.notifications as any)?.success?.(msg, '')
              } catch { /* ignore */ }
            }
            void c.refreshRemote()
          })
        } catch (e) {
          log.error('Heartbeat recovery failed', e)
          this.handleSessionLost()
        } finally {
          this._heartbeatRecovering = false
        }
      }).finally(() => {
        this._heartbeatProbeInFlight = false
      })
    }, 10000)
  }

  async reconnect(): Promise<void> {
    const c = this.ctx
    if (c.reconnecting) return
    c.reconnecting = true
    c.setRemoteLoading(true)
    this.detectChanges()
    try {

      this.releaseSftp()
      if (c.terminalRef) {
        try {
          const termEl = (c.terminalRef as { element?: { nativeElement?: HTMLElement } }).element?.nativeElement
          if (termEl) {
            termEl.click()
            termEl.focus?.()
          }
          const reconnect = (c.terminalRef as { reconnect?: () => Promise<void> }).reconnect
            || (c.terminalRef as { _reconnect?: () => Promise<void> })._reconnect
          if (typeof reconnect === 'function') {
            await reconnect.call(c.terminalRef)
          }
          if (c.sshSession && typeof c.sshSession === 'object') {
            const sessReconnect = (c.sshSession as { reconnect?: () => Promise<void> }).reconnect
            if (typeof sessReconnect === 'function') {
              await sessReconnect.call(c.sshSession)
            }
          }
        } catch (e) {
          log.info('Terminal reconnect trigger failed, will retry', e)
        }

        await new Promise(resolve => setTimeout(resolve, 2000))
        if (!this.isAlive()) return

        const fresh =
          (c.terminalRef as { sshSession?: SSHSessionLike }).sshSession
          || (c.terminalRef as { _sshSession?: SSHSessionLike })._sshSession
          || (c.terminalRef as { _session?: SSHSessionLike })._session
        if (fresh && fresh !== c.sshSession) {
          c.sshSession = fresh
        }
      }

      if (!c.sshSession) {
        c.connected = false
        this.releaseSftp()
        c.clearRemoteListing()
        try { c.notifications?.error?.(c.getI18n().t('notify.reconnectNoTerminal'), '') } catch { /* ignore */ }
        return
      }

      const sshAtOpen = c.sshSession
      const acquired = await c.sftpService.openFromSSHSession(sshAtOpen)
      if (!this.isAlive() || c.sshSession !== sshAtOpen) {
        c.sftpService.closeForSSHSession(sshAtOpen, acquired)
        return
      }
      c.sftpSession = acquired
      c.connected = true
      await this.applyInitialRemotePath()
      const ok = await c.refreshRemote()
      if (!ok && c.remotePath !== '/') {
        log.warn('Reconnect: initial remote path invalid, falling back to /')
        c.remotePath = '/'
        c.remotePathInput = '/'
        await c.refreshRemote()
      }
      c.pushRemoteNav(c.remotePath)
      this.startHeartbeat()
    } catch (e) {
      log.error('Reconnect failed', e)
      c.connected = false
      this.releaseSftp()
      this.stopHeartbeat()
      c.clearRemoteListing()
      if (this.isAlive()) {
        try { c.notifications?.error?.(c.getI18n().t('notify.reconnectFailed'), '') } catch { /* ignore */ }
      }
    } finally {
      c.reconnecting = false
      c.setRemoteLoading(false)
      this.detectChanges()
    }
  }

  private async applyInitialRemotePath(): Promise<void> {
    const c = this.ctx
    c.remotePath = c.getDefaultRemotePath()
    c.remotePathInput = c.remotePath

    if (c.pathMode === 'sync') {
      const cwd = await c.tryGetTerminalCwd()
      if (cwd) {
        c.remotePath = cwd
        c.remotePathInput = cwd
        return
      }
      return
    }

    if (c.pathMode === 'remember') {
      c.restoreSavedRemotePath()
    }
  }
}
