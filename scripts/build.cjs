const fs=require('fs'),path=require('path'),cp=require('child_process'),webpack=require('webpack'),policy=require('../build.config.json');
const root=path.resolve(__dirname,'..'),config=require('../webpack.config.cjs'),staging=path.join(root,policy.stagingDirectory),dist=path.join(root,policy.outputDirectory);config.output.path=staging;
webpack(config,(error,stats)=>{
 if(error||stats.hasErrors()){console.error(error||stats.toString('errors-only'));process.exitCode=1;return;}
 fs.copyFileSync(path.join(root,policy.policyFile),path.join(staging,'transfer-policy.json'));
 for(const file of policy.runtimeFiles)fs.copyFileSync(path.join(root,file.source),path.join(staging,file.name));
 const env={...process.env,SFTP_TEST_BUNDLE_PATH:path.join(staging,'index.js'),SFTP_TEST_TABBY_CORE_MAP:path.join(root,require('../tests/test-policy.json').sdkMapRelative)};
 for(const test of policy.verificationScripts){const result=cp.spawnSync(process.execPath,[path.join(root,test)],{cwd:root,env,encoding:'utf8'});if(result.status!==0){console.error(result.stdout,result.stderr);process.exitCode=1;return;}}
 fs.mkdirSync(dist,{recursive:true});
 for(const name of ['index.js','index.js.map','transfer-policy.json',...policy.runtimeFiles.map(f=>f.name)])fs.copyFileSync(path.join(staging,name),path.join(dist,name));
 fs.cpSync(path.join(root,policy.assetsDirectory),path.join(dist,'assets'),{recursive:true});
 const commit=cp.execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 fs.writeFileSync(path.join(dist,'build-info.json'),JSON.stringify({commit,builtAt:new Date().toISOString(),sourceBuild:true,angular:require('@angular/core/package.json').version,tabbySdk:require('tabby-core/package.json').version},null,2)+'\n','utf8');
 console.log('Built and verified SFTP++ from named source ('+commit+').');
});
