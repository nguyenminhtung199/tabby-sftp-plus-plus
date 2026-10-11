module.exports = function installActivity({ Panel, recovery }) {
    const fs = require('fs'), path = require('path'), crypto = require('crypto');
    const scope = new (require('async_hooks').AsyncLocalStorage)();
    const live = new Map();
    const release = row => { const key=JSON.stringify([row.server,row.direction,row.remotePath,row.localPath]);if(live.get(key)===row)live.delete(key); };
    const original = { upload: Panel.prototype._doUpload, download: Panel.prototype._doDownload };
    const terminal = status => ['Completed','Cancelled'].includes(status);
    const detect = p => { if (!p._destroyed && !p._customActivityDisposing) p.zone?.run(() => p._safeDetect?.()); };
    const save = (p, row) => {
        row.updatedAt = Date.now();
        if (row.server) try { recovery.put('transfers', row); }
        catch (e) { if (!p._customRecoveryError) { p._customRecoveryError = e.message; p.showToast?.('Cannot save transfer recovery: ' + e.message); } }
        detect(p);
    };
    const snapshot = stat => stat ? { size: Number(stat.size), time: stat.mtimeMs ?? (stat.modified instanceof Date ? stat.modified.getTime() : Number(stat.mtime || 0) * 1000) } : null;
    async function metadata(p, side, file) {
        try { return snapshot(side === 'local' ? await fs.promises.stat(file) : await p.sftpSession.stat(file)); }
        catch (e) { if (e.code === 'ENOENT' || /no such file|not found/i.test(e.message || '')) return null; throw e; }
    }
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const rowEntry = (p, row) => (p.transfers || []).find(t => t.direction === row.direction && t.remotePath === row.remotePath && t.localPath === row.localPath);
    Panel.prototype._customLoadTransfers = function () {
        const server = recovery.server(this); if (!server) return this._customTransferRows ||= [];
        if (this._customTransfersServer !== server) {
            this._customTransfersServer = server;
            this._customTransferRows = recovery.rows('transfers', server).sort((a,b) => b.updatedAt - a.updatedAt);
        }
        return this._customTransferRows;
    };
    Panel.prototype._customRunTransfer = async function (row, run) {
        const key = JSON.stringify([row.server, row.direction, row.remotePath, row.localPath]);
        if (live.has(key) && live.get(key) !== row) { row.status = 'Failed'; row.error = 'Another transfer to this destination is running'; save(this,row); this.showToast?.('This transfer is already running.'); return false; }
        live.set(key, row); row.status = 'Running'; row.error = ''; save(this, row);
        try {
            if (!row.isFolder && !row.prepared) {
                row.destination = await metadata(this, row.direction === 'upload' ? 'remote' : 'local', row.direction === 'upload' ? row.remotePath : row.localPath);
                row.source = await metadata(this, row.direction === 'upload' ? 'local' : 'remote', row.direction === 'upload' ? row.localPath : row.remotePath);
                row.prepared = true; save(this, row);
            }
            const ok = await run();
            const entry = rowEntry(this, row);
            if (entry?.logEntryId) row.logEntryId = entry.logEntryId;
            if (row.status === 'Cancelled') return false;
            if (entry?.paused || row.status === 'Paused') row.status = 'Paused';
            else row.status = ok ? 'Completed' : (!this.connected || this._destroyed ? 'Interrupted' : 'Failed');
            if (row.status === 'Completed') { row.percent = 100; row.error = ''; }
            else if (row.status !== 'Paused') row.error = row.error || 'Transfer did not complete; use Retry';
            return ok;
        } catch (e) {
            if (row.status !== 'Cancelled') { row.status = !this.connected || this._destroyed ? 'Interrupted' : 'Failed'; row.error = e.message; }
            return false;
        } finally {
            if (row.status !== 'Paused') release(row);
            save(this, row);
        }
    };
    const make = (p, data) => {
        const rows = p._customLoadTransfers();
        const queued = rows.find(row => row.status === 'Queued' && row.direction === data.direction && row.remotePath === data.remotePath && row.localPath === data.localPath);
        if (queued) { Object.assign(queued,data); return queued; }
        const finished = rows.filter(row => terminal(row.status));
        for (const old of finished.slice(49)) {
            rows.splice(rows.indexOf(old),1); if (old.server) recovery.remove('transfers',old.id);
        }
        const row = { id: crypto.randomUUID(), server: recovery.server(p), createdAt: Date.now(), updatedAt: Date.now(), percent: 0, attempts: 0, ...data };
        rows.unshift(row); return row;
    };
    for (const direction of ['upload','download']) {
        const method = direction === 'upload' ? '_doUpload' : '_doDownload';
        Panel.prototype[method] = async function (remotePath, localPath, ...args) {
            if (scope.getStore() || (direction === 'upload' && args[0] === 'edit-upload') || (direction === 'download' && args[2] === 'edit-download')) return original[direction].call(this, remotePath, localPath, ...args);
            const row = make(this, { direction, remotePath, localPath, isFolder: false, args });
            return this._customRunTransfer(row, () => original[direction].call(this, remotePath, localPath, ...args));
        };
    }
    Panel.prototype._customHookFolderTransfers = function () {
        const coordinator = this._transferCoordinator;
        if (!coordinator || coordinator._customRecoveryHook) return;
        coordinator._customRecoveryHook = true;
        for (const method of ['uploadPathToRemote','downloadRemoteDir','mergeLocalDirToRemote']) {
            const run = coordinator[method]; if (typeof run !== 'function') continue;
            coordinator[method] = async (...args) => {
                if (scope.getStore() || (method !== 'mergeLocalDirToRemote' && args[2])) return run.apply(coordinator, args);
                if (method === 'uploadPathToRemote' && !(await fs.promises.stat(args[1])).isDirectory()) return run.apply(coordinator, args);
                const direction = method === 'downloadRemoteDir' ? 'download' : 'upload';
                const remotePath = method === 'uploadPathToRemote' ? path.posix.join(args[0], path.basename(args[1])) : method === 'mergeLocalDirToRemote' ? args[1] : args[0];
                const localPath = method === 'downloadRemoteDir' ? path.join(args[1], args[3] || path.posix.basename(args[0])) : method === 'mergeLocalDirToRemote' ? args[0] : args[1];
                const retryArgs = method === 'mergeLocalDirToRemote' ? [args[0],args[1]] : method === 'downloadRemoteDir' ? [args[0],args[1],null,args[3],false] : [args[0],args[1]];
                const row = make(this, { direction, remotePath, localPath, isFolder: true, method, args: retryArgs });
                return this._customRunTransfer(row, () => scope.run(row, () => run.apply(coordinator, args)));
            };
            coordinator[method]._customOriginal = run;
        }
        const batch = coordinator.uploadBatchUseCase;
        if (batch?.execute && !batch.execute._customOriginal) {
            const execute = batch.execute;
            batch.execute = async (paths, remote, name) => {
                if (scope.getStore()) return execute.call(batch,paths,remote,name);
                const row = make(this,{direction:'upload',remotePath:remote,localPath:path.dirname(paths[0]),isFolder:true,method:'batch',args:[paths,remote,name],name});
                let result;
                await this._customRunTransfer(row,async()=>{result=await scope.run(row,()=>execute.call(batch,paths,remote,name));return result==='success';});
                if (result==='fallback') {
                    this._customTransferRows=this._customTransferRows.filter(r=>r!==row);
                    if(row.server)recovery.remove('transfers',row.id);
                }
                return result || 'failed';
            };
            batch.execute._customOriginal = execute;
        }
    };
    Panel.prototype._customCaptureQueued = function () {
        for (const entry of this.transfers || []) {
            if (entry.customEditTransfer || !entry.queued || !entry.remotePath || !entry.localPath || (this._customTransferRows || []).some(r=>r.logEntryId===entry.logEntryId || (!terminal(r.status) && rowEntry(this,r)===entry))) continue;
            const method = entry.isFolder ? (entry.direction==='upload'?'uploadPathToRemote':'downloadRemoteDir') : null;
            const args = !entry.isFolder ? [] : entry.direction==='upload' ? [path.posix.dirname(entry.remotePath),entry.localPath] : [entry.remotePath,path.dirname(entry.localPath),null,path.basename(entry.localPath),false];
            const row=make(this,{direction:entry.direction,remotePath:entry.remotePath,localPath:entry.localPath,isFolder:!!entry.isFolder,method,args,status:'Queued',logEntryId:entry.logEntryId});
            save(this,row);
        }
    };
    for(const method of ['_streamUploadOne','_streamDownloadOne']) {
        const enqueue=Panel.prototype[method];if(!enqueue)continue;
        Panel.prototype[method]=function(...args){const result=enqueue.apply(this,args);this._customCaptureQueued();return result;};
    }
    // Recovery never starts a transfer automatically: retry requires the user's action.
    Panel.prototype.customRetryTransfer = async function (row) {
        if (!this.connected || !this.sftpSession || this._destroyed || terminal(row.status) || row.status === 'Running' || row.status === 'Queued') return;
        const entry = rowEntry(this, row);
        if (entry?.paused) { await this.resumeTransfer(entry); return; }
        if (row._retryBusy) return;
        row._retryBusy = true;
        try {
            if (!row.isFolder) {
                const destination = await metadata(this, row.direction === 'upload' ? 'remote' : 'local', row.direction === 'upload' ? row.remotePath : row.localPath);
                const source = await metadata(this, row.direction === 'upload' ? 'local' : 'remote', row.direction === 'upload' ? row.localPath : row.remotePath);
                if (!source) throw new Error('Source file is missing');
                const changed = !row.prepared || !equal(destination, row.destination) || !equal(source, row.source);
                if (changed && !window.confirm('Source or destination changed since this transfer.\nRestart with the current source and replace the destination?\n' + row.remotePath + '\n' + row.localPath)) {
                    row.status = 'Conflict'; row.error = 'Source or destination changed; review before retrying'; save(this, row); return;
                }
                row.destination = destination; row.source = source; row.prepared = true;
                if(row.direction==='download')row.args=[row.args?.[0],source.size];
            }
            row.attempts = (row.attempts || 0) + 1;
            if (row.isFolder) {
                this._customHookFolderTransfers();
                if(row.method==='batch') {
                    await this._customRunTransfer(row,()=>scope.run(row,async()=>{
                        let ok=true;
                        for(const local of row.args[0]) {
                            if(row.status==='Cancelled'||this._destroyed||!this.connected)return false;
                            if(!await this.uploadPathToRemote(row.args[1],local))ok=false;
                        }
                        return ok;
                    }));return;
                }
                const fn = this._transferCoordinator?.[row.method]?._customOriginal;
                if (!fn) throw new Error('Folder transfer is unavailable');
                if (row.method === 'mergeLocalDirToRemote' && !window.confirm('Retry this folder upload and replace existing files?\n' + row.remotePath)) return;
                await this._customRunTransfer(row, () => scope.run(row, () => fn.apply(this._transferCoordinator, row.args)));
            } else await this._customRunTransfer(row, () => original[row.direction].call(this, row.remotePath, row.localPath, ...row.args));
        } catch (e) { row.status = 'Failed'; row.error = e.message; save(this, row); }
        finally { row._retryBusy = false; }
    };
    Panel.prototype.customCancelTransfer = function (row) {
        const entry = rowEntry(this, row);
        if (entry) this.cancelTransfer(entry);
        else if (row.status === 'Running' || row.status === 'Queued') return;
        row.status = 'Cancelled'; row.error = ''; save(this, row);
        release(row);
    };
    Panel.prototype.customClearFinishedTransfers = function () {
        this._customTransferRows = (this._customTransferRows || []).filter(row => {
            if (!terminal(row.status)) return true;
            release(row);
            if (row.server) recovery.remove('transfers', row.id);
            return false;
        }); detect(this);
    };
    for (const method of ['pauseTransfer','resumeTransfer','cancelTransfer']) {
        const run = Panel.prototype[method]; if (!run) continue;
        Panel.prototype[method] = async function (entry, ...args) {
            const edit=Array.from(this._customExternalSessions?.values() || []).find(e=>e.uploadSnapshot===entry.localPath && e.remotePath===entry.remotePath);
            if(edit && method==='pauseTransfer' && !entry.transfer?._customStream){this.showToast?.('Save uploads cannot be paused. Cancel to keep the local copy, then use Retry.');return;}
            if(edit && method==='cancelTransfer'){
                edit.cancelledUpload=true;edit.blockedHash=edit.pendingHash;
                this._customEditStatus?.(edit,'Failed','Upload cancelled; local copy retained');
            }
            const row = this._customTransferRows?.find(r => rowEntry(this, r) === entry && !terminal(r.status));
            if (row && method === 'resumeTransfer' && !row.isFolder) {
                try {
                    const source = await metadata(this, row.direction === 'upload' ? 'local' : 'remote', row.direction === 'upload' ? row.localPath : row.remotePath);
                    const destination = await metadata(this, row.direction === 'upload' ? 'remote' : 'local', row.direction === 'upload' ? row.remotePath : row.localPath);
                    if(row.status==='Cancelled'||this._destroyed||!this.connected)return;
                    if (!row.prepared || !equal(source,row.source) || !equal(destination,row.destination)) {
                        row.status = 'Conflict'; row.error = 'Changed while paused. Cancel and start a new transfer.'; save(this,row); this.showToast?.(row.error); return;
                    }
                } catch(e) { row.status = 'Failed'; row.error = e.message; save(this,row); return; }
            }
            if (row) { row.status = method === 'pauseTransfer' ? 'Paused' : method === 'resumeTransfer' ? 'Running' : 'Cancelled'; row.logEntryId = entry.logEntryId; save(this, row); }
            if(row && method==='cancelTransfer')release(row);
            return await run.call(this, entry, ...args);
        };
    }
    const clear=Panel.prototype.clearTransfers;
    if(clear)Panel.prototype.clearTransfers=function(...args){
        for(const row of this._customTransferRows || [])if(!terminal(row.status) && rowEntry(this,row)){
            row.status=this.connected&&!this._destroyed&&!this._customActivityDisposing?'Cancelled':'Interrupted';
            row.error=row.status==='Interrupted'?'Session ended; use Retry':'';save(this,row);
            release(row);
        }
        return clear.apply(this,args);
    };
    Object.defineProperty(Panel.prototype, 'customEditRows', { get() { return Array.from(this._customExternalSessions?.values() || []); } });
    Object.defineProperty(Panel.prototype, 'customTransferRows', { get() { return this._customTransferRows || []; } });
    Object.defineProperty(Panel.prototype, 'customHistoryOwner', { get() { return this; } });
    Object.defineProperty(Panel.prototype, 'customHistoryRecoveryRows', { get() {
        const ids=new Set((this.transferLog?.getAll?.() || []).map(e=>e.id));
        return this.customTransferRows.filter(row=>!row.logEntryId || !ids.has(row.logEntryId));
    } });
    Panel.prototype.customLogTransfer=function(entry){return this.customTransferRows.find(row=>row.logEntryId===entry.id);};
    Panel.prototype.customCanRetryTransfer=row=>!!row && !['Completed','Cancelled','Running','Queued'].includes(row.status);
    const clearHistory=Panel.prototype.clearLog;
    if(clearHistory)Panel.prototype.clearLog=function(...args){
        const before=new Set((this.transferLog?.getAll?.() || []).map(e=>e.id));
        const result=clearHistory.apply(this,args);
        const after=new Set((this.transferLog?.getAll?.() || []).map(e=>e.id));
        this._customTransferRows=this.customTransferRows.filter(row=>{
            if(!terminal(row.status) || !before.has(row.logEntryId) || after.has(row.logEntryId))return true;
            release(row);if(row.server)recovery.remove('transfers',row.id);return false;
        });
        return result;
    };
    Object.defineProperty(Panel.prototype, 'customActivityCount', { get() { return this.customEditRows.length + this.customTransferRows.filter(r => !terminal(r.status)).length; } });
    Panel.prototype.customTrackActivity = (_, row) => row.id || row.remotePath;
    Panel.prototype.customActivityName = row => row.name || path.basename(row.remotePath) || row.remotePath;
    Panel.prototype.customTransferDetails = row => row.status === 'Running' ? `${Math.round(row.percent || 0)}% · ${row.speed || '--'}` : row.error || row.status;
    Panel.prototype._customActivityTick = async function () {
        if (this._destroyed || this._customActivityBusy) return;
        this._customActivityBusy = true;
        try {
            this._customHookFolderTransfers(); this._customLoadTransfers(); this._customCaptureQueued(); this._customRestoreEdits?.();
            for (const row of this._customTransferRows || []) {
                if (terminal(row.status)) {release(row);continue;}
                const entry = rowEntry(this, row);
                if(entry?.skippedAsDuplicate) {row.status='Completed';row.percent=100;row.error='Identical content; skipped';save(this,row);continue;}
                if (!this.connected && ['Running','Queued'].includes(row.status)) { row.status = 'Interrupted'; row.error = 'Waiting for reconnection; use Retry'; save(this, row); continue; }
                if (entry) {
                    row.percent = entry.percent || 0; row.speed = entry.speed || ''; row.logEntryId = entry.logEntryId;
                    if (row.status !== 'Conflict' && this.connected) row.status = entry.paused ? 'Paused' : entry.queued ? 'Queued' : 'Running';
                } else if (row.logEntryId && ['Running','Paused'].includes(row.status)) {
                    const log = this.transferLog?.getAll?.().find(l => l.id === row.logEntryId);
                    if (log && !log.pending && log.endTime) { row.status = log.success ? 'Completed' : 'Failed'; row.error = log.success ? '' : 'Transfer failed; use Retry'; release(row); save(this, row); }
                }
            }
            detect(this);
        } catch (e) { if (!this._customRecoveryError) { this._customRecoveryError = e.message; this.showToast?.('Recovery unavailable: ' + e.message); } }
        finally { this._customActivityBusy = false; }
    };
    const init = Panel.prototype.ngOnInit;
    Panel.prototype.ngOnInit = function (...args) {
        const result = init?.apply(this, args);
        this._customActivityTimer = setInterval(() => void this._customActivityTick(), 1000);
        void this._customActivityTick(); return result;
    };
    const connect = Panel.prototype.connect;
    if (connect) Panel.prototype.connect = async function (...args) { const result = await connect.apply(this, args); await this._customActivityTick(); return result; };
    const destroy = Panel.prototype.ngOnDestroy;
    Panel.prototype.ngOnDestroy = function (...args) {
        this._customActivityDisposing = true;
        clearInterval(this._customActivityTimer);
        for (const row of this._customTransferRows || []) {
            if (['Running','Queued','Paused'].includes(row.status)) { row.status = row.status === 'Paused' ? 'Paused' : 'Interrupted'; save(this, row); }
            release(row);
        }
        for (const timer of this._customRefreshTimers || []) clearTimeout(timer);
        return destroy?.apply(this, args);
    };
    // Same-folder refresh preserves the visible anchor without undoing scrolling or a newer navigation.
    for (const side of ['local','remote']) {
        const method = side === 'local' ? 'refreshLocal' : 'refreshRemote';
        const refresh = Panel.prototype[method]; if (!refresh) continue;
        Panel.prototype[method] = async function (...args) {
            const folder = this[side + 'Path'];
            const gen = this['_customRefresh_' + side] = (this['_customRefresh_' + side] || 0) + 1;
            const sameFolder = this[side === 'local' ? '_lastLocalListedPath' : '_lastRemoteListedPath'] === folder;
            this['_customRefreshSame_' + side] = sameFolder;
            const list = this.elRef?.nativeElement?.querySelector('.pane-list.' + side + '-pane');
            const scrollTop = list?.scrollTop, scrollLeft = list?.scrollLeft;
            const top = list?.getBoundingClientRect?.().top || 0;
            const anchor = sameFolder ? Array.from(list?.querySelectorAll?.('.entry[data-path]') || []).find(e => e.getBoundingClientRect().bottom > top + 26) : null;
            const anchorPath = anchor?.getAttribute('data-path');
            const anchorOffset = anchor && anchor.getBoundingClientRect().top - top;
            let result;
            try { result = await refresh.apply(this, args); }
            finally { if(gen === this['_customRefresh_' + side])this['_customRefreshSame_' + side]=false; }
            if (sameFolder && folder === this[side + 'Path'] && gen === this['_customRefresh_' + side] && result !== false && !this._destroyed) {
                const entries = new Map((this[side + 'Entries'] || []).map(e => [e.fullPath, e]));
                const selected = side === 'local' ? 'selectedLocal' : 'selectedRemote';
                this[selected] = (this[selected] || []).map(e => entries.get(e.fullPath)).filter(Boolean);
                this._safeDetect?.();
                const restore = () => {
                    if (this._destroyed || folder !== this[side + 'Path'] || gen !== this['_customRefresh_' + side] || !list || list.scrollTop !== scrollTop || list.scrollLeft !== scrollLeft) return;
                    const row = Array.from(list.querySelectorAll?.('.entry[data-path]') || []).find(e => e.getAttribute('data-path') === anchorPath);
                    list.scrollTop = row ? scrollTop + row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchorOffset : scrollTop;
                    list.scrollLeft = scrollLeft;
                };
                const timer = setTimeout(() => { this._customRefreshTimers?.delete(timer); restore(); }, 0);
                (this._customRefreshTimers ||= new Set()).add(timer);
            }
            return result;
        };
    }
};
