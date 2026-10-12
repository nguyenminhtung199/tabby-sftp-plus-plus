const fs=require('fs'),path=require('path'),policy=require('./transfer-policy.json');
const root=path.join(__dirname,'recovery'),mode=process.argv[2];if(!['on','off'].includes(mode))throw Error('Use on or off');
if(mode==='on')fs.mkdirSync(root,{recursive:true});
for(const cfg of [policy.dropDiagnostics,policy.tabbyDiagnostics]){const marker=path.join(root,cfg.enabledMarker);if(mode==='on')fs.writeFileSync(marker,'Temporary diagnostics enabled; see DIAGNOSTICS-CLEANUP.md.\n','utf8');else if(fs.existsSync(marker))fs.unlinkSync(marker);}
console.log('Diagnostics '+mode+'. Restart Tabby to apply the complete change. Existing logs are retained.');
