/**
 * SFTP++ 文件属性对话框（从主面板抽离）
 * ★ 2026-08-11 美化：头部图标+类型徽章（一眼分辨文件/文件夹）；
 *   文件夹大小按需计算（「计算」按钮，复用传输预扫描的并发扫描）
 */
import { Component, EventEmitter, Input, Output } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

export type DetailsDisplay = {
  name: string
  /** ★ 2026-08-11：是否为文件夹（头部图标与徽章用） */
  isFolder: boolean
  /** ★ 2026-08-25：彩色 SVG 图标 URL（复用文件列表映射；为空时回退内置线条图标） */
  iconUrl?: string | null
  type: string
  /** ★ 2026-08-11：来源位置标签（本地/远程） */
  location: string
  path: string
  size?: string
  /** ★ 2026-08-11：文件夹可显示「计算」按钮按需得出真实大小 */
  sizeCalculable?: boolean
  sizeCalcState?: 'idle' | 'calculating' | 'error'
  modified: string
  created?: string
  accessed?: string
  perms?: string
  owner?: string
  group?: string
}

@Component({
  selector: 'sftp-details-dialog',
  template: require('./sftp-details-dialog.component.view.html'),
  styles: [require('./sftp-details-dialog.component.view.css')],
})
export class SftpDetailsDialogComponent {
  @Input() visible = false
  @Input() display: DetailsDisplay | null = null

  @Output() confirm = new EventEmitter<void>()
  @Output() cancel = new EventEmitter<void>()
  /** ★ 2026-08-11：请求计算文件夹真实大小 */
  @Output() calcSize = new EventEmitter<void>()

  @Input() i18n!: SftpI18nService
}
