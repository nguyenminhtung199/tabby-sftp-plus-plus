import { Component, EventEmitter, Input, Output } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

export type PermField =
  | 'ownerRead' | 'ownerWrite' | 'ownerExec'
  | 'groupRead' | 'groupWrite' | 'groupExec'
  | 'otherRead' | 'otherWrite' | 'otherExec'

@Component({
  selector: 'sftp-perm-dialog',
  template: require('./sftp-perm-dialog.component.view.html'),
  styles: [require('./sftp-perm-dialog.component.view.css')],
})
export class SftpPermDialogComponent {
  @Input() visible = false
  @Input() targetName = ''
  @Input() targetPath = ''
  @Input() ownerRead = false
  @Input() ownerWrite = false
  @Input() ownerExec = false
  @Input() groupRead = false
  @Input() groupWrite = false
  @Input() groupExec = false
  @Input() otherRead = false
  @Input() otherWrite = false
  @Input() otherExec = false
  @Input() modePreview = ''

  @Output() permChange = new EventEmitter<{ field: PermField; value: boolean }>()
  @Output() confirm = new EventEmitter<void>()
  @Output() cancel = new EventEmitter<void>()

  @Input() i18n!: SftpI18nService

  onPermChange(field: PermField, value: boolean): void {
    this.permChange.emit({ field, value })
  }
}
