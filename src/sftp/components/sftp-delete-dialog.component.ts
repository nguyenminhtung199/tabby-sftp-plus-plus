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
