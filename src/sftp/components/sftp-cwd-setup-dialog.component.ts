import { featureApis, invokeFeature, readFeature, writeFeature } from "../../features/api"
﻿/**
 * SFTP++ 终端目录上报配置确认对话框
 * 不会自动向终端注入命令；需用户明确选择「仅本次」或「永久写入」
 */
import { Component, EventEmitter, Input, Output } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

export type CwdSetupChoice = 'session' | 'permanent' | 'cancel'

/**
 * bash 用 \$(pwd) 转义：赋值时保留字面量，每次显示提示符时再展开，且避免嵌套双引号把 shell 卡进 > 续行。
 * （Tabby Wiki 原式用引号拼接：CurrentDir="'$(pwd)\a\]"，效果相同但易误读。）
 */
export const CWD_SESSION_CMD =
  'export PS1="$PS1\\[\\e]1337;CurrentDir=\\$(pwd)\\a\\]"'

/** 永久写入 bash：追加到 ~/.bashrc 的内容 */
export const CWD_BASH_SNIPPET = [
  '# tabby-sftp-plus-plus cwd reporting',
  'export PS1="$PS1\\[\\e]1337;CurrentDir=\\$(pwd)\\a\\]"',
].join('\n')

/** 永久写入 zsh：追加到 ~/.zshrc 的内容 */
export const CWD_ZSH_SNIPPET = [
  '# tabby-sftp-plus-plus cwd reporting',
  '__sftp_plus_cwd_precmd(){ printf "\\033]1337;CurrentDir=%s\\007" "$PWD"; }',
  'precmd_functions+=(__sftp_plus_cwd_precmd)',
].join('\n')

@Component({
  selector: 'sftp-cwd-setup-dialog',
  template: require('./sftp-cwd-setup-dialog.component.view.html'),
  styles: [require('./sftp-cwd-setup-dialog.component.view.css')],
})
export class SftpCwdSetupDialogComponent {
  @Input() visible = false
  @Input() i18n!: SftpI18nService
  @Output() choose = new EventEmitter<CwdSetupChoice>()

  readonly sessionCmd = CWD_SESSION_CMD
  readonly bashSnippet = CWD_BASH_SNIPPET
  readonly zshSnippet = CWD_ZSH_SNIPPET

  onBackdrop(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.choose.emit('cancel')
  }

  // Controller facade: named source methods, one explicit composition root.
  ngOnInit(...args: any[]): any { return invokeFeature("CwdDialog","ngOnInit",this,args) }
}

export interface SftpCwdSetupDialogComponent { [key: string]: any }
