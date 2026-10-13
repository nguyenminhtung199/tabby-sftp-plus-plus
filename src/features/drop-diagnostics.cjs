module.exports=function installDropDiagnostics({apis,Panel,root}){
 const fs=require('fs'),path=require('path'),createContext=require('../runtime/sync-context.cjs'),cfg=require('../../transfer-policy.json').dropDiagnostics;
 if(!fs.existsSync(path.join(root,cfg.enabledMarker)))return;
 fs.mkdirSync(root,{recursive:true});const scope=createContext(),panels=new WeakMap(),jobs=new WeakMap(),spans=new Map();
 const observedZones=new WeakSet();
 const file=path.join(root,cfg.file);let writes=Promise.resolve(),pending=0,records=0,nextPanel=0,nextJob=0,nextOperation=0,nextSpan=0,timer,last,owner;
 const outside=(p,fn)=>p?.zone?.runOutsideAngular?p.zone.runOutsideAngular(fn):fn();
 const panelId=p=>{if(!p)return undefined;if(!panels.has(p))panels.set(p,++nextPanel);return panels.get(p);};
 const snapshot=p=>({panelId:panelId(p),connected:!!p?.connected,destroyed:!!p?._destroyed,uploadQueue:p?._upQueue?.length,downloadQueue:p?._dlQueue?.length,queueLength:p?._upQueue?.length,activeUploads:p?._upActiveCount,activeDownloads:p?._dlActiveCount,concurrency:p?._uploadConcurrency,downloadConcurrency:p?._downloadConcurrency,transfers:p?.transfers?.length,lastTransferBytes:p?.transfers?.at(-1)?.bytesDone,lastTransferQueued:p?.transfers?.at(-1)?.queued});
 function record(p,phase,data={},frame=scope.getStore()){
  if(records>=cfg.maxRecords||pending>=cfg.maxPendingRecords)return;
  records++;pending++;
  const line=JSON.stringify({time:new Date().toISOString(),pid:process.pid,operationId:frame?.operationId,spanId:frame?.spanId,parentSpanId:frame?.parentSpanId,jobId:frame?.jobId,phase,...snapshot(p),...data})+'\n';
  if(cfg.criticalSyncPhases.includes(phase)){outside(p,()=>{try{fs.appendFileSync(file,line,'utf8');}catch{}finally{pending--;}});return;}
  outside(p,()=>{writes=writes.then(()=>fs.promises.appendFile(file,line,'utf8')).catch(()=>{}).finally(()=>pending--);});
 }
 function errorData(error){
  const frames=String(error?.stack||'').split('\n').slice(1,cfg.maxErrorFrames+1).map(line=>{const match=line.match(/at\s+([^ (]+).*?:(\d+):(\d+)\)?$/);return match?{function:match[1],line:Number(match[2]),column:Number(match[3])}:undefined;}).filter(Boolean);
  return {errorType:error?.name,errorCode:error?.code,errorFrames:frames};
 }
 function start(p,method,frame){
  owner=p;
  if(p?.zone?.onError?.subscribe&&!observedZones.has(p.zone)){observedZones.add(p.zone);outside(p,()=>p.zone.onError.subscribe(error=>record(owner,'runtime:zone:error',errorData(error))));}
  spans.set(frame.spanId,{frame,method,started:Date.now()});record(p,method+':start',{},frame);
  if(!timer){last=Date.now();outside(p,()=>{timer=setInterval(()=>{
   const now=Date.now();record(owner,'heartbeat',{activeStages:spans.size,lagMs:now-last-cfg.heartbeatMs,inflight:[...spans.values()].slice(0,cfg.heartbeatMaxSpans).map(s=>({operationId:s.frame.operationId,jobId:s.frame.jobId,spanId:s.frame.spanId,method:s.method,ageMs:now-s.started}))});last=now;
   if(records>=cfg.maxRecords||owner?._destroyed){clearInterval(timer);timer=null;}
  },cfg.heartbeatMs);timer.unref?.();});}
 }
 function finish(p,method,frame,error,result){
  const span=spans.get(frame.spanId);record(p,method+(error?':error':':end'),{durationMs:span?Date.now()-span.started:undefined,result:typeof result==='boolean'?result:undefined,...(error?errorData(error):{})},frame);
  spans.delete(frame.spanId);if(!spans.size&&timer){clearInterval(timer);timer=null;}
 }
 const trace=function(phase,data){const parent=scope.getStore();const frame=data?.transferId?{operationId:process.pid+'-transfer-'+data.transferId,parentSpanId:parent?.spanId,jobId:parent?.jobId}:parent;record(this,phase,data,frame);return outside(this,()=>writes);};
 apis.Panel._customTraceClipboard=trace;apis.Panel._customTraceTransfer=trace;
 apis.Panel._customTraceQueueEntry=function(entry){
  if(!jobs.has(entry))jobs.set(entry,{operationId:scope.getStore()?.operationId||process.pid+'-o'+(++nextOperation),jobId:process.pid+'-j'+(++nextJob)});
  return jobs.get(entry);
 };
 for(const method of cfg.methods){
  const original=apis.Panel[method];if(typeof original!=='function')continue;
  apis.Panel[method]=function(...args){
   const parent=scope.getStore(),saved=args[0]?.entry?._customDiagnosticContext;
   const frame={operationId:saved?.operationId||parent?.operationId||process.pid+'-o'+(++nextOperation),jobId:saved?.jobId||parent?.jobId,spanId:process.pid+'-s'+(++nextSpan),parentSpanId:parent?.spanId};
   return scope.run(frame,()=>{
    start(this,method,frame);
    if(cfg.flushBeforeMethods.includes(method))return outside(this,async()=>{
     await writes;try{const result=await scope.run(frame,()=>original.apply(this,args));finish(this,method,frame,null,result);return result;}catch(error){finish(this,method,frame,error);throw error;}
    });
    try{const result=original.apply(this,args);if(result?.then)return outside(this,()=>Promise.resolve(result).then(value=>{finish(this,method,frame,null,value);return value;},error=>{finish(this,method,frame,error);throw error;}));finish(this,method,frame,null,result);return result;}catch(error){finish(this,method,frame,error);throw error;}
   });
  };
 }
 // Observe failures without cancelling browser events or replacing Tabby's handlers.
 if(typeof window!=='undefined'&&window.addEventListener){
  outside(null,()=>{
   window.addEventListener('error',event=>record(owner,'runtime:window:error',errorData(event.error)));
   window.addEventListener('unhandledrejection',event=>record(owner,'runtime:promise:error',errorData(event.reason)));
  });
 }
 record(null,'diagnostics:ready');return {flush:()=>writes};
};
