module.exports = function installContextMenu({Panel,Angular,Platform}) {
    const outside=(panel,fn)=>panel.zone?.runOutsideAngular?panel.zone.runOutsideAngular(fn):fn();
    const isMenu=e=>!!e.target?.closest?.('sftp-context-menu');
    const right=e=>e.button===2||e.which===3||(e.button===0&&e.ctrlKey);
    const down=Panel.prototype.onPanelMouseDown;
    Panel.prototype.onPanelMouseDown=function(event){
        // Tabby's terminal host also listens for right-button down/up.
        if(right(event)||isMenu(event))event.stopPropagation();
        return down?.call(this,event);
    };
    Panel.prototype.customContextMouseUp=function(event){if(right(event)||isMenu(event))event.stopPropagation();};
    Angular.HostListener('mouseup',['$event'])(Panel.prototype,'customContextMouseUp',Object.getOwnPropertyDescriptor(Panel.prototype,'customContextMouseUp'));
    const dispatch=Panel.prototype.onContextMenuAction;
    Panel.prototype.onContextMenuAction=function(action){
        if(action!=='editFile'&&action!=='download')return dispatch.call(this,action);
        const pane=this.contextMenuPane,entry=this.contextMenuEntry;
        const entries=[...(this.getContextSelection()||[])];
        return action==='editFile'?this.ctxEditFile(entry,pane):this.ctxDownload(entries);
    };
    Panel.prototype._customDeferContextAction=function(work){
        this.closeContextMenu();
        // Let Angular finish the click and destroy the menu before starting work.
        return new Promise(resolve=>outside(this,()=>{
            const pending=this._customContextActions ||= new Map();
            const timer=setTimeout(async()=>{
                pending.delete(timer);
                if(this._destroyed){resolve(false);return;}
                try{resolve(await work());}
                catch(error){
                    try{if(!this._destroyed)this.showToast?.('Context menu action failed: '+(error?.message||String(error)),7000);}catch{}
                    resolve(false);
                }
            },0);
            pending.set(timer,resolve);
        }));
    };
    Panel.prototype.ctxEditFile=function(entry=this.contextMenuEntry,pane=this.contextMenuPane){
        const session=this.sftpSession;
        return this._customDeferContextAction(async()=>{
            if(!entry||(pane!=='local'&&(!this.connected||this.sftpSession!==session)))return false;
            const timer=pane==='local'?'localClickTimer':'remoteClickTimer';
            if(this[timer]){clearTimeout(this[timer]);this[timer]=null;}
            const event={preventDefault(){},stopPropagation(){}};
            // Explicit Edit must still open the file in single-click mode.
            if(this._openOnClick==='single')return this._activateEntry(pane,entry,event);
            return pane==='local'?this.onLocalEntryDblClick(entry,event):this.onRemoteEntryDblClick(entry,event);
        });
    };
    Panel.prototype._customContextDownload=async function(entries){
        if(!entries.length||this._destroyed)return false;
        if(!this.connected||!this.sftpSession){this.showToast(this.i18n.t('notify.notConnectedDownload'));return false;}
        // Use Tabby's own native folder picker. Cancelling never starts a transfer.
        const session=this.sftpSession;
        const directory=await this.injector.get(Platform).pickDirectory();
        if(!directory||this._destroyed||!this.connected||this.sftpSession!==session)return false;
        return this._customDownloadToDirectory(entries,directory,session);
    };
    Panel.prototype.ctxDownload=function(selection,target){
        const entries=selection?[...selection]:[...(this.getContextSelection()||[])];
        const session=this.sftpSession;
        return this._customDeferContextAction(()=>{
            if(this.sftpSession!==session)return false;
            return target?this._customDownloadToDirectory(entries,target,session):this._customContextDownload(entries);
        });
    };
    Panel.prototype._customDownloadToDirectory=async function(entries,destination,session){
        if(!this.connected||!this.sftpSession){this.showToast(this.i18n.t('notify.notConnectedDownload'));return false;}
        if(!entries.length)return false;
        const directory=await this._ensureTransferTargetDir('download',destination);
        if(!directory||this._destroyed||!this.connected||this.sftpSession!==session)return false;
        // Queue entries in order instead of starting concurrent native SFTP scans.
        for(const entry of entries){
            if(this._destroyed||!this.connected||this.sftpSession!==session)return false;
            await this._streamDownloadOne(entry,directory);
        }
        if(this._destroyed)return false;
        if(this._conflictQueue.length)this._showConflictDialog();
        await this.refreshLocal();this._safeDetect();return true;
    };
    const destroy=Panel.prototype.ngOnDestroy;
    Panel.prototype.ngOnDestroy=function(...args){
        for(const [timer,resolve] of this._customContextActions||[]){clearTimeout(timer);resolve(false);}
        this._customContextActions?.clear();return destroy?.apply(this,args);
    };
};
