import { Component, EventEmitter, Input, Output } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'
import type { PanelTransferItem } from '../core/panel-types'
import { formatPercent, formatSize } from '../core/file-utils'

const ETA_MAX_SEC = 24 * 60 * 60

const ETA_INFINITE_TEXT = '∞'

@Component({
  selector: 'sftp-transfer-queue',
  template: require('./sftp-transfer-queue.component.view.html'),
  styles: [require('./sftp-transfer-queue.component.view.css')],
})
export class SftpTransferQueueComponent {
  @Input() transfers: PanelTransferItem[] = []
  @Input() hidden = false
  @Input() minimized = false
  @Output() hiddenChange = new EventEmitter<boolean>()
  @Output() minimizeChange = new EventEmitter<boolean>()
  @Output() pause = new EventEmitter<PanelTransferItem>()
  @Output() resume = new EventEmitter<PanelTransferItem>()
  @Output() cancel = new EventEmitter<PanelTransferItem>()
  @Output() cancelCurrent = new EventEmitter<PanelTransferItem>()

  formatSize = formatSize
  formatPercent = formatPercent
  @Input() i18n!: SftpI18nService

  trackByTransfer = (_: number, t: PanelTransferItem): PanelTransferItem => t

  directionBadge(t: PanelTransferItem): string {
    return t.direction === 'upload'
      ? `⬆ ${this.i18n.t('transfer.upload')}`
      : `⬇ ${this.i18n.t('transfer.download')}`
  }

  directionTitle(t: PanelTransferItem): string {
    const local = this.i18n.t('pane.local')
    const remote = this.i18n.t('pane.remote')
    return t.direction === 'upload'
      ? `⬆ ${this.i18n.t('transfer.upload')}：${local} → ${remote}`
      : `⬇ ${this.i18n.t('transfer.download')}：${remote} → ${local}`
  }

  phaseLabel(t: PanelTransferItem): string {
    if (!t.isFolder) return ''
    if (t.waitingForServer) return 'Waiting for server…'
    return ({ preparing: 'Preparing folder…', scanning: 'Scanning files…', checking: 'Checking existing files…', extracting: 'Extracting files…', waiting: 'Waiting for file conflict decisions…' } as Record<string, string>)[t.phase || ''] || ''
  }

  indeterminate(t: PanelTransferItem): boolean {
    return !!t.isFolder && (['preparing', 'scanning', 'checking', 'extracting', 'waiting'].includes(t.phase || '') || (!(t.bytesTotal > 0) && !(t.itemCount > 0)))
  }

  modeOf(t: PanelTransferItem): 'sftp' | 'tar' | null {
    if (t.queued || t.skippedAsDuplicate) return null
    if (t.transferMode === 'tar' || t.transferMode === 'sftp') {
      return t.transferMode
    }
    return 'sftp'
  }

  etaText(t: PanelTransferItem): string {
    if (t.paused || t.queued || t.skippedAsDuplicate) return ''
    if (!(t.bytesTotal > 0) || !(t.bytesDone > 0)) return ''

    const bps = t.speedBps
    if (typeof bps !== 'number' || !isFinite(bps)) return ''
    const remain = t.bytesTotal - t.bytesDone
    if (remain <= 0) return ''
    if (bps <= 0) return this.i18n.t('transfer.etaRemaining', { time: ETA_INFINITE_TEXT })
    const sec = remain / bps
    const time = sec > ETA_MAX_SEC ? ETA_INFINITE_TEXT : this._formatEta(sec * 1000)
    return this.i18n.t('transfer.etaRemaining', { time })
  }

  private _formatEta(ms: number): string {
    const sec = Math.max(1, Math.round(ms / 1000))
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m${String(sec % 60).padStart(2, '0')}s`
    const hr = Math.floor(min / 60)
    return `${hr}h${String(min % 60).padStart(2, '0')}m`
  }
}
