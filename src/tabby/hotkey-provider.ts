import { Injectable, Optional } from '@angular/core'
import { ConfigService, HotkeyProvider } from 'tabby-core'
import { SftpI18nService } from '../services/sftp-i18n.service'

export const SFTP_PLUS_TOGGLE_HOTKEY = 'sftp-plus-plus-toggle-panel'

@Injectable()
export class SftpHotkeyProvider extends HotkeyProvider {
  private i18n: SftpI18nService

  constructor(@Optional() private config?: ConfigService) {
    super()
    this.i18n = new SftpI18nService(config)
  }

  async provide(): Promise<Array<{ id: string; name: string }>> {
    return [
      {
        id: SFTP_PLUS_TOGGLE_HOTKEY,

        name: this.i18n.t('hotkey.togglePanel'),
      },
    ]
  }
}
