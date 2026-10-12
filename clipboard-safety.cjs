module.exports=function installPasteSafety({Panel}){
    const path=require('path'),original=Panel.prototype.ctxClipboardPaste;
    const same=(pane,a,b)=>{
        const normalize=pane==='local'?path.resolve:path.posix.resolve;
        const left=normalize(a),right=normalize(b);
        return pane==='local'&&process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
    };
    Panel.prototype.ctxClipboardPaste=function(...args){
        if(this._destroyed||this._customPasteBusy)return Promise.resolve(false);
        const entries=[...(this.clipboardEntries||[])],pane=this.contextMenuPane,source=this.clipboardSource;
        const destination=pane==='local'?this.localPath:this.remotePath;
        const remaining=source===pane?entries.filter(entry=>{
            if(!entry.fullPath||!entry.name)return true;
            const target=(pane==='local'?path:path.posix).join(destination,entry.name);
            return !same(pane,entry.fullPath,target);
        }):entries;
        // A same-path copy/cut must never reach conflict hashing, SSH exec or I/O.
        if(entries.length&&!remaining.length){
            try{this.closeContextMenu?.();this.showToast?.('Source and destination are the same; nothing to paste.',4000);}catch{}
            return Promise.resolve(false);
        }
        this._customPasteBusy=true;
        const work=async()=>{
            try{
                if(remaining.length!==entries.length)this.clipboardEntries=remaining;
                return await original.apply(this,args);
            }catch(error){
                if(entries.length&&!this.clipboardEntries?.length){this.clipboardEntries=entries;this.clipboardSource=source;}
                try{if(!this._destroyed)this.showToast?.('Paste failed: '+(error?.message||String(error)),7000);}catch{}
                return false;
            }finally{this._customPasteBusy=false;}
        };
        return this.zone?.runOutsideAngular?this.zone.runOutsideAngular(work):work();
    };
};
