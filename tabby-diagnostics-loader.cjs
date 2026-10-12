module.exports=function install({root}){
 const fs=require('fs'),path=require('path'),cfg=require('./transfer-policy.json').tabbyDiagnostics;
 const marker=path.join(root,cfg.enabledMarker);if(!fs.existsSync(marker))return;
 // Defer the single remote installation until module initialization finishes.
 const outside=fn=>{const Zone=globalThis.Zone;return Zone?.root?Zone.root.run(fn):fn();};
 outside(()=>setTimeout(()=>{
  if(!fs.existsSync(marker))return;
  try{
   const remote=require('@electron/remote'),started=remote.require(path.join(__dirname,'tabby-main-diagnostics.cjs'))({root});
   if(!started)return;
   const {ipcRenderer}=require('electron');
   let timer;
   const beat=()=>{try{ipcRenderer.send(cfg.channel);}catch{if(timer)clearInterval(timer);}};
   timer=setInterval(()=>{if(!fs.existsSync(marker)){clearInterval(timer);return;}beat();},cfg.rendererHeartbeatMs);
   timer.unref?.();beat();
  }catch(error){try{fs.appendFileSync(path.join(root,cfg.file),JSON.stringify({time:new Date().toISOString(),pid:process.pid,phase:'renderer:diagnostics-install:error',errorType:error.name,errorCode:error.code})+'\n','utf8');}catch{}}
 },0));
};
