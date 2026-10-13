const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),ts=require('typescript');
const install=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/drop-diagnostics.cjs')),cfg=require('./transfer-policy.json').dropDiagnostics;
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sftp-shared-ui-')),previousWindow=global.window,listeners=new Map();
 try{
  fs.writeFileSync(path.join(root,cfg.enabledMarker),'enabled');
  global.window={addEventListener:(type,fn)=>listeners.set(type,fn)};
  let zoneError,subscriptions=0;
  class Panel{constructor(){this.zone={runOutsideAngular:fn=>fn(),onError:{subscribe(fn){zoneError=fn;subscriptions++;}}};}_safeDetect(){return 7;}toggleCustomSidebarPin(){throw Object.assign(Error('fixture'),{code:'PIN_FIXTURE'});}}
  const tracer=install({Panel,root}),panel=new Panel();assert.equal(panel._safeDetect(),7);panel._safeDetect();assert.equal(subscriptions,1);
  const error=Object.assign(Error('private fixture'),{code:'UI_FIXTURE'}),event={error,reason:error,preventDefault(){throw Error('observer cancelled event');}};
  listeners.get('error')(event);listeners.get('unhandledrejection')(event);zoneError(error);
  assert.throws(()=>panel.toggleCustomSidebarPin(),{code:'PIN_FIXTURE'});
  // Critical observations must exist before buffered writes finish.
  let rows=fs.readFileSync(path.join(root,cfg.file),'utf8').trim().split('\n').map(JSON.parse);
  for(const phase of ['runtime:window:error','runtime:promise:error','runtime:zone:error','toggleCustomSidebarPin:error'])assert.ok(rows.some(r=>r.phase===phase));
  assert.ok(rows.every(r=>!JSON.stringify(r).includes('private fixture')));
  await tracer.flush();
  const source=fs.readFileSync('src/features/sidebar.cjs','utf8'),ast=ts.createSourceFile('sidebar.js',source,99,true);let pin;
  function visit(n){if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='m.togglePin')pin=n.right.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(pin);
  let failedStage;const stages=[],calls=[];
  const m={pinned:false,expanded:true,hovering:true,cmp:{_customTraceTransfer:phase=>stages.push(phase),_safeDetect(){calls.push('detect');if(failedStage==='detect')throw error;}},layout(){calls.push('layout');},scheduleCollapse(){calls.push('collapse');}};
  const context={m,save(){calls.push('save');},resizeTerminal(){calls.push('resize');if(failedStage==='resize')throw error;}};
  const toggle=vm.runInNewContext(pin,context);toggle();assert.deepEqual(calls,['save','layout','detect','resize']);assert.equal(stages.at(-1),'sidebar:pin:end');
  for(const stage of ['detect','resize']){failedStage=stage;calls.length=0;stages.length=0;assert.throws(toggle,e=>e===error);assert.ok(stages.includes('sidebar:pin:'+stage+':start'));assert.ok(!stages.includes('sidebar:pin:'+stage+':end'));assert.equal(stages.at(-1),'sidebar:pin:error');}
  console.log('PASS: shared UI observers persist errors without cancelling events; zone subscription deduplicates; real pin function retains ordering and propagates errors with exact stage.');
 }finally{global.window=previousWindow;fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
