const cp=require('child_process'),path=require('path'),cfg=require('../tests/test-policy.json'),root=path.resolve(__dirname,'..');
const env={...process.env,SFTP_TEST_RUSSH_ROOT:process.env.SFTP_TEST_RUSSH_ROOT||path.join(process.env.LOCALAPPDATA,cfg.nativeRootRelative),SFTP_TEST_TABBY_CORE_MAP:process.env.SFTP_TEST_TABBY_CORE_MAP||path.join(process.env.LOCALAPPDATA,cfg.nativeCoreMapRelative)};
const result=cp.spawnSync(process.execPath,[path.join(root,'test-native-sftp.cjs')],{cwd:root,env,stdio:'inherit'});process.exitCode=result.status;
