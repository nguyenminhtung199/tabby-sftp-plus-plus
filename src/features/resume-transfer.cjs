module.exports = function createResumeTransfer({apis,Panel,root,server}) {
    const fs=require('fs'),fsp=fs.promises,path=require('path'),crypto=require('crypto');
    const file=path.join(root,'resume-state.json'),states=new Map(),attempts=new WeakMap();
    const registry=globalThis[Symbol.for('sftp-plus-plus.resume-owners')] ||= new Map();
    const owners=registry.get(file)||new Map();registry.set(file,owners);
    const metadata=require('../runtime/remote-metadata.cjs');
    const CHUNK=256*1024;
    const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
    const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
    function disk(){try{return JSON.parse(fs.readFileSync(file,'utf8')).states||[];}catch(e){if(e.code==='ENOENT')return [];throw e;}}
    function alive(pid){if(!pid)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
    function refresh(){const current=new Map(disk().map(s=>[s.id,s]));for(const [identity,state] of states)if(owners.has(identity))current.set(identity,state);states.clear();for(const [identity,state] of current){if(state.status==='Running'&&!owners.has(identity)&&!alive(state.ownerPid)){state.status='Interrupted';save(state);}states.set(identity,state);}}
    function save(state,removed){fs.mkdirSync(root,{recursive:true});const entries=new Map(disk().map(s=>[s.id,s]));if(state)entries.set(state.id,state);if(removed)entries.delete(removed);const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify({version:1,states:[...entries.values()]}),{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}}
    try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1)throw Error('Unsupported resume journal');for(const item of data.states||[])states.set(item.id,item);refresh();}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const id=(p,d,r,l,operation)=>hash(Buffer.from(JSON.stringify([server(p),d,r,l,operation])));
    const fail=message=>{const error=new Error(message);error.code='RESUME_CONFLICT';return error;};
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const validTemp=s=>typeof s.temp==='string'&&s.temp.startsWith((s.direction==='upload'?s.remote:s.local)+(s.direction==='upload'?'.sftp-plus-plus-upload-':'.sftp-plus-plus-download-'))&&/^[0-9a-f-]{36}$/i.test(s.temp.slice(s.temp.lastIndexOf(s.direction==='upload'?'.sftp-plus-plus-upload-':'.sftp-plus-plus-download-')+(s.direction==='upload'?'.sftp-plus-plus-upload-':'.sftp-plus-plus-download-').length));
    async function localBoundary(local,offset,n){const h=await fsp.open(local,'r');try{const b=Buffer.alloc(n);const result=await h.read(b,0,n,offset-n);if(result.bytesRead!==n)throw fail('Partial file is shorter than its saved checkpoint.');return hash(b);}finally{await h.close();}}
    // Request/response protocol: the helper emits at most one requested chunk, preserving backpressure.
    const python=`import sys,struct,hashlib,os
mode,p,off,digest,boundarylen=sys.argv[1:]
off=int(off)
boundarylen=int(boundarylen)
f=open(p,'rb' if mode=='download' else 'r+b')
f.seek(off-boundarylen)
if hashlib.sha256(f.read(boundarylen)).hexdigest()!=digest: raise RuntimeError('resume boundary changed')
if mode=='upload':
 if os.fstat(f.fileno()).st_size<off: raise RuntimeError('partial file is shorter than checkpoint')
 f.truncate(off)
f.seek(off)
i=sys.stdin.buffer;o=sys.stdout.buffer
def exact(n):
 b=b''
 while len(b)<n:
  c=i.read(n-len(b))
  if not c: raise EOFError()
  b+=c
 return b
o.write(b'SFTPRES1');o.flush()
while True:
 h=i.read(4)
 if not h: break
 if len(h)!=4: h+=exact(4-len(h))
 n=struct.unpack('!I',h)[0]
 if n==0: break
 if n>262144: raise RuntimeError('invalid chunk size')
 if mode=='download':
  b=f.read(n);o.write(struct.pack('!I',len(b))+b)
 else:
  b=exact(n);f.write(b);f.flush();o.write(struct.pack('!I',len(b)))
 o.flush()
if mode=='upload': f.flush();os.fsync(f.fileno())
f.close()
o.write(struct.pack('!I',0));o.flush()`;
    async function remoteAt(panel,session,remote,offset,direction,boundary,boundarylen){
        const ssh=(panel.sshSession||panel.terminalRef?.session)?.ssh;
        if(!ssh?.openSessionChannel||!ssh.activateChannel)throw Error('Resume requires a seek-capable SFTP adapter or SSH exec with Python 3. Partial file retained.');
        const channel=await ssh.activateChannel(await ssh.openSessionChannel());
        let buffer=Buffer.alloc(0),waiter,dead=false,error,subscriptions=[];
        const reject=e=>{error=e;dead=true;if(waiter){const w=waiter;waiter=null;clearTimeout(w.timer);w.reject(e);}};
        function drain(){if(!waiter||buffer.length<waiter.size)return;const w=waiter;waiter=null;clearTimeout(w.timer);const result=buffer.subarray(0,w.size);buffer=buffer.subarray(w.size);w.resolve(result);}
        function readBytes(size){const promise=dead?Promise.reject(error||Error('Resume SSH channel closed')):waiter?Promise.reject(Error('Concurrent resume reads are not allowed')):new Promise((resolve,rejectRead)=>{waiter={size,resolve,reject:rejectRead,timer:setTimeout(()=>{reject(Error('Resume channel timed out; Python 3 and SSH exec must be available.'));void channel.close();},30000)};drain();});promise.catch(()=>{});return promise;}
        subscriptions.push(channel.data$.subscribe({next:data=>{buffer=Buffer.concat([buffer,Buffer.from(data)]);if(buffer.length>CHUNK+12)reject(Error('Invalid resume response'));else drain();},error:reject}));
        const ended=()=>reject(Error('Resume SSH channel closed; Python 3 may be unavailable or partial file changed.'));
        subscriptions.push(channel.closed$.subscribe(ended));if(channel.eof$)subscriptions.push(channel.eof$.subscribe(ended));
        const close=async()=>{dead=true;if(waiter)reject(Error('Resume channel closed'));for(const s of subscriptions)s.unsubscribe();try{await channel.close();}catch{}};
        try{
            const ready=readBytes(8); // Subscribe before exec so even an immediate response is retained.
            await channel.requestExec('python3 -u -c '+quote(python)+' '+quote(direction)+' '+quote(remote)+' '+quote(offset)+' '+quote(boundary||'')+' '+quote(boundarylen||0));
            if((await ready).toString()!=='SFTPRES1')throw Error('Unexpected resume helper output.');
            let position=offset;
            return {read:async()=>{const n=Buffer.alloc(4);n.writeUInt32BE(CHUNK);const header=readBytes(4);await channel.write(n);const length=(await header).readUInt32BE();if(length>CHUNK)throw Error('Invalid resume chunk');const bytes=length?await readBytes(length):Buffer.alloc(0);position+=length;return bytes;},
                write:async bytes=>{const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);const ack=readBytes(4);await channel.write(Buffer.concat([header,bytes]));if((await ack).readUInt32BE()!==bytes.length)throw Error('Resume write acknowledgement mismatch');position+=bytes.length;},
                close:async()=>{try{if(!dead){const ack=readBytes(4);await channel.write(Buffer.alloc(4));if((await ack).readUInt32BE()!==0)throw Error('Resume final acknowledgement mismatch');}}finally{await close();}}};
        }catch(e){await close();throw e;}
    }
    async function openAt(panel,session,target,offset,direction,state){
        const native=await session.open(target,direction==='download'?1:3);
        try{
            if(typeof native.seek==='function'){
                if(direction==='upload'){
                    const stat=await metadata(session,target);
                    if(stat.size<offset)throw fail('Remote partial file is shorter than checkpoint.');
                    await native.seek(offset-state.boundaryLength);
                    const data=await native.read();if(hash(Buffer.from(data).subarray(0,state.boundaryLength))!==state.boundary)throw fail('Remote partial file changed; restart explicitly.');
                    if(typeof native.truncate==='function')await native.truncate(offset);
                    else if(stat.size!==offset){await native.close();return remoteAt(panel,session,target,offset,direction,state.boundary,state.boundaryLength);}
                }
                await native.seek(offset);return native;
            }
            await native.close();return remoteAt(panel,session,target,offset,direction,state.boundary,state.boundaryLength);
        }catch(e){await native.close().catch(()=>{});throw e;}
    }
    const api={
        async prepare(panel,direction,remote,local,operation,source,destination,size){
            refresh();
            const identity=id(panel,direction,remote,local,operation),old=states.get(identity);
            if(owners.has(identity))throw Error('This resumable transfer is already active.');
            if(old){
                if(!validTemp(old)||!Number.isSafeInteger(old.offset)||old.offset<0||old.offset>size||(old.offset&&(!Number.isInteger(old.boundaryLength)||old.boundaryLength<1||old.boundaryLength>CHUNK||old.boundaryLength>old.offset||!/^[0-9a-f]{64}$/i.test(old.boundary)))){old.status='Conflict';save(old);throw fail('Invalid resume checkpoint; partial file retained.');}
                if(!equal(old.source,source)||!equal(old.destination,destination)||old.size!==size){old.status='Conflict';save(old);throw fail('Source or destination changed. Partial file retained; restart this transfer explicitly.');}
                if(direction==='download'&&old.offset>0){const stat=await fsp.stat(old.temp);if(stat.size<old.offset||await localBoundary(old.temp,old.offset,old.boundaryLength)!==old.boundary){old.status='Conflict';save(old);throw fail('Local partial file changed; restart explicitly.');}}
                old.status='Running';old.ownerPid=process.pid;owners.set(identity,panel);save(old);return old;
            }
            const state={id:identity,server:server(panel),ownerPid:process.pid,direction,remote,local,operation,source,destination,size,offset:0,boundary:'',status:'Running',temp:direction==='upload'?remote+'.sftp-plus-plus-upload-'+crypto.randomUUID():local+'.sftp-plus-plus-download-'+crypto.randomUUID()};
            states.set(identity,state);owners.set(identity,panel);save(state);return state;
        },
        checkpoint(state,offset,chunk){state.offset=offset;state.boundary=hash(chunk);state.boundaryLength=chunk.length;if(offset-(state.savedOffset||0)>=4*1024*1024||Date.now()-(state.savedAt||0)>1000){state.savedOffset=offset;state.savedAt=Date.now();save(state);}},
        finish(state){states.delete(state.id);owners.delete(state.id);save(null,state.id);},
        fail(state,status){if(!state)return;state.status=status;owners.delete(state.id);save(state);},
        openAt,
        has(panel,direction,remote,local){return [...states.values()].some(s=>s.server===server(panel)&&s.direction===direction&&s.remote===remote&&s.local===local);},
        status(panel,direction,remote,local){return [...states.values()].find(s=>s.server===server(panel)&&s.direction===direction&&s.remote===remote&&s.local===local)?.status;},
        findEdit(panel,remote){return [...states.values()].find(s=>s.server===server(panel)&&s.remote===remote&&s.operation==='edit-download');},
        async discard(panel,direction,remote,local){for(const s of [...states.values()])if(s.server===server(panel)&&s.direction===direction&&s.remote===remote&&s.local===local){if(owners.has(s.id))throw Error('Cancel the running transfer first.');if(s.operation==='edit-upload')await panel._customBlockResumedEdit?.(remote,local);if(validTemp(s)){if(s.direction==='download')await fsp.unlink(s.temp).catch(()=>{});else await panel.sftpSession?.unlink(s.temp).catch(()=>{});}api.finish(s);}},
        async auto(panel){
            if(!panel.connected||!panel.sftpSession||panel._destroyed)return;
            refresh();
            let tried=attempts.get(panel);if(!tried){tried=new Map();attempts.set(panel,tried);}
            for(const state of [...states.values()]){
                if(state.server!==server(panel)||state.status!=='Interrupted'||owners.has(state.id)||tried.get(state.id)===panel.sftpSession)continue;
                tried.set(state.id,panel.sftpSession);
                if(state.operation==='edit-download'){void panel._customExternalEdit?.({name:path.posix.basename(state.remote),fullPath:state.remote,size:state.size,mode:420});continue;}
                const row=panel._customTransferRows?.find(r=>r.direction===state.direction&&r.remotePath===state.remote&&r.localPath===state.local&&!['Completed','Cancelled'].includes(r.status));
                if(row){if(row._retryBusy||['Running','Queued','Paused'].includes(row.status)){tried.delete(state.id);continue;}void panel.customRetryTransfer(row,true);continue;}
                void panel._customQueueEditTransfer(state.direction,state.remote,state.local,state.size,state.operation,async()=>{
                    const ok=state.direction==='upload'?await panel._doUpload(state.remote,state.local,state.operation):await panel._doDownload(state.remote,state.local,420,state.size,state.operation);
                    if(ok&&state.operation==='edit-upload')await panel._customResumeUploadedEdit?.(state.remote,state.local);
                    return ok;
                });
            }
        }
    };
    apis.Panel._customHasPartial=function(direction,remote,local){return api.has(this,direction,remote,local);};
    apis.Panel._customPartialStatus=function(direction,remote,local){return api.status(this,direction,remote,local);};
    apis.Panel._customPendingEditUpload=function(remote){return [...states.values()].find(s=>s.server===server(this)&&s.remote===remote&&s.operation==='edit-upload');};
    apis.Panel._customRetrySavedEditUpload=async function(remote){
        const state=this._customPendingEditUpload(remote);if(!state||owners.has(state.id))return false;
        return this._customQueueEditTransfer('upload',state.remote,state.local,state.size,'edit-upload',async()=>{
            const ok=await this._doUpload(state.remote,state.local,'edit-upload');
            if(ok)await this._customResumeUploadedEdit?.(state.remote,state.local);return ok;
        });
    };
    apis.Panel._customResumeLocalForEdit=function(remote){return api.findEdit(this,remote)?.local;};
    apis.Panel._customAutoResumeTransfers=function(){return api.auto(this);};
    apis.Panel._customDiscardPartial=function(direction,remote,local){return api.discard(this,direction,remote,local);};
    return api;
};
