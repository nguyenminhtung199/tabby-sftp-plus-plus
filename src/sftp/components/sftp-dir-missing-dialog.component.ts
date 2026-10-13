/**
 * SFTP++ 传输目标目录不存在确认对话框
 * 功能描述：右键上传/下载使用「默认上传/下载路径」时，若目标目录不存在，
 *   弹出三选一确认：创建并传输（远程逐级 mkdir / 本地 recursive mkdir）、
 *   本次使用当前面板目录（回退）、取消传输。每批传输只询问一次。
 * @创建人：DD1024z + Hy3
 * @创建时间：2026-09-28
 * @修改人：DD1024z + Hy3
 * @修改时间：2026-09-28
 * 修改情况：
 *   - 2026-09-28 (Hy3)：按钮顺序调整——「取消」移到最左侧（用户反馈），主操作保持靠右
 */
import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

@Component({
  selector: 'sftp-dir-missing-dialog',
  template: require('./sftp-dir-missing-dialog.component.view.html'),
  styles: [require('./sftp-dir-missing-dialog.component.view.css')],
})
export class SftpDirMissingDialogComponent implements OnChanges, OnDestroy {
  @Input() visible = false
  /** 不存在的目标目录完整路径 */
  @Input() dir = ''
  /** true = 远程目录（上传）；false = 本地目录（下载） */
  @Input() isRemote = false
  /** 请求目录与面板当前目录不同时才提供「使用当前目录」回退项 */
  @Input() showFallback = true

  @Output() choice = new EventEmitter<'create' | 'fallback' | 'cancel'>()

  @Input() i18n!: SftpI18nService

  @ViewChild('overlayEl', { static: false }) overlayEl?: ElementRef<HTMLDivElement>

  private _focusTimer: ReturnType<typeof setTimeout> | null = null

  // ★ 对话框显示时把焦点移入 overlay（tabindex=-1 可聚焦但不进入 Tab 序列），
  //   确保回车/Esc 的 keydown 能落到 overlay 的 onKeyDown（与删除确认框同套路）
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      if (this._focusTimer) {
        clearTimeout(this._focusTimer)
        this._focusTimer = null
      }
      if (this.visible) {
        this._focusTimer = setTimeout(() => {
          this._focusTimer = null
          this.overlayEl?.nativeElement?.focus()
        })
      }
    }
  }

  ngOnDestroy(): void {
    if (this._focusTimer) {
      clearTimeout(this._focusTimer)
      this._focusTimer = null
    }
  }

  emitChoice(c: 'create' | 'fallback' | 'cancel'): void {
    this.choice.emit(c)
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      // 回车 = 最常用动作：创建并传输
      event.preventDefault()
      event.stopImmediatePropagation()
      this.emitChoice('create')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.emitChoice('cancel')
    }
  }
}
