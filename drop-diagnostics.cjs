module.exports=function installDropDiagnostics({Panel,root}){
    const fs=require('fs'),path=require('path'),cfg=require('./transfer-policy.json').dropDiagnostics;
    if(!fs.existsSync(path.join(root,cfg.enabledMarker)))return;
    fs.mkdirSync(root,{recursive:true});
    const file=path.join(root,cfg.file);let writes=Promise.resolve(),pending=0,records=0,active=0,timer,last,owner;
    const outside=(p,fn)=>p?.zone?.runOutsideAngular?p.zone.runOutsideAngular(fn):fn();
    const snapshot=p=>({connected:!!p?.connected,destroyed:!!p?._destroyed,queueLength:p?._upQueue?.length,activeUploads:p?._upActiveCount,concurrency:p?._uploadConcurrency,transfers:p?.transfers?.length,lastTransferBytes:p?.transfers?.at(-1)?.bytesDone,lastTransferQueued:p?.transfers?.at(-1)?.queued});
    function record(p,phase,data={}){
        if(records>=cfg.maxRecords||pending>=cfg.maxPendingRecords)return;
        records++;pending++;
        const line=JSON.stringify({time:new Date().toISOString(),pid:process.pid,phase,...snapshot(p),...data})+'\n';
        outside(p,()=>{writes=writes.then(()=>fs.promises.appendFile(file,line,'utf8')).catch(()=>{}).finally(()=>pending--);});
    }
    function start(p,method){
        owner=p;active++;record(p,method+':start');
        if(!timer){last=Date.now();outside(p,()=>{timer=setInterval(()=>{
            const now=Date.now();record(owner,'heartbeat',{activeStages:active,lagMs:now-last-cfg.heartbeatMs});last=now;
            if(records>=cfg.maxRecords||owner?._destroyed){clearInterval(timer);timer=null;}
        },cfg.heartbeatMs);timer.unref?.();});}
    }
    function finish(p,method,error){
        record(p,method+(error?':error':':end'),error?{errorType:error.name,errorCode:error.code}:{});
        active--;if(!active&&timer){clearInterval(timer);timer=null;}
    }
    Panel.prototype._customTraceClipboard=function(phase,data){record(this,phase,data);return outside(this,()=>writes);};
    for(const method of cfg.methods){
        const original=Panel.prototype[method];if(typeof original!=='function')continue;
        Panel.prototype[method]=function(...args){
            start(this,method);
            if(cfg.flushBeforeMethods.includes(method))return outside(this,async()=>{
                await writes;
                try{const result=await original.apply(this,args);finish(this,method);return result;}
                catch(error){finish(this,method,error);throw error;}
            });
            try{
                const result=original.apply(this,args);
                if(result?.then)return outside(this,()=>Promise.resolve(result).then(value=>{finish(this,method);return value;},error=>{finish(this,method,error);throw error;}));
                finish(this,method);return result;
            }catch(error){finish(this,method,error);throw error;}
        };
    }
    record(null,'diagnostics:ready');
    return {flush:()=>writes};
};
