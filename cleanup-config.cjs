// Remove retired UI and code from the generated fork, keeping the upstream base immutable.
const ts=require('typescript');
const removedKeys=new Set(['hideAuthorInfo','openUnsupportedInSystem','editableFileExtensions','allowViewEditAllFiles','allowEditAllFiles','allowViewAllAsText','showTextLineNumbers','textCaretShape','fileOpenAction','openInNewTabByDefault','singleWorkspaceInstance','rememberSessionFolders']);
module.exports=function cleanup(source){
 const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];
 const replace=(n,text)=>edits.push({start:n.getStart(ast),end:n.end,text});
 function visit(n){
  if(ts.isFunctionDeclaration(n)&&n.name?.text==='Oe'){
   const obj=n.body.statements.find(ts.isReturnStatement).expression;
   replace(n,'function Oe(){return{'+obj.properties.filter(p=>p.name?.getText(ast)!=='viewFile').map(p=>p.getText(ast)).join(',')+'}}');return;
  }
  if(ts.isVariableDeclaration(n)&&['Nr','qr'].includes(n.name.getText(ast))&&n.initializer&&ts.isClassExpression(n.initializer)){
   replace(n,n.name.getText(ast)+'=class{}');return;
  }
  if(ts.isBinaryExpression(n)&&['Nr','qr'].includes(n.left.getText(ast))&&ts.isClassExpression(n.right)){
   replace(n,n.left.getText(ast)+'=class{}');return;
  }
  if(ts.isBinaryExpression(n)&&['Kr','Xr'].includes(n.left.getText(ast))&&n.getText(ast).includes('sftp-'+(n.left.getText(ast)==='Kr'?'viewer':'editor')+'-dialog')){
   replace(n,n.left.getText(ast)+'='+(n.left.getText(ast)==='Kr'?'Nr':'qr'));return;
  }
  if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='declarations'&&ts.isArrayLiteralExpression(n.initializer)){
   replace(n,'declarations:['+n.initializer.elements.filter(e=>!['Kr','Xr'].includes(e.getText(ast))).map(e=>e.getText(ast)).join(',')+']');return;
  }
  // Defaults, context menu definitions and keyboard action lists.
  if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='Ft'){
   replace(n,n.getText(ast).replace(/viewFile:\{[^}]+\},/,''));return;
  }
  if(ts.isArrayLiteralExpression(n)&&n.elements.some(e=>ts.isStringLiteral(e)&&e.text==='viewFile')){
   replace(n,'['+n.elements.filter(e=>!ts.isStringLiteral(e)||e.text!=='viewFile').map(e=>e.getText(ast)).join(',')+']');return;
  }
  if(ts.isFunctionDeclaration(n)&&n.name?.text==='je'){
   const obj=n.body.statements.find(ts.isReturnStatement).expression;
   replace(n,'function je(){return{'+obj.properties.filter(p=>!removedKeys.has(p.name?.getText(ast))).map(p=>p.name?.getText(ast)==='defaultPathMode'?'defaultPathMode:"remember"':p.name?.getText(ast)==='contextMenuOrder'?'contextMenuOrder:['+p.initializer.elements.filter(e=>e.text!=='viewFile').map(e=>e.getText(ast)).join(',')+']':p.getText(ast)).join(',')+'}}');return;
  }
  if(ts.isMethodDeclaration(n)||ts.isGetAccessorDeclaration(n)){
   const key=n.name.getText(ast);
   if(key==='_commitHotkeyRecording'){replace(n,n.getText(ast).replace('this.configService.store.hotkeys[oe]=[t]','this.configService.store.hotkeys[oe]=this._customMergeToggleBinding(t)'));return;}
   if(key==='importData'){replace(n,n.getText(ast).replaceAll('this.configService.save()','(this._customCleanConfig(),this.configService.save())'));return;}
   if(key==='onContextMenuAction'){replace(n,n.getText(ast).replace('case"viewFile":this.ctxViewFile();break;',''));return;}
   if(key==='_validateEditEntry'){replace(n,'');return;}
   if(key==='_openInNewTabByDefault'){replace(n,'_openInNewTabByDefault(){return false;}');return;}
   if(key==='_activateEntry'){
    replace(n,'async _activateEntry(pane,entry,event){if(!entry)return;let directory=!!entry.isDirectory||this.isDirByMode(entry.mode);if(!directory&&pane==="remote"&&(entry.isSymlink||rt(entry.mode)))directory=await this._resolveRemoteSymlinkIsDir(entry.fullPath);if(directory)return pane==="local"?this.openLocal(entry,event):this.openRemote(entry,event);}');return;
   }
   // Lifecycle hooks from the upstream base can still call these; they no longer own resources.
   if(['closeViewer','closeEditor','_cleanupViewerTemp','_cleanupEditorTemp','_stopEditorFileWatch'].includes(key)){replace(n,key+'(){}');return;}
   if((/(?:Viewer|Editor)/.test(key)&&key!=='_logEditorTransfer')||/^_(?:view|edit)(?:Local|Remote)File$/.test(key)||['ctxViewFile','getCustomEditableExtensions','getAllowViewEditAllFiles','isFileNameEditable','viewerShowSystemAction','editorShowSystemAction','onEditorScroll','toggleHideAuthorInfo','confirmHideAuthor','cancelHideAuthor','toggleOpenUnsupportedInSystem','toggleOpenInNewTabByDefault','toggleSingleWorkspaceInstance','toggleShowTextLineNumbers'].includes(key)){
    replace(n,'');return;
   }
   if(key==='canViewEntry'){replace(n,'canViewEntry(){return false;}');return;}
   if(key==='canEditEntry'){replace(n,'canEditEntry(entry){return !!entry&&!entry.isDirectory&&!this.isDirByMode(entry.mode);}');return;}
   if(key==='_saveToConfig'){
    let text=n.getText(ast);
    for(const key of removedKeys)text=text.replace(new RegExp('e\\.'+key+'=[^,;]+,','g'),'');
    replace(n,text);return;
   }
  }
  if(ts.isStringLiteral(n)&&n.text.includes('ss-toggle-row')&&n.text.includes('customSidebarSide')){
   let html=n.text;
   for(const binding of ['toggleHideAuthorInfo','toggleOpenInNewTabByDefault','toggleSingleWorkspaceInstance','toggleExternalEditOnOpen','toggleCustomRememberFolders']){
    const re=new RegExp('<label\\b[^>]*>[\\s\\S]*?</label>','g');let count=0;
    html=html.replace(re,row=>row.includes(binding)?(count++,''):row);
    if(count!==1)throw new Error('Settings removal anchor: '+binding+' ('+count+')');
   }
   html=removeContaining(html,'<div','</div>','showHideAuthorConfirm');
   const aboutMarker=html.indexOf("i18n.t('settings.about')");
   const aboutStart=html.lastIndexOf('<div class="ss-section">',aboutMarker);
   if(aboutMarker<0||aboutStart<0)throw new Error('About settings section missing');
   html=html.slice(0,aboutStart)+html.slice(findElementEnd(html,aboutStart,'div'));
   const start=html.lastIndexOf('<div',html.indexOf("settings.viewerEditor"));
   const end=html.indexOf('</div>',start)+6;
   // All viewer options occupy the end of the interaction section.
   const caretEnd=findElementEnd(html,html.lastIndexOf('<div',html.indexOf("settings.textCaretShapeHint")),'div');
   if(start<0||caretEnd<end)throw new Error('Viewer settings range mismatch');
   html=html.slice(0,start)+html.slice(caretEnd);
   html=html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/g,row=>row.includes("defaultPathMode === 'sync'")?'':row);
   html=html.replace("{{ i18n.t('settings.pathModeOff') }}",'Manual');
   html=html.replace(/<div class="ss-toggle-row"><span class="ss-toggle-label">Sidebar edge<\/span><select[^>]*>[\s\S]*?<\/select><\/div>/,
    `<div class="ss-toggle-row ss-pathmode-row"><span class="ss-toggle-label">Sidebar edge</span><div class="ss-segmented"><button type="button" class="ss-segment" [class.active]="customSidebarSide === 'left'" (click)="setCustomSidebarSide('left')">Left</button><button type="button" class="ss-segment" [class.active]="customSidebarSide === 'right'" (click)="setCustomSidebarSide('right')">Right</button></div></div>`);
   html=html.replace(/\s*\*ngIf="!hideAuthorInfo"/g,'');
   const toggleStart=html.lastIndexOf('<div class="ss-phk-row">',html.indexOf("i18n.t('settings.hotkey')"));
   if(toggleStart<0)throw new Error('Toggle shortcut row missing');
   const toggleEnd=findElementEnd(html,toggleStart,'div');
   const toggleRow=`<div class="ss-phk-row"><span class="ss-phk-label">{{ i18n.t('settings.hotkey') }}</span><div class="ss-hotkey-field ss-hotkey-multi" [class.recording]="hotkeyRecording" [class.has-value]="customPanelToggleBindings.length && !hotkeyRecording"><ng-container *ngIf="hotkeyRecording; else toggleChips"><span class="ss-hotkey-recording" (click)="startHotkeyRecording()">{{ customToggleBindingLabel(hotkeyRecordingPreview) || i18n.t('settings.hotkeyRecording') }}</span><button type="button" class="ss-chip-remove" (click)="cancelHotkeyRecording(); $event.stopPropagation()" [title]="i18n.t('app.cancel')">×</button></ng-container><ng-template #toggleChips><span class="ss-hotkey-chip" *ngFor="let k of customPanelToggleBindings; let i = index" (click)="customStartToggleRecording(i)" [title]="i18n.t('settings.hotkeyClickToSet')">{{ customToggleBindingLabel(k) }}<button type="button" class="ss-chip-remove" (click)="customRemoveToggleBinding(i); $event.stopPropagation()" [title]="i18n.t('settings.hotkeyClear')">×</button></span><button type="button" class="ss-hotkey-add" (click)="customStartToggleRecording()" [disabled]="!configService" [title]="i18n.t('settings.hotkeyAdd')">+</button></ng-template></div></div>`;
   html=html.slice(0,toggleStart)+toggleRow+html.slice(toggleEnd);
   replace(n,JSON.stringify(html));return;
  }
  if(ts.isStringLiteral(n)&&n.text.includes('<sftp-viewer-dialog')){
   let html=n.text.replace(/<sftp-(viewer|editor)-dialog\b[\s\S]*?<\/sftp-\1-dialog>/g,'');
   html=html.replace(/<svg \*ngIf="pathMode === 'sync'"[\s\S]*?<\/svg>/g,'').replace(' *ngIf="pathMode !== \'sync\'"','').replace(/<span class="custom-cwd-dot"[\s\S]*?<\/span>/g,'').replace('[title]="pathModeTitle() + \'\\n\' + customCwdTooltip"','[title]="pathModeTitle()"');
   replace(n,JSON.stringify(html));return;
  }
  if(ts.isStringLiteral(n)&&n.text.includes('hideAuthorInfo')&&n.text.includes('*ngIf')){
   replace(n,JSON.stringify(n.text.replace(/\s*\*ngIf="!hideAuthorInfo"/g,'')));return;
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 // Runtime migration also covers old imported settings and cached per-session path modes.
 const runtime=require('fs').readFileSync(require('path').join(__dirname,'cleanup-runtime.cjs'),'utf8').trim().replace(/^module\.exports = /,'').replace(/;$/,'');
 source=source.replace('const so=to;',`/* CONFIG_CLEANUP_V1 */(${runtime})({Panel:Xi,Settings:Wt});const so=to;`);
 const controls=require('fs').readFileSync(require('path').join(__dirname,'settings-controls.cjs'),'utf8').trim().replace(/^module\.exports = /,'').replace(/;$/,'');
 source=source.replace('const so=to;',`/* SETTINGS_CONTROLS_V1 */(${controls})({Settings:Wt,Decorator:tr,bindings:ve,formatBinding:he});const so=to;`);
 return source;
};
function findElementEnd(html,start,tag){
 const re=new RegExp('<(/?)'+tag+'\\b[^>]*>','g');re.lastIndex=start;let depth=0,match;
 while((match=re.exec(html))){depth+=match[1]?-1:1;if(depth===0)return re.lastIndex;}
 throw new Error('Unbalanced '+tag+' removal');
}
function removeContaining(html,startTag,endTag,marker){
 const pos=html.indexOf(marker);if(pos<0)throw new Error('Missing '+marker);
 const start=html.lastIndexOf(startTag,pos);return html.slice(0,start)+html.slice(findElementEnd(html,start,startTag.slice(1)));
}
