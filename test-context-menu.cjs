const terminalPolicy=require('./transfer-policy.json').terminalCommands;
const terminalEnvelope=command=>terminalPolicy.park+command+terminalPolicy.submit+terminalPolicy.restore;
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const pluginRequire=createRequire(path.resolve(__dirname,'package.json'));
const generic=new Proxy({}, {get:(_,key)=>key==='__esModule'?true:class{}});
const releaseListeners=new Map();
const document={addEventListener(name,callback,capture=false){if(name==='mouseup')releaseListeners.set(callback,capture);},removeEventListener(name,callback,capture=false){if(name==='mouseup'){assert.equal(releaseListeners.get(callback),capture,'release cleanup matches capture flag');releaseListeners.delete(callback);}},elementFromPoint:()=>null};
let spawnMock;
const sandbox={module:{exports:{}},exports:{},console,Buffer,process:{...process,env:{...process.env,APPDATA:path.join(__dirname,'test-fixtures','context-ui-unused')}},setTimeout,clearTimeout,setInterval,clearInterval,CompositionEvent:class{},FocusEvent:class{},ClipboardEvent:class{},Event:class{},KeyboardEvent:class{},MouseEvent:class{},WheelEvent:class{},DragEvent:class{},HTMLElement:class{},Element:class{},window:{},document,localStorage:{getItem:()=>null,setItem(){}},require(name){if(name==='child_process')return new Proxy(pluginRequire(name),{get(target,key){if(key==='spawn')return (...args)=>spawnMock?spawnMock(...args):target.spawn(...args);return target[key];}});if(name==='@angular/core')return pluginRequire(name);if(name.startsWith('tabby-')||['@angular/common','@angular/forms'].includes(name))return generic;if(name==='electron')return {shell:{openPath:async()=>''}};return pluginRequire(name);}};
sandbox.global=sandbox;vm.runInNewContext(fs.readFileSync(process.env.SFTP_TEST_BUNDLE_PATH||path.join(__dirname,'dist/index.js'),'utf8').replace('const so=to;','globalThis.__testRubberBand=qt;globalThis.__testFileDnd=Jt;const so=to;'),sandbox);
if(sandbox.module.exports.testing){sandbox.__testRubberBand=sandbox.module.exports.testing.PanelRubberBand;sandbox.__testFileDnd=sandbox.module.exports.testing.PanelFileDnd;}
const classes=sandbox.module.exports.default.__annotations__[0].declarations;
const Panel=classes.find(c=>c.prototype._customExternalEdit),Menu=classes.find(c=>c.__annotations__?.[0]?.selector==='sftp-context-menu');
const template=Menu.__annotations__[0].template;
const parsed=pluginRequire('@angular/compiler').parseTemplate(template,'context-menu.html');assert.ok(!parsed.errors?.length,JSON.stringify(parsed.errors));
assert.ok(Panel.__prop__metadata__.customContextMouseUp.some(a=>a.eventName==='mouseup'));
const actions=[...template.matchAll(/\(click\)="([^"]*\.emit\([^"]*)"/g)].map(m=>m[1]);assert.ok(actions.length>5);
for(const handler of actions)assert.ok(handler.indexOf('$event.stopPropagation()')<handler.indexOf('.emit('),'stop before any output removes menu');
const click=actions.find(h=>h.includes('menuAction.emit(a)'));
function event(button=0,menu=false){return {button,ctrlKey:false,target:{closest:()=>menu?{}:null},cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;}};}
function panel(){const p=Object.create(Panel.prototype);Object.assign(p,{contextMenuPane:'remote',contextMenuEntry:{name:'chosen.py',fullPath:'/chosen.py'},contextMenuVisible:true,selectedRemote:[{name:'chosen.py',fullPath:'/chosen.py'}],selectedLocal:[],localPath:'C:/target',connected:true,sftpSession:{},_conflictQueue:[],zone:{runOutsideAngular:fn=>fn()},_safeDetect(){},showToast(message){this.toast=message;},_handlePanelPointerFocus(){},refreshLocal:async()=>{p.refreshed=true;},i18n:{t:s=>s},isDirByMode:()=>false});return p;}
(async()=>{
 const p=panel();let nativeMenu=0,edit=0,inClick=false,pending;
 p._customExternalEdit=async entry=>{assert.equal(inClick,false);assert.equal(p.contextMenuVisible,false);assert.equal(entry.fullPath,'/chosen.py');edit++;};
 const e=event(2);p.onPanelMouseDown(e);if(!e.cancelBubble)nativeMenu++;const up=event(2);p.customContextMouseUp(up);if(!up.cancelBubble)nativeMenu++;assert.equal(nativeMenu,0,'right down/up cannot reach Tabby menu/paste');

 // Run the real rubber-band controller with a release that the panel blocks.
 const list={scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0}),removeEventListener(){}};
 const host={zone:{runOutsideAngular:fn=>fn(),run:fn=>fn()},selectedLocal:[],selectedRemote:[],closeContextMenu(){},closeBookmarks(){},cdr:{detectChanges(){}},syncPaneSelectionVisual(){},fixContextMenuPosition(){}};
 const band=new sandbox.__testRubberBand(host);let removed=0,selectedFinal=0;
 const start=event(2);start.clientX=20;start.clientY=30;start.target.closest=selector=>selector==='.pane-list'?list:null;
 band.onPaneMouseDown(start,'remote');assert.equal(releaseListeners.size,1);
 band.rubberBand.active=true;band._rbMoved=true;band._rbRectEl={remove(){removed++;}};
 band._rbApplySelectionFromRect=()=>selectedFinal++;
 const release=event(2);release.clientX=30;release.clientY=50;
 // Document capture runs first, even when the panel blocks the bubble phase.
 for(const [callback,capture] of [...releaseListeners])if(capture)callback(release);
 p.customContextMouseUp(release);
 for(const [callback,capture] of [...releaseListeners])if(!capture&&!release.cancelBubble)callback(release);
 assert.equal(release.cancelBubble,true);assert.equal(band.active,false);assert.equal(removed,1);assert.equal(selectedFinal,1);assert.equal(releaseListeners.size,0);assert.equal(host.contextMenuVisible,true,'right-drag still opens selection menu');
 band.clearContextMenuSuppress();
 // Left dragging and a stationary right click also unregister the release hook.
 for(const button of [0,2]){
  const press=event(button);press.clientX=20;press.clientY=30;press.buttons=button===0?1:2;press.target.closest=selector=>selector==='.pane-list'?list:null;
  band.onPaneMouseDown(press,'remote');
  if(button===0){band.rubberBand.active=true;band._rbMoved=true;band._rbRectEl={remove(){removed++;}};}
  const finish=event(button);finish.clientX=30;finish.clientY=50;
  for(const [callback,capture] of [...releaseListeners])if(capture)callback(finish);
  p.customContextMouseUp(finish);assert.equal(band.active,false);assert.equal(releaseListeners.size,0);band.clearContextMenuSuppress();
 }

 const normal=event();p.onPanelMouseDown(normal);assert.equal(normal.cancelBubble,false,'normal file selection remains intact');
 const selected=event(0,true);inClick=true;new Function('$event','menuAction','a',click)(selected,{emit:a=>{pending=p.onContextMenuAction(a);}},'editFile');inClick=false;if(!selected.cancelBubble)nativeMenu++;assert.equal(edit,0,'menu action waits until click returns');
 p.contextMenuPane='local';p.contextMenuEntry={fullPath:'/wrong'};await pending;assert.equal(edit,1);assert.equal(nativeMenu,0);
 // Double-click still calls the same local-edit implementation directly.
 await p._activateEntry('remote',{fullPath:'/chosen.py',mode:420},{});assert.equal(edit,2);
 const q=panel();q.selectedRemote[0].isDirectory=true;const files=[];let target,pickerOpened=0,acceptPicker;
 q.injector={get:()=>({pickDirectory:()=>{assert.equal(q.contextMenuVisible,false);pickerOpened++;return new Promise(resolve=>{acceptPicker=resolve;});}})};
 q._ensureTransferTargetDir=async(direction,dir)=>{assert.equal(direction,'download');target=dir;return dir;};q._streamDownloadOne=async(entry,dir)=>{assert.equal(q.contextMenuVisible,false);files.push(entry.fullPath);assert.equal(dir,'C:/picked');};q._showConflictDialog=()=>{q.conflictShown=true;};q._conflictQueue.push({});
 const download=q.onContextMenuAction('download');q.selectedRemote=[];q.localPath='C:/different';q.contextMenuPane='local';
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(pickerOpened,1);assert.equal(files.length,0,'no download until folder selected');acceptPicker('C:/picked');
 await download;assert.deepEqual(files,['/chosen.py']);assert.equal(target,'C:/picked');assert.equal(q.refreshed,true);assert.equal(q.conflictShown,true);
 for(const outcome of ['cancel','destroy','error']){
  const cancelled=panel();cancelled.selectedRemote[0].isDirectory=true;let transfers=0;cancelled._streamDownloadOne=()=>transfers++;
  cancelled.injector={get:()=>({pickDirectory:async()=>{if(outcome==='error')throw Error('picker failed');if(outcome==='destroy'){cancelled._destroyed=true;return 'C:/picked';}return '';}})};
  assert.equal(await cancelled.onContextMenuAction('download'),false);assert.equal(transfers,0);
  if(outcome==='error')assert.match(cancelled.toast,/picker failed/);
 }
 const local=panel();local.contextMenuPane='local';let localOpened=0;
 local._openPathInSystem=async name=>{assert.equal(name,'/chosen.py');localOpened++;};
 await local.onContextMenuAction('editFile');assert.equal(localOpened,1,'local menu uses local double-click path');
 const double=panel();let invoked=0;double._activateEntry=async()=>{invoked++;return 'finished';};
 assert.equal(await double.onRemoteEntryDblClick({},event()),'finished');assert.equal(invoked,1);
 double.connected=false;await double.onRemoteEntryDblClick({},event());assert.equal(invoked,1,'disconnected remote double-click is ignored');
 const failing=panel();failing._activateEntry=async()=>{throw Error('fixture failure');};assert.equal(await failing.onContextMenuAction('editFile'),false);assert.match(failing.toast,/fixture failure/);
 // Direct context commands share the same deferred, guarded implementation.
 const single=panel();single._openOnClick='single';let singleOpened=0;
 single._activateEntry=async(pane,entry)=>{assert.equal(pane,'remote');assert.equal(entry.fullPath,'/chosen.py');singleOpened++;};
 single.remoteClickTimer=setTimeout(()=>{throw Error('pending click must be cancelled');},1000);
 await single.ctxEditFile();assert.equal(singleOpened,1);assert.equal(single.remoteClickTimer,null);
 const direct=panel();direct.selectedRemote[0].isDirectory=true;let directTransfers=0;
 direct.injector={get:()=>({pickDirectory:async()=>''})};direct._streamDownloadOne=()=>directTransfers++;
 assert.equal(await direct.ctxDownload(),false);assert.equal(directTransfers,0,'direct Download also waits for a folder');
 const switched=panel();switched.selectedRemote[0].isDirectory=true;let switchedTransfers=0;
 switched.injector={get:()=>({pickDirectory:async()=>{switched.sftpSession={};return 'C:/picked';}})};
 switched._streamDownloadOne=()=>switchedTransfers++;
 assert.equal(await switched.ctxDownload(),false);assert.equal(switchedTransfers,0,'reconnection during folder choice cancels the old selection');
 const late=panel();late._ensureTransferTargetDir=async()=>{late.connected=false;return 'C:/picked';};
 late._streamDownloadOne=()=>{throw Error('download must not start after disconnect');};
 assert.equal(await late.ctxDownload(late.selectedRemote,'C:/picked'),false);
 const brokenToast=panel();brokenToast._activateEntry=async()=>{throw Error('edit failed');};brokenToast.showToast=()=>{throw Error('view already disposed');};
 assert.equal(await brokenToast.ctxEditFile(),false,'notification failure cannot reject the deferred timer');
 const serial=panel();const order=[];let scanning=false;
 serial._ensureTransferTargetDir=async()=> 'C:/picked';
 serial._streamDownloadOne=async entry=>{assert.equal(scanning,false,'native entry scans do not overlap');scanning=true;await new Promise(resolve=>setTimeout(resolve,1));order.push(entry.fullPath);scanning=false;};
 assert.equal(await serial.ctxDownload([{fullPath:'/first'},{fullPath:'/second'}],'C:/picked'),true);
 assert.deepEqual(order,['/first','/second']);

 const menu=new Menu();menu.i18n={t:key=>key};menu.pane='remote';menu.entry={name:'config.py',fullPath:'/config.py'};menu.singleSelected=true;menu.hasSelection=true;menu.canEdit=true;
 for(const action of ['editFile','openWith','openTerminalHere','copyFileName'])assert.ok(menu.orderedVisibleActions.includes(action));
 assert.equal(menu.contextActionLabel('editFile'),'Open');assert.equal(menu.contextActionLabel('openWith'),'Open with…');
 menu.menuOrder=['editFile','copyPath'];assert.ok(menu.orderedVisibleActions.includes('openWith'),'new actions appear with a saved old order');
 menu.disabledMenuEntries.add('openWith');assert.equal(menu.orderedVisibleActions.includes('openWith'),false);menu.disabledMenuEntries.clear();
 menu.entry.isDirectory=true;assert.equal(menu.isActionVisible('openWith'),false);assert.equal(menu.isActionVisible('openTerminalHere'),true);
 menu.pane='local';assert.equal(menu.isActionVisible('openTerminalHere'),false);assert.equal(menu.isActionVisible('editFile'),true);assert.equal(menu.isActionVisible('openLocal'),false,'one Open handles both panes');
 const copy=panel();let copied;copy.injector={get:()=>({setClipboard:content=>{copied=content.text;}})};
 copy.selectedRemote=[{name:'first file.py',fullPath:'/a/first file.py'},{fullPath:'/b/second.txt'}];
 assert.equal(await copy.onContextMenuAction('copyFileName'),true);assert.equal(copied,'first file.py\nsecond.txt');
 const terminalPanel=panel();const commands=[];let focused=0;
 terminalPanel.terminalRef={alternateScreenActive:true,frontend:{isAlternateScreenActive:()=>true},sendInput:command=>commands.push(command),emitFocused:()=>focused++};
 terminalPanel.contextMenuEntry={name:'file.py',fullPath:"/tmp/a b/o'neil/file.py"};
 assert.equal(await terminalPanel.onContextMenuAction('openTerminalHere'),true);
 assert.equal(commands[0],terminalEnvelope("cd -- '/tmp/a b/o'\\''neil'"));assert.equal(focused,1);
 terminalPanel.contextMenuEntry={fullPath:'/folder',isDirectory:true};await terminalPanel.onContextMenuAction('openTerminalHere');assert.equal(commands[1],terminalEnvelope("cd -- '/folder'"));
 terminalPanel.contextMenuEntry=null;terminalPanel.remotePath='/current';await terminalPanel.onContextMenuAction('openTerminalHere');assert.equal(commands[2],terminalEnvelope("cd -- '/current'"));
 terminalPanel.contextMenuEntry={fullPath:'/bad\ncommand',isDirectory:true};assert.equal(await terminalPanel.onContextMenuAction('openTerminalHere'),false);assert.equal(commands.length,3);
 const choose=panel();let appOpens=0,editDownloads=0;
 choose._customOpenWithFile=async(file)=>{assert.equal(file,'C:/copy/chosen.py');appOpens++;return '';};
 choose._customExternalEdit=async(entry,open)=>{assert.equal(entry.fullPath,'/chosen.py');editDownloads++;return open('C:/copy/chosen.py');};
 await choose.onContextMenuAction('openWith');assert.equal(appOpens,1);assert.equal(editDownloads,1);
 choose.contextMenuPane='local';choose.contextMenuEntry={fullPath:'C:/copy/chosen.py'};await choose.onContextMenuAction('openWith');assert.equal(appOpens,2);assert.equal(editDownloads,1);
 const cancelledOpen=panel();cancelledOpen._customOpenWithFile=async()=>{throw Error('picker failed');};cancelledOpen._customExternalEdit=async(entry,open)=>open('C:/copy/chosen.py');assert.equal(await cancelledOpen.onContextMenuAction('openWith'),false);
 const disconnectedOpen=panel();disconnectedOpen.connected=false;disconnectedOpen._customExternalEdit=()=>{throw Error('must not download');};assert.equal(await disconnectedOpen.onContextMenuAction('openWith'),false);



 const picker=panel();let dialogOptions;
 picker.injector={get:()=>({electron:{dialog:{showOpenDialog:async(window,options)=>{assert.equal(window,'host-window');dialogOptions=options;return {canceled:false,filePaths:['C:/Editor/editor.exe']};}}},hostWindow:{getWindow:()=> 'host-window'}})};
 assert.equal(await picker._customPickApplication(),'C:/Editor/editor.exe');assert.equal(dialogOptions.title,'Open with…');assert.deepEqual([...dialogOptions.properties],['openFile']);
 const launcher=panel();let unref=0;
 spawnMock=(application,args,options)=>{
  assert.equal(application,'C:/Program Files/Editor/editor.exe');assert.equal(args[0],'C:/local copy/a & b.py');assert.equal(options.shell,false);
  const child=new (require('events').EventEmitter)();child.unref=()=>unref++;setTimeout(()=>child.emit('spawn'),0);return child;
 };
 assert.equal(await launcher._customLaunchApplication('C:/Program Files/Editor/editor.exe','C:/local copy/a & b.py'),'');assert.equal(unref,1);
 spawnMock=()=>{const child=new (require('events').EventEmitter)();setTimeout(()=>child.emit('error',Error('app not found')),0);return child;};
 await assert.rejects(launcher._customLaunchApplication('missing.exe','a.py'),/app not found/);spawnMock=null;


 const Settings=classes.find(c=>c.prototype._customNormalizeOpenMenu);const settings=Object.create(Settings.prototype);
 settings.contextMenuOrder=['download','openLocal','editFile','openWith','copyPath'];settings.contextMenuDisabled=['openLocal','editFile'];
 settings._customNormalizeOpenMenu();assert.deepEqual([...settings.contextMenuOrder],['download','editFile','openWith','copyPath']);assert.deepEqual([...settings.contextMenuDisabled],['editFile']);
 assert.equal(settings.contextMenuOrder.filter(a=>a==='editFile').length,1,'legacy settings show one Open row');
 menu.menuOrder=['download','openLocal','editFile','openWith'];menu.entry={fullPath:'/a.py'};menu.pane='local';
 assert.equal(menu.orderedVisibleActions.filter(a=>a==='editFile').length,1);assert.equal(menu.orderedVisibleActions.includes('openLocal'),false);
 menu.disabledMenuEntries.add('editFile');assert.equal(menu.orderedVisibleActions.includes('editFile'),false);menu.pane='remote';assert.equal(menu.orderedVisibleActions.includes('editFile'),false);menu.disabledMenuEntries.clear();


 const created=panel();Object.assign(created,{inputDialogVisible:true,inputDialogMode:'remote-touch',inputDialogValue:'new.txt',inputDialogTargetPath:'/folder',inputDialogRemotePath:''});
 created._remoteEntryExists=async()=>({exists:false,isDirectory:false});created.cancelInputDialog=()=>{created.inputDialogVisible=false;};created.refreshRemote=async()=>{created.remoteRefreshed=true;};
 let createdUpload=0;
 created._doUpload=()=>{throw Error('empty file must not use the streamed upload engine');};created.sftpSession.open=async(remote,flags)=>{assert.equal(remote,'/folder/new.txt');assert.equal(flags,42);createdUpload++;return {close:async()=>{}};};created._customSetCreatedFilePermissions=async(remote)=>{assert.equal(remote,'/folder/new.txt');created.modeApplied=true;};
 await created.confirmInputDialog();assert.equal(createdUpload,1);assert.equal(created.inputDialogVisible,false);assert.equal(created.remoteRefreshed,true);assert.equal(created.modeApplied,true,'New File sets configured mode after exclusive creation');


 const exists=panel();exists.sftpSession={stat:()=>{throw Error('unsafe native stat must not run');},readdir:async()=>[{name:'exists.txt',isDirectory:false}]};
 assert.equal((await exists._remoteEntryExists('/folder','exists.txt')).exists,true);assert.equal((await exists._remoteEntryExists('/folder','missing.txt')).exists,false);
 exists.sftpSession.readdir=async()=>{throw Error('permission denied');};await assert.rejects(exists._remoteEntryExists('/folder','missing.txt'),/permission denied/);
 for(const [action,method] of Object.entries({newFolder:'ctxNewFolder',newFile:'ctxNewFile',rename:'ctxRename',delete:'ctxDelete',openLocal:'ctxOpenLocal',upload:'ctxUpload',revealInExplorer:'ctxRevealInExplorer',chmod:'ctxChmod',details:'ctxDetails',copy:'ctxClipboardCopy',cut:'ctxClipboardCut',paste:'ctxClipboardPaste',refresh:'ctxRefresh',selectAll:'ctxSelectAll',selectInvert:'ctxSelectInvert',copyPath:'ctxCopyPath'})){
  const command=panel();let calls=0;command[method]=async()=>{calls++;throw Error('fixture '+action);};
  assert.equal(await command.onContextMenuAction(action),false);assert.equal(calls,1);assert.match(command.toast,/fixture/);
 }


 const selfCopy=panel();selfCopy.remotePath='/';selfCopy._pasteAdapter={paste:()=>{throw Error('self-paste must not reach conflict/digest/server copy');}};
 await selfCopy.onContextMenuAction('cut');
 for(let i=0;i<5;i++)assert.equal(await selfCopy.onContextMenuAction('paste'),false);
 assert.equal(selfCopy.clipboardEntries.length,1,'self-paste retains the internal selfCopy file and cannot fall back to a stale screenshot');
 assert.match(selfCopy.toast,/Source and destination are the same/);


 // Reproduce the live error against the actual Panel accessor, not a plain mock.
 const explorer=panel();explorer.remotePath='/drop';explorer.refreshRemote=async()=>{};
 explorer._fileDnd=new sandbox.__testFileDnd(explorer);explorer._fileDnd._remoteDragOver=true;
 assert.equal(explorer._remoteDragOver,true);
 assert.throws(()=>new Function('panel',"'use strict'; panel._remoteDragOver=false;")(explorer),/getter|read only|readonly/i,'the previous assignment throws on the real panel');
 let fileDrops=0;explorer._streamUploadOne=async(local,dir)=>{assert.equal(local,'C:/tiny.py');assert.equal(dir,'/drop');fileDrops++;};
 const explorerEvent=event();explorerEvent.dataTransfer={files:[{name:'tiny.py',path:'C:/tiny.py'}],getData:()=>''};
 assert.equal(await explorer.onDrop(explorerEvent,'remote'),true);
 assert.equal(fileDrops,1);assert.equal(explorer._remoteDragOver,false,'controller.reset clears the actual read-only view');


 // Actual bundled panel: selected-folder image paste uses owned bytes and deferred work.
 const imagePanel=panel();imagePanel.remotePath='/current';imagePanel.refreshRemote=async()=>{};
 const borrowed=Buffer.from('png-bytes'),expected=Buffer.from(borrowed);let imageUploads=0;
 imagePanel._customTraceClipboard=async phase=>{if(phase==='image:encode:end')borrowed.fill(0);};
 imagePanel._streamUploadOne=async(local,destination)=>{assert.equal(destination,'/folder');assert.deepEqual(fs.readFileSync(local),expected);imageUploads++;};
 const firstPaste=imagePanel.customPasteImage({toPNG:()=>borrowed},'/folder');const duplicatePaste=imagePanel.customPasteImage({toPNG:()=>borrowed},'/folder');
 assert.strictEqual(firstPaste,duplicatePaste);assert.equal(await firstPaste,true);assert.equal(imageUploads,1);assert.equal(imagePanel._customImagePasteTask,null);

 class Disposable{onPanelMouseDown(){}onContextMenuAction(){}getContextSelection(){return [];}closeContextMenu(){}ngOnDestroy(){this._destroyed=true;} }
 require('./tests/helpers/feature-fixture.cjs')(require('./src/features/context-menu.cjs'))({Panel:Disposable,Angular:{HostListener:()=>()=>{}}});const d=new Disposable();d.contextMenuPane='remote';d._activateEntry=()=>{throw Error('must not run after destroy');};const cancelled=d.onContextMenuAction('editFile');d.ngOnDestroy();assert.equal(await cancelled,false);assert.equal(d._customContextActions.size,0);
 console.log('PASS: Angular menu parses; right-button isolation and rubber-band cleanup work; menu Open uses local/remote double-click handlers; Open with uses the native app chooser and retains auto-sync; terminal paths and clipboard names are preserved; Download waits for native folder choice and keeps selected files; cancel, destroy and errors start no transfer.');
})().catch(error=>{console.error(error);process.exitCode=1;});
