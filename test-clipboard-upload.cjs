const assert=require('assert'),fs=require('fs'),path=require('path');
const install=require('./tests/helpers/feature-fixture.cjs')(require('./src/features/clipboard-upload.cjs'));
const root=path.join(__dirname,'test-fixtures','clipboard-'+process.pid);
let currentImage=null,nativeKeys=0,nativeDrops=0,nativePaste=0,formatCalls=0;
const uploads=[];
class Panel {
    constructor(){this.connected=true;this.sftpSession={};this.remotePath='/initial';this.activePane='remote';this._isPanelActive=true;this.clipboardEntries=[];this.listeners=new Map();this.elRef={nativeElement:{contains:()=>true,addEventListener:(key,fn)=>this.listeners.set(key,fn),removeEventListener:key=>this.listeners.delete(key)}};}
    onGlobalKeyDown(){nativeKeys++;}onDrop(){nativeDrops++;}ctxClipboardPaste(){nativePaste++;}
    _streamUploadOne(local,dir){uploads.push({local,dir});return Promise.resolve();}
    _resolveDropDestDir(e){return e.destination;}_safeDetect(){}refreshRemote(){return Promise.resolve();}
    ngAfterViewInit(){}ngOnDestroy(){this._destroyed=true;}showToast(message){this.notice=message;}
}
install({Panel,electron:{clipboard:{readImage:()=>currentImage,availableFormats:()=>{formatCalls++;return currentImage?['image/png']:['text/plain'];}},webUtils:{getPathForFile:file=>file.nativePath||''}},stagingRoot:root});
const event=(target={})=>({target,key:'v',ctrlKey:true,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},stopPropagation(){}});
const image={isEmpty:()=>false,toPNG:()=>Buffer.from('png-fixture')};
(async()=>{
    fs.mkdirSync(root,{recursive:true});
    const p=new Panel();
    assert(await p.customPasteImage(image));
    assert.equal(uploads[0].dir,'/initial');assert(fs.readFileSync(uploads[0].local).equals(image.toPNG()));
    assert(/^clipboard-.*\.png$/.test(path.basename(uploads[0].local)));
    const first=uploads[0].local;await p.customPasteImage(image);assert.notEqual(first,uploads[1].local);
    currentImage=image;
    const typing=event({closest:()=>({})});p.onGlobalKeyDown(typing);assert.equal(nativeKeys,1);assert(!typing.prevented);
    p.activePane='local';p.onGlobalKeyDown(event());assert.equal(nativeKeys,2);p.activePane='remote';
    let calls=0;const original=p.customPasteImage;p.customPasteImage=(value,dir)=>{calls++;assert.equal(dir,'/initial');return Promise.resolve(true);};
    const pasteKey=event();p.onGlobalKeyDown(pasteKey);assert.equal(calls,1);assert(pasteKey.prevented&&pasteKey.stopped);
    currentImage=null;p.onGlobalKeyDown(event());assert.equal(nativeKeys,2);assert.equal(calls,2);
    currentImage=image;p._isPanelActive=false;p.onGlobalKeyDown(event());assert.equal(nativeKeys,3);p._isPanelActive=true;
    p.inputDialogVisible=true;p.onGlobalKeyDown(event());assert.equal(calls,2);p.inputDialogVisible=false;
    p.ngAfterViewInit();p.ngAfterViewInit();assert.equal(p.listeners.size,1);
    const domPaste=event();p.listeners.get('paste')(domPaste);assert(domPaste.prevented);assert.equal(calls,3);
    const textPaste=event({closest:()=>({})});p.listeners.get('paste')(textPaste);assert(!textPaste.prevented);

    // Internal copied files win even when a screenshot remains in Windows clipboard.
    p.clipboardEntries=[{name:'copied.py',fullPath:'/initial/copied.py'}];
    const previousKeys=nativeKeys,previousCalls=calls;
    const fileKey=event();p.onGlobalKeyDown(fileKey);assert.equal(nativeKeys,previousKeys+1);assert.equal(calls,previousCalls);assert(!fileKey.prevented);
    const filePaste=event();p.listeners.get('paste')(filePaste);assert.equal(calls,previousCalls);assert(!filePaste.prevented);
    p.clipboardEntries=[];

    p.customPasteImage=original;

    const imagePanel=new Panel();let inPasteEvent=true,encoded=0,stageUploads=0;
    const oneImage={toPNG(){assert.equal(inPasteEvent,false,'encoding runs after the input callback');encoded++;return Buffer.from('owned-image');}};
    imagePanel._streamUploadOne=async()=>{stageUploads++;};
    const firstImage=imagePanel.customPasteImage(oneImage,'/image-folder'),secondImage=imagePanel.customPasteImage(oneImage,'/image-folder');
    assert.strictEqual(firstImage,secondImage);assert.equal(encoded,0);inPasteEvent=false;assert.equal(await firstImage,true);assert.equal(encoded,1);assert.equal(stageUploads,1);
    imagePanel.contextMenuPane='remote';imagePanel.contextMenuEntry={fullPath:'/selected-folder',isDirectory:true};currentImage=image;
    imagePanel._streamUploadOne=async(local,destination)=>{assert.equal(destination,'/selected-folder');};
    assert.equal(await imagePanel.ctxClipboardPaste(),true);
    const deadImage=new Panel();let deadEncode=0;const pendingImage=deadImage.customPasteImage({toPNG(){deadEncode++;return Buffer.from('x');}});deadImage.ngOnDestroy();assert.equal(await pendingImage,false);assert.equal(deadEncode,0);

    const local=path.join(root,'file.bin');fs.writeFileSync(local,'local-content');
    const drop=event();drop.destination='/folder';drop.dataTransfer={files:[{name:'file.bin',nativePath:local,arrayBuffer(){throw Error('must not buffer disk file');}}],getData:()=>''};
    await p.onDrop(drop,'remote');assert(drop.prevented&&drop.stopped);assert.equal(uploads.at(-1).local,local);assert.equal(uploads.at(-1).dir,'/folder');

    // No upload or native I/O may start while the Explorer drop callback runs.
    const deferred=new Panel();let insideDrop=true,deferredCalls=0;
    deferred._streamUploadOne=async()=>{assert.equal(insideDrop,false);deferredCalls++;};
    const delayedEvent=event();delayedEvent.dataTransfer={files:[{name:'tiny.py',nativePath:local}],getData:()=>''};
    const dropWork=deferred.onDrop(delayedEvent,'remote');assert.equal(deferredCalls,0);insideDrop=false;await dropWork;assert.equal(deferredCalls,1);
    const closed=new Panel();let closedCalls=0;closed._streamUploadOne=()=>closedCalls++;
    const closeWork=closed.onDrop(delayedEvent,'remote');closed.ngOnDestroy();assert.equal(await closeWork,false);assert.equal(closedCalls,0);assert.equal(closed._customDropActions.size,0);

    const internal=event();internal.dataTransfer={getData:()=>'{"kind":"remote-paths","paths":["/x"]}'};await p.onDrop(internal,'remote');assert.equal(nativeDrops,1);
    await p.onDrop(drop,'local');assert.equal(nativeDrops,2);
    const virtual={name:'virtual.dat',stream(){let chunks=0;return new ReadableStream({pull(controller){if(chunks++<32)controller.enqueue(new Uint8Array(65536).fill(7));else controller.close();p.remotePath='/changed';}});},arrayBuffer(){throw Error('must stream');}};
    const virtualDrop=event();virtualDrop.dataTransfer={files:[virtual],getData:()=>''};p.remotePath='/captured';await p.onDrop(virtualDrop,'remote');
    const staged=uploads.at(-1);assert.equal(staged.dir,'/captured');assert.equal(fs.statSync(staged.local).size,32*65536);
    const count=uploads.length;
    const unsafe=event();unsafe.dataTransfer={files:[{...virtual,name:'../escape.dat'}],getData:()=>''};await p.onDrop(unsafe,'remote');assert.equal(uploads.length,count);assert(/Invalid/.test(p.notice));
    p.connected=false;assert.equal(await p.customPasteImage(image),false);await p.onDrop(drop,'remote');assert.equal(uploads.length,count);p.connected=true;
    p.contextMenuPane='remote';currentImage=null;assert.equal(await p.ctxClipboardPaste(),false);assert.equal(nativePaste,0);
    p.ngOnDestroy();assert.equal(p.listeners.size,0);

    const capturePanel=new Panel(),captureListeners=new Map(),routes=[];
    capturePanel.elRef.nativeElement.ownerDocument={addEventListener(name,fn,capture){assert.equal(capture,true);captureListeners.set(name,fn);},removeEventListener(name,fn,capture){assert.equal(capture,true);assert.equal(captureListeners.get(name),fn);captureListeners.delete(name);}};
    capturePanel._customTraceClipboard=phase=>routes.push(phase);let capturedPaste=0;
    capturePanel.customPasteImage=()=>{capturedPaste++;return Promise.resolve(true);};capturePanel.ngAfterViewInit();capturePanel.ngAfterViewInit();assert.equal(captureListeners.size,1);
    const key=event();captureListeners.get('keydown')(key);assert.equal(capturedPaste,1);assert(key.prevented&&key.stopped);assert(routes.includes('clipboard:key:capture'));
    const inputKey=event({closest:()=>({})});captureListeners.get('keydown')(inputKey);assert.equal(capturedPaste,1);assert(!inputKey.prevented);
    capturePanel.ngOnDestroy();assert.equal(captureListeners.size,0);

    assert.equal(formatCalls,0,'native clipboard format APIs are never called from key/paste callbacks');
    console.log('PASS: image staging/unique names, scoped Ctrl+V, editable/modal protection, paste listener cleanup, native drop/internal transfers, streaming virtual files, captured destinations, unsafe names and disconnected uploads.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
    const base=path.resolve(__dirname,'test-fixtures');if(path.resolve(root).startsWith(base+path.sep))fs.rmSync(root,{recursive:true,force:true});
});
