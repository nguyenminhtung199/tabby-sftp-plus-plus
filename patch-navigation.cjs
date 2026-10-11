const fs = require('fs');
const path = require('path');
const ts = require('../plugins/node_modules/typescript');
const reporter = require('./screen-reporter.cjs');
const localIconTheme = require('./assets/vscode-file-icons.json');
const iconAlignment = '@font-face{font-family:SftpLocalSeti;src:url("data:font/woff;base64,'+fs.readFileSync(path.join(__dirname,'assets/seti.woff')).toString('base64')+'") format("woff");font-weight:normal;font-style:normal;}\n'+fs.readFileSync(path.join(__dirname,'icon-alignment.css'),'utf8');
const activityStyles = fs.readFileSync(path.join(__dirname,'activity.css'),'utf8');
const activityTemplate = fs.readFileSync(path.join(__dirname,'activity-template.html'),'utf8');
const translations = {
    '日本語':'Japanese', '中文（简体）':'Chinese (Simplified)', '中文（繁體）':'Chinese (Traditional)',
    '远程文件已被修改。确定要覆盖服务器上的版本吗？':'The remote file changed. Overwrite the server version?',
    '已保存':'Saved', '无法读取权限，已取消':'Could not read permissions. Operation cancelled.',
    '权限修改失败':'Failed to change permissions.', '有正在进行的传输，确定要关闭吗？':'Transfers are in progress. Close anyway?',
    'SSH 连接已断开，请先重新连接终端':'SSH connection lost. Reconnect the terminal first.',
    'SFTP+（已最小化，点击恢复）':'SFTP+ (minimized; click to restore)',
    'SFTP+（已打开，点击关闭）':'SFTP+ (open; click to close)',
    '恢复':'Restore', '最小化':'Minimize', '已展开':'Expanded', '文件名':'Filename', '扩展名':'Extension',
    '摘要不可用（文件大小不同或远程服务器不支持）':'Checksum unavailable (different file sizes or unsupported remote server)',
    '摘要不可用（文件大小不同或本地读取失败）':'Checksum unavailable (different file sizes or local read failed)',
    '取消':'Cancel', '保存书签':'Save bookmark',
    '有 ':'There are ', ' 项移入回收站失败，文件未被删除（请尝试 Shift+Delete 永久删除）':' items that could not be moved to Trash. They were not deleted (use Shift+Delete to delete permanently).',
};
const once = (source, old, replacement) => {
    if(source.split(old).length !== 2) throw new Error('Navigation anchor mismatch: ' + old.slice(0,80));
    return source.replace(old,replacement);
};
const encodedTemplate = text => text.replace(/\n/g,'\\n').replace(/'/g,"\\'");
module.exports = function enhance(source) {
    source = once(source, 'function je(){return{lang:"",', 'function je(){return{lang:"en-US",rememberSessionFolders:!0,folderAutocomplete:!0,sidebarEnabled:!0,sidebarSide:"left",sidebarSessions:{},pathModes:{},cwdSetupServers:{},');
    source = once(source, '[pathInput]="localPathInput"', '[pathInput]="localPathInput"\\n          [customPathProvider]="customLocalPathProvider"');
    source = once(source, '[pathInput]="remotePathInput"', '[pathInput]="remotePathInput"\\n          [customPathProvider]="customRemotePathProvider"');
    source = once(source, '[loading]="_remoteLoading"', '[loading]="_remoteLoading"\\n          [customRefreshSameFolder]="_customRefreshSame_remote"');
    source = once(source, '[loading]="_localLoading"', '[loading]="_localLoading"\\n          [customRefreshSameFolder]="_customRefreshSame_local"');
    const location = '          <label class="ss-toggle-row" title="Download the complete file, open it in your local app, and upload on save. Progress appears in Transfer history.">';
    const toggles = `          <label class="ss-toggle-row" title="A sidebar for each SSH pane. Collapsing keeps editing and transfers running.">
            <span class="ss-toggle-label">Use SFTP sidebar</span>
            <span class="ss-toggle-track" [class.active]="customSidebarEnabled" (click)="toggleCustomSidebar()"><span class="ss-toggle-thumb"></span></span>
          </label>
          <div class="ss-toggle-row"><span class="ss-toggle-label">Sidebar edge</span><select [ngModel]="customSidebarSide" (ngModelChange)="setCustomSidebarSide($event)"><option value="left">Left</option><option value="right">Right</option></select></div>
          <label class="ss-toggle-row" title="Restore the last successfully opened folder for each SSH profile, in every path mode.">
            <span class="ss-toggle-label">Remember folders for each SSH profile</span>
            <span class="ss-toggle-track" [class.active]="customRememberFolders" (click)="toggleCustomRememberFolders()"><span class="ss-toggle-thumb"></span></span>
          </label>
          <label class="ss-toggle-row">
            <span class="ss-toggle-label">Suggest folders while typing paths</span>
            <span class="ss-toggle-track" [class.active]="customFolderAutocomplete" (click)="toggleCustomFolderAutocomplete()"><span class="ss-toggle-thumb"></span></span>
          </label>
`;
    source = once(source,location,encodedTemplate(toggles)+location);
    source = once(source, "<p>{{ i18n.t(\\'path.cwdSetupIntro\\') }}</p>", "<p>{{ i18n.t(\\'path.cwdSetupIntro\\') }}</p>\\n          <p>Supports Bash/Zsh inside GNU Screen. Run setup at an idle shell prompt in the active Screen window. Use Permanent to enable it in future shells.</p>");
    const extensionIcons={"python":[".py",".pyw",".pyi",".ipynb"],"javascript":[".js",".jsx",".mjs",".cjs"],"typescript":[".ts",".tsx"],"json":[".json",".jsonc"],"yaml":[".yaml",".yml"],"shell":[".sh",".bash",".zsh",".bat",".cmd",".ps1"],"go":[".go"],"rust":[".rs"],"java":[".java"],"sql":[".sql"],"html":[".html",".htm"],"css":[".css",".scss",".less"],"markdown":[".md",".markdown"]};
    for(const [icon,extensions] of Object.entries(extensionIcons))for(const ext of extensions){
        const anchor=JSON.stringify(ext)+':"code.svg"';const textAnchor=JSON.stringify(ext)+':"text.svg"';
        if(source.includes(anchor))source=once(source,anchor,JSON.stringify(ext)+':'+JSON.stringify(icon+'.svg'));
        else if(source.includes(textAnchor))source=once(source,textAnchor,JSON.stringify(ext)+':'+JSON.stringify(icon+'.svg'));
        else source=once(source,'".txt":"text.svg",','".txt":"text.svg",'+JSON.stringify(ext)+':'+JSON.stringify(icon+'.svg')+',');
    }
    // Translate actual message/template literals without changing translation dictionaries or sorting tables.
    const ast = ts.createSourceFile('index.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const edits = [];
    function visit(node) {
        if(ts.isStringLiteral(node) && !node.text.includes('msgid')) {
            let text = node.text;
            if(text.includes('class="top-actions"')) {
                const anchor='<button class="btn-close"';
                const icons='<button *ngIf="_customSidebarMount" class="btn-link btn-icon" (mousedown)="$event.preventDefault()" (click)="toggleCustomSidebarPin()" [class.active]="customSidebarPinned" [title]="customSidebarPinned ? \'Unpin (overlay)\' : \'Pin panel (dock)\'"><i class="fas" [class.fa-thumbtack]="customSidebarPinned" [class.fa-map-pin]="!customSidebarPinned"></i></button>\n          <button *ngIf="_customSidebarMount" class="btn-link btn-icon" (mousedown)="$event.preventDefault()" (click)="toggleCustomSidebarMode()" [class.active]="customSidebarMode" [title]="customSidebarMode ? \'Maximize panel\' : \'Restore sidebar\'"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M6 2.5v11"/></svg></button>\n          ';
                if(text.split(anchor).length!==2)throw new Error('Sidebar toolbar anchor mismatch');
                const sync='<button class="btn-link btn-icon" (mousedown)="$event.preventDefault()" (click)="customSyncNow()" title="Sync now — activate CWD reporting in the current Screen window at an idle shell prompt"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M13 6a5 5 0 0 0-8-2L3 6m0-3v3h3M3 10a5 5 0 0 0 8 2l2-2m0 3v-3h-3"/></svg></button>';
                const maximize=/<button \*ngIf="displayMode !== 'workspace'" class="btn-link btn-icon btn-maximize"[\s\S]*?<\/button>/;
                if(!maximize.test(text))throw new Error('Original maximize button missing');
                text=text.replace(maximize,button=>button.replace("displayMode !== 'workspace'", "displayMode !== 'workspace' && !_customSidebarMount").replace('toggleMaximize()', '_customSidebarMount ? toggleCustomSidebarFull() : toggleMaximize()').replaceAll('panelMaximized','(_customSidebarMount ? customSidebarFull : panelMaximized)'));
                text=text.replace('<div class="top-actions">','<div class="top-actions">'+sync);
                text=text.replace(anchor,icons+anchor);
                text=text.replace('title="Sync now — activate CWD reporting in the current Screen window at an idle shell prompt"', '[disabled]="_customSyncNowBusy || !connected" [title]="customCwdTooltip"');
                text=text.replace('[title]="pathModeTitle()"', '[title]="pathModeTitle() + \'\\n\' + customCwdTooltip"');
                const modeEnd = text.indexOf('</button>', text.indexOf('class="btn-link btn-icon btn-path-mode"'));
                text=text.slice(0,modeEnd)+'<span class="custom-cwd-dot" *ngIf="pathMode === \'sync\'" [class.tracking]="customCwdState === \'tracking\'" [class.waiting]="customCwdState === \'waiting\'" [class.failed]="customCwdState === \'failed\'"></span>'+text.slice(modeEnd);
                text=text.replace('<sftp-transfer-log-dialog', '<sftp-transfer-log-dialog [customHistoryOwner]="customHistoryOwner"');
                text=text.replace('</sftp-transfer-log-dialog>',activityTemplate+'\n</sftp-transfer-log-dialog>');
            }
            if(text.includes('class="dialog log-dialog"')) {
                text=text.replaceAll('entry.pending','customLogPending(entry)');
                text=text.replace('<div class="log-list" (wheel)="onScrollableWheel($event)">','<div class="log-list" (wheel)="onScrollableWheel($event)"><ng-content></ng-content>');
                text=text.replace('*ngIf="!entries.length"','*ngIf="!entries.length && !customHistoryOwner?.customEditRows.length && !customHistoryOwner?.customHistoryRecoveryRows.length"');
                text=text.replace('<div class="log-row-paths">',`<div class="log-recovery-actions" *ngIf="customHistoryOwner?.customLogTransfer(entry) as t">
                  <span>{{ customHistoryOwner.customTransferDetails(t) }}</span>
                  <button class="btn-link" *ngIf="customHistoryOwner.customCanRetryTransfer(t)" [disabled]="!customHistoryOwner.connected || t._retryBusy" (click)="customHistoryOwner.customRetryTransfer(t)" title="Retry or resume transfer"><i class="fas fa-play"></i></button>
                  <button class="btn-link" *ngIf="t.status !== 'Completed' && t.status !== 'Cancelled'" (click)="customHistoryOwner.customCancelTransfer(t)" title="Cancel transfer"><i class="fas fa-times"></i></button>
                </div><div class="log-row-paths">`);
            }
            if(text.includes('.log-row-main') && !text.includes('class="dialog log-dialog"'))text+='\n.log-recovery-actions{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px}.log-recovery-actions>span{flex:1}.log-recovery-actions button{color:inherit;}';
            text=text.replaceAll('<ng-container *ngIf="!folderIcon">📁</ng-container>','<ng-container *ngIf="!folderIcon"><span class="native-folder-icon">📁</span></ng-container>').replaceAll('<ng-container *ngIf="!iconSrc(e)">📄</ng-container>','<ng-container *ngIf="!iconSrc(e)"><span class="native-file-icon">📄</span></ng-container>');
            text=text.replace('<div class="pane-loading" *ngIf="loading">', '<div class="pane-loading" *ngIf="loading && (!entries.length || !customRefreshSameFolder)">');
            for(const entry of ['e','row.entry']) {
                const image='<img *ngIf="iconSrc('+entry+') as src" class="custom-file-icon"';
                text=text.replace(image,'<span *ngIf="customSetiPython('+entry+')" class="custom-seti-python" aria-hidden="true">&#xE07B;</span>\n<img *ngIf="!customSetiPython('+entry+') && iconSrc('+entry+') as src" class="custom-file-icon"');
            }
            if(text.includes('.sftp-root .icon .custom-file-icon'))text+='\n'+iconAlignment+'\n'+activityStyles;
            for(const [old,value] of Object.entries(translations)) text=text.split(old).join(value);
            if(text!==node.text) edits.push({start:node.getStart(ast),end:node.end,text:JSON.stringify(text)});
        } else if(ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)) {
            const translation = translations[node.text];
            if(translation) edits.push({start:node.getStart(ast),end:node.end,text:source.slice(node.getStart(ast),node.end).replace(node.text,translation)});
        }
        ts.forEachChild(node,visit);
    }
    visit(ast);
    for(const edit of edits.sort((a,b)=>b.start-a.start)) source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
    const runtime=fs.readFileSync(path.join(__dirname,'navigation.cjs'),'utf8').replace(/^\uFEFF/,'').trim().replace(/module\.exports = /,'').replace(/;$/,'');
    const injected=`/* LOCAL_NAVIGATION_V2 */(${runtime})({Panel:Xi,Settings:Wt,FilePane:wr,I18n:Kn,CwdDialog:Ui,Angular:o,execRemote:ss,reporter:${JSON.stringify(reporter)}});`;
    const sidebar=fs.readFileSync(path.join(__dirname,'sidebar.cjs'),'utf8').replace(/^\uFEFF/,'').trim().replace(/module\.exports = /,'').replace(/;$/,'');
    const icons=fs.readFileSync(path.join(__dirname,'file-icons.cjs'),'utf8').replace(/^\uFEFF/,'').trim().replace(/module\.exports = /,'').replace(/;$/,'');
    const cwd=fs.readFileSync(path.join(__dirname,'cwd.cjs'),'utf8').replace(/^\uFEFF/,'').trim().replace(/module\.exports = /,'').replace(/;$/,'');
    const activity=fs.readFileSync(path.join(__dirname,'activity.cjs'),'utf8').trim().replace(/^module\.exports = /,'').replace(/;$/,'');
    source=once(source,'const so=to;',injected + '/* LOCAL_FILE_ICONS_V1 */('+icons+')({FilePane:wr,theme:'+JSON.stringify(localIconTheme)+'});/* LOCAL_CWD_V3 */('+cwd+')({Panel:Xi,reporter:'+JSON.stringify(reporter)+'});Xi.prototype.showTopNotification=function(message,kind,detail){this.showToast([message,detail].filter(Boolean).join("\\n"),5000);};o.Input()(vr.prototype,"customHistoryOwner");vr.prototype.customLogPending=function(entry){const row=this.customHistoryOwner?.customLogTransfer(entry);return row?["Running","Queued","Paused"].includes(row.status):entry.pending;};/* LOCAL_ACTIVITY_V1 */('+activity+')({Panel:Xi,recovery:customSftpRecovery});/* LOCAL_SIDEBAR_V1 */('+sidebar+')({Panel:Xi,Settings:Wt,Decorator:tr});const so=to;');
    return source;
};
