import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

@Component({
  selector: 'sftp-dir-missing-dialog',
  template: require('./sftp-dir-missing-dialog.component.view.html'),
  styles: [require('./sftp-dir-missing-dialog.component.view.css')],
})
export class SftpDirMissingDialogComponent implements OnChanges, OnDestroy {
  @Input() visible = false

  @Input() dir = ''

  @Input() isRemote = false

  @Input() showFallback = true

  @Output() choice = new EventEmitter<'create' | 'fallback' | 'cancel'>()

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

  emitChoice(c: 'create' | 'fallback' | 'cancel'): void {
    this.choice.emit(c)
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {

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
