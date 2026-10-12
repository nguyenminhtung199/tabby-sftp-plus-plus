const fs=require('fs'),path=require('path'),vm=require('vm');
const original=fs.readFileSync(path.join(__dirname,'index.original.js'),'utf8');
const once=(source,old,replacement)=>{if(source.split(old).length!==2)throw new Error('Build anchor mismatch: '+old.slice(0,70));return source.replace(old,replacement);};
const runtime=name=>fs.readFileSync(path.join(__dirname,name),'utf8').replace(/^\uFEFF/,'').trim().replace(/^module\.exports = /,'').replace(/;$/,'');
let patched=once(original,'const r=new O(s);try{await this.sftpSession.upload(n,r)}',"const r=new O(s);try{await this.sftpSession.upload(n,r);await this._customSetCreatedFilePermissions(n)}");
patched=once(patched,'openOnClick:"double",openUnsupportedInSystem:','openOnClick:"double",fileOpenAction:"external-edit",openUnsupportedInSystem:');
const next='          <div class="ss-toggle-row ss-pathmode-row">\\n            <span class="ss-toggle-label">{{ i18n.t(\\\'settings.defaultPathMode\\\') }}</span>';
const template=`          <label class="ss-toggle-row" title="Download the complete file, open it in your local app, and upload on save. Progress appears in Transfer history.">
            <span class="ss-toggle-label">Open files in default app + auto sync</span>
            <span class="ss-toggle-track" [class.active]="externalEditOnOpen" (click)="toggleExternalEditOnOpen()"><span class="ss-toggle-thumb"></span></span>
          </label>
`;
patched=once(patched,next,template.replace(/\n/g,'\\n').replace(/'/g,"\\'")+next);
patched=once(patched,'const so=to;',`const customSftpRecovery=(${runtime('recovery-store.cjs')})();const customSftpResume=(${runtime('resume-transfer.cjs')})({Panel:Xi,root:customSftpRecovery.root,server:customSftpRecovery.server});/* LOCAL_TRANSFER_ENGINE_V1 */(${runtime('transfer-engine.cjs')})({Panel:Xi,resume:customSftpResume});/* LOCAL_EXTERNAL_EDIT_V1 */(${runtime('external-edit.cjs')})({Panel:Xi,Settings:Wt,download:I,shell:t(288).shell,recovery:customSftpRecovery});const so=to;`);
patched=require('./patch-navigation.cjs')(patched);
patched=require('./cleanup-config.cjs')(patched);
patched=require('./patch-recent.cjs')(patched);
patched=once(patched,'const so=to;',`/* CLIPBOARD_UPLOAD_V1 */(${runtime('clipboard-upload.cjs')})({Panel:Xi,electron:t(288)});const so=to;`);
patched=require('./patch-transfer-ui.cjs')(patched);
patched=require('./patch-context-menu.cjs')(patched);
patched=once(patched,'const so=to;',`/* CLIPBOARD_SAFETY_V1 */(${runtime('clipboard-safety.cjs')})({Panel:Xi});const so=to;`);
patched=once(patched,'const so=to;',"/* DROP_DIAGNOSTICS_V1 */require('./drop-diagnostics.cjs')({Panel:Xi,root:customSftpRecovery.root});/* TEMP_TABBY_DIAGNOSTICS_V1 */require('./tabby-diagnostics-loader.cjs')({root:customSftpRecovery.root});const so=to;");
patched=patched.replaceAll('tabby-sftp-plus','tabby-sftp-plus-plus').replaceAll('sftp-plus-toggle-panel','sftp-plus-plus-toggle-panel').replaceAll('SFTP+','SFTP++');
new vm.Script(patched,{filename:'SFTP++/dist/index.js'});
const dist=path.join(__dirname,'dist');fs.mkdirSync(dist,{recursive:true});
fs.cpSync(path.join(__dirname,'assets'),path.join(dist,'assets'),{recursive:true});
for(const file of ['file-permissions.cjs','transfer-policy.json','remote-metadata.cjs','drop-diagnostics.cjs','tabby-main-diagnostics.cjs','tabby-diagnostics-loader.cjs'])fs.copyFileSync(path.join(__dirname,file),path.join(dist,file));
fs.writeFileSync(path.join(dist,'index.js'),patched);
console.log('Built independent tabby-sftp-plus-plus 1.0.0 (SFTP++).');
