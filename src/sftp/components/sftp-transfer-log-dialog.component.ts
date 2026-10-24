import { Component, EventEmitter, Input, Output } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'
import { normalizeTransferOperation } from '../../services/sftp-transfer-log.service'
import type { TransferLogEntry } from '../../services/sftp-transfer-log.service'
import {
  formatDuration,
  formatFailReason as formatFailReasonFn,
  formatLogTime,
  formatSize,
  formatSpeedFromSize,
  getLogFileName,
  isUploadLikeOperation,
} from '../core/file-utils'
import { onFileDialogOverlayWheel, onFileDialogScrollableWheel } from './file-dialog-wheel'

@Component({
  selector: 'sftp-transfer-log-dialog',
  template: require('./sftp-transfer-log-dialog.component.view.html'),
  styles: [require('./sftp-transfer-log-dialog.component.view.css')],
})
export class SftpTransferLogDialogComponent {
  @Input() visible = false
  @Input() entries: TransferLogEntry[] = []
  @Input() totalCount = 0

  @Input() clearableCount = 0
  @Input() filterOp = ''
  @Input() filterStatus = ''
  @Input() filterTimeRange: '' | 'today' | '7d' | '30d' | 'custom' = ''
  @Input() filterDateFrom = ''
  @Input() filterDateTo = ''
  @Input() activeTransferCount = 0
  @Input() transfersHidden = false
  @Input() transfersMinimized = false

  @Output() close = new EventEmitter<void>()
  @Output() filterOpChange = new EventEmitter<string>()
  @Output() filterStatusChange = new EventEmitter<string>()
  @Output() filterTimeRangeChange = new EventEmitter<'' | 'today' | '7d' | '30d' | 'custom'>()
  @Output() filterDateFromChange = new EventEmitter<string>()
  @Output() filterDateToChange = new EventEmitter<string>()
  @Output() showTransfers = new EventEmitter<void>()
  @Output() export = new EventEmitter<void>()
  @Output() clear = new EventEmitter<void>()

  formatSize = formatSize
  formatLogTime = formatLogTime
  formatDuration = formatDuration
  formatSpeedFromSize = formatSpeedFromSize
  getLogFileName = getLogFileName
  onOverlayWheel = onFileDialogOverlayWheel
  onScrollableWheel = onFileDialogScrollableWheel

  operationFor(entry: TransferLogEntry): string { return normalizeTransferOperation(entry.operation) }

  isUploadLike(entry: TransferLogEntry): boolean {
    return isUploadLikeOperation(entry?.operation)
  }

  @Input() i18n!: SftpI18nService

  get countLabel(): string {
    const filtered = this.entries.length
    const total = this.totalCount
    if (filtered === total) {
      return this.i18n.t('transfer.logCount', { total })
    }
    return this.i18n.t('transfer.logCountFiltered', { filtered, total })
  }

  get emptyLabel(): string {
    if (this.totalCount > 0) return this.i18n.t('transfer.logNoMatch')
    return this.i18n.t('transfer.logEmpty')
  }

  formatFailReason(entry: TransferLogEntry): string {
    return formatFailReasonFn(entry, this.i18n.t.bind(this.i18n))
  }

  trackById(_index: number, entry: TransferLogEntry): string | number {

    return entry.id ?? _index
  }

  @Input() customHistoryOwner: any
  customLogPending(entry: any): boolean {const row=this.customHistoryOwner?.customLogTransfer(entry);return row?['Running','Queued','Paused'].includes(row.status):entry.pending;}
}
