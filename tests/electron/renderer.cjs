const {ipcRenderer}=require('electron'),path=require('path'),fs=require('fs'),Module=require('module'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),cfg=require('../test-policy.json').renderer;
(async()=>{try{
 require('reflect-metadata');require('zone.js');require('@angular/compiler');
 const Angular=require('@angular/core'),Common=require('@angular/common'),Forms=require('@angular/forms'),Browser=require('@angular/platform-browser'),Dynamic=require('@angular/platform-browser-dynamic');
 class CoreModule{}Angular.NgModule({})(CoreModule);
 const generic=new Proxy({__esModule:true,default:CoreModule},{get:(target,key)=>key in target?target[key]:(target[key]=class{})});
 const load=Module._load;Module._load=function(name,...args){if(name.startsWith('tabby-'))return generic;return load.call(this,name,...args);};
 let plugin;try{plugin=require(process.env.SFTP_TEST_BUNDLE_PATH||path.join(root,'dist','index.js'));}finally{Module._load=load;}
 const platform=Dynamic.platformBrowserDynamic();const compiled=platform.injector.get(Angular.CompilerFactory).createCompiler().compileModuleAndAllComponentsSync(plugin.default);assert.equal(compiled.componentFactories.length,16,'all plugin component factories compile in the target renderer');
 const {FilePane,Menu,LogDialog,TransferLogService,Panel,PanelRubberBand,computeSelection,setDateFormatPattern}=plugin.testing;const events=[];
 class Host{constructor(){this.entry={name:'sample.py',fullPath:'/sample.py',isDirectory:false,size:1};this.entries=[this.entry];this.edit={id:1,mode:'remote-rename',pane:'remote',folder:'/',originalPath:'/sample.py',value:'sample.py',isDirectory:false,title:'Rename',busy:false,error:''};this.i18n={t:(key)=>key,getLocale:()=> 'en-US'};this.owner={zone:{runOutsideAngular:fn=>globalThis.Zone.root.run(fn)},customInlineValue:value=>{this.edit={...this.edit,value};},customInlineCommit:()=>{if(this.edit){events.push('commit:'+this.edit.value);this.edit=null;}},customInlineCancel:()=>{events.push('cancel');this.edit=null;}};this.menuEvents=[];this.showLog=false;this.logEntries=[];this.logOwner={customEditRows:[{status:'Editing'}],customHistoryRecoveryRows:[],customLogTransfer:()=>null};this.dual=false;this.otherEntries=[];this.selection=[];this.otherSelection=[];this.isSelected=e=>this.selection.includes(e);this.otherSelected=e=>this.otherSelection.includes(e);this.revision=0;this.otherRevision=0;this.transientMenu=false;this.scrollCount=0;this.scrollZones=[];this.wheelCount=0;this.wheelZones=[];this.consumeWheel=false;this.onScroll=()=>{this.scrollCount++;this.scrollZones.push(Angular.NgZone.isInAngularZone());};this.onWheel=event=>{this.wheelCount++;this.wheelZones.push(Angular.NgZone.isInAngularZone());if(this.consumeWheel)event.preventDefault();};this.groups=null;this.navKey=null;this.folder='/';this.filter='';this.clicks=[];this.actions=[];}}
 Angular.Component({selector:'fixture-root',template:fs.readFileSync(path.join(__dirname,'host.html'),'utf8')})(Host);
 class FixtureModule{}Angular.NgModule({imports:[Browser.BrowserModule,Common.CommonModule,Forms.FormsModule],declarations:[Host,FilePane,Menu,LogDialog],bootstrap:[Host]})(FixtureModule);
 const module=await platform.bootstrapModule(FixtureModule),app=module.injector.get(Angular.ApplicationRef),host=app.components[0].instance;
 await new Promise(resolve=>setTimeout(resolve,cfg.settleMs));
 let input=document.querySelector('.custom-inline-name');assert.ok(input,'real Angular template must render inline name input');assert.equal(document.activeElement,input);assert.equal(input.selectionEnd,6,'basename selection preserves extension');
 input.value='changed.py';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));app.tick();assert.deepEqual(events,['commit:changed.py']);assert.equal(document.querySelector('.custom-inline-name'),null);
 host.edit={id:2,mode:'remote-touch',pane:'remote',folder:'/',originalPath:null,value:'',isDirectory:false,title:'New file',busy:false,error:''};app.tick();await new Promise(resolve=>setTimeout(resolve,cfg.focusMs));input=document.querySelector('.custom-inline-name');assert.ok(input);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));app.tick();assert.equal(events.at(-1),'cancel');assert.equal(document.querySelector('.custom-inline-name'),null);
 const items=[...document.querySelectorAll('.ctx-item')];const openWith=items.find(e=>e.textContent.includes('Open with'));assert.ok(openWith,'native-app chooser action must render');openWith.dispatchEvent(new MouseEvent('click',{bubbles:true}));assert.ok(host.menuEvents.includes('openWith'));
 const pane=Angular.getDebugNode(document.querySelector('sftp-file-pane')).componentInstance;
 const timings=[];
 for(const count of cfg.largeLists.sizes){
  const start=performance.now();host.navKey=null;host.entries=Array.from({length:count},(_,i)=>({name:'file'+i+'.txt',fullPath:'/file'+i+'.txt',isDirectory:false}));app.tick();
  const elapsed=performance.now()-start;timings.push({count,renderMs:Math.round(elapsed)});
  assert.ok(document.querySelectorAll('.entry[data-path]').length<=cfg.largeLists.maxPageRows);
  assert.ok(elapsed<cfg.largeLists.maxInteractionMs,'initial list must remain responsive: '+elapsed);
  const list=document.querySelector('.pane-list');const target=host.entries.at(-1);
  const jumpStart=performance.now();list.sftpRevealRow('data-path',target.fullPath);app.tick();
  assert.ok(document.querySelector('[data-path="'+target.fullPath+'"]'),'keyboard bridge reveals off-page target');
  assert.ok(performance.now()-jumpStart<cfg.largeLists.maxInteractionMs);
  let row=document.querySelector('[data-path="'+target.fullPath+'"]');row.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));
  assert.equal(host.clicks.at(-1).index,count-1,'Shift uses absolute full-model index');
  const range=computeSelection([host.entries[0]],target,{shiftKey:true},host.clicks.at(-1).index,0,host.entries,new Set([host.entries[0].fullPath]));assert.equal(range.selection.length,count,'Shift includes off-page entries');
  for(const type of ['dblclick','contextmenu','dragstart'])row.dispatchEvent(new MouseEvent(type,{bubbles:true}));
  list.dispatchEvent(new Event('drop',{bubbles:true}));assert.deepEqual(host.actions.slice(-4),['open','context','drag','drop']);
  host.navKey=host.entries[0].fullPath;app.tick();assert.equal(pane.listPage,0);
  pane.changeListPage(1);app.tick();assert.equal(pane.listPage,1,'page clicks do not bounce back to old keyboard focus');
  host.edit={id:count,originalPath:target.fullPath,value:target.name,isDirectory:false};app.tick();
  await new Promise(resolve=>setTimeout(resolve,cfg.focusMs));assert.equal(document.activeElement,document.querySelector('.custom-inline-name'));
  const lockedPage=pane.listPage;pane.changeListPage(0);assert.equal(pane.listPage,lockedPage,'rename keeps input mounted');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));app.tick();
  host.folder='/folder'+count;app.tick();assert.equal(pane.listPage,0,'folder change resets page');
  await new Promise(resolve=>requestAnimationFrame(resolve));
 }
 const full=host.entries;
 host.groups=[{kind:'header',bucketKey:'files',label:'Files',count:full.length,items:full,collapsed:false},...full.map((entry,index)=>({kind:'entry',entry,index}))];app.tick();
 pane.changeListPage(1);app.tick();assert.ok(document.querySelector('[data-group-key="files"]'),'continued group retains its header');
 assert.ok(document.querySelectorAll('.entry[data-path]').length<=cfg.largeLists.maxPageRows);
 const groupedRow=document.querySelector('.entry[data-path]');groupedRow.dispatchEvent(new MouseEvent('click',{bubbles:true}));assert.equal(host.clicks.at(-1).index,199);
 document.querySelector('[data-group-key="files"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));assert.equal(host.actions.at(-1),'group');
 host.groups=[{kind:'header',bucketKey:'files',label:'Files',count:full.length,items:full,collapsed:true}];app.tick();assert.equal(document.querySelectorAll('.entry[data-path]').length,0);
 host.groups=null;host.entries=[];app.tick();assert.equal(pane.listPageCount,1);
 // Ctrl rubber-band merges visible hits with selection on other pages, for both panes.
 for(const side of ['local','remote']){
  const h={selectedLocal:[],selectedRemote:[],getFilteredLocalEntries:()=>full,getFilteredRemoteEntries:()=>full};
  h[side==='local'?'selectedLocal':'selectedRemote']=[full[0]];const rb=new PanelRubberBand(h);
  rb.rubberBand.pane=side;rb._rbOffPageSelected=[full[0]];rb._rbElPaths=[full[250].fullPath];rb[side==='local'?'_rbCachedLocalEntries':'_rbCachedRemoteEntries']=full;
  rb._rbSyncSelectionModel(new Set([0]));assert.deepEqual(h[side==='local'?'selectedLocal':'selectedRemote'],[full[0],full[250]]);
 }
 // Filter/sort must keep the whole model and avoid eagerly formatting columns.
 const model=Object.create(Panel.prototype);Object.assign(model,{localEntries:full,showHiddenLocal:true,localFilter:'',localSortBy:'name',localSortAsc:true,pinFoldersLocal:true,_localFilterDirty:true});
 let calls=0;Object.assign(model,{cellEpoch:0,cellCache:new WeakMap(),colValue:(col,e)=>{calls++;return col+':'+e.name;}});
 const sample=full[0];assert.equal(model.cachedColumnValue('size',sample),model.cachedColumnValue('size',sample));assert.equal(calls,1);
 model._invalidateLocalCache();model.cachedColumnValue('size',sample);assert.equal(calls,2);
 setDateFormatPattern('YYYY');model.cachedColumnValue('size',sample);assert.equal(calls,3);setDateFormatPattern('');
 const filtered=model.getFilteredLocalEntries();assert.equal(filtered.length,full.length);assert.ok(!filtered[0]._cells);model.localFilter='file49999';model._invalidateLocalCache();assert.equal(model.getFilteredLocalEntries().length,1);
 // Two simultaneously mounted panes must skip unrelated app ticks and sibling actions.
 host.entries=full;host.otherEntries=full.map(e=>({...e,fullPath:'/remote'+e.fullPath}));host.dual=true;app.tick();
 const localEl=document.querySelector('sftp-file-pane'),remoteEl=document.querySelectorAll('sftp-file-pane')[1];
 const remotePane=Angular.getDebugNode(remoteEl).componentInstance;
 const selectionCalls={local:0,remote:0};host.isSelected=e=>{selectionCalls.local++;return host.selection.includes(e);};host.otherSelected=e=>{selectionCalls.remote++;return host.otherSelection.includes(e);};app.tick();
 selectionCalls.local=0;selectionCalls.remote=0;
 for(let i=0;i<cfg.dualPane.idleTicks;i++)app.tick();
 assert.deepEqual(selectionCalls,{local:0,remote:0},'unrelated terminal/transfer ticks skip both stable file lists');
 host.selection=[full[0]];app.tick();assert.ok(localEl.querySelector('[data-path="'+full[0].fullPath+'"]').classList.contains('selected'));
 assert.equal(selectionCalls.remote,0,'local selection does not recheck remote rows');
 host.selection=[full[1]];app.tick();assert.ok(!localEl.querySelector('[data-path="'+full[0].fullPath+'"]').classList.contains('selected'));assert.ok(localEl.querySelector('[data-path="'+full[1].fullPath+'"]').classList.contains('selected'),'same-count selection still updates');
 selectionCalls.local=0;selectionCalls.remote=0;
 remotePane.changeListPage(1);app.tick();assert.equal(selectionCalls.local,0,'remote page action does not recheck local rows');
 const nativeList=localEl.querySelector('.pane-list');const beforeScroll={...selectionCalls};
 for(let i=0;i<cfg.dualPane.scrollEvents;i++){nativeList.dispatchEvent(new Event('scroll'));nativeList.dispatchEvent(new WheelEvent('wheel',{deltaY:1,bubbles:true,cancelable:true}));}
 assert.equal(host.scrollCount,0,'ordinary scroll does not emit Angular output');assert.equal(host.wheelCount,cfg.dualPane.scrollEvents,'wheel hotkey handler still receives every wheel');
 assert.deepEqual(selectionCalls,beforeScroll,'ordinary wheel and scroll do not recheck either file list');assert.ok(host.wheelZones.every(z=>z===false),'wheel callbacks run outside Angular');
 host.transientMenu=true;app.tick();nativeList.dispatchEvent(new Event('scroll'));assert.equal(host.scrollCount,1,'scroll closes an open context menu');assert.deepEqual(host.scrollZones,[true]);
 host.consumeWheel=true;const wheel=new WheelEvent('wheel',{deltaY:1,cancelable:true});nativeList.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,true,'wheel shortcut retains cancellation');
 const remoteCalls=selectionCalls.remote;full[0].name='metadata-refreshed.txt';host.revision++;app.tick();assert.ok(localEl.querySelector('[data-path="'+full[0].fullPath+'"] .name').textContent.includes('metadata-refreshed.txt'));assert.equal(selectionCalls.remote,remoteCalls,'local cell invalidation is independent of remote pane input');
 host.dual=false;app.tick();assert.equal(remoteEl.querySelector('.pane-list').sftpRevealRow,undefined,'destroy releases native bridge');
 // Only upload/download filters and badges, including legacy editor-origin logs.
 host.logEntries=[{id:'legacy-up',operation:'edit-upload',localPath:'/tmp/a',remotePath:'/a',success:true,timestamp:Date.now()},{id:'legacy-down',operation:'edit-download',localPath:'/tmp/a',remotePath:'/a',success:true,timestamp:Date.now()}];host.showLog=true;app.tick();
 const logEl=document.querySelector('sftp-transfer-log-dialog');assert.deepEqual([...logEl.querySelector('select').options].map(o=>o.value),['','upload','download']);
 assert.deepEqual([...logEl.querySelectorAll('.log-op-badge')].map(e=>e.textContent.trim()),['transfer.upload','transfer.download']);assert.ok(!logEl.textContent.includes('Editing'));
 host.logEntries=[];app.tick();assert.ok(logEl.querySelector('.log-empty'),'an idle save watcher must not hide the empty transfer history');
 const logs=new TransferLogService();logs.logs=logs._sanitizeIds([{id:'u',operation:'edit-upload',timestamp:Date.now(),success:true},{id:'d',operation:'edit-download',timestamp:Date.now(),success:true}]);
 assert.equal(logs.filter({operation:'upload'}).length,1);assert.equal(logs.filter({operation:'download'}).length,1);assert.equal(logs.add({operation:'edit-upload',localPath:'/local',remotePath:'/remote',success:true}).operation,'upload');
 const panelTemplate=fs.readFileSync(path.join(root,'src/sftp/sftp-floating-panel.component.view.html'),'utf8');assert.ok(!panelTemplate.includes('customEditRows'),'no Editing ledger in panel template');
 // Real inline controller: failed rename reports the native reason, refocuses and can be dismissed.
 const renameModel=Object.create(Panel.prototype),renameEntry={name:'sample.py',fullPath:'/sample.py',isDirectory:false};
 Object.assign(renameModel,{remotePath:'/',connected:true,selectedRemote:[renameEntry],selectedLocal:[],i18n:host.i18n,zone:module.injector.get(Angular.NgZone),_safeDetect:()=>app.tick(),showToast:message=>{renameModel.toastMessage=message;},refreshRemote:async()=>{},sftpSession:{readdir:async()=>[renameEntry],rename:async()=>{throw Error('Permission denied: renderer rename fixture');}}});
 host.showLog=false;host.entries=[renameEntry];host.groups=null;host.owner=renameModel;Object.defineProperty(host,'edit',{get:()=>renameModel._customInlineEdit,set:value=>{renameModel._customInlineEdit=value;},configurable:true});
 renameModel.remoteRename();await new Promise(resolve=>setTimeout(resolve,cfg.focusMs));input=document.querySelector('.custom-inline-name');input.value='renamed.py';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,cfg.focusMs));app.tick();input=document.querySelector('.custom-inline-name');assert.equal(renameModel._customInlineEdit.error,'Permission denied: renderer rename fixture');assert.equal(renameModel.toastMessage,renameModel._customInlineEdit.error);assert.equal(document.activeElement,input);assert.equal(input.disabled,false);assert.equal(input.readOnly,false);assert.equal(document.querySelector('.custom-inline-error'),null,'errors must not create an undismissable paragraph below the name');
 document.querySelector('.custom-inline-cancel').dispatchEvent(new MouseEvent('click',{bubbles:true}));app.tick();assert.equal(renameModel._customInlineEdit,null);
 renameModel.toastMessage='dismiss me';renameModel.toastTimer=null;renameModel.dismissToast();assert.equal(renameModel.toastMessage,'');
 const timingSummary=' Timings '+JSON.stringify(timings);
 module.destroy();ipcRenderer.send('fixture:result',{ok:true,message:timingSummary+' Electron '+process.versions.electron+' / Angular '+Angular.VERSION.full+' render: 16 component factories, inline focus, basename selection, Enter, Escape, Open with menu, 1k/10k/50k bounded lists, cross-page navigation/rename, absolute Shift index, group collapse, drag/drop outputs and selection merge; dual-pane idle ticks skip rows and scroll/wheel stay outside Angular; history has only Upload/Download and no Editing ledger; failed rename exposes native error, restores focus and has a close button.'});
}catch(error){ipcRenderer.send('fixture:result',{ok:false,message:error.stack||String(error)});}})();
