const assert = require('assert/strict'), fs = require('fs/promises'), path = require('path'), os = require('os'), Module = require('module');
const header = require('fs').readFileSync('test-context-menu.cjs','utf8').split('(async()=>{')[0];
const harness = new Module(path.join(__dirname,'collision-harness.cjs'),module);harness.filename=path.join(__dirname,'collision-harness.cjs');harness.paths=module.paths;harness._compile(header+'\nmodule.exports=sandbox.module.exports.testing;',harness.filename);
const {PanelTransferRuntime,PanelTransferCoordinator,PanelPasteAdapter,ConflictResolveUseCase,folderFileProgress,folderSkipped,UploadPathUseCase,DownloadDirUseCase,SftpConflictDetector}=harness.exports;
const batches=require('./src/runtime/file-operation.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sftp-explorer-'));
 try{
  const src=path.join(root,'source'),dest=path.join(root,'target');await fs.mkdir(path.join(src,'tree','nested'),{recursive:true});await fs.mkdir(path.join(dest,'tree','nested'),{recursive:true});
  for(const [name,data]of [['a.txt','new a'],['b.txt','new b'],['nested/c.txt','new c'],['unique.txt','unique']])await fs.writeFile(path.join(src,'tree',name),data);
  for(const name of ['a.txt','b.txt','nested/c.txt'])await fs.writeFile(path.join(dest,'tree',name),'old');await fs.writeFile(path.join(dest,'tree','keep.txt'),'retain');
  const queue=[],resolved=new Set();let pending,completed=0,errors=[];
  const host={sftpSession:null,effectiveLang:'en-US',i18n:{t:s=>s},notifications:{error:message=>errors.push(message)},getConflictQueueLength:()=>queue.length,enqueueConflict:item=>queue.push(item),showConflictDialog(){},setConflictOriginalTotal(){},savePendingPaste:(entries,pane,folder,mode,source)=>{pending={entries,pane,folder,mode,source};},refreshLocal:async()=>{},refreshRemote:async()=>{}};
  const adapter=new PanelPasteAdapter(host);
  const localStat=async p=>{try{const s=await fs.lstat(p);return {isDirectory:s.isDirectory()};}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const resolver=new ConflictResolveUseCase({
   execution:{statLocal:localStat,copyLocalFile:(a,b)=>fs.copyFile(a,b),copyLocalDir:()=>{throw Error('directory overwrite must never occur');},unlinkLocal:p=>fs.unlink(p),markTransferSucceeded:()=>completed++,discardTransferLog(){},hasSftpSession:()=>false},
   pendingPaste:{getBatch:()=>pending?.entries[0]?.batch,hasPendingPaste:()=>!!pending,clearPending:()=>{pending=null;},restoreClipboardFromPending(){},resumePaste:async keys=>{const p=pending;pending=null;await adapter.executePaste(p.entries,p.pane,p.folder,p.mode,p.source,keys);}},
   queue:{snapshot:()=>queue.slice(),shift:()=>queue.shift(),clear:()=>{queue.length=0;},replace:items=>{queue.splice(0,queue.length,...items);},length:()=>queue.length,markResolved:key=>resolved.add(key),getResolvedKeys:()=>resolved,clearResolvedKeys:()=>resolved.clear(),setAllMode(){},resetAllMode(){},resetOriginalTotal(){}},
   ui:{hideDialog(){},clearSelection(){},refreshPanes(){},showNextDialog(){},reportError:(name,e)=>errors.push(e.message)}
  });
  const entry={name:'tree',fullPath:path.join(src,'tree'),isDirectory:true};
  await adapter.paste([entry],'local',dest,'cut','local');
  assert.equal(queue.length,3);assert.ok(queue.every(e=>!e.isDirectory),'folder merge prompts only for duplicate leaves');assert.ok(queue.every(e=>e.batch===queue[0].batch));
  const first=queue[0],skipped=first.remotePath;await resolver.resolve('skip');assert.equal(await fs.readFile(skipped,'utf8'),'new a');
  await resolver.resolve('overwrite-all');assert.equal(queue.length,0);assert.equal(pending,null);assert.equal(await fs.readFile(path.join(dest,'tree','a.txt'),'utf8'),'old');assert.equal(await fs.readFile(path.join(dest,'tree','b.txt'),'utf8'),'new b');assert.equal(await fs.readFile(path.join(dest,'tree','nested','c.txt'),'utf8'),'new c');assert.equal(await fs.readFile(path.join(dest,'tree','keep.txt'),'utf8'),'retain');assert.equal(await fs.readFile(path.join(dest,'tree','unique.txt'),'utf8'),'unique');assert.equal(await fs.readFile(skipped,'utf8'),'new a');assert.equal(await localStat(path.join(src,'tree','b.txt')),null);assert.equal(errors.length,0);
  // Repeated copy in the same directory creates Explorer copy names without a collision prompt.
  const file=path.join(root,'note.txt');await fs.writeFile(file,'copy data');
  for(let i=0;i<2;i++)await adapter.paste([{name:'note.txt',fullPath:file,isDirectory:false}],'local',root,'copy','local');
  assert.equal(await fs.readFile(path.join(root,'note - Copy.txt'),'utf8'),'copy data');assert.equal(await fs.readFile(path.join(root,'note - Copy (2).txt'),'utf8'),'copy data');
  // Keep both probes numeric names and preserves the original destination.
  const other=path.join(root,'other');await fs.mkdir(other);await fs.writeFile(path.join(other,'note.txt'),'old');await fs.writeFile(path.join(other,'note (2).txt'),'second');
  await adapter.paste([{name:'note.txt',fullPath:file,isDirectory:false}],'local',other,'copy','local');await resolver.resolve('rename');assert.equal(await fs.readFile(path.join(other,'note (3).txt'),'utf8'),'copy data');assert.equal(await fs.readFile(path.join(other,'note.txt'),'utf8'),'old');
  // A file/folder clash cannot erase a directory via Replace all.
  const clash=path.join(other,'tree');await fs.writeFile(clash,'file stays');await adapter.paste([entry],'local',other,'copy','local');assert.equal(queue[0].typeMismatch,true);await resolver.resolve('overwrite');assert.equal(await fs.readFile(clash,'utf8'),'file stays');assert.ok(errors.some(s=>/cannot replace/.test(s)));errors=[];
  // Decisions belong to one operation, including conflicts discovered after the first decision.
  const a=batches.create(),b=batches.create();const make=(batch,name)=>({batch,fileName:name,remotePath:'/src/'+name,localPath:'/dst/'+name,remoteDir:'/dst',direction:'upload',localStat:{size:1,mtimeMs:1},isSamePane:true,samePaneSource:'local'});
  const x=make(a,'x'),y=make(b,'y');batches.enqueue({enqueue:i=>queue.push(i)},x,a);batches.enqueue({enqueue:i=>queue.push(i)},y,b);await resolver.resolve('skip-all');assert.equal(queue[0],y);assert.equal(resolver.autoAction(y),null);assert.equal(resolver.autoAction(make(a,'later')),'skip');assert.equal(resolver.autoAction({...make(a,'type'),typeMismatch:true,batch:{...a,decision:'overwrite'}}),null);
  // Cancelling another operation cannot discard a pending paste or its resolved keys.
  pending={entries:[{batch:b}]};await resolver.resolve('cancel');assert.equal(pending,null);assert.equal(b.cancelled,true);
  const c=batches.create(),d=batches.create();pending={entries:[{batch:d}]};batches.enqueue({enqueue:i=>queue.push(i)},make(c,'cancel-c'),c);batches.enqueue({enqueue:i=>queue.push(i)},make(d,'keep-d'),d);await resolver.resolve('cancel');assert.equal(pending.entries[0].batch,d);assert.equal(queue.length,1);assert.equal(queue[0].batch,d);pending=null;await resolver.resolve('skip');
  // Live progress includes concurrent files and skipped bytes exactly once; failure never claims completion.
  const updates=[],ctx={t:{_taskCancelRef:{active:new Set()}},bytesDone:0,itemDone:0};const folder={updateProgress:(c,bytes,name,done)=>updates.push({bytes,done})};
  folderSkipped(folder,ctx,'skipped',5);const p1=folderFileProgress(folder,ctx,'one','one',100),p2=folderFileProgress(folder,ctx,'two','two',200);ctx.lastLiveReportAt=0;p1.report(40);ctx.lastLiveReportAt=0;p2.report(60);assert.equal(updates.at(-1).bytes,105);assert.equal(p1.report.cancelRef,ctx.t._taskCancelRef);p1.finish(true);assert.equal(updates.at(-1).bytes,165);p2.finish(true);assert.equal(updates.at(-1).bytes,305);assert.equal(ctx.bytesDone,300);assert.equal(ctx.itemDone,3);assert.equal(ctx.liveBytes.size,0);const failed=folderFileProgress(folder,ctx,'failed','failed',50);failed.report(10);failed.finish(false);assert.equal(ctx.bytesDone,300);
  // Same size/time is not proof of equal contents, and the product does not silently skip it.
  const detector=new SftpConflictDetector(()=>({stat:async()=>({size:9,modified:new Date(1700000000000),isDirectory:false})}));assert.equal((await detector.checkUploadConflict('/same',file,9,1700000000000)).kind,'conflict');
  const watched={isFolder:true,phase:'transferring',bytesDone:10,bytesTotal:100},runtime=new PanelTransferRuntime({connected:true,transfers:[watched],detectChanges(){},zone:{run:fn=>fn()},cdr:{detectChanges(){}}});runtime.watchFolder(watched);runtime._transferTimer.unref?.();runtime._transferMeta.get(watched).lastProgressTime=Date.now()-60000;runtime._tickAllTransfers();assert.equal(watched.waitingForServer,true);watched.bytesDone=20;runtime._tickAllTransfers();assert.equal(watched.waitingForServer,false);runtime.unwatchFolder(watched);assert.equal(runtime._transferTimer,null);assert.equal(runtime._trackedTransferCount,0);
  const coordinator=Object.create(PanelTransferCoordinator.prototype),calls=[];
  coordinator._claimTransferSlot=()=>true;coordinator._releaseTransferSlot=()=>{};coordinator._runScopedFolderTask=fn=>fn();
  coordinator.uploadUseCase={execute:async(...args)=>{calls.push(args);return true;}};coordinator.downloadDirUseCase=coordinator.uploadUseCase;
  const operation=batches.create();for(const top of [undefined,{bytesDone:0}]){await coordinator.uploadPathToRemote('/target',file,top,operation,true);assert.equal(calls.at(-1)[4],operation);assert.equal(calls.at(-1)[5],true);await coordinator.downloadRemoteDir('/source',root,top,undefined,false,operation,true);assert.equal(calls.at(-1)[6],operation);assert.equal(calls.at(-1)[7],true);}
  console.log('PASS: Explorer recursive merge; per-file Skip/Replace all; cut retains skipped source; destination-only files survive; repeat copy naming; numeric Keep both; type clashes; operation-scoped decisions/cancel; live aggregate progress and explicit cancellation ownership.');
 }finally{const target=path.resolve(root);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(target,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
