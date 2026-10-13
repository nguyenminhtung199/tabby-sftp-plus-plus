const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),Module=require('module');
// Reuse the existing real-bundle loading harness, excluding its test body.
const harness=fs.readFileSync('test-context-menu.cjs','utf8').split('(async()=>{')[0];const fixture=new Module(path.join(__dirname,'inline-harness.cjs'),module);fixture.filename=path.join(__dirname,'inline-harness.cjs');fixture.paths=module.paths;fixture._compile(harness+'\nmodule.exports={Panel,classes};',fixture.filename);const {Panel,classes}=fixture.exports;
const Pane=classes.find(c=>c.__annotations__?.[0]?.selector==='sftp-file-pane');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sftp-inline-'));
function panel(){const p=Object.create(Panel.prototype);Object.assign(p,{localPath:root,remotePath:'/remote',connected:true,_safeDetect(){},i18n:{t:s=>s},showToast(message){this.toast=message;},refreshLocal:async()=>true,refreshRemote:async()=>true,selectedLocal:[],selectedRemote:[],zone:{runOutsideAngular:fn=>fn()}});return p;}
(async()=>{
 try{
  const p=panel();p.localNewFile();assert.equal(p.inputDialogVisible,false);assert.equal(p._customInlineEdit.mode,'local-touch');p.customInlineValue('new.txt');await p.customInlineCommit();assert.equal(fs.readFileSync(path.join(root,'new.txt'),'utf8'),'');assert.equal(p._customInlineEdit,null);
  fs.writeFileSync(path.join(root,'new.txt'),'keep');p.localNewFile();p.customInlineValue('new.txt');await p.customInlineCommit();assert.equal(fs.readFileSync(path.join(root,'new.txt'),'utf8'),'keep');assert.ok(p._customInlineEdit.error);assert.equal(p.inputDialogVisible,false);p.customInlineCancel();
  p.localNewFolder();p.customInlineValue('folder');await p.customInlineCommit();assert.ok(fs.statSync(path.join(root,'folder')).isDirectory());
  p.selectedLocal=[{name:'new.txt',fullPath:path.join(root,'new.txt')}];p.localRename();assert.equal(p._customInlineEdit.originalPath,path.join(root,'new.txt'));p.customInlineValue('renamed.txt');await p.customInlineCommit();assert.equal(fs.readFileSync(path.join(root,'renamed.txt'),'utf8'),'keep');
  p.localNewFile();p.customInlineValue('cancelled.txt');p.customInlineCancel();assert.ok(!fs.existsSync(path.join(root,'cancelled.txt')));
  p.localNewFile();p.customInlineValue('');await p.customInlineCommit();assert.equal(p._customInlineEdit.error,'Enter a name.');p.customInlineValue('wrong-folder.txt');p.localPath=path.join(root,'folder');await p.customInlineCommit();assert.equal(p._customInlineEdit,null);assert.ok(!fs.existsSync(path.join(root,'folder','wrong-folder.txt')));
  const remote=new Map();let chmod=0;p.sftpSession={readdir:async()=>[...remote].map(([name,isDirectory])=>({name,isDirectory})),mkdir:async file=>remote.set(path.posix.basename(file),true),upload:async file=>remote.set(path.posix.basename(file),false),rename:async(old,next)=>{remote.set(path.posix.basename(next),remote.get(path.posix.basename(old)));remote.delete(path.posix.basename(old));}};p._customSetCreatedFilePermissions=async()=>chmod++;
  p.remoteNewFile();p.customInlineValue('remote.txt');await p.customInlineCommit();assert.equal(remote.get('remote.txt'),false);assert.equal(chmod,1,'remote file retains the existing permission-setting operation');
  p.remoteNewFolder();p.customInlineValue('dir');await p.customInlineCommit();assert.equal(remote.get('dir'),true);
  p.selectedRemote=[{name:'remote.txt',fullPath:'/remote/remote.txt'}];p.remoteRename();p.customInlineValue('changed.txt');await p.customInlineCommit();assert.ok(remote.has('changed.txt'));assert.ok(!remote.has('remote.txt'));
  p.remoteNewFile();p.customInlineValue('lost.txt');p.sftpSession={};await p.customInlineCommit();assert.equal(p._customInlineEdit,null);assert.ok(!remote.has('lost.txt'));
  p.localPath=root;p.localNewFile();const pane=Object.create(Pane.prototype);pane.customInlineOwner=p;pane.customInlineKey({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(p._customInlineEdit,null);
  p.openInputDialog('remote-chmod','Permissions','','764','', '/remote/changed.txt');assert.equal(p.inputDialogVisible,true,'unrelated permission dialog is retained');p.cancelInputDialog();
  console.log('PASS: real local and remote inline create/rename; no input popup; duplicate cannot overwrite; cancel, empty name, navigation/session guards; existing chmod operation and other dialogs retained.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
