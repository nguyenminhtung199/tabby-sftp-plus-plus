import { mapConcurrent, mapSettledConcurrent } from './sftp/core/concurrency'
import { ConflictResolveUseCase, SftpConflictDetector } from './sftp/core/conflict'
import { folderFileProgress, folderSkipped, folderPhase } from './sftp/core/transfer-progress'
import { initializeFeatures } from './features/bootstrap'
import { PanelRubberBand } from './sftp/components/panel-rubber-band'
import { PanelFileDnd } from './sftp/components/panel-file-dnd'
import { PanelTransferCoordinator, PanelTransferRuntime } from './sftp/core/transfer-coordinator'
import { DownloadOneUseCase, DownloadDirUseCase, UploadPathUseCase } from './sftp/core/transfer-ops'
import { PanelDropAdapter, parseDragPayload } from './sftp/core/drop'
import { PanelPasteAdapter, PasteUseCase } from './sftp/core/paste'
import { featureApis } from './features/api'
import { NavigationMemory } from './sftp/core/navigation-memory'
import { SftpTransferLogService } from './services/sftp-transfer-log.service'
import { SftpI18nService } from './services/sftp-i18n.service'
import { computeSelection } from './sftp/core/selection'
import { setDateFormatPattern } from './sftp/core/file-utils'
export const testing={TarChannel:require('./sftp/core/tar-channel').TarChannel,PluginUpdater:require('./runtime/plugin-updater.cjs').PluginUpdater,mapConcurrent,mapSettledConcurrent,PanelTransferCoordinator,ConflictResolveUseCase,SftpConflictDetector,folderFileProgress,folderSkipped,folderPhase,I18nService:SftpI18nService,PanelPasteAdapter,PanelDropAdapter,parseDragPayload,featureApis,NavigationMemory,TransferLogService:SftpTransferLogService,computeSelection,setDateFormatPattern,Panel:SftpFloatingPanel,FilePane: SftpFilePaneComponent,Menu:SftpContextMenuComponent,LogDialog:SftpTransferLogDialogComponent,PanelRubberBand,PanelFileDnd,PanelTransferRuntime,DownloadOneUseCase,DownloadDirUseCase,UploadPathUseCase,PasteUseCase}

import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgModule, Optional } from '@angular/core'
import TabbyCoreModule, { ConfigProvider, HotkeyProvider, LogService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { TerminalDecorator } from 'tabby-terminal'

import { bindSftpLogger, log } from './services/sftp-logger'
import { SftpTerminalDecorator } from './tabby/terminal-decorator'
import { SftpFloatingPanel } from './sftp/sftp-floating-panel.component'
import { SftpWorkspaceTabComponent } from './sftp/sftp-workspace-tab.component'
import { SftpSettingsTabProvider, SftpSettingsTabComponent } from './settings/sftp-settings.component'
import { SftpPlusConfigProvider } from './tabby/config-provider'
import { SftpHotkeyProvider } from './tabby/hotkey-provider'
import { SftpConflictDialogComponent } from './sftp/components/sftp-conflict-dialog.component'
import { SftpTransferQueueComponent } from './sftp/components/sftp-transfer-queue.component'
import { SftpTransferLogDialogComponent } from './sftp/components/sftp-transfer-log-dialog.component'
import { SftpFilePaneComponent } from './sftp/components/sftp-file-pane.component'
import { SftpContextMenuComponent } from './sftp/components/sftp-context-menu.component'
import { SftpBookmarkPopupComponent } from './sftp/components/sftp-bookmark-popup.component'
import { SftpDeleteDialogComponent } from './sftp/components/sftp-delete-dialog.component'
import { SftpDirMissingDialogComponent } from './sftp/components/sftp-dir-missing-dialog.component'
import { SftpInputDialogComponent } from './sftp/components/sftp-input-dialog.component'
import { SftpPermDialogComponent } from './sftp/components/sftp-perm-dialog.component'
import { SftpDetailsDialogComponent } from './sftp/components/sftp-details-dialog.component'
import { SftpViewerDialogComponent } from './sftp/components/sftp-viewer-dialog.component'
import { SftpEditorDialogComponent } from './sftp/components/sftp-editor-dialog.component'
import { SftpTextContextMenuComponent } from './sftp/components/sftp-text-context-menu.component'
import { SftpCwdSetupDialogComponent } from './sftp/components/sftp-cwd-setup-dialog.component'

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    TabbyCoreModule,
  ],
  declarations: [
    SftpFloatingPanel,
    SftpWorkspaceTabComponent,
    SftpSettingsTabComponent,
    SftpConflictDialogComponent,
    SftpTransferQueueComponent,
    SftpTransferLogDialogComponent,
    SftpFilePaneComponent,
    SftpContextMenuComponent,
    SftpBookmarkPopupComponent,
    SftpDeleteDialogComponent,
    SftpDirMissingDialogComponent,
    SftpInputDialogComponent,
    SftpPermDialogComponent,
    SftpDetailsDialogComponent,
    SftpTextContextMenuComponent,
    SftpCwdSetupDialogComponent,

  ],
  providers: [
    { provide: TerminalDecorator, useClass: SftpTerminalDecorator, multi: true },
    { provide: SettingsTabProvider, useClass: SftpSettingsTabProvider, multi: true },
    { provide: ConfigProvider, useClass: SftpPlusConfigProvider, multi: true },
    { provide: HotkeyProvider, useClass: SftpHotkeyProvider, multi: true },
  ],
})
export default class SftpPlusModule {
  constructor(@Optional() logService: LogService) {
    bindSftpLogger(logService)
    log.info('Module loaded OK')
  }
}

initializeFeatures()
