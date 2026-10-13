module.exports = function installNavigation({apis, Panel, Settings, FilePane, I18n, CwdDialog, Angular, execRemote, reporter }) {
    const fs = require('fs');
    const path = require('path');
    const originalTranslate = apis.I18n.t;
    apis.I18n.getLocale = function () { return 'en-US'; };
    apis.I18n.setLocale = function () { this.locale = 'en-US'; };
    apis.I18n.t = function (key, params) { this.locale = 'en-US'; return originalTranslate.call(this, key, params); };
    try { localStorage.setItem('sftp-plus-locale', 'en-US'); localStorage.setItem('sftp-plus-settings.lang', JSON.stringify('en-US')); } catch {}
    const config = panel => panel.configService?.store?.['tabby-sftp-plus-plus'];
    for (const [property, method, key] of [['customFolderAutocomplete','toggleCustomFolderAutocomplete','folderAutocomplete']]) {
        Object.defineProperty(apis.Settings, property, { get() { return config(this)?.[key] !== false; }, configurable:true });
        apis.Settings[method] = function () { const cfg = config(this); if(cfg) { cfg[key] = !this[property]; this.configService.save(); this.notifyPanels(); } };
    }
    const storageKey = panel => {
        const p = panel.profile || panel.terminalRef?.profile;
        if (!p?.id && !p?.options?.host) return null;
        return 'sftp-plus-custom-folder.' + JSON.stringify([p.id || '', p.options?.host || '', p.options?.port || 22, p.options?.username || p.options?.user || '']);
    };
    const readFolder = panel => {
        const key = storageKey(panel);
        if (!key) return {};
        try { const value = localStorage.getItem(key); if (value) return JSON.parse(value); } catch {}
        return config(panel)?.paneState?.customFolderSessions?.[key] || {};
    };
    apis.Panel._customRememberFolder = function (side, folder) {
        if (this.pathMode !== 'remember' || !folder || this._destroyed) return;
        const key = storageKey(this);
        if (!key) return;
        const saved = { ...readFolder(this), [side]: folder };
        if (readFolder(this)[side] === folder) return;
        try { localStorage.setItem(key, JSON.stringify(saved)); } catch {}
        try {
            const state = config(this)?.paneState;
            if (state) {
                state.customFolderSessions ||= {};
                state.customFolderSessions[key] = saved;
                clearTimeout(this._customFolderSaveTimer);
                this._customFolderSaveTimer = setTimeout(() => { this._customFolderSaveTimer = null; this.configService?.save(); }, 350);
            }
        } catch {}
    };
    const load = apis.Panel._loadSavedPaths;
    apis.Panel._loadSavedPaths = function (...args) {
        load.apply(this, args);
        if (this.pathMode !== 'remember') return;
        const saved = readFolder(this);
        if (saved.local && fs.existsSync(saved.local)) this.localPath = this.localPathInput = saved.local;
        if (saved.remote) this.remotePath = this.remotePathInput = saved.remote;
    };
    const defaultRemote = apis.Panel.getDefaultRemotePath;
    apis.Panel.getDefaultRemotePath = function (...args) {
        if (this.pathMode === 'remember') {
            const saved = readFolder(this).remote;
            if (typeof saved === 'string' && saved.startsWith('/')) return saved;
        }
        return defaultRemote.apply(this, args);
    };
    // Called by the lifecycle for Remember mode; the custom value must take priority over stale legacy state.
    const restore = apis.Panel._restoreSavedRemotePath;
    apis.Panel._restoreSavedRemotePath = function (...args) {
        restore.apply(this, args);
        if (this.pathMode === 'remember') {
            const saved = readFolder(this).remote;
            if (saved) this.remotePath = this.remotePathInput = saved;
        }
    };
    const refreshRemote = apis.Panel.refreshRemote;
    apis.Panel.refreshRemote = async function (...args) {
        const folder = this.remotePath;
        this._customDirectoryCache?.delete(folder);
        const success = await refreshRemote.apply(this, args);
        if (success && this.connected && !this._remoteError && folder === this.remotePath) {this._customLastRemoteFolder=folder;this._customRememberFolder('remote', folder);}
        return success;
    };
    const refreshLocal = apis.Panel.refreshLocal;
    apis.Panel.refreshLocal = async function (...args) {
        const folder = this.localPath;
        await refreshLocal.apply(this, args);
        // The upstream local refresh returns void even on failure; verify the folder before remembering it.
        if (!this._destroyed && folder === this.localPath) {
            try { if ((await fs.promises.stat(folder)).isDirectory()) {this._customLastLocalFolder=folder;this._customRememberFolder('local', folder);} } catch {}
        }
    };
    apis.Panel._customSuggestPaths = async function (side, input) {
        if (this._destroyed || config(this)?.folderAutocomplete === false) return [];
        const local = side === 'local';
        const api = local ? path : path.posix;
        let typed = String(input || '');
        const base = (local ? this.localPath : this.remotePath) || (local ? process.cwd() : '/');
        if (local && /^~(?:[\\/]|$)/.test(typed)) typed = require('os').homedir() + typed.slice(1);
        if (!local && /^~(?:\/|$)/.test(typed)) {
            if (!this.connected || !this.sftpSession?.realpath) return [];
            const home = await this.sftpSession.realpath('.');
            typed = home + typed.slice(1);
        }
        const absolute = api.isAbsolute(typed) ? api.normalize(typed) : api.resolve(base, typed || '.');
        const ending = local ? /[\\/]$/.test(typed) : typed.endsWith('/');
        const parent = ending || !typed ? api.resolve(absolute) : api.dirname(absolute);
        const prefix = ending || !typed ? '' : api.basename(absolute);
        let names = [];
        if (local) {
            const entries = await fs.promises.readdir(parent, { withFileTypes: true });
            const matched = entries.filter(e => (e.isDirectory() || e.isSymbolicLink()) && e.name.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, 300);
            const directories = await Promise.all(matched.map(async entry => {
                if (entry.isDirectory()) return entry.name;
                if (entry.isSymbolicLink()) { try { if ((await fs.promises.stat(api.join(parent, entry.name))).isDirectory()) return entry.name; } catch {} }
                return null;
            }));
            names = directories.filter(Boolean);
        } else {
            if (!this.connected || !this.sftpSession) return [];
            const session = this.sftpSession;
            const cache = this._customDirectoryCache ||= new Map();
            let cached = cache.get(parent);
            if (!cached || cached.session !== session || Date.now() - cached.time > 10000) {
                cached = { session, time:Date.now(), promise:session.readdir(parent) };
                cache.set(parent,cached);
                if(cache.size > 20) cache.delete(cache.keys().next().value);
            }
            let entries;
            try { entries = await cached.promise; } catch(error) { if(cache.get(parent) === cached) cache.delete(parent); throw error; }
            if (this._destroyed || this.sftpSession !== session) return [];
            const matched = entries.filter(e => e.name !== '.' && e.name !== '..' && e.name.startsWith(prefix));
            names = matched.filter(e => e.isDirectory || this.isDirByMode(e.mode)).map(e => e.name);
            for (const e of matched.filter(e => e.isSymlink || (e.mode & 0xf000) === 0xa000).slice(0, 12)) {
                const fullPath = e.fullPath || api.join(parent, e.name);
                const links=cached.links ||= new Map();
                if(!links.has(fullPath))links.set(fullPath,this._resolveRemoteSymlinkIsDir(fullPath));
                if (!names.includes(e.name) && await links.get(fullPath)) names.push(e.name);
                if(this._destroyed || this.sftpSession !== session) return [];
            }
        }
        return names.filter(name => !prefix || (local ? name.toLowerCase() !== prefix.toLowerCase() : name !== prefix)).sort((a,b) => a.localeCompare(b)).slice(0, 80).map(name => api.join(parent, name));
    };
    Object.defineProperty(apis.Panel, 'customLocalPathProvider', {
        get() { return this._customLocalProvider ||= input => this._customSuggestPaths('local', input); }, configurable: true,
    });
    Object.defineProperty(apis.Panel, 'customRemotePathProvider', {
        get() { return this._customRemoteProvider ||= input => this._customSuggestPaths('remote', input); }, configurable: true,
    });


    const focus = apis.FilePane.onPathFocus;
    const change = apis.FilePane.onPathModelChange;
    const blur = apis.FilePane.onPathBlur;
    const paneDestroy = apis.FilePane.ngOnDestroy;
    apis.FilePane._customHideSuggestions = function () {
        this._customSuggestGen = (this._customSuggestGen || 0) + 1;
        clearTimeout(this._customSuggestTimer);
        this._customSuggestBox?.remove();
        this._customSuggestBox = null;
        this._customSuggestItems = [];
        this._customSuggestIndex = -1;
    };
    apis.FilePane._customChooseSuggestion = function (folder, navigate) {
        this._customTypedPath = folder;
        if(navigate)this._customHideSuggestions();
        change.call(this, folder);
        const input = this.hostRef.nativeElement.querySelector('.path-input');
        if (input) { input.value = folder; input.setSelectionRange?.(folder.length, folder.length); }
        if (navigate) this.pathEnter.emit();
        else this._customScheduleSuggestions();
    };
    apis.FilePane._customScheduleSuggestions = function () {
        if (!this.customPathProvider || !this.pathFocused || this._customPaneDestroyed) return;
        clearTimeout(this._customSuggestTimer);
        const query = this._customTypedPath ?? this.pathModel;
        const gen = this._customSuggestGen = (this._customSuggestGen || 0) + 1;
        this._customSuggestItems=[];this._customSuggestIndex=-1;
        this._customSuggestTimer = setTimeout(async () => {
            try {
                const items = await this.customPathProvider(query);
                if (gen !== this._customSuggestGen || !this.pathFocused || this._customPaneDestroyed) return;
                this._customSuggestItems = items;
                this._customSuggestIndex = -1;
                const input = this.hostRef.nativeElement.querySelector('.path-input');
                if (!input) return;
                if (!items.length) { if(this._customSuggestBox){this._customSuggestBox.style.display='none';this._customSuggestBox.replaceChildren();} return; }
                const rect = input.getBoundingClientRect();
                const box = this._customSuggestBox || document.createElement('div');
                box.replaceChildren();box.style.display='block';box.style.top='';box.style.bottom='';
                box.className = 'sftp-custom-folder-dropdown';
                box.setAttribute('role', 'listbox');
                box.setAttribute('aria-label', 'Folder suggestions');
                const surface = getComputedStyle(this.hostRef.nativeElement);
                const textStyle = getComputedStyle(input);
                Object.assign(box.style, { position:'fixed', zIndex:'100000', maxHeight:'240px', overflowY:'auto', padding:'4px', borderRadius:'5px', boxShadow:'0 4px 16px #0005', background:surface.getPropertyValue('--_bg') || '#252733', color:surface.getPropertyValue('--_text') || '#eee', border:'1px solid ' + (surface.getPropertyValue('--_border') || '#555'), fontFamily:textStyle.fontFamily || surface.fontFamily || 'inherit', fontSize:textStyle.fontSize || surface.fontSize || '13px', minWidth:'160px', width:Math.min(Math.max(rect.width, 260), window.innerWidth - 16)+'px', left:Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width,260) - 8))+'px', top:(rect.bottom + 3)+'px' });
                for (const folder of items) {
                    const row = document.createElement('div');
                    row.textContent = folder;
                    row.title = folder;
                    row.setAttribute('role','option');
                    Object.assign(row.style,{padding:'6px 8px',cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'});
                    row.addEventListener('mouseenter', () => { if(gen!==this._customSuggestGen)return;this._customSuggestIndex = items.indexOf(folder); this._customHighlightSuggestion(false); });
                    row.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); if(gen!==this._customSuggestGen)return;this._customChooseSuggestion(folder, true); });
                    box.appendChild(row);
                }
                if(!this._customSuggestBox)document.body.appendChild(box);
                if (box.getBoundingClientRect().bottom > window.innerHeight - 8) { box.style.top = ''; box.style.bottom = Math.max(8, window.innerHeight - rect.top + 3)+'px'; }
                this._customSuggestBox = box;
            } catch { if (gen === this._customSuggestGen) {this._customSuggestItems=[];this._customSuggestIndex=-1;if(this._customSuggestBox){this._customSuggestBox.replaceChildren();this._customSuggestBox.style.display='none';}} }
        }, 0);
    };
    apis.FilePane._customPreviewSuggestion = function (folder) {
        change.call(this, folder);
        const input = this.hostRef.nativeElement.querySelector('.path-input');
        if (input) {
            input.value = folder;
            input.setSelectionRange?.(folder.length, folder.length);
        }
    };
    apis.FilePane._customHighlightSuggestion = function (preview = true) {
        Array.from(this._customSuggestBox?.children || []).forEach((row, index) => {
            row.style.background = index === this._customSuggestIndex ? '#6688aa55' : 'transparent';
            row.setAttribute('aria-selected', index === this._customSuggestIndex ? 'true' : 'false');
            if (index === this._customSuggestIndex) row.scrollIntoView({ block:'nearest' });
        });
        const folder = this._customSuggestItems?.[this._customSuggestIndex];
        if (folder && preview) this._customPreviewSuggestion(folder);
    };
    apis.FilePane.onPathFocus = function (...args) {
        focus.apply(this,args);
        this._customTypedPath = this.pathModel;
        const input = this.hostRef.nativeElement.querySelector('.path-input');
        if (input && this._customBoundInput !== input) {
            if (this._customBoundInput) {
                this._customBoundInput.removeEventListener('keydown',this._customPathKey,true);
                this._customBoundInput.removeEventListener('keyup',this._customPathKeyup,true);
                document.removeEventListener('mousedown',this._customOutside,true);
                window.removeEventListener('resize',this._customCloseOnResize);
                document.removeEventListener('scroll',this._customCloseOnScroll,true);
            }
            this._customBoundInput = input;
            this._customPathKey = event => {
                const items = this._customSuggestItems || [];
                if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if(this._customSuggestBox && this._customTypedPath != null) this._customPreviewSuggestion(this._customTypedPath); this._customHideSuggestions(); return; }
                if (!items.length) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); event.stopImmediatePropagation();
                    const current = this._customSuggestIndex ?? -1;
                    const next = current < 0 && event.key === 'ArrowUp' ? items.length - 1 : current + (event.key === 'ArrowDown' ? 1 : -1);
                    this._customSuggestIndex = (next + items.length) % items.length;
                    this._customHighlightSuggestion();
                } else if (event.key === 'Tab' || (event.key === 'Enter' && this._customSuggestIndex >= 0)) {
                    event.preventDefault(); event.stopImmediatePropagation();
                    if(event.key === 'Enter') this._customSuppressEnter = true;
                    this._customChooseSuggestion(items[Math.max(0,this._customSuggestIndex)], event.key === 'Enter');
                }
            };
            input.addEventListener('keydown',this._customPathKey,true);
            // Prevent Angular's keyup.enter from navigating twice after choosing a folder.
            this._customPathKeyup = event => {
                if (event.key === 'Enter' && this._customSuppressEnter) { event.preventDefault(); event.stopImmediatePropagation(); this._customSuppressEnter = false; }
            };
            input.addEventListener('keyup',this._customPathKeyup,true);
            this._customOutside = event => { if (!this._customSuggestBox?.contains(event.target) && event.target !== this._customBoundInput) this._customHideSuggestions(); };
            document.addEventListener('mousedown',this._customOutside,true);
            this._customCloseOnResize = () => this._customHideSuggestions();
            window.addEventListener('resize',this._customCloseOnResize);
            this._customCloseOnScroll = event => { if(!this._customSuggestBox?.contains(event.target)) this._customHideSuggestions(); };
            document.addEventListener('scroll',this._customCloseOnScroll,true);
        }
        this._customScheduleSuggestions();
    };
    apis.FilePane.onPathModelChange = function (...args) { change.apply(this,args); this._customTypedPath = this.pathModel; this._customSuggestIndex=-1; this._customScheduleSuggestions(); };
    apis.FilePane.onPathBlur = function (...args) { this._customHideSuggestions(); return blur.apply(this,args); };
    apis.FilePane.ngOnDestroy = function (...args) {
        this._customPaneDestroyed = true;
        this._customHideSuggestions();
        this._customBoundInput?.removeEventListener('keydown',this._customPathKey,true);
        this._customBoundInput?.removeEventListener('keyup',this._customPathKeyup,true);
        if(this._customOutside) document.removeEventListener('mousedown',this._customOutside,true);
        if(this._customCloseOnResize) window.removeEventListener('resize',this._customCloseOnResize);
        if(this._customCloseOnScroll) document.removeEventListener('scroll',this._customCloseOnScroll,true);
        return paneDestroy?.apply(this,args);
    };
    apis.CwdDialog.ngOnInit = function () { this.sessionCmd = reporter.session; this.bashSnippet = reporter.snippet; this.zshSnippet = reporter.snippet; };
    // Use the existing Path mode Sync workflow, including its existing setup dialog.
    const syncCwd = apis.Panel._syncRemoteToTerminalCwd;
    apis.Panel._syncRemoteToTerminalCwd = async function (offerSetup = false) {
        await syncCwd?.call(this, offerSetup);
        const session = this.terminalRef?.session || this.terminalRef;
        if (offerSetup && this.pathMode === 'sync' && this.connected && !this._destroyed &&
            this._customReporterSession !== session && !this.cwdSetupVisible) {
            this._cwdSetupPrompted = true;
            this.cwdSetupVisible = true;
            this._safeDetect();
        }
    };
    apis.Panel._enableCwdReporterSession = function () {
        if (!this.terminalRef?.sendInput) return false;
        try { this.terminalRef.sendInput(reporter.session + '\n'); this._customReporterSession = this.terminalRef.session || this.terminalRef; return true; } catch { return false; }
    };
    apis.Panel._enableCwdReporterPermanent = async function () {
        if (!this.sshSession) return false;
        try {
            const shell = String(await execRemote(this.sshSession, 'printf "%s" "${SHELL:-}"')).toLowerCase();
            const rc = shell.includes('zsh') ? '$HOME/.zshrc' : '$HOME/.bashrc';
            const b64 = Buffer.from(reporter.snippet,'utf8').toString('base64');
            const command = `RC=${rc}; if grep -qF '# tabby-sftp-plus-plus screen cwd reporting v2' "$RC" 2>/dev/null; then printf ALREADY; else if [ -f "$RC" ] && [ ! -e "$RC.sftp-plus-screen-backup" ]; then cp -p "$RC" "$RC.sftp-plus-screen-backup" || exit 1; fi; printf '\\n' >> "$RC" && printf '%s' '${b64}' | base64 -d >> "$RC" && printf WRITTEN; fi`;
            const result = String(await execRemote(this.sshSession,command));
            if (!/ALREADY|WRITTEN/.test(result)) return false;
            this._enableCwdReporterSession();
            return true;
        } catch { return false; }
    };
    const panelDestroy = apis.Panel.ngOnDestroy;
    apis.Panel.ngOnDestroy = function (...args) {
        clearTimeout(this._customFolderSaveTimer);
        if(this._customFolderSaveTimer) { this._customFolderSaveTimer = null; try { this.configService?.save(); } catch {} }
        return panelDestroy.apply(this,args);
    };
};
