const {app,BrowserWindow,ipcMain}=require('electron'),path=require('path'),fs=require('fs');
const root=path.resolve(__dirname,'../..'),cfg=require('../test-policy.json').renderer;let done=false;
const finish=(ok,message)=>{if(done)return;done=true;console.log((ok?'PASS: ':'FAIL: ')+message);app.exit(ok?0:1);};
// Native keyboard input exercises Chromium's focused-button activation.
ipcMain.handle('fixture:key', (event, key) => {
 event.sender.focus();event.sender.sendInputEvent({type:'keyDown',keyCode:key});if(key==='Enter')event.sender.sendInputEvent({type:'char',keyCode:'\r'});event.sender.sendInputEvent({type:'keyUp',keyCode:key});
});
ipcMain.on('fixture:result',(_event,result)=>finish(result.ok,result.message));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:cfg.width,height:cfg.height,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});
 win.webContents.on('render-process-gone',(_e,d)=>finish(false,'renderer gone: '+d.reason));
 win.webContents.on('unresponsive',()=>finish(false,'renderer unresponsive'));
 const html=path.join(root,'recovery','renderer-fixture.html');fs.mkdirSync(path.dirname(html),{recursive:true});
 fs.writeFileSync(html,'<!doctype html><meta charset="UTF-8"><fixture-root></fixture-root><script>require('+JSON.stringify(path.join(__dirname,'renderer.cjs'))+')</script>','utf8');
 await win.loadFile(html);
});
setTimeout(()=>finish(false,'renderer fixture timed out'),30000);
