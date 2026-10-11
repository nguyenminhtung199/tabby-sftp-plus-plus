module.exports = function installSettingsControls({Settings,Decorator,bindings,formatBinding}){
 const action='sftp-plus-toggle-panel';
 Object.defineProperty(Settings.prototype,'customPanelToggleBindings',{get(){return bindings(this.configService?.store?.hotkeys).slice();},configurable:true});
 Settings.prototype.customToggleBindingLabel=function(binding){return (Array.isArray(binding)?binding:[binding]).flatMap(stroke=>String(stroke).split(' › ')).map(stroke=>stroke.replace(/^(?:(?:Ctrl|Alt|Shift|Meta|Cmd|Super|Win|Command|Option)-)+/,modifiers=>modifiers.replace(/-/g,'+'))).join(' › ');};
 Settings.prototype.customStartToggleRecording=function(index=-1){this._customToggleBindingIndex=index;this.startHotkeyRecording();};
 Settings.prototype._customMergeToggleBinding=function(binding){
  const list=this.customPanelToggleBindings,index=this._customToggleBindingIndex;
  if(Number.isInteger(index)&&index>=0&&index<list.length)list[index]=binding;else list.push(binding);
  return list.filter((value,i,all)=>all.findIndex(other=>formatBinding(other)===formatBinding(value))===i);
 };
 Settings.prototype.customRemoveToggleBinding=async function(index){
  const store=this.configService?.store;if(!store)return;
  this.cancelHotkeyRecording();const list=this.customPanelToggleBindings;
  if(index<0||index>=list.length)return;list.splice(index,1);
  (store.hotkeys ||= {})[action]=list;await this.configService.save();
 };
 // Read the live user setting before the upstream cached SFTPConfig service.
 Decorator.prototype._shouldHideNativeBtn=function(){
  const value=this.config?.store?.['tabby-sftp-plus']?.hideNativeSFTPButton;
  if(typeof value==='boolean')return value;
  try{return JSON.parse(localStorage.getItem('sftp-plus-settings.hideNativeBtn')||'false')===true;}catch{return false;}
 };
 const apply=Decorator.prototype._applyNativeBtnHideRule;
 Decorator.prototype._hideNativeBtnsOnce=function(toolbar){
  if(!this._shouldHideNativeBtn())return;
  this._customNativeButtons ||= new Map();
  const toolbars=toolbar?[toolbar]:[...new Set([...this._liveToolbars(),...document.querySelectorAll('terminal-toolbar, .terminal-toolbar')])];
  for(const bar of toolbars)for(const button of bar.querySelectorAll('button')){
   if(!this._isNativeSftpToolbarButton(button))continue;
   if(!this._customNativeButtons.has(button))this._customNativeButtons.set(button,{value:button.style.getPropertyValue('display'),priority:button.style.getPropertyPriority('display')});
   button.style.setProperty('display','none','important');button.setAttribute('data-sftp-plus-hidden-native','1');
  }
  for(const button of this._customNativeButtons.keys())if(button.isConnected===false)this._customNativeButtons.delete(button);
 };
 Decorator.prototype._applyNativeBtnHideRule=function(...args){
  if(!this._customNativeSettingsListener){
   this._customNativeSettingsListener=()=>this._applyNativeBtnHideRule();
   window.addEventListener('sftp-plus-settings-changed',this._customNativeSettingsListener);
  }
  const result=apply?.apply(this,args);
  if(this._shouldHideNativeBtn()){
   this._hideNativeBtnsOnce();
   if(!this._customNativeObserver&&typeof MutationObserver!=='undefined'&&document.body){
    this._customNativeObserver=new MutationObserver(records=>{
     const changed=records.some(record=>record.target.closest?.('terminal-toolbar, .terminal-toolbar')||Array.from(record.addedNodes||[]).some(node=>node.nodeType===1&&(node.matches?.('terminal-toolbar, .terminal-toolbar')||node.querySelector?.('terminal-toolbar, .terminal-toolbar'))));
     if(!changed||this._customNativeRefreshQueued)return;
     this._customNativeRefreshQueued=true;queueMicrotask(()=>{this._customNativeRefreshQueued=false;if(!this._customNativeDisposed&&this._shouldHideNativeBtn())this._hideNativeBtnsOnce();});
    });
    this._customNativeObserver.observe(document.body,{childList:true,subtree:true});
   }
  }else{
   this._customNativeObserver?.disconnect();this._customNativeObserver=null;
   for(const [button,old] of this._customNativeButtons||[]){if(old.value)button.style.setProperty('display',old.value,old.priority);else button.style.removeProperty('display');button.removeAttribute('data-sftp-plus-hidden-native');}
   this._customNativeButtons?.clear();
  }
  return result;
 };
 const attach=Decorator.prototype.attach;
 Decorator.prototype.attach=function(...args){const result=attach?.apply(this,args);this._applyNativeBtnHideRule();return result;};
 const destroy=Decorator.prototype.ngOnDestroy;
 Decorator.prototype.ngOnDestroy=function(...args){
  this._customNativeDisposed=true;this._customNativeObserver?.disconnect();
  if(this._customNativeSettingsListener)window.removeEventListener('sftp-plus-settings-changed',this._customNativeSettingsListener);
  this._hideStyleEl?.remove();
  for(const [button,old] of this._customNativeButtons||[]){if(old.value)button.style.setProperty('display',old.value,old.priority);else button.style.removeProperty('display');button.removeAttribute('data-sftp-plus-hidden-native');}
  this._customNativeButtons?.clear();
  this._clearHideNativeTimers?.();return destroy?.apply(this,args);
 };
};
