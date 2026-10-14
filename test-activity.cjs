const assert = require('assert/strict');
const fs = require('fs'), fsp = fs.promises, path = require('path');
const root = path.join(__dirname,'test-activity-fixture');
const editPolicy=require('./transfer-policy.json').externalEdit;
const createStore = require('./src/runtime/recovery-store.cjs');
const installEdit = require('./tests/helpers/feature-fixture.cjs')(require('./src/features/external-edit.cjs'));
const installActivity = require('./tests/helpers/feature-fixture.cjs')(require('./src/features/activity.cjs'));
const delay = ms => new Promise(r => setTimeout(r,ms));
let downloads=0, uploads=0, confirmations=0, opened=[];
global.window = { confirm: () => { confirmations++; return false; } };
class Panel {
    constructor(host='fixture', user='alice') {
        this.profile={options:{host,username:user,port:22}};
        this.configService={store:{'tabby-sftp-plus-plus':{fileOpenAction:'external-edit'}},save(){}};
        this.connected=true;this.transfers=[];this.messages=[];this.remote=new Map();this.zone={run:f=>f()};
        this.sftpSession={stat:async p=>{const st=this.remote.get(p);if(!st){const e=new Error('No such file');e.code='ENOENT';throw e;}return {...st};}};
        this.transferLog={getAll:()=>this.logs || []};
        this._transferCoordinator={
            uploadPathToRemote:async (remote,local)=>{this.folderCalls=(this.folderCalls||0)+1;return this._doUpload(path.posix.join(remote,path.basename(local),'a.txt'),path.join(local,'a.txt'));},
            downloadRemoteDir:async()=>false,
            mergeLocalDirToRemote:async()=>false,
            uploadBatchUseCase:{execute:async()=>this.batchResult || 'fallback'},
        };
    }
    ngOnInit(){} ngOnDestroy(){this._destroyed=true;} _activateEntry(){} isDirByMode(){return false;}
    _safeDetect(){} showToast(m){this.messages.push(m);}
    async refreshRemote(){return true;} async refreshLocal(){}
    async _doUpload(remote,local) {
        uploads++;
        if(this.slowUpload)await this.slowUpload();
        if(this.fail)return false;
        const data=await fsp.readFile(local);this.remote.set(remote,{size:data.length,mtime:1700000000+uploads});return true;
    }
    async _doDownload(remote,local){downloads++;if(this.fail)return false;await fsp.writeFile(local,'downloaded');return true;}
    pauseTransfer(e){e.paused=true;} resumeTransfer(e){e.paused=false;this.resumes=(this.resumes||0)+1;}
    cancelTransfer(e){this.transfers=this.transfers.filter(t=>t!==e);}
    clearLog(){if(!this.cancelClear)this.logs=[];}
    uploadPathToRemote(remote,local){return this._transferCoordinator.uploadPathToRemote(remote,local);}
    _streamUploadOne(local,remote){this.transfers.push({queued:true,direction:'upload',remotePath:remote,localPath:local,logEntryId:'queue-'+Date.now()});return Promise.resolve();}
}
function install(Clazz,store) {
    installEdit({Panel:Clazz,Settings:class{},recovery:store,shell:{openPath:async p=>{opened.push(p);return '';}},download:async()=>{const file=path.join(root,'download'+(++downloads)+'.txt');await fsp.writeFile(file,'old');return file;}});
    installActivity({Panel:Clazz,recovery:store});
}
const stop=p=>{for(const e of p._customExternalSessions?.values()||[])clearInterval(e.timer);clearInterval(p._customActivityTimer);};
(async()=>{
    await fsp.mkdir(root,{recursive:true});
    const runRoot=path.join(root,require('crypto').randomUUID());
    const store=createStore(runRoot);install(Panel,store);
    const idle=new Panel('idle');let idleRenders=0, outsideStarts=0;
    idle._safeDetect=()=>idleRenders++;idle.zone.runOutsideAngular=fn=>{outsideStarts++;return fn();};
    idle.ngOnInit();await delay(0);
    for(let i=0;i<20;i++)await idle._customActivityTick();
    assert.equal(idleRenders,0,'idle recovery ticks do not repaint the file list');
    assert.equal(outsideStarts,1,'background activity interval is registered outside Angular');
    idle.showTransferLog=true;await idle._customActivityTick();assert.equal(idleRenders,1,'visible transfer history still refreshes');idle.ngOnDestroy();
    const p=new Panel();p.remote.set('/edit.txt',{size:3,mtime:1700000000});
    await p._customExternalEdit({name:'edit.txt',fullPath:'/edit.txt',size:3});
    let e=p._customExternalSessions.get('/edit.txt');clearInterval(e.timer);
    assert.equal(e.status,'Editing');assert.ok(e.localPath.startsWith(path.join(runRoot,'edits')),'durable copy lives outside OS temp');
    const originalPath=e.localPath;
    await fsp.writeFile(e.localPath,Buffer.from([0xff,0,1,2]));await fsp.utimes(e.localPath,new Date(0),new Date(0));
    await p._customSyncExternal(e);assert.equal(e.status,'Synced');
    assert.equal(p.customTransferRows.length,0,'edit snapshots do not create disposable transfer recovery jobs');
    p.connected=false;await p._customSyncExternal(e);assert.equal(e.status,'Offline');
    await fsp.writeFile(e.localPath,'saved offline');await fsp.utimes(e.localPath,new Date(0),new Date(0));
    p.ngOnDestroy();
    // A fresh store and class simulate reopening Tabby, not just reusing an in-memory map.
    class Reopened extends Panel {}
    // Avoid installing wrappers twice on inherited methods: copy the original class behavior first.
    for(const method of ['ngOnInit','ngOnDestroy','_activateEntry','_doUpload','_doDownload','refreshRemote','refreshLocal','pauseTransfer','resumeTransfer','cancelTransfer']) {
        Reopened.prototype[method]=method==='_doUpload'?async function(remote,local){uploads++;const b=await fsp.readFile(local);this.remote.set(remote,{size:b.length,mtime:1700000000+uploads});return true;}:method==='_doDownload'?async()=>true:method==='ngOnDestroy'?function(){this._destroyed=true;}:method==='refreshRemote'?async()=>true:method==='refreshLocal'?async()=>{}:function(){};
    }
    const restoredStore=createStore(runRoot);install(Reopened,restoredStore);
    const reopened=new Reopened();reopened.remote=p.remote;
    const beforeUploads=uploads;
    reopened._customRestoreEdits();await delay(40);stop(reopened);
    const restored=reopened._customExternalSessions.get('/edit.txt');
    assert.equal(restored.localPath,originalPath);assert.equal(restored.status,'Offline');assert.equal(uploads,beforeUploads,'old local saves are not uploaded automatically after reconnect');
    await reopened.customRetryEdit(restored);stop(reopened);assert.equal(restored.status,'Synced');assert.equal(uploads,beforeUploads+1,'explicit Retry can recover an offline local save');
    await fsp.writeFile(restored.localPath,'conflicting save');await fsp.utimes(restored.localPath,new Date(0),new Date(0));
    reopened.remote.set('/edit.txt',{size:99,mtime:1700009999});
    const beforeConflict=uploads,automaticAction=editPolicy.remoteChangeAction;
    editPolicy.remoteChangeAction='confirm';
    try { await reopened._customSyncExternal(restored); } finally { editPolicy.remoteChangeAction=automaticAction; }
    assert.equal(restored.status,'Conflict');assert.equal(uploads,beforeConflict,'remote conflict never overwrites without confirmation');
    const other=new Reopened('fixture','bob');other._customRestoreEdits();assert.equal(other.customEditRows.length,0,'recovery isolated by username');
    const duplicate=new Reopened();duplicate.remote=reopened.remote;duplicate._customRestoreEdits();assert.equal(duplicate.customEditRows.length,0,'one watcher owns each file across panels');
    reopened.customStopEdit(restored);assert.ok(fs.existsSync(originalPath),'stop watching retains local copy');assert.equal(restoredStore.rows('edits',restoredStore.server(reopened)).length,0);
    stop(reopened);stop(duplicate);stop(other);
    const source=path.join(root,'upload.txt');await fsp.writeFile(source,'source');
    const q=new Panel();q.remote.set('/destination',{size:3,mtime:1});q.fail=true;
    assert.equal(await q._doUpload('/destination',source),false);
    let row=q.customTransferRows[0];assert.equal(row.status,'Failed');assert.equal(row.prepared,true);
    q.fail=false;await q.customRetryTransfer(row);assert.equal(row.status,'Completed');assert.equal(q.customTransferRows.length,1,'retry reuses the same recovery job');
    q.fail=true;await q._doUpload('/changed',source);row=q.customTransferRows[0];
    q.remote.set('/changed',{size:100,mtime:12});q.fail=false;
    const beforeRetry=uploads;await q.customRetryTransfer(row);assert.equal(row.status,'Conflict');assert.equal(uploads,beforeRetry);
    assert.ok(confirmations>=2);
    window.confirm=()=>true;await q.customRetryTransfer(row);assert.equal(row.status,'Completed');
    // Interrupted records persist, but reconnect never launches a transfer by itself.
    const recoveryRow={id:'interrupted',server:store.server(q),direction:'upload',remotePath:'/later',localPath:source,args:[],status:'Running',prepared:false};
    store.put('transfers',recoveryRow);
    const cleanStore=createStore(runRoot);assert.equal(cleanStore.rows('transfers',store.server(q)).find(r=>r.id==='interrupted').status,'Interrupted');
    const cancelled={id:'cancelled',server:store.server(q),status:'Cancelled'};cleanStore.put('transfers',cancelled);
    const testCancel=cleanStore.rows('transfers',store.server(q)).find(r=>r.id==='cancelled');assert.equal(testCancel.status,'Cancelled');
    const recoveredPanel=new Reopened();const countBeforeTick=uploads;await recoveredPanel._customActivityTick();stop(recoveredPanel);assert.equal(uploads,countBeforeTick,'reconnecting never auto-runs transfer recovery');
    const queuePath=path.join(root,'queued.txt');await fsp.writeFile(queuePath,'queued');await q._streamUploadOne(queuePath,'/queued');
    const queued=q.customTransferRows[0];assert.equal(queued.status,'Queued');assert.ok(store.rows('transfers',store.server(q)).some(r=>r.id===queued.id),'queued task is saved before it starts');
    q.fail=false;await q._doUpload('/queued',queuePath);assert.equal(q.customTransferRows[0].id,queued.id,'native stream claims the queued recovery row');q.transfers=[];
    const folder=path.join(root,'folder');await fsp.mkdir(folder,{recursive:true});await fsp.writeFile(path.join(folder,'a.txt'),'nested');
    q._customHookFolderTransfers();await q._transferCoordinator.uploadPathToRemote('/remote',folder);
    const folderRows=q.customTransferRows.filter(r=>r.isFolder);
    assert.equal(folderRows.length,1);assert.equal(folderRows[0].status,'Completed');assert.ok(!q.customTransferRows.some(r=>r.remotePath==='/remote/folder/a.txt'),'nested files belong to their directory job');
    q.batchResult='failed';const batchResult=await q._transferCoordinator.uploadBatchUseCase.execute([source,queuePath],'/batch','Two files');
    assert.equal(batchResult,'failed');const batchRow=q.customTransferRows[0];assert.equal(batchRow.status,'Failed','archive handled-failure is not mistaken for success');
    q.batchResult='fallback';const beforeBatchRows=q.customTransferRows.length;await q._transferCoordinator.uploadBatchUseCase.execute([source,queuePath],'/fallback','Fallback');assert.equal(q.customTransferRows.length,beforeBatchRows,'archive fallback delegates to normal file jobs');
    const transient={id:'busy',server:store.server(q),status:'Failed',_retryBusy:true};store.put('transfers',transient);assert.equal(store.rows('transfers',store.server(q)).find(r=>r.id==='busy')._retryBusy,undefined,'transient locks do not survive restart');
    // Failed download recovery uses fresh source metadata; it never truncates the upload source.
    const target=path.join(root,'target.txt');await fsp.writeFile(target,'existing');q.remote.set('/download',{size:10,mtime:5});q.fail=true;
    await q._doDownload('/download',target);const down=q.customTransferRows[0];q.fail=false;
    await q.customRetryTransfer(down);assert.equal(down.status,'Completed');assert.equal((await fsp.readFile(source)).toString(),'source');
    // Native pause/resume keeps its progress object, but changed sources are blocked.
    q.fail=true;await q._doUpload('/paused',source);const paused=q.customTransferRows[0];
    const entry={direction:'upload',remotePath:'/paused',localPath:source,paused:true,percent:42,speed:'1 MB/s',logEntryId:'pause'};q.transfers=[entry];paused.status='Paused';
    await q.customRetryTransfer(paused);assert.equal(q.resumes,1);assert.equal(paused.status,'Running');
    entry.paused=true;paused.status='Paused';await fsp.writeFile(source,'changed source');
    await q.customRetryTransfer(paused);assert.equal(q.resumes,1,'unsafe offset resume blocked after source changed');assert.equal(paused.status,'Conflict');
    q.customCancelTransfer(paused);assert.equal(paused.status,'Cancelled');assert.equal(q.transfers.length,0);
    const editSnapshot={remotePath:'/editing',uploadSnapshot:source,pendingHash:'pending'};q._customExternalSessions=new Map([['/editing',editSnapshot]]);
    const editEntry={remotePath:'/editing',localPath:source,direction:'upload'};await q.pauseTransfer(editEntry);assert.notEqual(editEntry.paused,true,'save snapshot cannot become an orphan paused transfer');await q.cancelTransfer(editEntry);assert.equal(editSnapshot.blockedHash,'pending','cancelled save does not silently retry the same content');
    q.logs=[{id:paused.logEntryId}];
    assert.equal(q.customHistoryOwner,q);
    assert.equal(q.customLogTransfer(q.logs[0]),paused);
    assert.ok(!q.customHistoryRecoveryRows.includes(paused),'history row and recovery row are not duplicated');
    assert.equal(q.customCanRetryTransfer(paused),false,'cancelled history row cannot retry');
    assert.equal(q.customCanRetryTransfer({status:'Interrupted'}),true);
    q.cancelClear=true;q.clearLog();assert.ok(q.customTransferRows.includes(paused),'cancelled history clear retains recovery');q.cancelClear=false;q.clearLog();assert.ok(!q.customTransferRows.includes(paused),'cleared history does not reappear as a recovery duplicate');
    q.customClearFinishedTransfers();assert.ok(q.customTransferRows.every(r=>!['Completed','Cancelled'].includes(r.status)));
    q.ngOnDestroy();stop(q);
    const mergeRoot=path.join(root,'merge-'+require('crypto').randomUUID()),writerA=createStore(mergeRoot),writerB=createStore(mergeRoot);
    writerA.put('transfers',{id:'a',server:'host',status:'Failed'});writerB.put('transfers',{id:'b',server:'host',status:'Failed'});writerA.remove('transfers','a');
    assert.equal(createStore(mergeRoot).rows('transfers','host')[0].id,'b','stale writer cannot erase another saved job');
    console.log('PASS: durable editing, process restart/offline save, conflicts, server isolation, watcher ownership, persistent file/directory retry, download direction, safe pause/resume and cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
