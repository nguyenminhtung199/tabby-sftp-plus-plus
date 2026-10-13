const assert=require('assert/strict'),fs=require('fs'),fsp=fs.promises,path=require('path'),crypto=require('crypto'),cp=require('child_process');
const engine=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/transfer-engine.cjs')),makeResume=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/resume-transfer.cjs')),activity=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/activity.cjs')),makeStore=require('./src/runtime/recovery-store.cjs');
const installEdit=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/external-edit.cjs'));let opened=[];
const root=path.join(__dirname,'test-fixtures','resume-'+process.pid),CHUNK=256*1024;
const python=process.env.SFTP_TEST_PYTHON||'python3';
const panels=[],children=[];let wireRead=0,wireWrite=0,execCount=0,confirmations=0;
global.window={confirm:()=>{confirmations++;return false;}};
class Signal{constructor(){this.rows=new Set();}subscribe(value){const observer=typeof value==='function'?{next:value}:value;this.rows.add(observer);return {unsubscribe:()=>this.rows.delete(observer)};}emit(value){for(const o of [...this.rows])o.next?.(value);}error(e){for(const o of [...this.rows])o.error?.(e);}}
function shellSplit(s){const values=[];let quote=false,word='',started=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==="'"){quote=!quote;started=true;}else if(c==='\\'&&!quote){word+=s[++i];started=true;}else if(/\s/.test(c)&&!quote){if(started){values.push(word);word='';started=false;}}else{word+=c;started=true;}}if(started)values.push(word);assert(!quote);return values;}
const remote=p=>path.join(root,'remote',path.posix.basename(p));
function ssh(){return {openSessionChannel:async()=>({}),activateChannel:async()=>{
    const data$=new Signal(),closed$=new Signal(),eof$=new Signal();let process;
    return {data$,closed$,eof$,requestExec:async command=>{
        execCount++;const argv=shellSplit(command);assert.equal(argv[0],'python3');assert.equal(argv[1],'-u');assert.equal(argv[2],'-c');argv[5]=remote(argv[5]);
        process=cp.spawn(python,argv.slice(1),{stdio:['pipe','pipe','pipe'],windowsHide:true});children.push(process);
        process.stdout.on('data',bytes=>{wireRead+=bytes.length;data$.emit(bytes);});process.stderr.on('data',()=>{});process.on('error',e=>data$.error(e));process.on('close',()=>closed$.emit());
    },write:bytes=>new Promise((resolve,reject)=>{wireWrite+=bytes.length;process.stdin.write(bytes,e=>e?reject(e):resolve());}),close:async()=>{process?.kill();}};
}};}
class Base {
    constructor(host='fixture'){this.profile={options:{host,username:'test'}};this.connected=true;this.transfers=[];this.logs=[];this.toasts=[];this.zone={run:f=>f()};this._upQueue=[];this._dlQueue=[];this._upActiveCount=0;this._dlActiveCount=0;this._uploadConcurrency=1;this._downloadConcurrency=1;this.sshSession={ssh:ssh()};
        this.transferLog={getAll:()=>this.logs,add:row=>{const e={id:crypto.randomUUID(),...row};this.logs.push(e);return e;},update:(id,values)=>Object.assign(this.logs.find(e=>e.id===id)||{},values)};
        const closed$=new Signal();this.sftpSession={closed$,stat:async p=>{const st=await fsp.stat(remote(p));return {size:st.size,modified:st.mtime,mode:420};},chmod:async()=>{},unlink:p=>fsp.unlink(remote(p)),rename:(a,b)=>fsp.rename(remote(a),remote(b)),open:async(p,flags)=>{
            const handle=await fsp.open(remote(p),flags&8?'wx':flags&2?'r+':'r');let position=0;
            return {read:async()=>{if(this.breakRead&&position>=CHUNK){this.connected=false;closed$.emit();throw Error('Connection closed');}const b=Buffer.alloc(CHUNK),r=await handle.read(b,0,b.length,position);position+=r.bytesRead;return b.subarray(0,r.bytesRead);},write:async bytes=>{await handle.write(bytes,0,bytes.length,position);position+=bytes.length;if(this.breakWrite&&position>=2*CHUNK){this.connected=false;closed$.emit();throw Error('Connection closed after write before ACK');}},close:()=>handle.close()};
        }};panels.push(this);
    }
    _safeDetect(){}showToast(s){this.toasts.push(s);}refreshRemote(){}refreshLocal(){}ngOnInit(){}ngOnDestroy(){this._destroyed=true;} _activateEntry(){}isDirByMode(){return false;}
    _doUpload(){return false;}_doDownload(){return false;}
    _pumpUploadQueue(){while(this._upActiveCount<this._uploadConcurrency&&this._upQueue.length){this._upActiveCount++;void this._runQueuedUpload(this._upQueue.shift());}}
    _pumpDownloadQueue(){while(this._dlActiveCount<this._downloadConcurrency&&this._dlQueue.length){this._dlActiveCount++;void this._runQueuedDownload(this._dlQueue.shift());}}
    _runQueuedUpload(){}_runQueuedDownload(){}pauseTransfer(){}resumeTransfer(){}
    cancelTransfer(e){e.transfer?.cancel();this.transfers=this.transfers.filter(x=>x!==e);}
    trackTransfer(t,d,r,l,operation){let e=this.transfers.find(x=>x.queued&&x.direction===d&&x.remotePath===r&&x.localPath===l);if(!e){const log=this.transferLog.add({operation,remotePath:r,localPath:l,pending:true});e={direction:d,remotePath:r,localPath:l,logEntryId:log.id};this.transfers.push(e);}Object.assign(e,{transfer:t,queued:false,bytesTotal:t.getSize()});}
}
function setup(edit=false){class Panel extends Base{}const store=makeStore(path.join(root,'recovery'));const resume=makeResume({Panel,root:store.root,server:store.server});engine({Panel,resume});if(edit)installEdit({Panel,Settings:class{},recovery:store,shell:{openPath:async file=>{opened.push(file);return '';}},download:()=>{throw Error('Hidden download must not be used');}});activity({Panel,recovery:store});return Panel;}
const wait=async condition=>{for(let n=0;n<400;n++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
(async()=>{
    await fsp.mkdir(path.join(root,'remote'),{recursive:true});const bytes=crypto.randomBytes(5*CHUNK+71),local=path.join(root,'local.bin');await fsp.writeFile(local,bytes);await fsp.writeFile(remote('/download.bin'),bytes);
    const P=setup(),p=new P();p.breakRead=true;const downloaded=path.join(root,'downloaded.bin');assert.equal(await p._doDownload('/download.bin',downloaded,420,bytes.length),false);
    const checkpoint=JSON.parse(fs.readFileSync(path.join(root,'recovery/resume-state.json'))).states[0];assert.equal(checkpoint.offset,CHUNK);assert(fs.existsSync(checkpoint.temp));assert(!fs.existsSync(downloaded));
    // A new process/store loads the checkpoint and requests only the remaining remote bytes.
    const journalFile=path.join(root,'recovery/resume-state.json');
    const crashed=JSON.parse(fs.readFileSync(journalFile));crashed.states[0].status='Running';crashed.states[0].ownerPid=99999999;fs.writeFileSync(journalFile,JSON.stringify(crashed));
    const Q=setup(),q=new Q();await q._customActivityTick();await wait(()=>fs.existsSync(downloaded));assert(fs.readFileSync(downloaded).equals(bytes));assert(wireRead<bytes.length,'download must not retransmit prefix');assert.equal(confirmations,0);assert.equal(execCount,1);
    const upload='/uploaded.bin';
    // The fixture SFTP adapter closes over its owner, so use a fresh panel for upload interruption.
    const u=new P();u.breakWrite=true;assert.equal(await u._doUpload(upload,local),false);
    let state=JSON.parse(fs.readFileSync(path.join(root,'recovery/resume-state.json'))).states.find(s=>s.remote===upload);assert.equal(state.offset,CHUNK);assert.equal((await fsp.stat(remote(state.temp))).size,2*CHUNK,'unacknowledged write is present');
    const v=new Q();const beforeWire=wireWrite;await v._customActivityTick();await wait(()=>fs.existsSync(remote(upload)));assert(fs.readFileSync(remote(upload)).equals(bytes));assert(wireWrite-beforeWire<bytes.length,'upload must not resend acknowledged prefix');
    assert(!fs.existsSync(remote(state.temp)));assert.equal(confirmations,0);
    // Changed source blocks automatic resume and preserves the partial/destination.
    const c=new P();c.breakWrite=true;await c._doUpload('/changed.bin',local);await fsp.appendFile(local,'changed');const c2=new Q();await c2._customActivityTick();await new Promise(r=>setTimeout(r,80));assert(!fs.existsSync(remote('/changed.bin')));assert.equal(confirmations,0);assert(c2.customTransferRows.some(r=>r.status==='Conflict'));
    // Cross-server automatic recovery must not claim another server's partial.
    const other=new Q('other-host'),beforeExec=execCount;await other._customActivityTick();assert.equal(execCount,beforeExec);
    // Corrupted local partial never becomes a completed download.
    await fsp.writeFile(remote('/corrupt.bin'),bytes);const d=new P();d.breakRead=true;const target=path.join(root,'corrupt-local');await d._doDownload('/corrupt.bin',target,420,bytes.length);state=JSON.parse(fs.readFileSync(path.join(root,'recovery/resume-state.json'))).states.find(s=>s.remote==='/corrupt.bin');await fsp.writeFile(state.temp,Buffer.alloc(CHUNK));const d2=new Q();await d2._customActivityTick();await new Promise(r=>setTimeout(r,80));assert(!fs.existsSync(target));assert(d2.customTransferRows.some(r=>r.status==='Conflict'));
    // Explicit cancellation removes the checkpoint and partial, without auto-retrying.
    const row=d2.customTransferRows.find(r=>r.remotePath==='/corrupt.bin');d2.customCancelTransfer(row);await wait(()=>!fs.existsSync(state.temp));assert.equal(row.status,'Cancelled');
    // Local-edit downloads open the app only after the resumed file is complete.
    await fsp.writeFile(remote('/editable.bin'),bytes);const E=setup(true),ed=new E();ed.breakRead=true;await ed._customExternalEdit({fullPath:'/editable.bin',name:'editable.bin',size:bytes.length,mode:420});assert.equal(opened.length,0);
    const ed2=new E();await ed2._customActivityTick();await wait(()=>opened.length===1);assert(fs.readFileSync(opened[0]).equals(bytes));
    const edit=ed2._customExternalSessions.get('/editable.bin');await wait(()=>!edit.opening);clearInterval(edit.timer);
    const edited=Buffer.from(bytes);edited.write('edit',0);await fsp.writeFile(edit.localPath,edited);await fsp.utimes(edit.localPath,new Date(0),new Date(0));ed2.breakWrite=true;await ed2._customSyncExternal(edit);
    const saved=JSON.parse(fs.readFileSync(journalFile)).states.find(s=>s.operation==='edit-upload');assert(saved);assert(fs.existsSync(saved.local),'immutable snapshot must survive disconnect');
    const ed3=new E();await ed3._customActivityTick();await wait(()=>fs.readFileSync(remote('/editable.bin')).equals(edited));await wait(()=>!fs.existsSync(saved.local));assert(fs.readFileSync(edit.localPath).equals(edited));assert.equal(confirmations,0);
    console.log('PASS: real Python offset helper, reconnect/process-restart auto-resume, no prefix retransmission, lost upload ACK rollback, exact output bytes, changed-source conflict, cross-server isolation, corrupted partial rejection and cancellation cleanup.');
    console.log('PASS: local-edit download resumes before opening app; interrupted immutable save upload is retained, resumed and integrated back into editor sync.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    for(const p of panels)p.ngOnDestroy();for(const child of children)child.kill();await new Promise(r=>setTimeout(r,50));const base=path.resolve(__dirname,'test-fixtures');if(path.resolve(root).startsWith(base+path.sep))await fsp.rm(root,{recursive:true,force:true});
});
