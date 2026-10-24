'use strict';
const fs=require('fs/promises'),path=require('path'),{execFile}=require('child_process');
const policy=require('../../transfer-policy.json').pluginUpdate;

function panelHasWork(panel){
    if(panel._destroyed)return false;
    if(panel._internalMoveBusy||panel._customSyncNowBusy||panel._conflictQueue?.length||panel._customInlineEdit||panel._inputBusy||panel._customImagePasteTask||panel._customDropActions?.size||panel._customActiveDrops)return true;
    if(panel._upQueue?.length||panel._dlQueue?.length||panel._upActiveCount||panel._dlActiveCount||panel._activeUploadTargets?.size||panel._activeDownloadTargets?.size)return true;
    if([...panel._customExternalSessions?.values?.()||[]].some(s=>s.busy||s.opening))return true;
    return (panel.transfers||[]).some(row=>{
        if(row.queued||row.paused)return true;
        const transfer=row.transfer;
        return transfer?!transfer.isComplete?.()&&!transfer.isCancelled?.()&&!transfer.isFailed?.():row.isFolder&&row.percent<100;
    });
}

/** Git installations only: all writes stay inside this plugin's checkout. */
class PluginUpdater{
    constructor(root,options={}){
        this.root=path.resolve(root);this.policy={...policy,...options};this.listeners=new Map();
        this.state=Object.freeze({available:false,checking:false,updating:false,restartRequired:false,version:'',error:''});
    }
    publish(patch){this.state=Object.freeze({...this.state,...patch});for(const fn of this.listeners.keys())try{fn(this.state);}catch{};}
    subscribe(listener,hasWork=()=>false){
        this.listeners.set(listener,hasWork);listener(this.state);
        if(this.listeners.size===1){
            this.initial=setTimeout(()=>void this.check(),this.policy.initialDelayMs);this.initial.unref?.();
            this.timer=setInterval(()=>void this.check(),this.policy.intervalMs);this.timer.unref?.();
        }
        return ()=>{this.listeners.delete(listener);if(!this.listeners.size){clearTimeout(this.initial);clearInterval(this.timer);}};
    }
    hasWork(){return [...this.listeners.values()].some(check=>{try{return check();}catch{return true;}});}
    git(args){
        return new Promise((resolve,reject)=>execFile('git',args,{cwd:this.root,windowsHide:true,timeout:this.policy.timeoutMs,maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}},(error,stdout,stderr)=>{
            if(error){const failure=new Error('Plugin update: '+(stderr.trim()||error.message).slice(0,600));failure.code=error.code;reject(failure);}else resolve(stdout.trim());
        }));
    }
    async validateCheckout(){
        if(!(await fs.stat(path.join(this.root,'.git')).catch(()=>null))?.isDirectory())throw Error('Automatic update requires the plugin Git installation.');
        const top=await this.git(['rev-parse','--show-toplevel']);
        if(await fs.realpath(top)!==await fs.realpath(this.root))throw Error('Plugin Git root does not match its installation folder.');
        if(await this.git(['remote','get-url','origin'])!==this.policy.remote)throw Error('Plugin origin does not match its update repository.');
        if(await this.git(['symbolic-ref','--quiet','--short','HEAD'])!==this.policy.branch)throw Error('Switch the plugin checkout to '+this.policy.branch+' before updating.');
    }
    async manifest(commit){
        const pkg=JSON.parse(await this.git(['show',commit+':package.json']));
        if(pkg.name!=='tabby-sftp-plus-plus'||typeof pkg.version!=='string')throw Error('Invalid plugin update package.');
        const build=JSON.parse(await this.git(['show',commit+':dist/build-info.json']));
        if(!build.sourceBuild)throw Error('The plugin update has no verified source build.');
        await this.git(['cat-file','-e',commit+':dist/index.js']);
        return pkg;
    }
    async canFastForward(local,target){
        try{await this.git(['merge-base','--is-ancestor',local,target]);return true;}catch(error){if(error.code===1)return false;throw error;}
    }
    async hasRuntimeChanges(local,target){
        try{await this.git(['diff','--quiet',local,target,'--','dist','package.json']);return false;}
        catch(error){if(error.code===1)return true;throw error;}
    }
    async check(){
        if(this.state.checking||this.state.updating||this.state.restartRequired)return;
        this.publish({checking:true,error:''});
        try{
            await this.validateCheckout();
            await this.git(['fetch','--no-tags','--quiet','origin','refs/heads/'+this.policy.branch+':refs/remotes/origin/'+this.policy.branch]);
            const local=await this.git(['rev-parse','HEAD']),target=await this.git(['rev-parse','refs/remotes/origin/'+this.policy.branch]);
            if(local===target){this.target=null;this.publish({available:false,version:''});return;}
            if(!await this.canFastForward(local,target))throw Error('Plugin has local commits; automatic update cannot fast-forward.');
            if(!await this.hasRuntimeChanges(local,target)){this.target=null;this.publish({available:false,version:''});return;}
            const pkg=await this.manifest(target);this.target=target;this.publish({available:true,version:pkg.version});
        }catch(error){this.publish({error:error.message});}
        finally{this.publish({checking:false});}
    }
    async update(relaunch){
        if(this.state.checking||this.state.updating)return false;
        if(typeof relaunch!=='function'){this.publish({error:'Tabby restart API is unavailable.'});return false;}
        if(this.hasWork()){this.publish({error:'Finish file transfers and pending file operations before updating or restarting.'});return false;}
        this.publish({updating:true,error:''});
        try{
            if(!this.state.restartRequired){
                if(!this.target||!this.state.available)return false;
                await this.validateCheckout();
                if(await this.git(['status','--porcelain','--untracked-files=no']))throw Error('Plugin has local changes. Commit or remove those changes before updating.');
                const target=this.target,local=await this.git(['rev-parse','HEAD']);
                if(!await this.canFastForward(local,target))throw Error('Plugin history changed; check for updates again.');
                const before=await this.manifest(local),after=await this.manifest(target);
                if(JSON.stringify(before.dependencies||{})!==JSON.stringify(after.dependencies||{}))throw Error('This update changes plugin dependencies and requires manual installation.');
                await this.git(['merge','--ff-only','--no-edit',target]);
                if(await this.git(['rev-parse','HEAD'])!==target)throw Error('Could not verify the installed plugin update.');
                this.publish({available:false,restartRequired:true,version:after.version});
            }
            if(this.hasWork())throw Error('Plugin updated. Finish file operations, then click Restart Tabby.');
            await relaunch();return true;
        }catch(error){this.publish({error:error.message});return false;}
        finally{this.publish({updating:false});}
    }
}
let shared;
module.exports={PluginUpdater,panelHasWork,getPluginUpdater:root=>shared||=(new PluginUpdater(root))};
