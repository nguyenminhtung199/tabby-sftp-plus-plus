import { Component, EventEmitter, Input, Output } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

export type DetailsDisplay = {
  name: string

  isFolder: boolean

  iconUrl?: string | null
  type: string

  location: string
  path: string
  size?: string

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

  @Output() calcSize = new EventEmitter<void>()

  @Input() i18n!: SftpI18nService
}
