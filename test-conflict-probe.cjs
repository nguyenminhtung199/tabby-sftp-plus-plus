const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const pluginRequire=createRequire(path.resolve(__dirname,'../plugins/node_modules/tabby-sftp-plus-plus/package.json'));
const generic=new Proxy({}, {get:(_,key)=>key==='__esModule'?true:class{}});
let asyncLstat=0,asyncStat=0;
let danglingPath;const danglingStat={size:0,mtimeMs:0,isSymbolicLink:()=>true};
const probeFs={...fs,lstatSync:(name,...args)=>name===danglingPath?danglingStat:fs.lstatSync(name,...args)};
const asyncFs={...fs.promises,lstat:async(name,...args)=>{asyncLstat++;return name===danglingPath?danglingStat:fs.promises.lstat(name,...args);},stat:async(...args)=>{asyncStat++;return fs.promises.stat(...args);}};
const sandbox={module:{exports:{}},exports:{},console,Buffer,process,setTimeout,clearTimeout,setInterval,clearInterval,CompositionEvent:class{},FocusEvent:class{},ClipboardEvent:class{},Event:class{},KeyboardEvent:class{},MouseEvent:class{},WheelEvent:class{},DragEvent:class{},HTMLElement:class{},Element:class{},window:{},document:{},localStorage:{getItem:()=>null,setItem(){}},require(name){if(name==='fs')return probeFs;if(name==='fs/promises')return asyncFs;if(name==='@angular/core')return pluginRequire(name);if(name.startsWith('tabby-')||['@angular/common','@angular/forms'].includes(name))return generic;if(name==='electron')return {shell:{openPath:async()=>''}};return pluginRequire(name);}};
sandbox.global=sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'dist/index.js'),'utf8').replace('const so=to;','globalThis.__testConflict=Is;const so=to;'),sandbox);
const fixture=fs.mkdtempSync(path.join(__dirname,'test-fixtures-conflict-'));
(async()=>{
 try{
  const detector=new sandbox.__testConflict(()=>null);let digests=0,skips=0;
  detector._resolveDigest=async()=>{digests++;return {localDigest:'local',remoteDigest:'remote'};};detector.onAutoSkipped=()=>skips++;
  const missing=path.join(fixture,'missing.py');
  assert.equal((await detector.checkLocalConflict(missing,'/missing.py',10,1000)).kind,'no-conflict');
  assert.equal(asyncLstat,0,'missing destination never invokes async lstat');assert.equal(asyncStat,0);assert.equal(digests,0);
  const existing=path.join(fixture,'existing.py');fs.writeFileSync(existing,'original content');const stat=fs.statSync(existing);
  assert.equal((await detector.checkLocalConflict(existing,'/existing.py',stat.size,stat.mtimeMs)).kind,'auto-skipped');assert.equal(skips,1);assert.equal(digests,0);
  assert.equal((await detector.checkLocalConflict(existing,'/existing.py',stat.size+1,stat.mtimeMs+10000)).kind,'conflict');assert.equal(digests,1);assert.equal(fs.readFileSync(existing,'utf8'),'original content');
  detector._resolveDigest=async()=>({localDigest:'same',remoteDigest:'same'});
  assert.equal((await detector.checkLocalConflict(existing,'/existing.py',stat.size+1,stat.mtimeMs+10000)).kind,'auto-skipped');assert.equal(skips,2);
  // Model a dangling symlink stat; Windows symlink creation needs privileges.
  danglingPath=path.join(fixture,'dangling-link');
  assert.equal((await detector.checkLocalConflict(danglingPath,'/link',0,0)).kind,'conflict');
  assert.equal(asyncLstat,4);assert.equal(asyncStat,3);
  console.log('PASS: actual bundle bypasses async ENOENT for missing targets; existing size/mtime and content checks still skip or conflict; dangling links remain conflicts.');
 }finally{
  for(const name of ['existing.py']){const p=path.join(fixture,name);if(fs.existsSync(p))fs.unlinkSync(p);}
  // Remove only this test-created directory; never recurse through junctions.
  fs.rmdirSync(fixture);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
