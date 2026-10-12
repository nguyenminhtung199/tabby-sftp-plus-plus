const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),{EventEmitter}=require('events');
const policy=require('./transfer-policy.json'),cfg=policy.tabbyDiagnostics;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tabby-diag-'));
try{
 const app=new EventEmitter(),ipcMain=new EventEmitter(),proc=new EventEmitter(),wc=new EventEmitter();wc.id=31;wc.isDestroyed=()=>false;
 app.getVersion=()=> 'fixture';app.getAppMetrics=()=>[{pid:123,type:'Browser',cpu:{percentCPUUsage:1},memory:{workingSetSize:10}}];proc.pid=123;proc.versions={electron:'fixture'};
 let tick,cleared=false;const exports={exports:{}};
 const context={module:exports,process:proc,Buffer,Date,setInterval(fn){tick=fn;return {unref(){}};},clearInterval(){cleared=true;},require(name){if(name==='electron')return {app,ipcMain,webContents:{getAllWebContents:()=>[wc]}};if(name==='./transfer-policy.json')return policy;return require(name);}};
 vm.runInNewContext(fs.readFileSync('tabby-main-diagnostics.cjs','utf8'),context);
 const install=exports.exports;assert.equal(install({root}),false);assert.equal(app.eventNames().length,0);
 fs.writeFileSync(path.join(root,cfg.enabledMarker),'on');fs.writeFileSync(path.join(root,cfg.file),'x'.repeat(cfg.maxBytes));
 assert.equal(install({root}),true);assert.equal(install({root}),true);assert.equal(app.listenerCount('child-process-gone'),1);
 const event={sender:wc,preventDefault(){throw Error('cancelled');}};ipcMain.emit(cfg.channel,event);
 wc.emit('unresponsive',event);wc.emit('responsive',event);wc.emit('render-process-gone',event,{reason:'crashed',exitCode:9,privateField:'do not log'});
 app.emit('child-process-gone',event,{type:'GPU',reason:'killed',exitCode:1,serviceName:'do not log'});tick();
 const rows=fs.readFileSync(path.join(root,cfg.file),'utf8').trim().split('\n').map(JSON.parse);
 for(const phase of ['main:diagnostics:ready','renderer:unresponsive','renderer:responsive','renderer:gone','child:gone','main:heartbeat'])assert.ok(rows.some(r=>r.phase===phase));
 assert.ok(rows.every(r=>!JSON.stringify(r).includes('do not log')));assert.ok(fs.existsSync(path.join(root,cfg.backupFile)));
 const heartbeat=rows.find(r=>r.phase==='main:heartbeat');assert.equal(heartbeat.renderers[0].webContentsId,31);assert.ok(heartbeat.renderers[0].heartbeatAgeMs>=0);
 fs.unlinkSync(path.join(root,cfg.enabledMarker));tick();assert.ok(cleared);assert.equal(app.eventNames().length,0);assert.equal(wc.eventNames().length,0);assert.equal(ipcMain.listenerCount(cfg.channel),0);assert.equal(proc.eventNames().length,0);
 // Test renderer bootstrap without an Electron process or network access.
 const loaderModule={exports:{}},sent=[];let deferred,rendererTick,remoteCalls=0;
 const loaderContext={module:loaderModule,__dirname:__dirname,process:{pid:777},setTimeout(fn){deferred=fn;},setInterval(fn){rendererTick=fn;return {unref(){}};},clearInterval(){},require(name){if(name==='./transfer-policy.json')return policy;if(name==='@electron/remote')return {require(file){remoteCalls++;assert.equal(file,path.join(__dirname,'tabby-main-diagnostics.cjs'));return args=>{assert.equal(args.root,root);return true;};}};if(name==='electron')return {ipcRenderer:{send:channel=>sent.push(channel)}};return require(name);}};
 vm.runInNewContext(fs.readFileSync('tabby-diagnostics-loader.cjs','utf8'),loaderContext);
 loaderModule.exports({root});assert.equal(deferred,undefined);
 fs.writeFileSync(path.join(root,cfg.enabledMarker),'on');loaderModule.exports({root});assert.equal(remoteCalls,0);deferred();assert.equal(remoteCalls,1);rendererTick();assert.deepEqual(sent,[cfg.channel,cfg.channel]);
 fs.unlinkSync(path.join(root,cfg.enabledMarker));rendererTick();assert.equal(sent.length,2);
 console.log('PASS: main observer is opt-in and deduplicated; renderer/GPU/hang events and heartbeat persist; rotation is bounded; marker removal detaches all observers; no private fields or cancelled events.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
