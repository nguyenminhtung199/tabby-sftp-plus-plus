module.exports = function installInlineEdit({Panel,FilePane,Angular}) {
 const open=Panel.prototype.openInputDialog,cancel=Panel.prototype.cancelInputDialog,confirm=Panel.prototype.confirmInputDialog;
 let sequence=0;
 Object.defineProperty(Panel.prototype,'customInlineOwner',{get(){return this;},configurable:true});
 Panel.prototype._customInlineUpdate=function(patch){if(this._customInlineEdit)this._customInlineEdit={...this._customInlineEdit,...patch};this._safeDetect?.();};
 Panel.prototype.customInlineCancel=function(){if(this._inputBusy)return;this._customInlineEdit=null;cancel.call(this);this._safeDetect?.();};
 Panel.prototype.openInputDialog=function(mode,title,placeholder,value,target,remote){
  if(this._inputBusy)return;
  if(!/^(local|remote)-(mkdir|touch|rename)$/.test(mode)){this.customInlineCancel();return open.apply(this,arguments);}
  const pane=mode.split('-')[0],rename=mode.endsWith('rename');
  if(pane==='remote'&&!this.connected)return;
  open.apply(this,arguments);this.inputDialogVisible=false;
  const entry=rename?(pane==='local'?this.selectedLocal:this.selectedRemote)?.[0]:null;
  this._customInlineEdit={id:++sequence,mode,pane,title,value:value||'',originalPath:rename?(remote||target):null,isDirectory:mode.endsWith('mkdir')||!!entry?.isDirectory,folder:this[pane+'Path'],session:this.sftpSession,busy:false,error:''};
  this.activePane=pane;this._safeDetect?.();
 };
 Panel.prototype.cancelInputDialog=function(...args){this._customInlineEdit=null;return cancel.apply(this,args);};
 Panel.prototype.customInlineValue=function(value){this._customInlineUpdate({value,error:''});};
 Panel.prototype.customInlineCommit=async function(){
  const edit=this._customInlineEdit;if(!edit||edit.busy||this._inputBusy)return;
  if(this._destroyed||this[edit.pane+'Path']!==edit.folder||(edit.pane==='remote'&&(!this.connected||this.sftpSession!==edit.session))){this.customInlineCancel();return;}
  if(!edit.value.trim()){this._customInlineUpdate({error:'Enter a name.'});return;}
  // Preserve the existing name validation, collision checks, SSH operations and 0764 creation policy.
  this.inputDialogValue=edit.value;this._customInlineUpdate({busy:true,error:''});
  try{await confirm.call(this);}finally{if(this._customInlineEdit?.id===edit.id)this._customInlineUpdate({busy:false,error:this._customInlineEdit.error||'Could not save this name. Check the notification and try again.'});else this._safeDetect?.();}
 };
 const destroy=Panel.prototype.ngOnDestroy;
 Panel.prototype.ngOnDestroy=function(...args){this._customInlineEdit=null;return destroy?.apply(this,args);};
 Angular.Input()(FilePane.prototype,'customInlineEdit');Angular.Input()(FilePane.prototype,'customInlineOwner');
 FilePane.prototype.customInlineRename=function(entry){return !!this.customInlineEdit?.originalPath&&entry.fullPath===this.customInlineEdit.originalPath;};
 FilePane.prototype.customInlineKey=function(event){event.stopPropagation();if(event.key==='Enter'){event.preventDefault();void this.customInlineOwner?.customInlineCommit();}else if(event.key==='Escape'){event.preventDefault();this.customInlineOwner?.customInlineCancel();}};
 const checked=FilePane.prototype.ngAfterViewChecked;
 FilePane.prototype.ngAfterViewChecked=function(...args){
  const result=checked?.apply(this,args),edit=this.customInlineEdit;
  if(!edit||this._customInlineFocused===edit.id)return result;
  const input=this.hostRef?.nativeElement?.querySelector('.custom-inline-name');if(!input)return result;
  this._customInlineFocused=edit.id;
  const focus=()=>{if(this.customInlineEdit?.id!==edit.id||!input.isConnected)return;input.closest('.entry')?.scrollIntoView?.({block:'nearest'});input.focus();const dot=edit.value.lastIndexOf('.');input.setSelectionRange(0,edit.originalPath&&!edit.isDirectory&&dot>0?dot:edit.value.length);};
  const outside=this.customInlineOwner?.zone?.runOutsideAngular;
  const schedule=()=>{this._customInlineFocusTimer=setTimeout(focus,0);};outside?outside.call(this.customInlineOwner.zone,schedule):schedule();return result;
 };
 const paneDestroy=FilePane.prototype.ngOnDestroy;
 FilePane.prototype.ngOnDestroy=function(...args){clearTimeout(this._customInlineFocusTimer);return paneDestroy?.apply(this,args);};
};
