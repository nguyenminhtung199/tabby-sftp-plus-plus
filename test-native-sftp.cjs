const assert=require('assert/strict'),fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const {Server,utils}=require('ssh2'),status=utils.sftp.STATUS_CODE;
const fsSyncRead=file=>require('fs').readFileSync(file,'utf8');
const Module=require('module'),load=Module._load,nativeRoot=process.env.SFTP_TEST_RUSSH_ROOT;
if(!nativeRoot)throw Error('Set SFTP_TEST_RUSSH_ROOT to the installed russh directory');
// Tabby 1.0.231 uses RxJS 7; Angular 9 bundle tests retain their RxJS 6 dependency.
Module._load=function(name,parent,...args){if(name==='rxjs'&&parent?.filename.startsWith(nativeRoot))return require('rxjs-native-fixture');return load.call(this,name,parent,...args);};
const russh=require(path.join(nativeRoot,'lib/index.js'));
const metadata=require('./src/runtime/remote-metadata.cjs'),permissions=require('./src/runtime/file-permissions.cjs');
const files=new Map(),clients=new Set(),root=path.join(__dirname,'test-fixtures','native-sftp-'+crypto.randomUUID());
const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
function attrs(file){return {mode:0o100000|file.mode,size:file.data.length,uid:1000,gid:1000,atime:1700000000,mtime:1700000000};}
const server=new Server({hostKeys:[key]},client=>{
 clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
 client.on('authentication',ctx=>ctx.accept()).on('ready',()=>client.on('session',accept=>accept().on('sftp',accept=>{
  const sftp=accept(),handles=new Map();let next=1;
  const handle=value=>{const h=Buffer.alloc(4);h.writeUInt32BE(next++);handles.set(h.toString('hex'),value);return h;};
  const lookup=h=>handles.get(h.toString('hex'));
  sftp.on('OPEN',(id,name,flags)=>{if((flags&32)&&files.has(name))return sftp.status(id,status.FAILURE);if(!files.has(name)&&!(flags&8))return sftp.status(id,status.NO_SUCH_FILE);if(flags&8&&!files.has(name))files.set(name,{data:Buffer.alloc(0),mode:0o600});if(flags&16)files.get(name).data=Buffer.alloc(0);sftp.handle(id,handle({name}));});
  sftp.on('WRITE',(id,h,offset,data)=>{const value=lookup(h),file=value&&files.get(value.name);if(!file)return sftp.status(id,status.FAILURE);const length=Math.max(file.data.length,offset+data.length),bytes=Buffer.alloc(length);file.data.copy(bytes);data.copy(bytes,offset);file.data=bytes;sftp.status(id,status.OK);});
  sftp.on('READ',(id,h,offset,length)=>{const file=files.get(lookup(h)?.name);if(!file)return sftp.status(id,status.FAILURE);if(offset>=file.data.length)return sftp.status(id,status.EOF);sftp.data(id,file.data.subarray(offset,offset+length));});
  sftp.on('CLOSE',(id,h)=>{handles.delete(h.toString('hex'));sftp.status(id,status.OK);});
  for(const op of ['STAT','LSTAT'])sftp.on(op,(id,name)=>{const file=files.get(name);file?sftp.attrs(id,attrs(file)):sftp.status(id,status.NO_SUCH_FILE);});
  sftp.on('SETSTAT',(id,name,a)=>{const file=files.get(name);if(!file)return sftp.status(id,status.NO_SUCH_FILE);if(a.mode!==undefined)file.mode=a.mode&0o7777;sftp.status(id,status.OK);});
  sftp.on('OPENDIR',(id,name)=>sftp.handle(id,handle({directory:name,listed:false})));
  sftp.on('READDIR',(id,h)=>{const value=lookup(h);if(!value||value.listed)return sftp.status(id,status.EOF);value.listed=true;const entries=[...files].filter(([name])=>path.posix.dirname(name)===value.directory).map(([name,file])=>({filename:path.posix.basename(name),longname:path.posix.basename(name),attrs:attrs(file)}));entries.length?sftp.name(id,entries):sftp.status(id,status.EOF);});
  sftp.on('RENAME',(id,from,to)=>{if(!files.has(from))return sftp.status(id,status.NO_SUCH_FILE);files.set(to,files.get(from));files.delete(from);sftp.status(id,status.OK);});
  sftp.on('REMOVE',(id,name)=>{files.delete(name);sftp.status(id,status.OK);});
 })));
});
let ssh,sftp;const deadline=setTimeout(()=>{console.error('native SFTP fixture timed out');for(const client of clients)client.end();server.close();process.exitCode=1;},30000);
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await fs.mkdir(root,{recursive:true});
 const transport=await russh.SshTransport.newSocket('127.0.0.1:'+server.address().port);
 ssh=await russh.SSHClient.connect(transport,()=>Promise.resolve(true),{connectionTimeoutSeconds:5});ssh=await ssh.authenticateNone('fixture');
 sftp=await ssh.activateSFTP(await ssh.openSessionChannel());
 if(process.argv.includes('--probe-original-stat')){
  files.set('/fixture/probe',{data:Buffer.from('probe'),mode:0o764});
  const original=await sftp.stat('/fixture/probe');
  console.log('Original native stat permissions:',original.permissions,'own keys:',Object.keys(original));
  files.delete('/fixture/probe');
  try{await sftp.stat('/fixture/missing');throw Error('missing stat unexpectedly succeeded');}catch(error){console.log('Original native missing-file stat:',error.message);}
 }
 const adapter={sftp,readdir:async folder=>(await sftp.readDirectory(folder)).map(entry=>({name:entry.name,fullPath:path.posix.join(folder,entry.name),isDirectory:entry.metadata.type===0,isSymlink:entry.metadata.type===2,mode:entry.metadata.permissions,size:entry.metadata.size,modified:new Date(entry.metadata.mtime*1000)})),stat:()=>{throw Error('unsafe native stat must not be called');},open:async(file,mode)=>{const inner=await sftp.open(file,mode);return {read:()=>inner.read(256*1024),write:data=>inner.writeAll(data),close:()=>inner.shutdown()};},chmod:(file,mode)=>sftp.chmod(file,mode),rename:(from,to)=>sftp.rename(from,to),unlink:file=>sftp.removeFile(file)};
 class Panel{constructor(){this.connected=true;this.transfers=[];this.sftpSession=adapter;}_doUpload(){}_doDownload(){}ctxClipboardPaste(){throw Error('same-path paste reached native backend');}closeContextMenu(){}trackTransfer(){}showToast(message){console.error(message);}ngOnDestroy(){}}
 require('./tests/helpers/feature-fixture.cjs')(require('./src/features/transfer-engine.cjs'))({Panel});
 const traceRoot=path.join(root,'trace'),cfg=require('./transfer-policy.json').dropDiagnostics;await fs.mkdir(traceRoot,{recursive:true});await fs.writeFile(path.join(traceRoot,cfg.enabledMarker),'enabled');const diagnostic=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/drop-diagnostics.cjs'))({Panel,root:traceRoot});
 require('./tests/helpers/feature-fixture.cjs')(require('./src/features/clipboard-safety.cjs'))({Panel});
 // Exercise the actual inline rename controller against installed russh and the loopback SFTP server.
 const harness=fsSyncRead('test-context-menu.cjs').split('(async()=>{')[0],fixture=new Module(path.join(__dirname,'native-inline-harness.cjs'),module);fixture.filename=path.join(__dirname,'native-inline-harness.cjs');fixture.paths=module.paths;fixture._compile(harness+'\nmodule.exports=Panel;',fixture.filename);
 const nativePanel=Object.create(fixture.exports.prototype);Object.assign(nativePanel,{connected:true,remotePath:'/fixture',selectedLocal:[],sftpSession:adapter,_safeDetect(){},showToast(message){this.toast=message;},refreshRemote:async()=>true,i18n:{t:key=>key}});
 files.set('/fixture/rename-source.txt',{data:Buffer.from('rename preserves bytes'),mode:0o750});nativePanel.selectedRemote=[{name:'rename-source.txt',fullPath:'/fixture/rename-source.txt'}];nativePanel.remoteRename();nativePanel.customInlineValue('rename-target.txt');await nativePanel.customInlineCommit();
 assert.equal(nativePanel._customInlineEdit,null);assert.equal(files.has('/fixture/rename-source.txt'),false);assert.equal(files.get('/fixture/rename-target.txt').data.toString(),'rename preserves bytes');assert.equal(files.get('/fixture/rename-target.txt').mode,0o750);
 nativePanel.selectedRemote=[{name:'rename-target.txt',fullPath:'/fixture/rename-target.txt'}];nativePanel.remoteRename();await nativePanel.customInlineCommit();assert.equal(nativePanel._customInlineEdit,null,'unchanged name does not fail native rename');
 await adapter.unlink('/fixture/rename-target.txt');
 console.log('PASS: actual inline remote rename through russh preserves bytes/mode and accepts unchanged names.');
 const p=new Panel(),local=path.join(root,'edit.txt');await fs.writeFile(local,'edited content');
 for(let i=0;i<8;i++){
  const remote='/fixture/file'+i;
  // The restored New File path: open/close a zero-byte file, then apply 0764.
  await require('./src/runtime/new-file.cjs')(adapter,remote,file=>p._customSetCreatedFilePermissions(file));assert.equal((await metadata(adapter,remote)).mode&0o7777,0o764);
  await adapter.chmod(remote,0o750);assert.equal(await p._doUpload(remote,local,'edit-upload'),true);assert.equal(files.get(remote).mode,0o750);
  const downloaded=path.join(root,'download'+i);assert.equal(await p._doDownload(remote,downloaded,0o750,14),true);assert.equal(await fs.readFile(downloaded,'utf8'),'edited content');
 }
 const existingBytes=Buffer.from(files.get('/fixture/file0').data);await assert.rejects(require('./src/runtime/new-file.cjs')(adapter,'/fixture/file0',file=>p._customSetCreatedFilePermissions(file)));assert.ok(files.get('/fixture/file0').data.equals(existingBytes),'exclusive native create cannot truncate an existing remote file');
 require('./tests/helpers/feature-fixture.cjs')(require('./src/features/clipboard-upload.cjs'))({Panel,electron:{webUtils:{getPathForFile:file=>file.nativePath}},stagingRoot:path.join(root,'image-staging')});
 const dropped=new Panel();dropped.remotePath='/fixture';dropped._safeDetect=()=>{};dropped.refreshRemote=async()=>{};
 dropped._streamUploadOne=(local,destination)=>dropped._doUpload(path.posix.join(destination,path.basename(local)),local);
 const tiny=path.join(root,'file0');await fs.writeFile(tiny,'x');
 const event={dataTransfer:{files:[{name:'file0',nativePath:tiny}],getData:()=>''},preventDefault(){},stopImmediatePropagation(){},stopPropagation(){}};
 assert.equal(await dropped.onDrop(event,'remote'),true);assert.equal(files.get('/fixture/file0').data.toString(),'x');assert.equal(files.get('/fixture/file0').mode,0o750);
 console.log('PASS: an Explorer-style one-byte file drop finishes through native upload and retains existing server permissions.');
 const pastePanel=new Panel();let pasteCalls=0;
 pastePanel.sftpSession=new Proxy(adapter,{get(target,key){const value=target[key];return typeof value==='function'?function(...args){pasteCalls++;return value.apply(target,args);}:value;}});
 Object.assign(pastePanel,{contextMenuPane:'remote',remotePath:'/fixture',clipboardSource:'remote',clipboardMode:'copy',clipboardEntries:[{name:'file0',fullPath:'/fixture/file0'}]});
 pastePanel.showToast=()=>{};const before=Buffer.from(files.get('/fixture/file0').data);
 for(let i=0;i<10;i++)assert.equal(await pastePanel.ctxClipboardPaste(),false);
 assert.equal(pasteCalls,0);assert.ok(files.get('/fixture/file0').data.equals(before));assert.equal(pastePanel.clipboardEntries.length,1);
 console.log('PASS: 10 same-folder pastes with the native adapter invoke no SFTP/exec/hash, preserve source bytes and retain the internal clipboard.');
 const imagePanel=new Panel();imagePanel.remotePath='/fixture/images';imagePanel._safeDetect=()=>{};imagePanel.refreshRemote=async()=>{};
 imagePanel._streamUploadOne=(local,destination)=>imagePanel._doUpload(path.posix.join(destination,path.basename(local)),local);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 const imageTask=imagePanel.customPasteImage({toPNG:()=>png},'/fixture/images');assert.strictEqual(imageTask,imagePanel.customPasteImage({toPNG:()=>png},'/fixture/images'));assert.equal(await imageTask,true);
 const imageEntry=[...files].find(([name])=>name.startsWith('/fixture/images/clipboard-'));assert.ok(imageEntry);assert.ok(imageEntry[1].data.equals(png));assert.equal(imageEntry[1].mode,0o764);
 console.log('PASS: image staging + native upload preserves PNG bytes, selected folder and 0764; concurrent image paste is deduplicated.');
 await diagnostic.flush();const traceRows=(await fs.readFile(path.join(traceRoot,cfg.file),'utf8')).trim().split('\n').map(JSON.parse);
 for(const phase of ['transfer.upload.native-write:start','transfer.upload.remote-close:end','transfer.upload.permissions:end','transfer.upload.commit:end','transfer.download.native-read:start','transfer.download.disk-write:end','transfer.download.commit:end'])assert.ok(traceRows.some(row=>row.phase===phase),phase);
 assert.ok(traceRows.filter(row=>row.phase.startsWith('transfer.')).every(row=>row.transferId&&row.operationId));
 assert.equal(files.size,9);console.log('PASS: actual installed russh native adapter survives 8 empty creations + chmod + save-upload + downloads against an isolated loopback SFTP server; exact bytes and permissions preserved.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(deadline);try{await sftp?.close();}catch{}try{await ssh?.disconnect();}catch{}for(const client of clients)client.end();server.close();if(path.dirname(root)===path.resolve(__dirname,'test-fixtures'))await fs.rm(root,{recursive:true,force:true});});
