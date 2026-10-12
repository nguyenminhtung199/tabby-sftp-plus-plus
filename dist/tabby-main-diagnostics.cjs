// Temporary observer loaded in Tabby's main process via its existing remote module.
const fs=require('fs'),path=require('path'),cfg=require('./transfer-policy.json').tabbyDiagnostics;
let active;
module.exports=function install({root}){
 if(active)return true;
 const marker=path.join(root,cfg.enabledMarker);if(!fs.existsSync(marker))return false;
 const {app,webContents,ipcMain}=require('electron'),file=path.join(root,cfg.file),backup=path.join(root,cfg.backupFile);
 fs.mkdirSync(root,{recursive:true});let bytes=fs.existsSync(file)?fs.statSync(file).size:0,records=0,lastTick=Date.now(),timer;
 const removals=[],contents=new Map(),beats=new Map();
 const listen=(emitter,event,fn,list=removals)=>{emitter.on(event,fn);list.push(()=>emitter.removeListener(event,fn));};
 const errorData=error=>({errorType:error?.name,errorCode:error?.code,errorFrames:String(error?.stack||'').split('\n').slice(1,cfg.maxErrorFrames+1).map(line=>{const m=line.match(/at\s+([^ (]+).*?:(\d+):(\d+)\)?$/);return m?{function:m[1],line:Number(m[2]),column:Number(m[3])}:undefined;}).filter(Boolean)});
 function record(phase,data={}){
  if(records>=cfg.maxRecords)return;
  try{const line=JSON.stringify({time:new Date().toISOString(),pid:process.pid,phase,...data})+'\n';
   if(bytes+Buffer.byteLength(line)>cfg.maxBytes){if(fs.existsSync(backup))fs.unlinkSync(backup);if(fs.existsSync(file))fs.renameSync(file,backup);bytes=0;}
   fs.appendFileSync(file,line,'utf8');bytes+=Buffer.byteLength(line);records++;
  }catch{} // Diagnostics must not cause an application failure.
 }
 function observe(wc){
  if(wc.isDestroyed()||contents.has(wc.id))return;
  const id=wc.id,cleanup=[];contents.set(id,cleanup);record('renderer:observed',{webContentsId:id});
  listen(wc,'unresponsive',()=>record('renderer:unresponsive',{webContentsId:id}),cleanup);
  listen(wc,'responsive',()=>record('renderer:responsive',{webContentsId:id}),cleanup);
  listen(wc,'render-process-gone',(_event,details)=>record('renderer:gone',{webContentsId:id,reason:details.reason,exitCode:details.exitCode}),cleanup);
  listen(wc,'did-start-loading',()=>record('renderer:loading',{webContentsId:id}),cleanup);
  listen(wc,'did-finish-load',()=>record('renderer:loaded',{webContentsId:id}),cleanup);
  listen(wc,'destroyed',()=>{record('renderer:destroyed',{webContentsId:id});cleanup.forEach(fn=>fn());contents.delete(id);beats.delete(id);},cleanup);
 }
 listen(app,'web-contents-created',(_event,wc)=>observe(wc));
 listen(app,'child-process-gone',(_event,details)=>record('child:gone',{type:details.type,reason:details.reason,exitCode:details.exitCode}));
 listen(app,'before-quit',()=>record('app:before-quit'));
 listen(app,'will-quit',()=>{record('app:will-quit');stop();});
 listen(process,'uncaughtExceptionMonitor',error=>record('main:exception',errorData(error)));
 listen(ipcMain,cfg.channel,event=>{if(!event.sender.isDestroyed()){observe(event.sender);beats.set(event.sender.id,Date.now());}});
 for(const wc of webContents.getAllWebContents())observe(wc);
 function stop(){if(!active)return;clearInterval(timer);removals.forEach(fn=>fn());for(const cleanup of contents.values())cleanup.forEach(fn=>fn());contents.clear();beats.clear();active=undefined;}
 active={stop};record('main:diagnostics:ready',{tabbyVersion:app.getVersion(),electronVersion:process.versions.electron});
 timer=setInterval(()=>{
  if(!fs.existsSync(marker)||records>=cfg.maxRecords){record('main:diagnostics:stopped');stop();return;}
  const now=Date.now();let metrics=[];try{metrics=app.getAppMetrics().slice(0,cfg.maxMetrics).map(m=>({pid:m.pid,type:m.type,cpuPercent:m.cpu?.percentCPUUsage,workingSetKB:m.memory?.workingSetSize}));}catch{}
  record('main:heartbeat',{lagMs:now-lastTick-cfg.heartbeatMs,renderers:[...contents.keys()].map(id=>({webContentsId:id,heartbeatAgeMs:beats.has(id)?now-beats.get(id):null})),metrics});lastTick=now;
 },cfg.heartbeatMs);timer.unref?.();return true;
};
module.exports.stop=()=>active?.stop();
