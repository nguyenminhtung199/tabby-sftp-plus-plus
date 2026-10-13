const assert=require('assert/strict'),metadata=require('./src/runtime/remote-metadata.cjs');
(async()=>{
 const table=new Map([['/dir',[{name:'file',mode:0o100764,size:3,modified:new Date(0),isDirectory:false},{name:'link',isSymlink:true}]],['/loop',[{name:'a',isSymlink:true},{name:'b',isSymlink:true}]]]);
 let nativeCalls=0;const session={sftp:{inner:{}},stat:()=>{nativeCalls++;throw Error('native stat must not be called');},readdir:async folder=>{if(!table.has(folder))throw Error('permission denied');return table.get(folder);},readlink:async target=>target==='/dir/link'?'file':target==='/loop/a'?'b':'a'};
 assert.equal((await metadata(session,'/dir/file')).mode&0o7777,0o764);assert.equal((await metadata(session,'/dir/link')).size,3);
 await assert.rejects(metadata(session,'/dir/missing'),{code:'ENOENT'});await assert.rejects(metadata(session,'/denied/file'),/permission denied/);await assert.rejects(metadata(session,'/loop/a'),/symlink loop/);assert.equal(nativeCalls,0);
 const nativeObject=Object.create({permissions:0o764,mtime:1700000000});nativeObject.type=()=>1;nativeObject.size='3';
 const old=Object.assign({},nativeObject,{type:nativeObject.type(),size:parseInt(nativeObject.size)});
 assert.equal(old.permissions,undefined,'old russh spread omits prototype metadata getters');
 console.log('PASS: plain native directory metadata retains permissions; relative links resolve; missing/denied/loop errors are explicit; native stat is never invoked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
