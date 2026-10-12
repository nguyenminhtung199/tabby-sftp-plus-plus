module.exports = function installTransferEngine({Panel,resume}) {
    const fs=require('fs'),fsp=fs.promises,path=require('path'),crypto=require('crypto');
    // Downloads copy native memory and finish the disk write before the next read.
    // Uploads overlap one owned disk buffer with one network write (512 KiB bound).
    // Cursor-based russh handles must never receive concurrent read/write calls.
    const permissions=require('./file-permissions.cjs');
    const CHUNK=256*1024;
    const original={upload:Panel.prototype._doUpload,download:Panel.prototype._doDownload};
    const stamp=s=>[s.size,s.mtimeMs,s.ctimeMs,s.ino].join(':');
    const remoteStamp=s=>[s.size,s.modified instanceof Date?s.modified.getTime():s.mtime].join(':');
    const settled=promise=>Promise.resolve(promise).then(value=>({value}),error=>({error}));
    const missing=e=>e.code==='ENOENT'||/no such file|not found/i.test(e.message||'');
    class Transfer {
        constructor(local,size,mode){this._customStream=true;this.local=local;this.size=size;this.mode=mode||420;this.bytes=0;this.complete=false;this.cancelled=false;this.paused=false;this.failed=false;this.error='';this.waiters=[];}
        getName(){return path.basename(this.local);} getSize(){return this.size;} getMode(){return this.mode;}
        getCompletedBytes(){return this.bytes;} isComplete(){return this.complete;} isCancelled(){return this.cancelled;}
        isPaused(){return this.paused;} isFailed(){return this.failed;} getStatus(){return this.error;}
        setStatus(message){this.error=message;this.failed=true;} close(){}
        cancel(){this.userCancelled=true;this.cancelled=true;this.resume();} interrupt(){this.interrupted=true;this.cancelled=true;this.resume();} pause(){this.paused=true;return this.bytes;}
        resume(){this.paused=false;for(const resolve of this.waiters.splice(0))resolve();}
        async gate(panel,session){while(this.paused&&!this.cancelled)await new Promise(r=>this.waiters.push(r));if(this.cancelled||panel._destroyed||!panel.connected||panel.sftpSession!==session)throw new Error('Transfer cancelled or connection closed');}
    }
    async function replaceRemote(session,temp,target){
        try{await session.rename(temp,target);return;}catch(error){
            try{await session.stat(target);}catch{throw error;}
            const backup=target+'.sftp-plus-plus-backup-'+crypto.randomUUID();
            await session.rename(target,backup);
            try{await session.rename(temp,target);}catch(failure){
                try{await session.rename(backup,target);}catch(rollback){throw new Error(failure.message+'; restore remote backup: '+backup+' ('+rollback.message+')');}
                throw failure;
            }
            await session.unlink(backup).catch(()=>{});
        }
    }
    async function run(panel,direction,remote,local,mode,size,operation,track=true,onProgress){
        const session=panel.sftpSession;if(!session?.open)return direction==='upload'?original.upload.call(panel,remote,local,operation):original.download.call(panel,remote,local,mode,size,operation);
        const targets=direction==='upload'?(panel._activeUploadTargets ||= new Set()):(panel._activeDownloadTargets ||= new Set());
        const key=direction==='upload'?remote:local;if(targets.has(key))return false;targets.add(key);
        let transfer,remoteHandle,localHandle,pending,temp,initial,remoteBefore,state,closedSub,retained=false;
        try{
            if(direction==='upload'){initial=await fsp.stat(local);size=initial.size;try{remoteBefore=await session.stat(remote);}catch(e){if(!missing(e))throw e;}}
            else{remoteBefore=await session.stat(remote);size=Number(remoteBefore.size);if(!Number.isSafeInteger(size)||size<0)throw new Error('Cannot determine remote file size');}
            let destination;
            if(direction==='download'){try{destination=stamp(await fsp.stat(local));}catch(e){if(!missing(e))throw e;}}
            if(resume)state=await resume.prepare(panel,direction,remote,local,operation,direction==='upload'?stamp(initial):remoteStamp(remoteBefore),direction==='upload'?(remoteBefore?remoteStamp(remoteBefore):null):(destination||null),size);
            transfer=new Transfer(local,size,mode);transfer.bytes=state?.offset||0;(panel._customStreamTransfers ||= new Set()).add(transfer);
            if(session.closed$)closedSub=session.closed$.subscribe(()=>transfer.interrupt());
            if(track){panel.trackTransfer(transfer,direction,remote,local,operation);await Promise.resolve();}
            const cancelRef=panel._byteTransferCtx?.().cancelRef;
            transfer.cancelRef=cancelRef;if(cancelRef){cancelRef.active ||= new Set();cancelRef.active.add(transfer);cancelRef.current=transfer;}
            await transfer.gate(panel,session);
            if(direction==='download'){
                await fsp.mkdir(path.dirname(local),{recursive:true});temp=state?.temp||local+'.sftp-plus-plus-download-'+crypto.randomUUID();
                localHandle=await fsp.open(temp,state&&fs.existsSync(temp)?'r+':'wx');if(state)await localHandle.truncate(state.offset);
                remoteHandle=state?.offset?await resume.openAt(panel,session,remote,state.offset,'download',state):await session.open(remote,1);
                const read=()=>settled(remoteHandle.read());pending=read();
                while(true){
                    await transfer.gate(panel,session);const result=await pending;pending=null;if(result.error)throw result.error;
                    // Do not retain a zero-copy view over the native addon backing store.
                    // A new native read must not overlap use of the previous native memory.
                    const chunk=Buffer.from(result.value);if(!chunk.length)break;
                    if(chunk.length>CHUNK)throw new Error('SFTP chunk exceeds bounded transfer buffer');
                    if(transfer.bytes+chunk.length>size)throw new Error('Remote file grew while downloading');
                    let written=0;while(written<chunk.length){const r=await localHandle.write(chunk,written,chunk.length-written,transfer.bytes+written);if(!r.bytesWritten)throw new Error('Local write made no progress');written+=r.bytesWritten;}
                    transfer.bytes+=chunk.length;if(state)resume.checkpoint(state,transfer.bytes,chunk);onProgress?.(transfer.bytes);
                    pending=read();
                }
                if(transfer.bytes!==size)throw new Error('Download incomplete: expected '+size+', received '+transfer.bytes);
                const after=await session.stat(remote);if(remoteStamp(after)!==remoteStamp(remoteBefore))throw new Error('Remote file changed while downloading');
                await transfer.gate(panel,session);await localHandle.sync();await localHandle.close();localHandle=null;
                await remoteHandle.close();remoteHandle=null;await fsp.rename(temp,local);temp=null;
            }else{
                temp=state?.temp||remote+'.sftp-plus-plus-upload-'+crypto.randomUUID();remoteHandle=state?.offset?await resume.openAt(panel,session,temp,state.offset,'upload',state):await session.open(temp,2|8|16);localHandle=await fsp.open(local,'r');
                let offset=state?.offset||0;
                const read=()=>{const at=offset;offset+=CHUNK;const buffer=Buffer.alloc(CHUNK);return settled(localHandle.read(buffer,0,CHUNK,at).then(r=>buffer.subarray(0,r.bytesRead)));};
                pending=read();
                while(true){
                    await transfer.gate(panel,session);const result=await pending;pending=null;if(result.error)throw result.error;
                    const chunk=result.value;if(!chunk.length)break;pending=read();
                    await remoteHandle.write(chunk);transfer.bytes+=chunk.length;if(state)resume.checkpoint(state,transfer.bytes,chunk);onProgress?.(transfer.bytes);
                }
                const after=await fsp.stat(local);if(transfer.bytes!==size||stamp(after)!==stamp(initial))throw new Error('Local file changed while uploading; retry after saving');
                await transfer.gate(panel,session);await remoteHandle.close();remoteHandle=null;
                if(typeof session.chmod==='function')await session.chmod(temp,(remoteBefore?.mode ?? mode ?? 420)&0o777);
                const uploaded=await session.stat(temp);if(Number(uploaded.size)!==size)throw new Error('Uploaded size could not be verified');
                let current;try{current=await session.stat(remote);}catch(e){if(!missing(e))throw e;}
                if((!!current)!=(!!remoteBefore)||(current&&remoteStamp(current)!==remoteStamp(remoteBefore)))throw new Error('Remote file changed during upload; local copy retained');
                // Preserve permissions in effect at commit, including special bits.
                // A fresh upload uses the configured new-file mode, not Windows local mode.
                const targetMode=current?permissions.mode(current):permissions.newFileMode;
                await permissions.apply(session,temp,targetMode);
                await transfer.gate(panel,session);await replaceRemote(session,temp,remote);temp=null;
            }
            if(state)resume.finish(state);transfer.complete=true;return true;
        }catch(error){
            retained=!!state&&!transfer?.userCancelled;
            if(state){if(retained)resume.fail(state,error.code==='RESUME_CONFLICT'?'Conflict':(!panel.connected||panel._destroyed||panel.sftpSession!==session||transfer?.interrupted||/connection|closed|disconnect/i.test(error.message)?'Interrupted':'Failed'));else resume.finish(state);}
            if(transfer){transfer.setStatus(error.message);transfer.cancelled=true;}panel.showToast?.((retained?'Transfer interrupted; partial file retained: ':'Transfer failed: ')+path.basename(remote)+' — '+error.message,7000);return false;
        }
        finally{
            if(pending)await pending;
            if(remoteHandle)await remoteHandle.close().catch(()=>{});if(localHandle)await localHandle.close().catch(()=>{});
            if(temp&&!retained){if(direction==='upload')await session.unlink(temp).catch(()=>{});else await fsp.unlink(temp).catch(()=>{});}
            closedSub?.unsubscribe();
            if(transfer){panel._customStreamTransfers?.delete(transfer);const ref=transfer.cancelRef;ref?.active?.delete(transfer);if(ref?.current===transfer)ref.current=null;}
            targets.delete(key);
        }
    }
    Panel.prototype._doUpload=function(remote,local,operation){return run(this,'upload',remote,local,undefined,undefined,operation||'upload');};
    Panel.prototype._doDownload=function(remote,local,mode,size,operation){return run(this,'download',remote,local,mode,size,operation||'download');};
    for(const [direction,method]of [['upload','_doUploadRaw'],['download','_doDownloadRaw']]){
        const fallback=Panel.prototype[method];
        Panel.prototype[method]=function(remote,local,mode,size,onProgress){if(!this.sftpSession?.open)return fallback?.call(this,remote,local,mode,size,onProgress);return run(this,direction,remote,local,mode,size,direction,false,onProgress);};
    }
    for(const direction of ['upload','download']){
        const method=direction==='upload'?'_runQueuedUpload':'_runQueuedDownload',counter=direction==='upload'?'_upActiveCount':'_dlActiveCount',pump=direction==='upload'?'_pumpUploadQueue':'_pumpDownloadQueue';
        const native=Panel.prototype[method];
        Panel.prototype[method]=async function(job){
            if(!job._customRun)return native.call(this,job);
            let ok=false;try{if(this.transfers.includes(job.entry))ok=await job._customRun();}catch(error){this.showToast?.('Queued transfer failed: '+error.message);}finally{this[counter]--;job.finish(ok);this[pump]();}
        };
    }
    Panel.prototype._customQueueEditTransfer=function(direction,remote,local,size,operation,run){
        const pump=direction==='upload'?'_pumpUploadQueue':'_pumpDownloadQueue',queue=direction==='upload'?'_upQueue':'_dlQueue';
        if(!this[pump]||!this.transferLog?.add)return run();
        const log=this.transferLog.add({operation,localPath:local,remotePath:remote,profileName:this.profile?.name,size,duration:0,startTime:Date.now(),pending:true,success:true});
        const entry={transfer:null,direction,name:path.basename(remote),remotePath:remote,localPath:local,percent:0,speed:'',bytesDone:0,bytesTotal:size,paused:false,queued:true,logEntryId:log.id,customEditTransfer:true};
        this.transfers.push(entry);this.transfersMinimized=false;this.transfersHidden=false;this._safeDetect?.();
        return new Promise(resolve=>{
            let done=false;entry._customFinish=ok=>{if(done)return;done=true;
                if(entry.queued&&this.transfers.includes(entry)){this.transferLog.update(entry.logEntryId,{pending:false,success:!!ok,endTime:Date.now(),failReason:ok?'':'Failed before transfer started'});this.transfers=this.transfers.filter(x=>x!==entry);this._safeDetect?.();}
                resolve(ok);
            };
            (this[queue] ||= []).push({entry,_customRun:run,finish:entry._customFinish});this[pump]();
        });
    };
    Panel.prototype._customDownloadForEdit=async function(entry,local){
        return this._customQueueEditTransfer('download',entry.fullPath,local,entry.size,'edit-download',()=>this._doDownload(entry.fullPath,local,entry.mode,entry.size,'edit-download'));
    };
    Panel.prototype._customUploadForEdit=function(remote,local,size,expected){return this._customQueueEditTransfer('upload',remote,local,size,'edit-upload',async()=>{
        if(expected){const st=await this.sftpSession.stat(remote);const time=st.modified instanceof Date?st.modified.getTime():Number(st.mtime||0)*1000;if(Number(st.size)!==expected.size||time!==expected.time){this.showToast?.('Remote file changed while upload was queued; use Retry to review the conflict.');return false;}}
        return this._doUpload(remote,local,'edit-upload');
    });};
    for(const [method,action]of [['pauseTransfer','pause'],['resumeTransfer','resume']]){
        const native=Panel.prototype[method];
        Panel.prototype[method]=function(entry,...args){if(!entry.transfer?._customStream)return native?.call(this,entry,...args);entry.transfer[action]();entry.paused=action==='pause';this._safeDetect?.();};
    }
    const cancel=Panel.prototype.cancelTransfer;
    Panel.prototype.cancelTransfer=function(entry,...args){const queued=entry.queued,inactive=queued||!entry.transfer||entry.transfer.isCancelled?.()||entry.transfer.isComplete?.();if(resume&&entry.direction==='upload'&&this._customPendingEditUpload?.(entry.remotePath)?.local===entry.localPath)void this._customBlockResumedEdit?.(entry.remotePath,entry.localPath).catch(e=>this.showToast?.('Cannot stop edit sync: '+e.message));const result=cancel?.call(this,entry,...args);if(queued)entry._customFinish?.(false);if(inactive&&resume)void resume.discard(this,entry.direction,entry.remotePath,entry.localPath).catch(e=>this.showToast?.('Cannot remove partial: '+e.message));return result;};
    const destroy=Panel.prototype.ngOnDestroy;
    Panel.prototype.ngOnDestroy=function(...args){for(const transfer of this._customStreamTransfers||[])transfer.interrupt();for(const entry of this.transfers||[])entry._customFinish?.(false);return destroy?.apply(this,args);};
};
