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
