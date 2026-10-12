const assert=require('assert/strict');
class Panel{
 constructor(pane='remote'){this.contextMenuPane=pane;this.clipboardSource=pane;this.remotePath='/folder';this.localPath='C:/folder';this.clipboardMode='copy';this.clipboardEntries=[{name:'file.py',fullPath:pane==='remote'?'/folder/file.py':'C:/folder/file.py'}];this.calls=0;this.zone={runOutsideAngular:fn=>{this.outside=true;return fn();}};}
 ctxClipboardPaste(){this.calls++;assert.equal(this.outside,true);this.pasted=this.clipboardEntries.slice();this.clipboardEntries=[];return this.work?this.work():Promise.resolve(true);}
 closeContextMenu(){}showToast(message){this.toast=message;}
}
require('./clipboard-safety.cjs')({Panel});
(async()=>{
 for(const pane of ['remote','local'])for(const mode of ['copy','cut']){
  const p=new Panel(pane);p.clipboardMode=mode;for(let i=0;i<10;i++)assert.equal(await p.ctxClipboardPaste(),false);assert.equal(p.calls,0);assert.equal(p.clipboardEntries.length,1);
 }
 const normalized=new Panel();normalized.remotePath='/folder/./';assert.equal(await normalized.ctxClipboardPaste(),false);assert.equal(normalized.calls,0);
 const windows=new Panel('local');windows.clipboardEntries[0].fullPath='c:/FOLDER/FILE.py';assert.equal(await windows.ctxClipboardPaste(),false);
 const other=new Panel();other.remotePath='/another';assert.equal(await other.ctxClipboardPaste(),true);assert.equal(other.calls,1);
 const mixed=new Panel();mixed.clipboardEntries.push({name:'other.py',fullPath:'/source/other.py'});await mixed.ctxClipboardPaste();assert.deepEqual(mixed.pasted.map(e=>e.name),['other.py']);
 const busy=new Panel();busy.remotePath='/another';let finish;busy.work=()=>new Promise(resolve=>{finish=resolve;});const active=busy.ctxClipboardPaste();assert.equal(await busy.ctxClipboardPaste(),false);finish(true);assert.equal(await active,true);assert.equal(busy.calls,1);assert.equal(busy._customPasteBusy,false);
 const failed=new Panel();failed.remotePath='/another';failed.work=()=>Promise.reject(Error('fixture failure'));assert.equal(await failed.ctxClipboardPaste(),false);assert.equal(failed.clipboardEntries.length,1);assert.match(failed.toast,/fixture failure/);assert.equal(failed._customPasteBusy,false);
 const destroyed=new Panel();destroyed._destroyed=true;assert.equal(await destroyed.ctxClipboardPaste(),false);assert.equal(destroyed.calls,0);
 const toast=new Panel();toast.showToast=()=>{throw Error('disposed toast');};assert.equal(await toast.ctxClipboardPaste(),false);
 console.log('PASS: repeated same-folder file copy/cut paste does no I/O or digest; clipboard remains internal; different paths/mixed selections work; reentrant paste, errors and teardown are contained.');
})().catch(error=>{console.error(error);process.exitCode=1;});
