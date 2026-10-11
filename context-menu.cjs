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
        this.closeContextMenu();
        // Let Angular finish the click and destroy the menu before starting work.
        return new Promise(resolve=>outside(this,()=>{
            const pending=this._customContextActions ||= new Map();
            const timer=setTimeout(async()=>{
                pending.delete(timer);
                if(this._destroyed){resolve(false);return;}
                try{
                    const event={preventDefault(){},stopPropagation(){}};
                    const result=action==='editFile'
                        ?await (pane==='local'?this.onLocalEntryDblClick(entry,event):this.onRemoteEntryDblClick(entry,event))
                        :await this._customContextDownload(entries);
                    resolve(result);
                }catch(error){this.showToast?.('Context menu action failed: '+(error?.message||String(error)),7000);resolve(false);}
            },0);
            pending.set(timer,resolve);
        }));
    };
    Panel.prototype._customContextDownload=async function(entries){
        if(!entries.length||this._destroyed)return false;
        if(!this.connected||!this.sftpSession){this.showToast(this.i18n.t('notify.notConnectedDownload'));return false;}
        // Use Tabby's own native folder picker. Cancelling never starts a transfer.
        const directory=await this.injector.get(Platform).pickDirectory();
        if(!directory||this._destroyed)return false;
        return this.ctxDownload(entries,directory);
    };
    Panel.prototype.ctxDownload=async function(selection,target){
        const entries=selection?[...selection]:[...(this.getContextSelection()||[])];
        const destination=target||this._defaultDownloadPath||this.localPath;
        this.closeContextMenu();
        if(!this.connected||!this.sftpSession){this.showToast(this.i18n.t('notify.notConnectedDownload'));return false;}
        if(!entries.length)return false;
        const directory=await this._ensureTransferTargetDir('download',destination);
        if(!directory||this._destroyed)return false;
        await Promise.all(entries.map(entry=>this._streamDownloadOne(entry,directory)));
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
