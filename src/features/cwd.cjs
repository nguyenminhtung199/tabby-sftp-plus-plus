// CWD tracking before Tabby's OSC middleware (preserves paths containing '=' and chunk boundaries).
module.exports = function installCwd({apis,Panel, reporter}) {
    const watchers=new WeakMap();
    const debugFile=require('path').join(process.env.APPDATA || '', 'tabby','custom-sftp-plus','path-mode-debug.json');
    let lastDebug='';
    function debug(panel,state,event){
        const data={event,pathMode:panel.pathMode,connected:!!panel.connected,remotePath:panel.remotePath,receivedCwd:state?.cwd||null,bytesReceived:state?.bytes||0,reportCount:state?.reports||0,observerInstalled:!!state?.wrapper,reportedCWD:panel.terminalRef?.session?.reportedCWD||null,lastError:panel._customCwdLastError||null};
        const key=JSON.stringify(data);if(key===lastDebug)return;lastDebug=key;
        try{require('fs').writeFileSync(debugFile,JSON.stringify({time:new Date().toISOString(),...data},null,2));}catch{}
    }
    function watch(panel) {
        if(panel._destroyed || panel._customActivityDisposing || panel._customEditDisposing)return null;
        const session=panel.terminalRef?.session || panel.sshSession;
        if(!session)return null;
        if(panel._customCwdSession===session)return watchers.get(session);
        unwatch(panel);
        const processor=session.oscProcessor;
        let state=watchers.get(session);
        if(!state){
            state={refs:0,cwd:null,bytes:0,reports:0,lastReportAt:0,lastTrafficAt:0,unreportedSince:0,buffer:'',decoder:new (require('string_decoder').StringDecoder)('utf8'),processor};watchers.set(session,state);
            if(processor?.feedFromSession){
                state.original=processor.feedFromSession;
                state.wrapper=function(data){
                    state.bytes+=Buffer.byteLength(data);
                    state.lastTrafficAt=Date.now();
                    // Ignore prompt text / DCS terminators printed immediately after a report.
                    if (!state.unreportedSince && (!state.lastReportAt || state.lastTrafficAt-state.lastReportAt>1000)) state.unreportedSince=state.lastTrafficAt;
                    state.buffer=(state.buffer+state.decoder.write(Buffer.from(data))).slice(-65536);
                    const pattern=/\x1b\]1337;CurrentDir=([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
                    let match,end=0;while((match=pattern.exec(state.buffer))){if(match[1].startsWith('/')){state.cwd=match[1];state.reports++;state.lastReportAt=Date.now();state.unreportedSince=0;}end=pattern.lastIndex;}
                    if(end)state.buffer=state.buffer.slice(end);
                    return state.original.call(this,data);
                };
                processor.feedFromSession=state.wrapper;
            }
        }
        state.refs++;panel._customCwdSession=session;return state;
    }
    function unwatch(panel){const session=panel._customCwdSession;if(!session)return;const state=watchers.get(session);if(state&&!--state.refs){if(state.processor?.feedFromSession===state.wrapper)state.processor.feedFromSession=state.original;watchers.delete(session);}panel._customCwdSession=null;}
    const setupKey=p=>JSON.stringify([p.profile?.options?.host||'',p.profile?.options?.port||22,p.profile?.options?.username||p.profile?.options?.user||'']);
    const setup=p=>p.configService?.store?.['tabby-sftp-plus-plus']?.cwdSetupServers?.[setupKey(p)];
    const rememberSetup=(p,kind)=>{const config=p.configService?.store?.['tabby-sftp-plus-plus'];if(config){(config.cwdSetupServers ||= {})[setupKey(p)]={kind,configuredAt:new Date().toISOString()};p.configService.save();}};
    const modeKey = p => 'sftp-plus-path-mode-v3.' + JSON.stringify([p.profile?.id || '', p.profile?.options?.host || '', p.profile?.options?.port || 22, p.profile?.options?.username || p.profile?.options?.user || '']);
    const savedMode = p => { const config=p.configService?.store?.['tabby-sftp-plus-plus'];try{return config?.pathModes?.[modeKey(p)] || localStorage.getItem(modeKey(p));}catch{return config?.pathModes?.[modeKey(p)];} };
    const loadMode=apis.Panel.loadPathMode;
    apis.Panel.loadPathMode=function(...args){const saved=savedMode(this);if(['off','remember','sync'].includes(saved))this.pathMode=saved;else loadMode?.apply(this,args);};
    apis.Panel.savePathMode=function(){try{localStorage.setItem(modeKey(this),this.pathMode);}catch{}const config=this.configService?.store?.['tabby-sftp-plus-plus'];if(config){(config.pathModes ||= {})[modeKey(this)]=this.pathMode;this.configService.save();}};
    const applyDefault=apis.Panel._applyDefaultPathMode;
    apis.Panel._applyDefaultPathMode=function(...args){if(['off','remember','sync'].includes(savedMode(this)))return;return applyDefault?.apply(this,args);};
    const tryCwd=apis.Panel.tryGetTerminalCwd;
    apis.Panel.tryGetTerminalCwd=async function(){const s=watch(this);debug(this,s,'read-cwd');if(s?.cwd)return s.cwd;return await tryCwd?.call(this)||null;};
    const init=apis.Panel.ngOnInit;
    apis.Panel.ngOnInit=function(...args){watch(this);return init?.apply(this,args);};
    const destroy=apis.Panel.ngOnDestroy;
    apis.Panel.ngOnDestroy=function(...args){unwatch(this);return destroy?.apply(this,args);};
    Object.defineProperty(apis.Panel,'customCwdState',{get(){
        if(!this.connected)return 'offline';
        if(this._customSyncNowBusy||this._customCwdBusy)return 'waiting';
        if(this._customCwdLastError)return 'failed';
        const state=watch(this);
        if(!state?.lastReportAt || (state.unreportedSince && Date.now()-state.unreportedSince>3000))return 'waiting';
        return 'tracking';
    }});
    Object.defineProperty(apis.Panel,'customCwdTooltip',{get(){
        const state=watch(this), kind=this.customCwdState;
        const label=kind==='offline'?'Terminal sync: disconnected':kind==='failed'?'Terminal sync: '+this._customCwdLastError:kind==='waiting'?'Terminal sync: waiting for a CWD report / shell prompt':'Terminal sync: receiving CWD reports';
        const report=state?.lastReportAt?'\nLast report: '+new Date(state.lastReportAt).toLocaleTimeString()+'\n'+state.cwd:'\nNo report received in this terminal session';
        return label+report+'\nMode: '+this.pathMode+'\nSync now activates reporting at an idle prompt in the current Screen window.';
    }});
    // Subscribe before requestExec: fast exec commands may otherwise finish before data listeners exist.
    async function exec(session,command){
        const ssh=session?.ssh;if(!ssh?.openSessionChannel||!ssh.activateChannel)throw new Error('SSH exec channel is unavailable');
        const channel=await ssh.activateChannel(await ssh.openSessionChannel());
        const chunks=[];let subscriptions=[],timer;
        try{
            return await new Promise((resolve,reject)=>{
                let done=false;
                const finish=error=>{if(done)return;done=true;clearTimeout(timer);for(const s of subscriptions)s?.unsubscribe();if(error)reject(error);else resolve(Buffer.concat(chunks).toString('utf8'));};
                subscriptions.push(channel.data$.subscribe({next:data=>chunks.push(Buffer.from(data)),error:finish}));
                subscriptions.push(channel.closed$.subscribe(()=>finish()));
                timer=setTimeout(()=>finish(new Error('CWD setup command timed out')),15000);
                Promise.resolve(channel.requestExec(command)).catch(finish);
            });
        }finally{clearTimeout(timer);for(const s of subscriptions)s?.unsubscribe();try{await channel.close();}catch{}}
    }
    apis.Panel._customCwdExec=exec;
    apis.Panel._enableCwdReporterSession=function(reportOnly=false){
        if(!this.terminalRef?.sendInput)return false;
        watch(this);
        const command=reportOnly?'if command -v __sftp_plus_cwd_report >/dev/null 2>&1; then __sftp_plus_cwd_report; else '+reporter.session+'; fi':reporter.session;
        try{this.terminalRef.sendInput('\x05\x15'+command+'\n');this._customReporterSession=this.terminalRef.session||this.terminalRef;if(!setup(this))rememberSetup(this,'session');return true;}catch(e){this.showToast?.('CWD setup failed: '+e.message);return false;}
    };
    apis.Panel._enableCwdReporterPermanent=async function(){
        if(!this.sshSession)return false;
        try{
            const result=await this._customCwdExec(this.sshSession,reporter.permanent);
            if(!/^SFTP_CWD_SAVED:/m.test(result))throw new Error('The shell did not confirm the saved hook. '+result.trim().slice(-300));
            this._customCwdPermanentTarget=result.match(/^SFTP_CWD_SAVED:(.*)$/m)[1];
            if(!this._enableCwdReporterSession())this.showToast?.('Hook saved; reopen the shell to activate it.');
            rememberSetup(this,'permanent');
            return true;
        }catch(e){this.showToast?.('Permanent CWD setup failed: '+e.message);return false;}
    };
    apis.Panel.customSyncNow=async function(){
        if(this._customSyncNowBusy||!this.connected)return;
        this._customSyncNowBusy=true;
        try{
            this.cwdSetupVisible=false;this._cwdSetupPrompted=true;
            this._customCwdLastError=null;this._safeDetect?.();
            const before=watch(this)?.reports||0;
            if(!this._enableCwdReporterSession(true))return;
            for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,150));if(this._destroyed)return;if((watch(this)?.reports||0)>before){await this._syncRemoteToTerminalCwd(false,true);return;}}
            this._customCwdLastError='No fresh report; use Sync now at an idle shell prompt';
            this.showToast?.('No fresh CWD report received. Use Sync now at an idle shell prompt.');
        }finally{this._customSyncNowBusy=false;this._safeDetect?.();}
    };
    // Only mark a CWD as synced after a successful listing; failed/offline listings must retry.
    apis.Panel._syncRemoteToTerminalCwd=async function(offerSetup=false,force=false){
        if((this.pathMode!=='sync'&&!force)||!this.connected||this._destroyed||this._customCwdBusy)return;
        this._customCwdBusy=true;
        try{
            const cwd=await this.tryGetTerminalCwd();
            const session=this.terminalRef?.session||this.terminalRef;
            if(offerSetup&&!setup(this)&&!this.cwdSetupVisible&&!this._cwdSetupPrompted){this._cwdSetupPrompted=true;this.cwdSetupVisible=true;}
            if(!cwd){this._safeDetect();return;}
            if(!force&&!offerSetup&&cwd===this.remotePath&&cwd===this._lastSyncedCwd){this._customCwdLastError=null;return;}
            const before=this.remotePath;
            this.remotePath=this.remotePathInput=cwd;
            const ok=await this.refreshRemote();
            if(ok){this._lastSyncedCwd=cwd;if(offerSetup||before!==cwd)this._pushRemoteNav?.(cwd);}
            else this._lastSyncedCwd='';
            this._customCwdLastError=ok?null:'Remote listing failed';debug(this,watch(this),ok?'sync-success':'sync-failed');
            this._safeDetect();
        }finally{this._customCwdBusy=false;}
    };
};
