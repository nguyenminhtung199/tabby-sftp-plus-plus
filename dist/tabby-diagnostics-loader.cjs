module.exports=function install({root}){
 const fs=require('fs'),path=require('path'),cfg=require('./transfer-policy.json').tabbyDiagnostics;
 const marker=path.join(root,cfg.enabledMarker);if(!fs.existsSync(marker))return;
 // Defer the single remote installation until module initialization finishes.
 const outside=fn=>{const Zone=globalThis.Zone;return Zone?.root?Zone.root.run(fn):fn();};
 outside(()=>setTimeout(()=>{
  if(!fs.existsSync(marker))return;
  let stage='remote:load';
  try{
   const remote=require('@electron/remote');stage='remote:require';
   const bridge=remote.require(path.join(__dirname,'tabby-main-diagnostics.cjs'));stage='main:install';
   const started=typeof bridge==='function'?bridge({root}):bridge.install({root});
   if(!started)return;
   stage='renderer:heartbeat';
   const {ipcRenderer}=require('electron');
   let timer;
   const beat=()=>{try{ipcRenderer.send(cfg.channel);}catch{if(timer)clearInterval(timer);}};
   timer=setInterval(()=>{if(!fs.existsSync(marker)){clearInterval(timer);return;}beat();},cfg.rendererHeartbeatMs);
   timer.unref?.();beat();
  }catch(error){try{fs.appendFileSync(path.join(root,cfg.file),JSON.stringify({time:new Date().toISOString(),pid:process.pid,phase:'renderer:diagnostics-install:error',stage,errorType:error.name,errorCode:error.code,errorFrames:String(error.stack||'').split('\n').slice(1,8).map(line=>{const m=line.match(/at\s+([^ (]+).*?:(\d+):(\d+)\)?$/);return m?{function:m[1],line:Number(m[2]),column:Number(m[3])}:undefined;}).filter(Boolean)})+'\n','utf8');}catch{}}
 },0));
};
