/**
 * SFTP++ 传输日志对话框（从主面板抽离）
 * 创建人：DD1024z + Hy3 preview
 * 创建时间：2026-06-21
 * 修改人：DD1024z + Deepseek-V4.1-Flash
 * 修改时间：2026-09-26 — 传输方式标签（tag-tar/tag-sftp）作为**基准配色**保留，并补
 *              font-weight:600 与「传输中」面板（sftp-transfer-queue）对齐为逐字一致的样式
 *              （原先同名字段两处两套色：此处 📦青 #26c6da，那边 📦绿 #22c55e）
 *              ★ 同日： 「清除」按钮在无「可清除记录」时禁用：新增 clearableCount 输入
 *              （由父组件按「该连接下已结束的记录数」计算），一条记录都没有、或剩下的
 *              全是正在传输中的 pending 条目时都不可点——点了也清不掉任何东西
 *              2026-09-21 — 多拆分窄窗：对话框宽高约束在面板内（对齐 file-dialog 的 max 100%），避免 620px/85vh 被裁切
 *              2026-09-20 — A8 审计修复：删除死输入 isZh（父模板从未传入、模板亦未使用）
 *              2026-09-20 — 路径箭头仅加粗加大，去掉彩色标签底
 *              2026-09-20 — 传输方式标签增加 SFTP；与进度条统一展示
 *              2026-09-07 — issue #15+：渲染 skippedAsDuplicate 徽章，区分「真的下载/上传了」与「内容相同自动跳过」
 */
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
  /**
   * ★ 2026-09-26：可清除的记录数（= 该连接下**已结束**的记录数，不含 pending）。
   *   「清除」按钮据此判可用：为 0 时禁用——包括「一条记录都没有」与
   *   「剩下的全是在传的」两种情况，此时点了也清不掉任何东西。
   */
  @Input() clearableCount = 0
  @Input() filterOp = ''
  @Input() filterStatus = ''
  @Input() filterTimeRange: '' | 'today' | '7d' | '30d' | 'custom' = ''
  @Input() filterDateFrom = ''
  @Input() filterDateTo = ''
  @Input() activeTransferCount = 0
  @Input() transfersHidden = false
  @Input() transfersMinimized = false
  // ★ 2026-09-20 A8 审计修复：删除死输入 isZh（从未被父模板传入，模板也未使用）

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

  /** ★ 2026-08-30 修复：上传条目方向显示反转
   *  原写法 `isUploadLike = isUploadLikeOperation` 直接暴露了工具函数，而该函数的入参是
   *  operation 字符串，模板却按 isUploadLike(entry) 传入整个条目对象 ——
   *  `entry === 'upload'` 恒为 false，导致上传条目误走下载分支（🌐远端→🖥本地），
   *  方向看起来是反的（下载分支碰巧正确，故只有上传受害）。
   *  改为接收条目对象、内部取 operation，使签名与调用方语义一致；同时防御空条目。 */
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
    // 回退 index：旧日志可能缺 id 字段，若多条 id 相同/为空，*ngFor 会把它们当同一节点折叠成 1 行
    return entry.id ?? _index
  }

  @Input() customHistoryOwner: any
  customLogPending(entry: any): boolean {const row=this.customHistoryOwner?.customLogTransfer(entry);return row?['Running','Queued','Paused'].includes(row.status):entry.pending;}
}
