module.exports = function installClipboardUpload({apis,Panel, electron, stagingRoot}) {
    const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),crypto=require('crypto');
    const {Readable}=require('stream'),{pipeline}=require('stream/promises');
    const root=stagingRoot||path.join(process.env.APPDATA||path.join(os.homedir(),'.config'),'tabby','sftp-plus-plus','uploads');
    const editable=target=>!!target&&(target.isContentEditable||!!target.closest?.('input,textarea,select,[contenteditable="true"]'));
    const blocked=p=>p._destroyed||!p.connected||!p.sftpSession||p.inputDialogVisible||p.deleteConfirmVisible||p.showConflictDialog||p.showPermDialog||p.cwdSetupVisible||p.detailsVisible||p.showTransferLog;
    const notice=(p,error)=>p.showToast?.('Upload failed: '+error.message);
    const capture=event=>{event.preventDefault?.();event.stopImmediatePropagation?.();event.stopPropagation?.();};
    const image=()=>{try{const value=electron?.clipboard?.readImage();return value&&!value.isEmpty()?value:null;}catch{return null;}};
    const outside=(panel,fn)=>panel.zone?.runOutsideAngular?panel.zone.runOutsideAngular(fn):fn();
    const nativeDrop=apis.Panel.onDrop;
    apis.Panel._customDeferDrop=function(work){
        return outside(this,()=>new Promise(resolve=>{
            const pending=this._customDropActions ||= new Map();
            const timer=setTimeout(async()=>{
                pending.delete(timer);
                if(this._destroyed){resolve(false);return;}
                this._customActiveDrops=(this._customActiveDrops||0)+1;
                try{resolve(await work());}catch(error){try{notice(this,error);}catch{}resolve(false);}
                finally{this._customActiveDrops--;}
            },0);
            pending.set(timer,resolve);
        }));
    };
    apis.Panel._customUploadLocalPaths=async function(paths,destination){
        if(blocked(this))throw new Error('Connect SFTP before uploading.');
        const session=this.sftpSession;
        const unique=[...new Set(paths)];
        // Capture destination once, so navigation during staging never redirects an upload.
        await Promise.all(unique.map(local=>{
            if(blocked(this)||this.sftpSession!==session)throw Error('Connection changed before upload started.');
            return this._streamUploadOne(local,destination);
        }));
        if(!this._destroyed&&this.connected&&this.sftpSession===session){await this.refreshRemote();this._safeDetect?.();}
    };
    apis.Panel.customPasteImage=function(value,destination=this.remotePath){
        if(value===null)return Promise.resolve(false);
        if(blocked(this)){this.showToast?.('Connect SFTP before pasting an image.');return Promise.resolve(false);}
        if(this._customImagePasteTask)return this._customImagePasteTask;
        const session=this.sftpSession;
        const trace=(phase,data)=>this._customTraceClipboard?.(phase,data);
        const task=this._customDeferDrop(async()=>{
            if(blocked(this)||this.sftpSession!==session)return false;
            await trace('image:read:start');
            if(value===undefined)value=image();
            await trace('image:read:end',{hasImage:!!value});
            if(!value)return false;
            // Yield the paste event and destroy any menu before native image encoding.
            await trace('image:encode:start');
            const bytes=Buffer.from(value.toPNG());
            if(!bytes.length)throw Error('Clipboard image is empty.');
            await trace('image:encode:end',{bytes:bytes.length});
            await fsp.mkdir(root,{recursive:true});
            const name='clipboard-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8)+'.png';
            const local=path.join(root,name);
            await trace('image:stage:start');
            await fsp.writeFile(local,bytes,{flag:'wx',mode:0o600});
            await trace('image:stage:end',{bytes:bytes.length});
            if(this.sftpSession!==session||blocked(this))throw Error('Connection changed while preparing image; local image retained.');
            await trace('image:queue:start');
            await this._customUploadLocalPaths([local],destination);
            await trace('image:queue:end');
            return true;
        });
        const tracked=task.finally(()=>{if(this._customImagePasteTask===tracked)this._customImagePasteTask=null;});
        this._customImagePasteTask=tracked;return tracked;
    };
    const keydown=apis.Panel.onGlobalKeyDown;
    apis.Panel.onGlobalKeyDown=function(event){
        const host=this.elRef?.nativeElement;
        const owns=this._isPanelActive&&(host?.contains?.(event.target)||this._panelOwnsClipboardHotkeys);
        if((event.ctrlKey||event.metaKey)&&event.key?.toLowerCase()==='v')this._customTraceClipboard?.('clipboard:key-route',{owned:!!owns,panelActive:!!this._isPanelActive,targetInPanel:!!host?.contains?.(event.target),activePane:this.activePane,editable:editable(event.target),internalFiles:this.clipboardEntries?.length||0});
        if(owns&&this.activePane==='remote'&&!this.clipboardEntries?.length&&!editable(event.target)&&!this._isPanelTyping?.(event)&&!blocked(this)&&
            (event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key?.toLowerCase()==='v'){
            capture(event);void this.customPasteImage(undefined,this.remotePath);return;
        }
        return keydown?.call(this,event);
    };
    const paste=apis.Panel.ctxClipboardPaste;
    apis.Panel.ctxClipboardPaste=function(...args){
        if(this.contextMenuPane==='remote'&&!this.clipboardEntries?.length&&!blocked(this)){
            {const entry=this.contextMenuEntry;const destination=entry&&(entry.isDirectory||this.isDirByMode?.(entry.mode))?entry.fullPath:this.remotePath;this.closeContextMenu?.();return this.customPasteImage(undefined,destination);}
        }
        return paste?.apply(this,args);
    };
    apis.Panel._customStageDropFile=async function(file){
        const name=file.name;
        if(!name||name==='.'||name==='..'||/[\\/\x00-\x1f]/.test(name))throw new Error('Invalid dropped filename.');
        if(typeof file.stream!=='function')throw new Error('Cannot stream this dropped file. Drag it from File Explorer instead.');
        const folder=path.join(root,crypto.randomUUID());await fsp.mkdir(folder,{recursive:true});
        const local=path.join(folder,name);
        try{await pipeline(Readable.fromWeb(file.stream()),fs.createWriteStream(local,{flags:'wx',mode:0o600}));return local;}
        catch(error){await fsp.unlink(local).catch(()=>{});await fsp.rmdir(folder).catch(()=>{});throw error;}
    };
    apis.Panel.onDrop=async function(event,pane){
        const data=event.dataTransfer;
        // Preserve native SFTP-to-SFTP/local transfers and column/bookmark reordering.
        if(pane!=='remote'||!data||data.getData?.('application/x-sftp-plus'))return nativeDrop?.call(this,event,pane);
        let files=Array.from(data.files||[]);
        if(!files.length)files=Array.from(data.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
        if(!files.length)return nativeDrop?.call(this,event,pane);
        capture(event);this._fileDnd?.reset?.();this._safeDetect?.();
        if(blocked(this)){this.showToast?.('Connect SFTP before uploading.');return;}
        const destination=this._resolveDropDestDir?.(event,'remote')||this.remotePath,session=this.sftpSession;
        // Read native paths and DataTransfer while the drop event is valid.
        const sources=files.map(file=>{let local;try{local=electron?.webUtils?.getPathForFile?.(file);}catch{}return {file,local:local||file.path};});
        return this._customDeferDrop(async()=>{
            if(blocked(this)||this.sftpSession!==session)throw Error('Connection changed before preparing files.');
            const paths=[];
            for(const source of sources)paths.push(source.local||await this._customStageDropFile(source.file));
            if(blocked(this)||this.sftpSession!==session)throw Error('Connection changed while preparing files.');
            await this._customUploadLocalPaths(paths,destination);
            return true;
        });
    };
    const mounted=apis.Panel.ngAfterViewInit;
    apis.Panel.ngAfterViewInit=function(...args){
        const result=mounted?.apply(this,args),host=this.elRef?.nativeElement;
        if(host?.addEventListener&&!this._customImagePasteHandler){
            this._customImagePasteHandler=event=>{
                if(this.activePane!=='remote'||this.clipboardEntries?.length||editable(event.target)||blocked(this))return;
                if(event.clipboardData?.types?.length&&!Array.from(event.clipboardData.types).some(type=>type==='Files'||type.startsWith('image/')))return;
                capture(event);void this.customPasteImage(undefined,this.remotePath);
            };
            host.addEventListener('paste',this._customImagePasteHandler,true);
        }
        const doc=host?.ownerDocument||(typeof document!=='undefined'?document:null);
        const captureTarget=doc?.defaultView||doc;
        if(captureTarget?.addEventListener&&!this._customClipboardKeyCapture){
            this._customClipboardDocument=captureTarget;
            this._customClipboardKeyCapture=event=>{
                if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||event.key?.toLowerCase()!=='v')return;
                this._customTraceClipboard?.('clipboard:key:capture');
                const owned=this._isPanelActive&&(host?.contains?.(event.target)||this._panelOwnsClipboardHotkeys);
                this._customTraceClipboard?.('clipboard:key:capture-route',{owned:!!owned,activePane:this.activePane,editable:editable(event.target),internalFiles:this.clipboardEntries?.length||0});
                if(owned&&this.activePane==='remote'&&!editable(event.target)&&!this._isPanelTyping?.(event)&&!blocked(this))this.onGlobalKeyDown(event);
            };
            captureTarget.addEventListener('keydown',this._customClipboardKeyCapture,true);
        }
        return result;
    };
    const destroy=apis.Panel.ngOnDestroy;
    apis.Panel.ngOnDestroy=function(...args){
        if(this._customClipboardKeyCapture)this._customClipboardDocument?.removeEventListener?.('keydown',this._customClipboardKeyCapture,true);
        this._customClipboardKeyCapture=null;this._customClipboardDocument=null;
        if(this._customImagePasteHandler)this.elRef?.nativeElement?.removeEventListener?.('paste',this._customImagePasteHandler,true);
        for(const [timer,resolve]of this._customDropActions||[]){clearTimeout(timer);resolve(false);}
        this._customDropActions?.clear();
        this._customImagePasteHandler=null;return destroy?.apply(this,args);
    };
};
