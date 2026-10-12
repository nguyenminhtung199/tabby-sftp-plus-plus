// One retained component per terminal. Collapsing changes visibility, never connection ownership.
module.exports = function installSidebar({ Panel, Settings, Decorator }) {
    const mounts = new WeakMap();
    const cfg = owner => owner.config?.store?.['tabby-sftp-plus'] || owner.configService?.store?.['tabby-sftp-plus'] || {};
    const key = terminal => JSON.stringify([terminal.profile?.id || '', terminal.profile?.options?.host || '', terminal.profile?.options?.port || 22, terminal.profile?.options?.user || terminal.profile?.options?.username || '']);
    const save = (d, m) => {
        const config = cfg(d);
        (config.sidebarSessions ||= {})[key(m.terminal)] = { width:m.width, pinned:m.pinned, side:m.side, mode:m.mode };
        try { d.config?.save(); } catch {}
    };
    function ensureStyle() {
        if (document.getElementById('sftp-plus-sidebar-style')) return;
        const style = document.createElement('style'); style.id = 'sftp-plus-sidebar-style';
        style.textContent = `
.sftp-plus-sidebar { position:absolute; z-index:40; display:flex; flex-direction:column; box-sizing:border-box; background:var(--theme-bg,#1d1f21); color:var(--theme-fg,#eee); overflow:hidden; transition:width .15s ease; }
.sftp-plus-sidebar.expanded { box-shadow:0 3px 14px #0005; }
.sftp-plus-sidebar .custom-sp-strip { position:absolute; inset:0; width:24px; writing-mode:vertical-rl; display:flex; align-items:center; justify-content:center; cursor:pointer; user-select:none; font-size:12px; letter-spacing:3px; font-weight:bold; opacity:.6; }
.sftp-plus-sidebar .custom-sp-panel { position:absolute; top:0; bottom:0; min-height:0; display:block; }
.sftp-plus-sidebar .custom-sp-panel .sftp-root.workspace-mode { width:100%; height:100%; }
.sftp-plus-sidebar .custom-sp-panel .sftp-root.workspace-mode .sftp-main { width:100%; height:100%; border-radius:0; }
.sftp-plus-sidebar .custom-sp-drag { position:absolute; top:0; bottom:0; width:5px; cursor:col-resize; z-index:45; }
.sftp-plus-sidebar .custom-sp-drag:hover { background:#8886; }
.sftp-plus-sidebar .custom-sp-strip:hover { opacity:1; }
.sftp-plus-sidebar .custom-sp-panel .sftp-main { border:0; box-shadow:none; }
.sftp-plus-sidebar .sftp-root .title { color:var(--_text); }
.sftp-plus-sidebar .sftp-root .top-bar { background:var(--_bg); }
@media (prefers-reduced-motion:reduce) { .sftp-plus-sidebar { transition:none; } }
`;
        document.head.appendChild(style);
    }
    const originalClose = Panel.prototype.close;
    Panel.prototype.close = function (...args) {
        if (this._customSidebarMount) { this.saveCurrentPath(); this._customSidebarMount.collapse(true); return; }
        return originalClose.apply(this,args);
    };
    const originalMinimize = Panel.prototype.minimize;
    Panel.prototype.minimize = function (...args) {
        if (this._customSidebarMount) { this.saveCurrentPath(); this._customSidebarMount.collapse(true); return; }
        return originalMinimize.apply(this,args);
    };
    const originalInit = Panel.prototype.ngOnInit;
    Panel.prototype.ngOnInit = function (...args) {
        const result = originalInit.apply(this,args);
        if (this._customSidebarMount?.mode === 'sidebar') { this._layoutMode='single'; this.activePane='remote'; this._effectiveLayout='single'; this._scheduleLayoutRefresh?.(); }
        return result;
    };
    Object.defineProperty(Settings.prototype,'customSidebarEnabled',{get(){return cfg(this).sidebarEnabled !== false;},configurable:true});
    Settings.prototype.toggleCustomSidebar = function () { const c=cfg(this); c.sidebarEnabled=!this.customSidebarEnabled; this.configService?.save(); this.notifyPanels(); };
    Object.defineProperty(Settings.prototype,'customSidebarSide',{get(){return cfg(this).sidebarSide==='right'?'right':'left';},configurable:true});
    Settings.prototype.setCustomSidebarSide=function(side){cfg(this).sidebarSide=side==='right'?'right':'left';this.configService?.save();this.notifyPanels();};
    Object.defineProperty(Panel.prototype,'customSidebarPinned',{get(){return !!this._customSidebarMount?.pinned;},configurable:true});
    Object.defineProperty(Panel.prototype,'customSidebarMode',{get(){return !this._customSidebarMount?.full;},configurable:true});
    Panel.prototype.toggleCustomSidebarPin=function(){this._customSidebarMount?.togglePin();};
    Panel.prototype.toggleCustomSidebarMode=function(){this._customSidebarMount?.toggleMode();};
    Object.defineProperty(Panel.prototype,'customSidebarFull',{get(){return !!this._customSidebarMount?.full;},configurable:true});
    Panel.prototype.toggleCustomSidebarFull=function(){const m=this._customSidebarMount;if(!m)return;m.full=!m.full;this._layoutMode=m.full?'auto':m.mode==='sidebar'?'single':'auto';m.layout();this._safeDetect?.();};
    const autoTheme=Panel.prototype._applyAutoTheme;
    Panel.prototype._applyAutoTheme=function(...args){const result=autoTheme?.apply(this,args);const mount=this._customSidebarMount;if(mount){
        const style=this.elRef?.nativeElement?.style;
        const terminalStyle=getComputedStyle(mount.pane);
        const background=terminalStyle.getPropertyValue?.('--theme-bg')?.trim() || '#1d1f21';
        const foreground=terminalStyle.getPropertyValue?.('--theme-fg')?.trim() || '#eee';
        if(style)for(const [name,value] of Object.entries({'--_bg':background,'--_content':background,'--_text':foreground,'--_border':'rgba(127,127,127,.2)','--_primary':foreground,'--_input-bg':'rgba(127,127,127,.1)'}))style.setProperty(name,value);
    }return result;};
    const originalAttach = Decorator.prototype.attach;
    const originalDetach = Decorator.prototype.detach;
    const originalToggle = Decorator.prototype.togglePanelForActiveTerminal;
    Decorator.prototype._customMountSidebar = function (terminal) {
        const prior=mounts.get(terminal); if(prior) return prior;
        if(!this._isSshTerminal(terminal)) return null;
        const pane=terminal.element?.nativeElement;
        const frontend=terminal.frontend?.element?.nativeElement || terminal.frontend?.element;
        if(!pane || !frontend?.style || !pane.contains(frontend)) return null;
        ensureStyle();
        const stored=cfg(this).sidebarSessions?.[key(terminal)] || {};
        const side=cfg(this).sidebarSide==='right'?'right':'left';
        const host=document.createElement('div'); host.className='sftp-plus-sidebar'; host.tabIndex=-1;
        const strip=document.createElement('div'); strip.className='custom-sp-strip'; strip.textContent='SFTP+'; strip.title='SFTP+ — hover or click to open'; strip.setAttribute('role','button'); strip.tabIndex=0;
        const panelHost=document.createElement('div'); panelHost.className='custom-sp-panel';
        const drag=document.createElement('div'); drag.className='custom-sp-drag';
        host.appendChild(strip);host.appendChild(panelHost);host.appendChild(drag);
        const old={position:pane.style.position, marginLeft:frontend.style.marginLeft, marginRight:frontend.style.marginRight, width:frontend.style.width, boxSizing:frontend.style.boxSizing, paddingLeft:frontend.style.paddingLeft, paddingRight:frontend.style.paddingRight};
        if(getComputedStyle(pane).position==='static') pane.style.position='relative';
        pane.appendChild(host);
        const m={terminal,pane,frontend,host,strip,panelHost,drag,old,width:Math.max(280,Math.min(900,Number(stored.width)||420)),pinned:!!stored.pinned,side,mode:'sidebar',expanded:false,subs:[],listeners:[],d:this};
        mounts.set(terminal,m);
        const listen=(el,type,fn,options)=>{el.addEventListener(type,fn,options);m.listeners.push(()=>el.removeEventListener(type,fn,options));};
        const resizeTerminal=()=>{try{terminal.frontend?.resizeHandler?.();}catch{} window.dispatchEvent(new Event('resize'));};
        m.layout=()=>{
            if(m.disposed) return;
            const rect=pane.getBoundingClientRect();
            const width=Math.min(m.width,Math.max(180,rect.width-80));
            const top=0;
            const shown=m.expanded;
            host.classList.toggle('expanded',shown);
            Object.assign(host.style,{top:top+'px',bottom:'0',left:m.side==='left'?'0':'auto',right:m.side==='right'?'0':'auto',width:(shown?width:24)+'px',height:'auto'});
            strip.style.display=shown?'none':'flex';
            panelHost.style.width=(m.full?rect.width:m.mode==='sidebar'?width:rect.width*.96)+'px';
            panelHost.style.left=m.side==='left'?'0':'auto';panelHost.style.right=m.side==='right'?'0':'auto';
            panelHost.style.pointerEvents=shown?'auto':'none';
            clearTimeout(m.hideTimer);
            if(shown){panelHost.style.visibility='visible';panelHost.removeAttribute?.('inert');}
            else {panelHost.setAttribute('inert','');m.hideTimer=setTimeout(()=>{if(!m.expanded&&!m.disposed)panelHost.style.visibility='hidden';},150);}
            host.style.transition=m.resizing||m.mode==='floating'?'none':'width .15s ease';
            drag.style.display=shown&&!m.full&&m.mode==='sidebar'?'block':'none';drag.style.left=m.side==='right'?'0':'auto';drag.style.right=m.side==='left'?'0':'auto';
            const reserve=(m.mode==='sidebar' && !m.full ? (m.pinned&&shown?width:24):24)+8;
            frontend.style.paddingLeft='8px';frontend.style.paddingRight='8px';frontend.style.boxSizing='border-box';frontend.style.width=`calc(100% - ${reserve}px)`;
            frontend.style.marginLeft=m.side==='left'?reserve+'px':old.marginLeft;frontend.style.marginRight=m.side==='right'?reserve+'px':old.marginRight;
            if(m.mode==='floating'&&shown) Object.assign(host.style,{left:'2%',right:'2%',top:(top+8)+'px',bottom:'8px',width:'96%'});
            if(m.full&&shown)Object.assign(host.style,{left:'0',right:'0',top:'0',bottom:'0',width:'100%'});
            // Tabby's online indicator lives in a separate absolute toolbar, outside the frontend.
            const toolbar=pane.querySelector('terminal-toolbar') || pane.querySelector('.terminal-toolbar');
            if(toolbar&&toolbar!==m.toolbar){if(m.toolbar)Object.assign(m.toolbar.style,m.toolbarOld);m.toolbar=toolbar;m.toolbarOld={left:toolbar.style.left,right:toolbar.style.right,width:toolbar.style.width,boxSizing:toolbar.style.boxSizing};}
            if(m.toolbar){Object.assign(m.toolbar.style,{left:m.side==='left'?reserve+'px':m.toolbarOld.left,right:m.side==='right'?reserve+'px':m.toolbarOld.right,width:'calc(100% - '+reserve+'px)',boxSizing:'border-box'});}
            if(m.cmp) { m.cmp.minimized=!shown; m.cmp._scheduleLayoutRefresh?.(); }
            const anchor=this._resolveHostEl(terminal);if(anchor){anchor.__sftpPlusMinimized=!shown;this._syncToolbarBtnState(anchor);}
        };
        m.connect=()=>{
            const ssh=terminal.sshSession || terminal._sshSession || terminal.session || terminal._session;
            if(!ssh || ssh.open===false) return false;
            if(m.ref) {
                if(m.cmp.sshSession!==ssh) { m.cmp.disconnect();m.cmp.sshSession=ssh;void m.cmp.connect(); }
                else if(!m.cmp.connected&&!m.cmp.connecting) void m.cmp.connect();
                return true;
            }
            const factory=this.resolver.resolveComponentFactory(Panel);
            const ref=factory.create(this.injector,[],panelHost);m.ref=ref;m.cmp=ref.instance;
            Object.assign(m.cmp,{sshSession:ssh,terminalRef:terminal,profile:terminal.profile || terminal._profile,displayMode:'workspace',_customSidebarMount:m,onClose:()=>m.collapse(true),onMinimize:()=>m.collapse(true)});
            this.appRef.attachView(ref.hostView);ref.changeDetectorRef.detectChanges();
            if(m.mode==='sidebar'){m.cmp._layoutMode='single';m.cmp.activePane='remote';m.cmp._effectiveLayout='single';m.cmp._scheduleLayoutRefresh?.();}
            const anchor=this._resolveHostEl(terminal); if(anchor){anchor.__sftpPlusOpen=true;anchor.__sftpPlusCmpRef=ref;}
            return true;
        };
        m.expand=()=>{clearTimeout(m.collapseTimer);m.dismissed=false;this.zone.run(()=>{try{if(!m.connect()){this.notifications.error('SFTP+','Connect the SSH terminal first.');return;}m.expanded=true;m.layout();m.ref?.changeDetectorRef.detectChanges();resizeTerminal();}catch(e){this.notifications.error('SFTP+','Cannot open sidebar: '+e.message);}});};
        m.collapse=force=>{clearTimeout(m.collapseTimer);if(m.pinned&&!force)return;m.expanded=false;if(m.full){m.full=false;if(m.cmp)m.cmp._layoutMode=m.mode==='sidebar'?'single':'auto';}m.dismissed=!!force;m.cmp?.saveCurrentPath();m.layout();resizeTerminal();};
        m.togglePin=()=>{
            const trace=(stage)=>m.cmp?._customTraceTransfer?.('sidebar:pin:'+stage,{pinned:m.pinned,expanded:m.expanded});
            trace('start');
            try {
                m.pinned=!m.pinned;if(m.pinned&&!m.expanded)m.expand();
                trace('config:start');save(this,m);trace('config:return');
                trace('layout:start');m.layout();trace('layout:end');
                trace('detect:start');m.cmp?._safeDetect?.();trace('detect:end');
                trace('resize:start');resizeTerminal();trace('resize:end');
                if(!m.pinned&&!m.hovering)m.scheduleCollapse();trace('end');
            } catch(error) { trace('error');throw error; }
        };
        m.toggleMode=()=>{m.full=!m.full;m.mode='sidebar';m.expanded=true;if(m.cmp){m.cmp._layoutMode=m.full?'auto':'single';m.cmp.activePane='remote';m.cmp._scheduleLayoutRefresh?.();}m.layout();m.cmp?._safeDetect?.();resizeTerminal();};
        m.scheduleCollapse=()=>{clearTimeout(m.collapseTimer);m.collapseTimer=setTimeout(()=>{
            if(m.disposed||m.full||m.pinned||m.hovering||m.mode!=='sidebar')return;
            const active=document.activeElement;
            const typing=host.contains(active)&&(['INPUT','TEXTAREA'].includes(active?.tagName)||active?.isContentEditable);
            const dialog=m.cmp&&Object.keys(m.cmp).some(k=>/Visible$/.test(k)&&m.cmp[k]===true);
            const unfocused=document.hasFocus&&!document.hasFocus();
            if(m.resizing||m.menuOpen||typing||dialog||unfocused||document.querySelector('ngb-modal-window')||document.querySelector('.sftp-custom-folder-dropdown')){m.scheduleCollapse();return;}
            m.collapse(false);
        },300);};
        listen(host,'mousedown',e=>e.stopPropagation());listen(host,'click',e=>e.stopPropagation());
        listen(strip,'click',()=>m.expand());listen(strip,'keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();m.expand();}});
        listen(host,'mouseenter',()=>{m.hovering=true;clearTimeout(m.collapseTimer);if(!m.expanded){m.full=false;m.mode='sidebar';m.expand();}});
        listen(host,'mouseleave',()=>{m.hovering=false;m.dismissed=false;if(!m.pinned&&m.mode==='sidebar')m.scheduleCollapse();});
        listen(host,'contextmenu',()=>{m.menuOpen=true;const release=()=>{m.menuOpen=false;window.removeEventListener('mousemove',release,true);window.removeEventListener('keydown',release,true);};window.addEventListener('mousemove',release,true);window.addEventListener('keydown',release,true);m.listeners.push(()=>{window.removeEventListener('mousemove',release,true);window.removeEventListener('keydown',release,true);});},true);
        listen(drag,'mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();m.resizing=true;clearTimeout(m.collapseTimer);const start=e.clientX,initial=m.width;const move=ev=>{m.width=Math.max(280,Math.min(900,initial+(m.side==='left'?1:-1)*(ev.clientX-start)));m.layout();};const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);m.resizing=false;save(this,m);m.layout();resizeTerminal();if(!m.hovering)m.scheduleCollapse();};window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);m.dragCleanup=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};});
        m.observer=new ResizeObserver(()=>m.layout());m.observer.observe(pane);
        listen(window,'sftp-plus-settings-changed',()=>{const enabled=cfg(this).sidebarEnabled!==false;m.mode='sidebar';m.full=false;m.side=cfg(this).sidebarSide==='right'?'right':'left';if(m.cmp){m.cmp._layoutMode=enabled?'single':'auto';m.cmp._scheduleLayoutRefresh?.();}m.layout();});
        const sessionSub=terminal.sessionChanged$?.subscribe?.(session=>{if(m.disposed)return;if(session && session.open!==false){if(m.expanded || m.pinned)this.zone.run(()=>m.expand());}else if(m.cmp){m.cmp.disconnect();}});
        if(sessionSub)m.subs.push(sessionSub);
        m.layout(); if(m.pinned && (terminal.sshSession||terminal._sshSession||terminal.session)?.open!==false && (terminal.sshSession||terminal._sshSession||terminal.session))m.expand();
        return m;
    };
    Decorator.prototype.attach = function (terminal,...args) {
        const result=originalAttach.call(this,terminal,...args);
        const ready=terminal.frontendReady$?.subscribe?.(()=>{if(!terminal.__customSftpDetached)this.zone.run(()=>this._customMountSidebar(terminal));});
        if(ready)this.subscribeUntilDetached(terminal,ready);
        const delays=[0,300,1000,2500];const timers=delays.map(ms=>setTimeout(()=>{if(terminal.__customSftpDetached)return;this.zone.run(()=>this._customMountSidebar(terminal));},ms));
        terminal.__customSftpDetached=false;
        this.subscribeUntilDetached(terminal,{unsubscribe:()=>timers.forEach(clearTimeout)});
        return result;
    };
    Decorator.prototype.togglePanelForActiveTerminal = function (terminal) {
        terminal ||= this._getActiveSshTerminal();
        if(!terminal)return originalToggle.call(this,terminal);
        const m=this._customMountSidebar(terminal);
        if(!m)return originalToggle.call(this,terminal);
        if(m.expanded)m.collapse(true);else{m.expand();m.panelHost.focus?.();}
    };
    Decorator.prototype.detach = function (terminal,...args) {
        terminal.__customSftpDetached=true;
        const m=mounts.get(terminal);
        if(m){m.disposed=true;clearTimeout(m.collapseTimer);clearTimeout(m.hideTimer);m.observer?.disconnect();m.subs.forEach(s=>s?.unsubscribe());m.dragCleanup?.();m.listeners.forEach(fn=>fn());try{if(m.ref){this.appRef.detachView(m.ref.hostView);m.ref.destroy();}}catch{}m.host.remove();if(m.toolbar)Object.assign(m.toolbar.style,m.toolbarOld);Object.assign(m.frontend.style,{marginLeft:m.old.marginLeft,marginRight:m.old.marginRight,width:m.old.width,boxSizing:m.old.boxSizing,paddingLeft:m.old.paddingLeft,paddingRight:m.old.paddingRight});m.pane.style.position=m.old.position;const a=this._resolveHostEl(terminal);if(a){delete a.__sftpPlusCmpRef;delete a.__sftpPlusOpen;delete a.__sftpPlusMinimized;}mounts.delete(terminal);try{terminal.frontend?.resizeHandler?.();}catch{}}
        return originalDetach.call(this,terminal,...args);
    };
};
