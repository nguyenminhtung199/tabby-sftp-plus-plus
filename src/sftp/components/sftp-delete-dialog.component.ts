/**
 * SFTP++ 删除确认对话框（从主面板抽离）
 * @创建人：DD1024z + Auto(未确认底层模型)
 * @创建时间：2026-07-07
 * @修改人：DD1024z + Claude Opus 5
 * @修改时间：2026-09-21 — 单项与批量删除都显示目标所在目录（此前只显示文件名，
 *              选择残留跨目录时用户无法判断删的是哪个目录下的文件）
 *              2026-09-21 — visible 切换时清理过期焦点定时器，避免隐藏对话框抢焦点
 */
import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

@Component({
  selector: 'sftp-delete-dialog',
  template: require('./sftp-delete-dialog.component.view.html'),
  styles: [require('./sftp-delete-dialog.component.view.css')],
})
export class SftpDeleteDialogComponent implements OnChanges, OnDestroy {
  @Input() visible = false
  @Input() batch = false
  @Input() batchText = ''
  @Input() isDir = false
  @Input() name = ''
  /** 目标所在目录（单项与批量共用） */
  @Input() location = ''
  @Input() type = ''
  @Input() size: string | null = null
  @Input() date = ''
  @Input() toTrash = false

  @Output() confirm = new EventEmitter<void>()
  @Output() cancel = new EventEmitter<void>()

  @Input() i18n!: SftpI18nService

  @ViewChild('overlayEl', { static: false }) overlayEl?: ElementRef<HTMLDivElement>

  private _focusTimer: ReturnType<typeof setTimeout> | null = null

  // ★ 修复：对话框显示时把焦点移入 overlay（tabindex=-1 可聚焦但不进入 Tab 序列），
  //   确保回车/Esc 的 keydown 能落到 overlay 的 onKeyDown（此前 overlay 不可聚焦、焦点在面板外，回车无法确认）
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

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.confirm.emit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cancel.emit()
    }
  }
}
