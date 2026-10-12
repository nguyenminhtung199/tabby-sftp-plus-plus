module.exports = function installContextMenu({Panel,Angular,Platform,Menu,Registry,Settings}) {
    if(Menu&&Registry){
        Registry.editFile.labelKey='file.open';
        Object.assign(Registry,{openWith:{labelKey:'Open with…',category:'open'},openTerminalHere:{labelKey:'Open terminal here',category:'open'},copyFileName:{labelKey:'Copy file name',category:'panel'}});
        const visible=Menu.prototype.isActionVisible;
        Menu.prototype.isActionVisible=function(action){
            if(action==='openLocal')return false;
            if(action==='editFile')return this.pane==='local'?this.hasLocalOpen:this.hasEdit;
            if(action==='openWith')return this.singleSelected&&!!this.entry&&!this.entry.isDirectory;
            if(action==='openTerminalHere')return this.pane==='remote';
            if(action==='copyFileName')return this.hasSelection||!!this.entry;
            return visible.call(this,action);
        };
        Menu.prototype.contextActionLabel=function(action){
            return {editFile:'Open',openWith:'Open with…',openTerminalHere:'Open terminal here',copyFileName:'Copy file name'}[action]||this.i18n.t(Registry[action].labelKey);
        };
        const ordered=Object.getOwnPropertyDescriptor(Menu.prototype,'orderedVisibleActions').get;
        Object.defineProperty(Menu.prototype,'orderedVisibleActions',{configurable:true,get(){
            const actions=[...ordered.call(this)].filter(action=>action!=='editFile'||!this.disabledMenuEntries.has('openLocal'));
            for(const [action,anchor] of [['openWith','editFile'],['openTerminalHere','openWith'],['copyFileName','copyPath']]){
                if(!actions.includes(action)&&this.isActionVisible(action)&&!this.disabledMenuEntries.has(action)){
                    const i=actions.indexOf(anchor);actions.splice(i<0?actions.length:i+1,0,action);
                }
            }
            return actions;
        }});
    }
    if(Settings){
        Settings.prototype._customNormalizeOpenMenu=function(){
            const normalize=list=>[...new Set(list.map(action=>action==='openLocal'?'editFile':action))];
            this.contextMenuOrder=normalize(this.contextMenuOrder);
            this.contextMenuDisabled=normalize(this.contextMenuDisabled);
        };
        const read=Settings.prototype._readFromConfig;
        Settings.prototype._readFromConfig=function(...args){const result=read.apply(this,args);this._customNormalizeOpenMenu();return result;};
    }
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
        if(!['editFile','download','openWith','openTerminalHere','copyFileName'].includes(action)){
            const handlers={newFolder:'ctxNewFolder',newFile:'ctxNewFile',rename:'ctxRename',delete:'ctxDelete',openLocal:'ctxOpenLocal',upload:'ctxUpload',revealInExplorer:'ctxRevealInExplorer',chmod:'ctxChmod',details:'ctxDetails',copy:'ctxClipboardCopy',cut:'ctxClipboardCut',paste:'ctxClipboardPaste',refresh:'ctxRefresh',selectAll:'ctxSelectAll',selectInvert:'ctxSelectInvert',copyPath:'ctxCopyPath'};
            const failed=error=>{try{if(!this._destroyed)this.showToast?.('Context menu action failed: '+(error?.message||String(error)),7000);}catch{}return false;};
            try{const result=handlers[action]?this[handlers[action]]():dispatch.call(this,action);return result?.then?Promise.resolve(result).catch(failed):result;}catch(error){return failed(error);}
        }
        const pane=this.contextMenuPane,entry=this.contextMenuEntry;
        const entries=[...(this.getContextSelection()||[])];
        if(action==='openWith')return this.ctxOpenWith(entry,pane);
        if(action==='openTerminalHere')return this.ctxOpenTerminalHere(entry,pane);
        if(action==='copyFileName')return this.ctxCopyFileName(entries.length?entries:(entry?[entry]:[]),pane);
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
    Panel.prototype._customPickApplication=async function(){
        const platform=this.injector.get(Platform);
        const result=await platform.electron.dialog.showOpenDialog(platform.hostWindow.getWindow(),{
            title:'Open with…',buttonLabel:'Open',properties:['openFile'],
            filters:process.platform==='win32'?[{name:'Applications',extensions:['exe']}]:[]
        });
        return result.canceled?null:result.filePaths[0];
    };
    Panel.prototype._customLaunchApplication=function(application,file){
        return new Promise((resolve,reject)=>{
            // Separate argv preserves spaces and prevents shell interpretation.
            const child=require('child_process').spawn(application,[file],{shell:false,detached:true,stdio:'ignore'});
            child.once('error',reject);child.once('spawn',()=>{child.unref();resolve('');});
        });
    };
    Panel.prototype.ctxOpenWith=function(entry=this.contextMenuEntry,pane=this.contextMenuPane){
        const session=this.sftpSession;
        return this._customDeferContextAction(async()=>{
            if(!entry||entry.isDirectory||this.isDirByMode(entry.mode))return false;
            if(pane==='remote'&&(!this.connected||this.sftpSession!==session))return false;
            if(pane==='remote'&&entry.isSymlink&&await this._resolveRemoteSymlinkIsDir(entry.fullPath))return false;
            const application=await this._customPickApplication();
            if(!application||this._destroyed||(pane==='remote'&&(!this.connected||this.sftpSession!==session)))return false;
            const open=file=>this._customLaunchApplication(application,file);
            if(pane==='local')return open(entry.linkTarget||entry.fullPath);
            return this._customExternalEdit(entry,open);
        });
    };
    Panel.prototype.ctxCopyFileName=function(entries,pane=this.contextMenuPane){
        const path=require('path');
        const names=entries.map(entry=>entry.name||(pane==='local'?path:path.posix).basename(entry.fullPath||'')).filter(Boolean);
        return this._customDeferContextAction(()=>{
            if(!names.length)return false;
            this.injector.get(Platform).setClipboard({text:names.join('\n')});return true;
        });
    };
    Panel.prototype.ctxOpenTerminalHere=function(entry=this.contextMenuEntry,pane=this.contextMenuPane){
        const terminal=this.terminalRef,session=this.sftpSession,current=this.remotePath;
        return this._customDeferContextAction(async()=>{
            if(pane!=='remote'||!this.connected||this.sftpSession!==session||!terminal?.sendInput)return false;
            const path=require('path').posix;
            let directory=entry&&(entry.isDirectory||this.isDirByMode(entry.mode));
            if(entry&&!directory&&entry.isSymlink)directory=await this._resolveRemoteSymlinkIsDir(entry.fullPath);
            const target=entry?(directory?entry.fullPath:path.dirname(entry.fullPath)):current;
            if(!target||/[\x00-\x1f\x7f]/.test(target))throw Error('This folder path contains terminal control characters');
            if(this._destroyed||!this.connected||this.sftpSession!==session||this.terminalRef!==terminal)return false;
            const quoted="'"+target.replace(/'/g,"'\\''")+"'";
            terminal.sendInput('cd -- '+quoted+'\n');
            terminal.emitFocused?.();terminal.frontend?.focus?.();return true;
        });
    };
    const destroy=Panel.prototype.ngOnDestroy;
    Panel.prototype.ngOnDestroy=function(...args){
        for(const [timer,resolve] of this._customContextActions||[]){clearTimeout(timer);resolve(false);}
        this._customContextActions?.clear();return destroy?.apply(this,args);
    };
};
