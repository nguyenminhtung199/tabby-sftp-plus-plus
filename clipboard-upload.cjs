module.exports = function installClipboardUpload({Panel, electron, stagingRoot}) {
    const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),crypto=require('crypto');
    const {Readable}=require('stream'),{pipeline}=require('stream/promises');
    const root=stagingRoot||path.join(process.env.APPDATA||path.join(os.homedir(),'.config'),'tabby','sftp-plus-plus','uploads');
    const editable=target=>!!target&&(target.isContentEditable||!!target.closest?.('input,textarea,select,[contenteditable="true"]'));
    const blocked=p=>p._destroyed||!p.connected||!p.sftpSession||p.inputDialogVisible||p.deleteConfirmVisible||p.showConflictDialog||p.showPermDialog||p.cwdSetupVisible||p.detailsVisible||p.showTransferLog;
    const notice=(p,error)=>p.showToast?.('Upload failed: '+error.message);
    const capture=event=>{event.preventDefault?.();event.stopImmediatePropagation?.();event.stopPropagation?.();};
    const image=()=>{try{const value=electron?.clipboard?.readImage();return value&&!value.isEmpty()?value:null;}catch{return null;}};
    const nativeDrop=Panel.prototype.onDrop;
    Panel.prototype._customUploadLocalPaths=async function(paths,destination){
        if(blocked(this))throw new Error('Connect SFTP before uploading.');
        const session=this.sftpSession;
        const unique=[...new Set(paths)];
        // Capture destination once, so navigation during staging never redirects an upload.
        await Promise.all(unique.map(local=>this._streamUploadOne(local,destination)));
        if(!this._destroyed&&this.connected&&this.sftpSession===session){await this.refreshRemote();this._safeDetect?.();}
    };
    Panel.prototype.customPasteImage=async function(value=image(),destination=this.remotePath){
        if(!value)return false;
        if(blocked(this)){this.showToast?.('Connect SFTP before pasting an image.');return false;}
        const session=this.sftpSession;
        try{
            const bytes=value.toPNG();if(!bytes.length)throw new Error('Clipboard image is empty.');
            await fsp.mkdir(root,{recursive:true});
            const name='clipboard-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8)+'.png';
            const local=path.join(root,name);await fsp.writeFile(local,bytes,{flag:'wx',mode:0o600});
            if(this.sftpSession!==session||blocked(this))throw new Error('Connection changed while preparing image; local image retained.');
            await this._customUploadLocalPaths([local],destination);
            return true;
        }catch(error){notice(this,error);return false;}
    };
    const keydown=Panel.prototype.onGlobalKeyDown;
    Panel.prototype.onGlobalKeyDown=function(event){
        const host=this.elRef?.nativeElement;
        const owns=this._isPanelActive&&(host?.contains?.(event.target)||this._panelOwnsClipboardHotkeys);
        if(owns&&this.activePane==='remote'&&!editable(event.target)&&!this._isPanelTyping?.(event)&&!blocked(this)&&
            (event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key?.toLowerCase()==='v'){
            const value=image();if(value){capture(event);void this.customPasteImage(value,this.remotePath);return;}
        }
        return keydown?.call(this,event);
    };
    const paste=Panel.prototype.ctxClipboardPaste;
    Panel.prototype.ctxClipboardPaste=function(...args){
        if(this.contextMenuPane==='remote'&&!this.clipboardEntries?.length&&!blocked(this)){
            const value=image();if(value){this.closeContextMenu?.();return this.customPasteImage(value,this.remotePath);}
        }
        return paste?.apply(this,args);
    };
    Panel.prototype._customStageDropFile=async function(file){
        const name=file.name;
        if(!name||name==='.'||name==='..'||/[\\/\x00-\x1f]/.test(name))throw new Error('Invalid dropped filename.');
        if(typeof file.stream!=='function')throw new Error('Cannot stream this dropped file. Drag it from File Explorer instead.');
        const folder=path.join(root,crypto.randomUUID());await fsp.mkdir(folder,{recursive:true});
        const local=path.join(folder,name);
        try{await pipeline(Readable.fromWeb(file.stream()),fs.createWriteStream(local,{flags:'wx',mode:0o600}));return local;}
        catch(error){await fsp.unlink(local).catch(()=>{});await fsp.rmdir(folder).catch(()=>{});throw error;}
    };
    Panel.prototype.onDrop=async function(event,pane){
        const data=event.dataTransfer;
        // Preserve native SFTP-to-SFTP/local transfers and column/bookmark reordering.
        if(pane!=='remote'||!data||data.getData?.('application/x-sftp-plus'))return nativeDrop?.call(this,event,pane);
        let files=Array.from(data.files||[]);
        if(!files.length)files=Array.from(data.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
        if(!files.length)return nativeDrop?.call(this,event,pane);
        capture(event);this._remoteDragOver=false;this._safeDetect?.();
        if(blocked(this)){this.showToast?.('Connect SFTP before uploading.');return;}
        const destination=this._resolveDropDestDir?.(event,'remote')||this.remotePath,session=this.sftpSession;
        try{
            const paths=[];
            for(const file of files){
                let local;try{local=electron?.webUtils?.getPathForFile?.(file);}catch{}
                local ||= file.path;
                paths.push(local||await this._customStageDropFile(file));
            }
            if(blocked(this)||this.sftpSession!==session)throw new Error('Connection changed while preparing files.');
            await this._customUploadLocalPaths(paths,destination);
        }catch(error){notice(this,error);}
    };
    const mounted=Panel.prototype.ngAfterViewInit;
    Panel.prototype.ngAfterViewInit=function(...args){
        const result=mounted?.apply(this,args),host=this.elRef?.nativeElement;
        if(host?.addEventListener&&!this._customImagePasteHandler){
            this._customImagePasteHandler=event=>{
                if(this.activePane!=='remote'||editable(event.target)||blocked(this))return;
                const value=image();if(value){capture(event);void this.customPasteImage(value,this.remotePath);}
            };
            host.addEventListener('paste',this._customImagePasteHandler,true);
        }
        return result;
    };
    const destroy=Panel.prototype.ngOnDestroy;
    Panel.prototype.ngOnDestroy=function(...args){
        if(this._customImagePasteHandler)this.elRef?.nativeElement?.removeEventListener?.('paste',this._customImagePasteHandler,true);
        this._customImagePasteHandler=null;return destroy?.apply(this,args);
    };
};
