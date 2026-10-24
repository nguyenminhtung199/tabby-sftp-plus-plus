import { AppService } from 'tabby-core'
import { SettingsTabComponent } from 'tabby-settings'
import { SFTP_PLUS_SETTINGS_TAB_ID } from './sftp-settings.component'

export function openSftpPlusSettings(app: AppService): void {
  const tabId = SFTP_PLUS_SETTINGS_TAB_ID

  const isSettingsTab = (tab: any): boolean => {
    if (!tab) return false
    if (tab.constructor?.name === 'SettingsTabComponent') return true
    if (tab.settingsProviders) return true
    try {
      const el = tab.hostElement as HTMLElement | undefined
      if (el && el.querySelector && el.querySelector(`[ngbNavItem="${tabId}"]`)) return true
    } catch { /* ignore */ }
    return false
  }

  const existingTabs = (app.tabs || []).filter(isSettingsTab)
  for (const tab of existingTabs) {
    try {

      app.closeTab(tab, false)
    } catch { /* ignore */ }
  }

  const settingsTab = app.openNewTabRaw({
    type: SettingsTabComponent,
    inputs: { activeTab: tabId },
  }) as any

  if (!settingsTab) return
  app.selectTab(settingsTab)
}
