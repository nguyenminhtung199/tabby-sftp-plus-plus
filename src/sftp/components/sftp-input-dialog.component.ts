/**
 * SFTP++ 输入对话框（从主面板抽离）
 * @创建人：DD1024z + Auto(未确认底层模型)
 * @创建时间：2026-07-07
 * @修改人：DD1024z + GPT-5.6 Sol
 * @修改时间：2026-09-21 — 清理可见性切换与销毁后的焦点定时器
 */
import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, SimpleChanges, OnChanges, OnDestroy } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

@Component({
  selector: 'sftp-input-dialog',
  template: require('./sftp-input-dialog.component.view.html'),
  styles: [require('./sftp-input-dialog.component.view.css')],
})
export class SftpInputDialogComponent implements OnChanges, OnDestroy {
  @Input() visible = false
  @Input() title = ''
  @Input() value = ''
  @Input() placeholder = ''
  /** 重命名时输入框自动聚焦，但不需要额外的高亮描边 */
  @Input() focusHighlight = true

  @Output() valueChange = new EventEmitter<string>()
  @Output() confirm = new EventEmitter<void>()
  @Output() cancel = new EventEmitter<void>()

  @Input() i18n!: SftpI18nService

  @ViewChild('overlayEl') overlayEl!: ElementRef<HTMLElement>
  @ViewChild('inputEl') inputEl!: ElementRef<HTMLInputElement>
  private _focusTimer: ReturnType<typeof setTimeout> | null = null

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      if (this._focusTimer) {
        clearTimeout(this._focusTimer)
        this._focusTimer = null
      }
      if (this.visible) {
        // ★ 2026-07-25：聚焦输入框本身（而非遮罩层），确保打开新建/重命名对话框即可直接键入。
        //   仅聚焦、不 select() 全选文本（重命名时保留原名不被整体选中，光标落在末尾）。
        this._focusTimer = setTimeout(() => {
          this._focusTimer = null
          this.inputEl?.nativeElement?.focus()
        })
      }
    }
  }

  ngOnDestroy(): void {
    if (this._focusTimer) clearTimeout(this._focusTimer)
    this._focusTimer = null
  }

  onEnter(): void {
    if (this.value.trim()) this.confirm.emit()
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.cancel.emit() }
  }
}
