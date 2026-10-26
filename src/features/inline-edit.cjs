module.exports = function installInlineEdit({apis,Panel,FilePane,Angular}) {
 const open=apis.Panel.openInputDialog,cancel=apis.Panel.cancelInputDialog,confirm=apis.Panel.confirmInputDialog;
 let sequence=0;
 Object.defineProperty(apis.Panel,'customInlineOwner',{get(){return this;},configurable:true});
 apis.Panel._customInlineUpdate=function(patch){if(this._customInlineEdit)this._customInlineEdit={...this._customInlineEdit,...patch};this._safeDetect?.();};
 apis.Panel.customInlineCancel=function(){this._customInlineEdit=null;cancel.call(this);this._safeDetect?.();};
 apis.Panel.openInputDialog=function(mode,title,placeholder,value,target,remote){
  if(this._inputBusy)return;
  if(!/^(local|remote)-(mkdir|touch|rename)$/.test(mode)){this.customInlineCancel();return open.apply(this,arguments);}
  const pane=mode.split('-')[0],rename=mode.endsWith('rename');
  if(pane==='remote'&&!this.connected)return;
  open.apply(this,arguments);this.inputDialogVisible=false;
  const entry=rename?(pane==='local'?this.selectedLocal:this.selectedRemote)?.[0]:null;
  this._customInlineEdit={id:++sequence,mode,pane,title,value:value||'',originalPath:rename?(remote||target):null,isDirectory:mode.endsWith('mkdir')||!!entry?.isDirectory,folder:this[pane+'Path'],session:this.sftpSession,busy:false,error:''};
  this.activePane=pane;this._safeDetect?.();
 };
 apis.Panel.cancelInputDialog=function(...args){this._customInlineEdit=null;return cancel.apply(this,args);};
 apis.Panel.customInlineValue=function(value){this._customInlineUpdate({value,error:''});};
 apis.Panel.customInlineBlur=function(){
  const edit=this._customInlineEdit;if(!edit||edit.busy||this._inputBusy||this.operationError)return;
  if(!edit.value.trim()||edit.error){this.customInlineCancel();return;}
  return this.customInlineCommit();
 };
 apis.Panel.customInlineCommit=async function(){
  const edit=this._customInlineEdit;if(!edit||edit.busy||this._inputBusy)return;
  if(this._destroyed||this[edit.pane+'Path']!==edit.folder||(edit.pane==='remote'&&(!this.connected||this.sftpSession!==edit.session))){this.customInlineCancel();return;}
  if(!edit.value.trim()){this._customInlineUpdate({error:'Enter a name.',focusRevision:(edit.focusRevision||0)+1});this.showOperationError?.('Enter a name.');return;}
  // Preserve the existing name validation, collision checks, SSH operations and 0764 creation policy.
  this.inputDialogMode=edit.mode;
  this.inputDialogTargetPath=edit.mode.endsWith('rename')?(edit.pane==='local'?edit.originalPath:''):edit.folder;
  this.inputDialogRemotePath=edit.mode==='remote-rename'?edit.originalPath:null;
  this.inputDialogValue=edit.value;this._customInlineUpdate({busy:true,error:''});
  try{await confirm.call(this);}catch(error){if(this._customInlineEdit?.id===edit.id)this._customInlineUpdate({error:error.message||String(error)});}
  finally{if(this._customInlineEdit?.id===edit.id){const error=this._customInlineEdit.error||'Could not save this name. Try again or press Escape to cancel.';this._customInlineUpdate({busy:false,error,focusRevision:(edit.focusRevision||0)+1});if(this.showOperationError)this.showOperationError(edit.value+'\n'+error);else this.showToast?.(error);}else this._safeDetect?.();}
 };
 const destroy=apis.Panel.ngOnDestroy;
 apis.Panel.ngOnDestroy=function(...args){this._customInlineEdit=null;return destroy?.apply(this,args);};

 apis.FilePane.customInlineRename=function(entry){return !!this.customInlineEdit?.originalPath&&entry.fullPath===this.customInlineEdit.originalPath;};
 apis.FilePane.customInlineKey=function(event){event.stopPropagation();if(event.key==='Enter'){event.preventDefault();void this.customInlineOwner?.customInlineCommit();}else if(event.key==='Escape'){event.preventDefault();this.customInlineOwner?.customInlineCancel();}};
 const checked=apis.FilePane.ngAfterViewChecked;
 apis.FilePane.ngAfterViewChecked=function(...args){
  const result=checked?.apply(this,args),edit=this.customInlineEdit;
  const focusKey=edit&&edit.id+':'+(edit.focusRevision||0);
  if(!edit||edit.busy||this.customInlineOwner?.operationError||this._customInlineFocused===focusKey)return result;
  const input=this.hostRef?.nativeElement?.querySelector('.custom-inline-name');if(!input)return result;
  this._customInlineFocused=focusKey;
  const focus=()=>{if(this.customInlineEdit?.id!==edit.id||!input.isConnected)return;input.closest('.entry')?.scrollIntoView?.({block:'nearest'});input.focus();const dot=edit.value.lastIndexOf('.');input.setSelectionRange(0,edit.originalPath&&!edit.isDirectory&&dot>0?dot:edit.value.length);};
  const outside=this.customInlineOwner?.zone?.runOutsideAngular;
  const schedule=()=>{this._customInlineFocusTimer=setTimeout(focus,0);};outside?outside.call(this.customInlineOwner.zone,schedule):schedule();return result;
 };
 const paneDestroy=apis.FilePane.ngOnDestroy;
 apis.FilePane.ngOnDestroy=function(...args){clearTimeout(this._customInlineFocusTimer);return paneDestroy?.apply(this,args);};
};
