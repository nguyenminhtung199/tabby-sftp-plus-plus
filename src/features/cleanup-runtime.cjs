module.exports = function installCleanup({apis,Panel,Settings}){
 const cfg=o=>o.configService?.store?.['tabby-sftp-plus-plus'];
 const normalize=mode=>mode==='remember'?'remember':'off';
 const retired=['hideAuthorInfo','openUnsupportedInSystem','editableFileExtensions','allowViewEditAllFiles','allowEditAllFiles','allowViewAllAsText','showTextLineNumbers','textCaretShape','fileOpenAction','openInNewTabByDefault','singleWorkspaceInstance','rememberSessionFolders'];
 const removeKey=(object,key)=>{
  if(!object)return;
  // Tabby's ConfigProxy schema accessors are non-configurable. Never delete them.
  if(Object.getOwnPropertyDescriptor(object,key)?.configurable===false){object.__setValue?.(key,undefined);return;}
  delete object[key];
 };
 const clean=config=>{
  if(!config||typeof config!=='object')return config;
  const legacyRemember=config.rememberSessionFolders===true;
  if(legacyRemember&&config.defaultPathMode==='off')config.defaultPathMode='remember';
  if(config.defaultPathMode==='sync')config.defaultPathMode='off';
  if(config.pathModes)for(const key of Object.keys(config.pathModes))config.pathModes[key]=legacyRemember&&config.pathModes[key]==='off'?'remember':normalize(config.pathModes[key]);
  for(const key of retired)removeKey(config,key);
  for(const key of ['contextMenuOrder','contextMenuDisabled'])if(Array.isArray(config[key]))config[key]=config[key].filter(item=>item!=='viewFile');
  if(config.panelHotkeys)removeKey(config.panelHotkeys,'viewFile');
  return config;
 };
 apis.Settings._customCleanConfig=function(){return clean(cfg(this));};
 const save=apis.Settings._saveToConfig;
 apis.Settings._saveToConfig=function(...args){clean(cfg(this));return save?.apply(this,args);};
 const collect=apis.Settings.collectAllData;
 apis.Settings.collectAllData=function(...args){const data=collect?.apply(this,args);if(data){clean(data['tabby-sftp-plus-plus']||data);}return data;};
 const read=apis.Settings._readFromConfig;
 apis.Settings._readFromConfig=function(...args){clean(cfg(this));return read?.apply(this,args);};
 const load=apis.Panel.loadPathMode;
 apis.Panel.loadPathMode=function(...args){load?.apply(this,args);this.pathMode=normalize(this.pathMode);};
 const defaultMode=apis.Panel._readDefaultPathMode;
 apis.Panel._readDefaultPathMode=function(...args){return normalize(defaultMode?.apply(this,args));};
 apis.Panel.cyclePathMode=function(){return this.setPathMode(this.pathMode==='remember'?'off':'remember');};
 const setMode=apis.Panel.setPathMode;
 apis.Panel.setPathMode=function(mode){const result=setMode.call(this,normalize(mode));if(this.pathMode==='remember')this.saveCurrentPath();return result;};
 apis.Panel.saveCurrentPath=function(){if(this.pathMode!=='remember')return;if(this.localPath&&this.localPath===this._customLastLocalFolder)this._customRememberFolder('local',this.localPath);if(this.remotePath&&this.remotePath===this._customLastRemoteFolder)this._customRememberFolder('remote',this.remotePath);};
 apis.Panel.pathModeTitle=function(){return this.pathMode==='remember'?'Remember last folder':'Manual navigation';};
 apis.Panel._startCwdSync=function(){this._stopCwdSync?.();};
 apis.Settings.saveDefaultPathMode=function(){this.defaultPathMode=normalize(this.defaultPathMode);this._saveToConfig();this.notifyPanels();};
 // New-tab launch is retired, including cached preferences used by the legacy decorator.
 try{localStorage.setItem('sftp-plus-settings.openInNewTabByDefault','false');}catch{}
 const init=apis.Settings.ngOnInit;
 apis.Settings.ngOnInit=function(...args){const config=cfg(this);if(config)config.defaultPathMode=normalize(config.defaultPathMode);const result=init?.apply(this,args);this.defaultPathMode=normalize(this.defaultPathMode);return result;};
};
