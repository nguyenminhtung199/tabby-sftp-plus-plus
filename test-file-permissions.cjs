const assert=require('assert/strict'),fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const engine=require('./transfer-engine.cjs'),permissions=require('./file-permissions.cjs');
const root=path.join(__dirname,'test-fixtures','permissions-'+crypto.randomUUID());
class Panel{
 constructor(mode){
  this.connected=true;this.transfers=[];this.messages=[];this.files=new Map();
  if(mode!==null)this.files.set('/file',{data:Buffer.from('original'),mode,modified:new Date(0)});
  const files=this.files;
  this.sftpSession={
   stat:async name=>{const file=files.get(name);if(!file)throw Object.assign(Error('not found'),{code:'ENOENT'});return {size:file.data.length,mode:file.mode,modified:file.modified};},
   open:async name=>{files.set(name,{data:Buffer.alloc(0),mode:0,modified:new Date(0)});return {write:async data=>{const f=files.get(name);f.data=Buffer.concat([f.data,data]);},close:async()=>{if(this.permissionChange!==undefined&&files.has('/file'))files.get('/file').mode=this.permissionChange;}};},
   chmod:async(name,mode)=>{if(this.chmodError)throw Error('permission denied');if(!this.ignoreChmod)files.get(name).mode=mode;},
   rename:async(from,to)=>{files.set(to,files.get(from));files.delete(from);},unlink:async name=>files.delete(name)
  };
 }
 _doUpload(){throw Error('must use stream engine');}_doDownload(){}trackTransfer(){}showToast(message){this.messages.push(message);}ngOnDestroy(){}
}
engine({Panel});
(async()=>{
 await fs.mkdir(root,{recursive:true});const local=path.join(root,'file');await fs.writeFile(local,'updated content');
 assert.equal(permissions.newFileMode,0o764);
 for(const mode of [0o764,0o640,0o755,0o4755,0]){
  const p=new Panel(mode);assert.equal(await p._doUpload('/file',local,'edit-upload'),true);
  assert.equal(p.files.get('/file').mode,mode,'sync preserves permissions '+mode.toString(8));assert.equal(p.files.get('/file').data.toString(),'updated content');
 }
 const fresh=new Panel(null);assert.equal(await fresh._doUpload('/file',local,'create-file'),true);assert.equal(fresh.files.get('/file').mode,0o764,'new file has exact mode regardless of umask/local Windows mode');
 const changed=new Panel(0o644);changed.permissionChange=0o750;assert.equal(await changed._doUpload('/file',local,'edit-upload'),true);assert.equal(changed.files.get('/file').mode,0o750,'permission change during upload is preserved');
 for(const problem of ['ignoreChmod','chmodError','missingChmod','unknownMode']){
  const p=new Panel(0o764);if(problem==='missingChmod')delete p.sftpSession.chmod;else if(problem==='unknownMode')p.files.get('/file').mode=undefined;else p[problem]=true;
  assert.equal(await p._doUpload('/file',local,'edit-upload'),false,problem);
  assert.equal(p.files.get('/file').data.toString(),'original','failed permission verification never replaces original');
  assert.equal(p.files.size,1,'failed upload staging is removed');assert.ok(p.messages.length);
 }

 const native=new Panel(0o764);native.sftpSession.sftp={inner:{}};
 native.sftpSession.stat=()=>{throw Error('native stat must not be called');};
 native.sftpSession.readdir=async folder=>[...native.files].filter(([name])=>path.posix.dirname(name)===folder).map(([name,file])=>({name:path.posix.basename(name),fullPath:name,mode:file.mode,size:file.data.length,modified:file.modified,isDirectory:false,isSymlink:false}));
 assert.equal(await native._doUpload('/file',local,'edit-upload'),true);assert.equal(native.files.get('/file').mode,0o764,'native-adapter sync retains permissions without unsafe stat');

 console.log('PASS: new files are 0764; sync preserves current permissions including special/zero bits; changes during upload survive; failed/unsupported/ignored chmod or unknown mode never replace the original.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(path.dirname(root)!==path.resolve(__dirname,'test-fixtures')||!path.basename(root).startsWith('permissions-'))throw Error('Unsafe fixture path');await fs.rm(root,{recursive:true,force:true});});
