import * as Angular from '@angular/core'
import { PlatformService } from 'tabby-core'
import { SftpFloatingPanel as Panel } from '../sftp/sftp-floating-panel.component'
import { SftpSettingsTabComponent as Settings } from '../settings/sftp-settings.component'
import { SftpFilePaneComponent as FilePane } from '../sftp/components/sftp-file-pane.component'
import { SftpTerminalDecorator as Decorator } from '../tabby/terminal-decorator'
import { SftpI18nService as I18n } from '../services/sftp-i18n.service'
import { SftpCwdSetupDialogComponent as CwdDialog } from '../sftp/components/sftp-cwd-setup-dialog.component'
import { SftpContextMenuComponent as Menu, FILE_MENU_REGISTRY as Registry } from '../sftp/components/sftp-context-menu.component'
import { SftpBookmarkPopupComponent as Bookmark } from '../sftp/components/sftp-bookmark-popup.component'
import { PanelTransferRuntime as ProgressRuntime } from '../sftp/core/transfer-coordinator'
import { downloadRemoteToTempFile as download } from '../sftp/core/transfer-adapters'
import { execSshCommand as execRemote } from '../sftp/core/path-utils'
import { readToggleHotkeyBindings as bindings, formatHotkeyBinding as formatBinding } from '../tabby/hotkey-util'
import { featureApis } from './api'
const surfaces=require('./surface.json')
let initialized=false
/** One composition root; only plain controller objects are extended, never Angular prototypes. */
export function initializeFeatures(): void {
 if(initialized)return
 initialized=true
 const types={Panel,Settings,FilePane,Decorator,I18n,CwdDialog,Menu,Bookmark,ProgressRuntime}
 for(const [role,Type] of Object.entries(types)){
  const api=Object.create(null),changed=new Set(surfaces[role])
  let prototype=Type.prototype
  while(prototype&&prototype!==Object.prototype){
   for(const name of Object.getOwnPropertyNames(prototype)){
    if(name==='constructor'||name.startsWith('_base_'))continue
    if(changed.has(name))continue
    if(Object.prototype.hasOwnProperty.call(api,name))continue
    const descriptor=Object.getOwnPropertyDescriptor(prototype,name)!
    Object.defineProperty(api,name,{...descriptor,configurable:true})
   }
   prototype=Object.getPrototypeOf(prototype)
  }
  for(const name of changed as Set<string>){const descriptor=Object.getOwnPropertyDescriptor(Type.prototype,'_base_'+name);if(descriptor)Object.defineProperty(api,name,{...descriptor,configurable:true});}
  featureApis[role]=api
 }
 const dependencies={...types,apis:featureApis,Angular,Platform:PlatformService,Registry,bindings,formatBinding,execRemote,download,shell:require('electron').shell,reporter:require('../runtime/screen-reporter.cjs'),theme:require('../../assets/vscode-file-icons.json')}
 const recovery=require('../runtime/recovery-store.cjs')()
 const resume=require('./resume-transfer.cjs')({...dependencies,root:recovery.root,server:recovery.server})
 // This list is the supported extension order, verified by integration tests.
 for(const feature of [
  'transfer-engine','external-edit','navigation','file-icons','cwd','activity','sidebar',
  'cleanup-runtime','settings-controls','recent-folders','clipboard-upload','transfer-ui',
  'context-menu','inline-edit','keyboard-events','clipboard-safety'
 ]) featureFactories[feature]({...dependencies,recovery,resume})
 featureApis.Panel.showTopNotification=function(message:any,kind:any,detail:any){this.showToast([message,detail].filter(Boolean).join('\n'),5000)}
 require('./drop-diagnostics.cjs')({...dependencies,root:recovery.root})
}
const featureFactories: Record<string,any>={
 'transfer-engine':require('./transfer-engine.cjs'),'external-edit':require('./external-edit.cjs'),
 navigation:require('./navigation.cjs'),'file-icons':require('./file-icons.cjs'),cwd:require('./cwd.cjs'),
 activity:require('./activity.cjs'),sidebar:require('./sidebar.cjs'),'cleanup-runtime':require('./cleanup-runtime.cjs'),
 'settings-controls':require('./settings-controls.cjs'),'recent-folders':require('./recent-folders.cjs'),
 'clipboard-upload':require('./clipboard-upload.cjs'),'transfer-ui':require('./transfer-ui.cjs'),
 'context-menu':require('./context-menu.cjs'),'inline-edit':require('./inline-edit.cjs'),
 'keyboard-events':require('./keyboard-events.cjs'),'clipboard-safety':require('./clipboard-safety.cjs')
}
