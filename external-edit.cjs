module.exports = function installExternalEdit({ Panel, Settings, download, shell, recovery }) {
    const fs = require('fs');
    const fsp = fs.promises;
    const path = require('path');
    const crypto = require('crypto');
    const metadata=require('./remote-metadata.cjs');
    const hashFile = async file => {const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file,{highWaterMark:256*1024}))digest.update(chunk);return digest.digest('hex');};
    const signature = stat => [stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':');
    const poll = (panel, state) => {
        const start = () => setInterval(() => void panel._customSyncExternal(state), 1000);
        return panel.zone?.runOutsideAngular ? panel.zone.runOutsideAngular(start) : start();
    };
    const baseline = st => {
        if (!st || !Number.isFinite(Number(st.size))) throw new Error('Cannot verify remote file metadata');
        const date = st.modified instanceof Date ? st.modified.getTime() : Number(st.mtime || 0);
        return { size: Number(st.size), time: date > 0 && date < 1e12 ? date * 1000 : date };
    };
    const same = (a, b) => a.size === b.size && a.time === b.time;
    const persist = (panel, state) => {
        if (!recovery || !state.id || !state.localPath || !state.syncedHash) return;
        try {
            recovery.put('edits', { id: state.id, server: state.server, remotePath: state.remotePath,
                localPath: state.localPath, baseline: state.baseline, syncedHash: state.syncedHash,
                blockedHash: state.blockedHash, status: state.status, error: state.error || '', retries: state.retries || 0 });
        } catch (e) { if (!panel._customRecoveryError) { panel._customRecoveryError = e.message; notice(panel, 'Cannot save edit recovery: ' + e.message, true); } }
    };
    const status = (panel, state, value, error = '') => {
        if (state.status === value && state.error === error) return;
        state.status = value; state.error = error; state.changedAt = Date.now();
        persist(panel, state); if(!panel._customActivityDisposing && !panel._customEditDisposing)panel._safeDetect?.();
    };
    Panel.prototype._customPersistEdit = function (state) { persist(this, state); };
    Panel.prototype._customBlockResumedEdit = async function(remote,snapshot){
        const state=this._customExternalSessions?.get(remote);if(!state)return;
        state.stopped=true;clearInterval(state.timer);state.cancelledUpload=true;
        state.blockedHash=await hashFile(snapshot);status(this,state,'Failed','Upload cancelled; local copy retained. Use Retry to continue.');persist(this,state);
    };
    Panel.prototype._customResumeUploadedEdit = async function(remote,snapshot){
        const state=this._customExternalSessions?.get(remote);
        if(state){state.baseline=baseline(await metadata(this.sftpSession,remote));state.syncedHash=await hashFile(snapshot);state.blockedHash=null;state.session=this.sftpSession;state.retries=0;state.nextRetry=0;status(this,state,'Synced');persist(this,state);}
        const folder=path.dirname(snapshot),base=path.resolve(recovery?.root||'');
        if(path.resolve(folder).startsWith(base+path.sep)&&path.basename(folder).startsWith('.sync-')){
            await fsp.unlink(snapshot).catch(()=>{});await fsp.rmdir(folder).catch(()=>{});
        }
    };
    Panel.prototype._customEditStatus = function (state,value,error) { status(this,state,value,error); };
    Panel.prototype._customRestoreEdits = function () {
        if (!recovery || !this.connected || !this.sftpSession || this._destroyed) return;
        const server = recovery.server(this); if (!server) return;
        const sessions = this._customExternalSessions ||= new Map();
        try {
            for (const state of sessions.values()) if (state.server && state.server !== server) {
                state.stopped = true; clearInterval(state.timer); status(this, state, 'Offline', 'Belongs to another server');
                recovery.release(state.id, this); sessions.delete(state.remotePath);
            }
            for (const saved of recovery.rows('edits', server)) {
                if (!recovery.claim(saved.id, this)) continue;
                let state = sessions.get(saved.remotePath);
                if (!state) { state = { ...saved, busy: false, stopped: true }; sessions.set(saved.remotePath, state); }
                if (state.busy || state.opening) continue;
                if (!fs.existsSync(state.localPath)) { status(this, state, 'Missing', 'Local copy is unavailable'); continue; }
                if (state.session !== this.sftpSession || state.stopped) {
                    clearInterval(state.timer); state.session = this.sftpSession; state.stopped = false;
                    status(this, state, state.blockedHash ? (saved.status === 'Failed' ? 'Failed' : 'Conflict') : 'Editing', state.blockedHash ? 'Resolve or retry this local edit' : '');
                    state.timer = poll(this, state);
                    void this._customSyncExternal(state);
                }
            }
        } catch (e) { if (!this._customRecoveryError) { this._customRecoveryError = e.message; notice(this, 'Cannot restore edits: ' + e.message, true); } }
    };
    Panel.prototype.customRetryEdit = async function (state) {
        if (!this.connected || state.busy || state.opening || this._destroyed) return;
        if (state.openingError) return this._customExternalEdit(state.entry);
        if(this._customPendingEditUpload?.(state.remotePath)&&!await this._customRetrySavedEditUpload(state.remotePath))return;
        if (state.id && recovery && !recovery.claim(state.id, this)) return;
        state.blockedHash = null; state.retries = 0; state.nextRetry = 0; state.stopped = false; state.session = this.sftpSession;
        clearInterval(state.timer); state.timer = poll(this, state);
        status(this, state, 'Editing'); await this._customSyncExternal(state);
    };
    Panel.prototype.customOpenEdit = async function (state) {
        const error = await shell.openPath(state.localPath);
        if (error) status(this, state, 'Failed', 'Cannot open local app: ' + error);
    };
    Panel.prototype.customStopEdit = function (state) {
        if (state.busy || state.opening) return;
        state.stopped = true; clearInterval(state.timer);
        this._customExternalSessions?.delete(state.remotePath);
        if (state.id && recovery) { recovery.remove('edits', state.id); recovery.release(state.id, this); }
        this._safeDetect?.();
    };
    const activate = Panel.prototype._activateEntry;
    Panel.prototype.ctxEditFile=function(...args){
        const entry=this.contextMenuEntry,pane=this.contextMenuPane;this.closeContextMenu?.();
        return this._activateEntry(pane,entry,{});
    };
    const destroy = Panel.prototype.ngOnDestroy;
    const notice = (panel, message, error = false) => {
        if (panel._destroyed) return;
        panel.zone.run(() => {
            panel.showToast(message, 7000);
        });
    };
    Panel.prototype._activateEntry = async function (pane, entry, event) {
        if (!entry) return;
        let directory = !!entry.isDirectory || this.isDirByMode(entry.mode);
        if (!directory && pane === 'remote' && (entry.isSymlink || (entry.mode & 0xf000) === 0xa000)) {
            directory = await this._resolveRemoteSymlinkIsDir(entry.fullPath);
        }
        if (directory) return activate.call(this, pane, entry, event);
        if (pane === 'local') return this._openPathInSystem(entry.linkTarget || entry.fullPath, { waitForModRelease: true });
        return this._customExternalEdit(entry);
    };
    Panel.prototype._customExternalEdit = async function (entry, opener) {
        const open=opener||((file)=>shell.openPath(file));
        if (!this.connected || !this.sftpSession || this._destroyed) return;
        this._customRestoreEdits();
        const sessions = this._customExternalSessions ||= new Map();
        let existing = sessions.get(entry.fullPath);
        if(existing?.openingError){sessions.delete(entry.fullPath);if(existing.id && recovery)recovery.release(existing.id,this);existing=null;}
        if (existing && existing.session === this.sftpSession) {
            if (existing.opening) {
                await existing.opening;
                if(opener&&existing.syncedHash&&!existing.stopped&&!this._destroyed&&existing.session===this.sftpSession)return open(existing.localPath);
                return;
            }
            existing.blockedHash = null;
            existing.nextRetry = 0; existing.retries = 0;
            if (existing.stopped) {
                existing.stopped = false;
                existing.timer = poll(this, existing);
            }
            const error = await open(existing.localPath);
            if (error) notice(this, `Cannot open editor: ${error}. Local copy: ${existing.localPath}`, true);
            else if(existing.status==='Failed')status(this,existing,'Editing');
            return;
        }
        if (existing) { existing.stopped = true; clearInterval(existing.timer); }
        const server = recovery?.server(this);
        const id = server && recovery.editId(server, entry.fullPath);
        if (id && !recovery.claim(id, this)) {
            const owner = recovery.owner(id); const state = owner?._customExternalSessions?.get(entry.fullPath);
            if (state?.localPath) await open(state.localPath);
            else notice(this, 'This file is already opening in another SFTP panel.');
            return;
        }
        const state = { id, server, entry: { name: entry.name, fullPath: entry.fullPath, size: entry.size, mode: entry.mode }, session: this.sftpSession, remotePath: entry.fullPath, stopped: false, busy: false, blockedHash: null, status: 'Opening' };
        sessions.set(entry.fullPath, state);
        this._safeDetect?.();
        state.opening = (async () => {
            try {
                const before = baseline(await metadata(state.session,entry.fullPath));
                if(this._customDownloadForEdit){
                    const resumed=this._customResumeLocalForEdit?.(entry.fullPath);
                    const directory=resumed?path.dirname(resumed):path.join(id?recovery.root:require('os').tmpdir(),'edits',crypto.randomUUID());
                    await fsp.mkdir(directory,{recursive:true});state.localPath=resumed||path.join(directory,path.basename(entry.fullPath));
                    status(this,state,'Downloading');
                    if(!await this._customDownloadForEdit({...entry,size:before.size},state.localPath))throw new Error('Download failed or cancelled; local app was not opened');
                }else state.localPath = await download(state.session, entry.fullPath, entry.size ?? 0, entry.mode, { requireExactSize: true });
                state.baseline = baseline(await metadata(state.session,entry.fullPath));
                if (!same(before, state.baseline)) throw new Error('Remote file changed while downloading; open it again');
                if (id && !this._customDownloadForEdit) {
                    const directory = path.join(recovery.root, 'edits', crypto.randomUUID());
                    await fsp.mkdir(directory, { recursive: true });
                    const durable = path.join(directory, path.basename(state.localPath));
                    await fsp.copyFile(state.localPath, durable); state.localPath = durable;
                }
                state.syncedHash = await hashFile(state.localPath);
                state.checkedSignature=signature(await fsp.stat(state.localPath));state.checkedHash=state.syncedHash;
                if (this._destroyed || this.sftpSession !== state.session || state.stopped) throw new Error('Connection closed while downloading');
                // Poll the path: atomic-save editors may replace the inode or briefly remove the file.
                state.timer = poll(this, state);
                status(this, state, 'Editing');
                const error = await open(state.localPath);
                if (error) throw new Error(error);
                notice(this, `Editing ${entry.name}: save in the local app to sync to the server.`);
            } catch (error) {
                state.stopped = true;
                clearInterval(state.timer);
                status(this, state, 'Failed', error.message);
                if (!state.syncedHash) { state.openingError = true; if (id) recovery.release(id, this); }
                notice(this, `External edit failed: ${error.message}${state.localPath ? `. Local copy: ${state.localPath}` : ''}`, true);
            } finally { state.opening = null; }
        })();
        return state.opening;
    };
    Panel.prototype._customSyncExternal = async function (state) {
        if(this._customPendingEditUpload?.(state.remotePath))return;
        if (state.stopped || state.busy || this._destroyed) return;
        if (state.nextRetry > Date.now()) return;
        if (!this.connected || this.sftpSession !== state.session) {
            state.stopped = true;
            clearInterval(state.timer);
            status(this, state, 'Offline', 'Waiting for this server to reconnect');
            notice(this, `Sync stopped: connection closed. Local copy retained: ${state.localPath}`, true);
            return;
        }
        state.busy = true;
        let snapshot, snapshotDirectory;
        let contentHash;
        try {
            const stat = await fsp.stat(state.localPath);
            if (Date.now() - stat.mtimeMs < 750) return;
            if(state.checkedSignature===signature(stat) && (state.checkedHash===state.syncedHash || state.checkedHash===state.blockedHash))return;
            contentHash = await hashFile(state.localPath);
            const after = await fsp.stat(state.localPath);
            if (signature(stat)!==signature(after)) return;
            state.checkedSignature=signature(after);state.checkedHash=contentHash;
            if (contentHash === state.syncedHash || contentHash === state.blockedHash) return;
            state.pendingHash=contentHash;state.cancelledUpload=false;
            status(this, state, 'Pending');
            const current = baseline(await metadata(state.session,state.remotePath));
            if (!same(current, state.baseline)) {
                const overwrite = window.confirm(`Remote file changed: ${state.remotePath}\nOverwrite with your local edits?\nLocal copy: ${state.localPath}`);
                if (!overwrite) { state.blockedHash = contentHash; status(this, state, 'Conflict', 'Server file changed; local edits retained'); return; }
            }
            if (state.stopped || this._destroyed || !this.connected || this.sftpSession !== state.session) return;
            // Upload an immutable copy, preserving bytes/encoding while the editor can keep saving.
            snapshotDirectory = path.join(path.dirname(state.localPath), `.sync-${crypto.randomUUID()}`);
            await fsp.mkdir(snapshotDirectory);
            snapshot = path.join(snapshotDirectory,path.basename(state.remotePath));
            await fsp.copyFile(state.localPath,snapshot,fs.constants.COPYFILE_EXCL);
            if(await hashFile(snapshot)!==contentHash || signature(await fsp.stat(state.localPath))!==signature(stat))return;
            if (state.stopped || this._destroyed || !this.connected || this.sftpSession !== state.session) return;
            status(this, state, 'Uploading');
            state.uploadSnapshot=snapshot;
            const uploaded=this._customUploadForEdit?await this._customUploadForEdit(state.remotePath,snapshot,stat.size,current):await this._doUpload(state.remotePath, snapshot, 'edit-upload');
            if (!uploaded) throw new Error('Upload failed');
            state.baseline = baseline(await metadata(state.session,state.remotePath));
            if (state.baseline.size !== stat.size) throw new Error('Uploaded size could not be verified');
            state.syncedHash = contentHash;
            state.blockedHash = null;
            state.retries = 0; state.nextRetry = 0;
            status(this, state, 'Synced'); persist(this, state);
            notice(this, `Synced ${path.basename(state.remotePath)} to server.`);
            void this.refreshRemote();
        } catch (error) {
            // Atomic-save gaps are transient; bounded retry keeps the local copy and avoids a tight failure loop.
            if (error.code !== 'ENOENT' && error.code !== 'EBUSY') {
                state.retries = (state.retries || 0) + 1;
                state.nextRetry = Date.now() + Math.min(30000, 3000 * 2 ** (state.retries - 1));
                if (state.retries >= 3 || state.cancelledUpload) state.blockedHash = contentHash;
                status(this, state, 'Failed', state.cancelledUpload ? 'Upload cancelled; use Retry' : error.message + (state.retries < 3 ? '; retry scheduled' : '; use Retry'));
                notice(this, `Sync failed: ${error.message}. Local copy retained: ${state.localPath}. Use Retry to upload again.`, true);
            }
        } finally {
            const keep=snapshot&&this._customHasPartial?.('upload',state.remotePath,snapshot);
            if (snapshot&&!keep) await fsp.unlink(snapshot).catch(() => {});
            if (snapshotDirectory&&!keep) await fsp.rmdir(snapshotDirectory).catch(() => {});
            state.uploadSnapshot=null;state.pendingHash=null;
            state.busy = false;
        }
    };
    Panel.prototype.ngOnDestroy = function (...args) {
        this._customEditDisposing = true;
        for (const state of this._customExternalSessions?.values() || []) {
            state.stopped = true;
            clearInterval(state.timer);
            status(this, state, 'Offline', 'Panel closed; local copy retained');
            if (state.id && recovery) recovery.release(state.id, this);
        }
        // Keep local copies: the external app may still be open after this panel closes.
        return destroy.apply(this, args);
    };
};

