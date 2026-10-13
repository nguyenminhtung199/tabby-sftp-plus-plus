const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const pluginRequire=createRequire(path.resolve(__dirname,'../plugins/node_modules/tabby-sftp-plus-plus/package.json'));
const generic=new Proxy({}, {get:(_,key)=>key==='__esModule'?true:class{}});
const sandbox={module:{exports:{}},exports:{},console,Buffer,process:{env:{...process.env,APPDATA:path.join(__dirname,'test-ui-unused')}},setTimeout,clearTimeout,setInterval,clearInterval,
    CompositionEvent:class{},FocusEvent:class{},ClipboardEvent:class{},Event:class{},KeyboardEvent:class{},MouseEvent:class{},WheelEvent:class{},DragEvent:class{},HTMLElement:class{},Element:class{},window:{},document:{},localStorage:{getItem:()=>null,setItem(){}},
    require(name){if(name==='@angular/core')return pluginRequire(name);if(name.startsWith('tabby-')||['@angular/common','@angular/forms'].includes(name))return generic;if(name==='electron')return {shell:{openPath:async()=>''}};return pluginRequire(name);}};
sandbox.global=sandbox;
vm.runInNewContext(fs.readFileSync(process.env.SFTP_TEST_BUNDLE_PATH||path.join(__dirname,'dist/index.js'),'utf8').replace('const so=to;','globalThis.testProgress=pi;const so=to;'),sandbox);
if(sandbox.module.exports.testing)sandbox.testProgress=sandbox.module.exports.testing.PanelTransferRuntime;
const panel=sandbox.module.exports.default.__annotations__[0].declarations.find(c=>c.prototype._customExternalEdit);
(async()=>{
    let outside=0,starts=0;
    const zone={run:fn=>fn(),runOutsideAngular:fn=>{starts++;outside++;try{return fn();}finally{outside--;}}};
    const logs=[],host={connected:true,transfers:[],zone,profile:{name:'test'},detectChanges(){},formatSpeed:()=>''};
    host.transferLog={add:row=>{const log={id:logs.length+1,...row};logs.push(log);return log;},update:(id,change)=>Object.assign(logs.find(row=>row.id===id),change)};
    const runtime=new sandbox.testProgress(host);let complete=false,failed=false;
    const transfer={_customStream:true,getSize:()=>100,getName:()=> 'file.txt',getCompletedBytes:()=>100,isComplete:()=>complete,isCancelled:()=>failed,isFailed:()=>failed};
    await runtime.trackTransfer(transfer,'download','/file.txt','C:/file.txt','download');assert.equal(starts,1);
    runtime._tickAllTransfers();assert.equal(host.transfers.length,1);assert.equal(logs[0].pending,true);
    complete=true;runtime._tickAllTransfers();assert.equal(host.transfers.length,0);assert.equal(logs[0].success,true);
    complete=false;await runtime.trackTransfer(transfer,'download','/file.txt','C:/file.txt','download');failed=true;
    runtime._tickAllTransfers();assert.equal(logs[1].success,false);runtime.dispose();
    const p=Object.create(panel.prototype);Object.assign(p,{zone,transfers:[],_dlQueue:[],_dlActiveCount:1,_downloadConcurrency:1,_safeDetect(){},showToast(){},_customRestoreEdits(){},connected:true,_destroyed:false,_customExternalSessions:new Map()});
    let downloadOutside=false,editOutside=false;
    p._transferCoordinator={streamDownloadOne:()=>{downloadOutside=outside>0;return Promise.resolve();}};
    const job={entry:{localPath:'C:/file.txt'},file:{fullPath:'/file.txt'},finish(){}};p.transfers.push(job.entry);
    await p._runQueuedDownload(job);assert.equal(downloadOutside,true);
    p.sftpSession={stat:()=>{editOutside=outside>0;throw Error('test stop before file access');}};
    await p._customExternalEdit({fullPath:'/file.txt',name:'file.txt',size:100});assert.equal(editOutside,true);

    // Local metadata must not block the renderer, even for an immediately small file.
    const fsp=fs.promises,root=await fsp.mkdtemp(path.join(require('os').tmpdir(),'sftp-drop-')),tiny=path.join(root,'tiny.py');await fsp.writeFile(tiny,'x');
    const originalStat=fsp.stat,originalSync=fs.statSync;let releaseStat,queued=false;
    fsp.stat=(file,...args)=>file===tiny?new Promise(resolve=>{releaseStat=resolve;}):originalStat(file,...args);
    fs.statSync=(file,...args)=>{if(file===tiny)throw Error('sync stat blocks UI');return originalSync(file,...args);};
    try{
      const q=Object.create(panel.prototype);Object.assign(q,{connected:true,sftpSession:{},remotePath:'/before',transfers:[],_upQueue:[],_safeDetect(){},transferLog:{add:row=>({id:1,...row})},_pumpUploadQueue(){queued=true;const job=this._upQueue.shift();assert.equal(job.remoteDir,'/before');assert.equal(job.entry.bytesTotal,1);job.entry.queued=false;job.finish();}});
      const work=q._streamUploadOne(tiny);q.remotePath='/after';await new Promise(resolve=>setImmediate(resolve));assert.equal(queued,false,'event loop keeps running while metadata is pending');releaseStat(await originalStat(tiny));await work;assert.equal(queued,true);
    }finally{fsp.stat=originalStat;fs.statSync=originalSync;await fsp.unlink(tiny);await fsp.rmdir(root);}

    console.log('PASS: real bundle Download/Edit and progress timer execute outside Angular; 100% waits for verification; final failures remain failures.');
})().catch(error=>{console.error(error);process.exitCode=1;});
