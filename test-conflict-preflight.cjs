const assert=require('assert/strict'),fs=require('fs'),path=require('path'),Module=require('module');
const header=fs.readFileSync('test-context-menu.cjs','utf8').split('(async()=>{')[0],harness=new Module(path.join(__dirname,'preflight-harness.cjs'),module);harness.filename=path.join(__dirname,'preflight-harness.cjs');harness.paths=module.paths;harness._compile(header+'\nmodule.exports=sandbox.module.exports.testing;',harness.filename);
const {PanelPasteAdapter}=harness.exports;
(async()=>{
 const count=5000,sourceTime=1700000000000,targetTime=1710000000000,queue=[],reads=new Map();let sourceSize=11,targetSize=22,heartbeat=false;
 const entries=size=>Array.from({length:count},(_,i)=>({name:'file'+i+'.txt',isDirectory:false,size,modified:new Date(size===sourceSize?sourceTime:targetTime)}));
 const session={readdir:async folder=>{reads.set(folder,(reads.get(folder)||0)+1);if(folder==='/dest')return [{name:'tree',isDirectory:true}];if(folder==='/src/tree')return entries(sourceSize);if(folder==='/dest/tree')return entries(targetSize);throw Object.assign(Error('No such file'),{code:'ENOENT'});}};
 const host={sftpSession:session,i18n:{t:s=>s},getConflictQueueLength:()=>queue.length,enqueueConflict:item=>queue.push(item),savePendingPaste(){},setConflictOriginalTotal(){},showConflictDialog(){}};
 const adapter=new PanelPasteAdapter(host),input=[{name:'tree',fullPath:'/src/tree',isDirectory:true}];
 const timer=setTimeout(()=>{heartbeat=true;},0),started=performance.now();await adapter.paste(input,'remote','/dest','copy','remote');clearTimeout(timer);
 assert.equal(queue.length,count);assert.equal([...reads.values()].reduce((a,b)=>a+b,0),3,'one read for destination parent, source folder and destination folder');assert.ok(heartbeat,'large preflight yields so renderer input/timers can run');
 assert.equal(queue[0].remoteFileSize,11);assert.equal(queue[0].localStat.size,22);assert.equal(queue[0].remoteFileMtime,sourceTime);assert.equal(queue[0].localStat.mtimeMs,targetTime);
 console.log(JSON.stringify({files:count,directoryReads:3,elapsedMs:Math.round(performance.now()-started),heartbeat}));
 // Each new operation gets fresh snapshots, including changed server-side data.
 queue.length=0;sourceSize=33;targetSize=44;await adapter.paste(input,'remote','/dest','copy','remote');assert.equal(queue[0].remoteFileSize,33);assert.equal(queue[0].localStat.size,44);assert.ok([...reads.values()].every(n=>n===2));
 queue.length=0;host.sftpSession={readdir:async()=>{throw Error('Permission denied');}};await assert.rejects(adapter.paste(input,'remote','/dest','copy','remote'),/Permission denied/);
 console.log('PASS: bounded per-folder preflight reads, event-loop responsiveness, fresh snapshots per operation, distinct source/destination sizes and dates, and permission errors retained.');
})().catch(error=>{console.error(error);process.exitCode=1;});
