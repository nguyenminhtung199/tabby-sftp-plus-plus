const assert=require('assert/strict'),fs=require('fs/promises'),path=require('path'),os=require('os');
const install=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/drop-diagnostics.cjs')),cfg=require('./transfer-policy.json').dropDiagnostics;
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sftp-drop-diagnostics-'));
 try{
  class Disabled{onDrop(){return 9;}}const original=Disabled.prototype.onDrop;
  assert.equal(install({Panel:Disabled,root}),undefined);assert.equal(Disabled.prototype.onDrop,original);
  await fs.writeFile(path.join(root,cfg.enabledMarker),'enabled');let resolveDrop;
  class Panel{constructor(){this.connected=true;this._upQueue=[{}];this._upActiveCount=0;this._uploadConcurrency=2;this.transfers=[];this.zone={runOutsideAngular:fn=>fn()};}onDrop(){return new Promise(resolve=>{resolveDrop=resolve;});}_streamUploadOne(){const entry={};entry._customDiagnosticContext=this._customTraceQueueEntry(entry);return Promise.resolve(entry);}_runQueuedUpload(job){return this._doDownload();}_doDownload(){return Promise.resolve(true);}_safeDetect(){return 7;}_doUpload(){return Promise.reject(Object.assign(Error('fixture'),{code:'E_TEST'}));}}
  const tracer=install({Panel,root}),p=new Panel(),work=p.onDrop();
  assert.equal(p._safeDetect(),7);
  await assert.rejects(p._doUpload(),{code:'E_TEST'});
  await new Promise(resolve=>setTimeout(resolve,cfg.heartbeatMs+100));p._upQueue=[];resolveDrop('unchanged-result');assert.equal(await work,'unchanged-result');await tracer.flush();
  const rows=(await fs.readFile(path.join(root,cfg.file),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(rows.some(row=>row.phase==='onDrop:start'));assert.ok(rows.some(row=>row.phase==='heartbeat'&&row.queueLength===1&&row.concurrency===2));assert.ok(rows.some(row=>row.phase==='_doUpload:error'&&row.errorCode==='E_TEST'));assert.ok(rows.some(row=>row.phase==='onDrop:end'&&row.queueLength===0));
  const entry=await p._streamUploadOne();await p._runQueuedUpload({entry});await tracer.flush();
  const extraRows=(await fs.readFile(path.join(root,cfg.file),'utf8')).trim().split('\n').map(JSON.parse);const queued=extraRows.find(row=>row.phase==='_runQueuedUpload:start');const downloaded=extraRows.find(row=>row.phase==='_doDownload:start');
  assert.equal(queued.operationId,entry._customDiagnosticContext.operationId);assert.equal(queued.jobId,entry._customDiagnosticContext.jobId);assert.equal(downloaded.operationId,queued.operationId);assert.equal(downloaded.parentSpanId,queued.spanId);
  p._customTraceClipboard('clipboard:key-route',{owned:true});const durable=(await fs.readFile(path.join(root,cfg.file),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(durable.some(row=>row.phase==='clipboard:key-route'&&row.owned===true));
  assert.ok(rows.every(row=>!('filePath'in row)&&!('host'in row)&&!('contents'in row)));
  console.log('PASS: diagnostics are opt-in; async phase/heartbeat records persist; queue state is visible; action returns/errors are preserved; file content and server addresses are not logged.');
 }finally{await fs.unlink(path.join(root,cfg.enabledMarker)).catch(()=>{});await fs.unlink(path.join(root,cfg.file)).catch(()=>{});await fs.rmdir(root);}
})().catch(error=>{console.error(error);process.exitCode=1;});
