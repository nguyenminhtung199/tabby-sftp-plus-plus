const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const createContext=require('./sync-context.cjs'),scope=createContext();
(async()=>{
 assert.equal(scope.getStore(),undefined);scope.run('outer',()=>{assert.equal(scope.getStore(),'outer');scope.run('inner',()=>assert.equal(scope.getStore(),'inner'));assert.equal(scope.getStore(),'outer');});assert.equal(scope.getStore(),undefined);
 assert.throws(()=>scope.run('error',()=>{throw Error('fixture');}));assert.equal(scope.getStore(),undefined);
 await scope.run('async',async()=>{await Promise.resolve();assert.equal(scope.getStore(),undefined,'native await must not leak a shared context into other jobs');});
 for(const file of ['activity.cjs','drop-diagnostics.cjs','dist/index.js'])assert.ok(!/AsyncLocalStorage/.test(fs.readFileSync(file,'utf8')),file+' must not use the native crash path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sftp-context-'));
 try{
  const source=path.join(root,'folder');fs.mkdirSync(source);const local=path.join(source,'a.txt'),unrelated=path.join(root,'other.txt');fs.writeFileSync(local,'a');fs.writeFileSync(unrelated,'b');
  let proceed;const gate=new Promise(resolve=>proceed=resolve);
  class Panel{constructor(){this.connected=true;this.transfers=[];this.zone={run:fn=>fn()};this.sftpSession={stat:async()=>({size:1,mtime:1})};this._transferCoordinator={uploadPathToRemote:async(remote,dir)=>{await gate;return this._doUpload(path.posix.join(remote,path.basename(dir),'a.txt'),path.join(dir,'a.txt'));}};}_safeDetect(){}_doUpload(){return Promise.resolve(true);}ngOnInit(){}ngOnDestroy(){}_streamUploadOne(){}refreshRemote(){}refreshLocal(){}}
  const originalLoad=Module._load;Module._load=function(name,...args){if(name==='async_hooks'||name==='node:async_hooks')throw Error('Forbidden native context');return originalLoad.call(this,name,...args);};
  try{require('./activity.cjs')({Panel,recovery:{server:()=> 'fixture',rows:()=>[],put(){},remove(){}}});}finally{Module._load=originalLoad;}
  const p=new Panel();p._customHookFolderTransfers();const folder=p._transferCoordinator.uploadPathToRemote('/remote',source);await new Promise(resolve=>setImmediate(resolve));
  const separate=p._doUpload('/other.txt',unrelated);await separate;proceed();assert.equal(await folder,true);
  assert.equal(p._customTransferRows.filter(r=>r.isFolder).length,1);assert.equal(p._customTransferRows.filter(r=>!r.isFolder).length,1,'concurrent unrelated file retains its own job');assert.ok(!p._customTransferRows.some(r=>r.remotePath==='/remote/folder/a.txt'),'child after await belongs to directory job');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 console.log('PASS: renderer context uses no async_hooks; synchronous nesting/throw restore; delayed folder children retain ownership while concurrent unrelated files stay independent.');
})().catch(error=>{console.error(error);process.exitCode=1;});
