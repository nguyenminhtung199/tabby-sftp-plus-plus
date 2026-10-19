const assert=require('assert/strict'),fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const cfg=require('./tests/test-policy.json').terminalNative,send=require('./src/runtime/terminal-command.cjs');
const pty=require(path.join(process.env.LOCALAPPDATA,cfg.ptyRelative));
(async()=>{let child,transcript='',waiters=[];
 const dir=await fs.mkdtemp(path.join(__dirname,cfg.scratchRelative)+'-');const dump=path.join(dir,cfg.dumpFile),seed=path.join(dir,cfg.seedFile);
 const wait=(pattern,offset)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters=waiters.filter(w=>w!==check);reject(Error('PTY timeout '+pattern+' '+JSON.stringify(transcript.slice(-1000))));},cfg.timeoutMs);const check=()=>{const match=transcript.slice(offset).match(pattern);if(match){clearTimeout(timer);waiters=waiters.filter(w=>w!==check);resolve(match);}};waiters.push(check);check();});
 try{
  child=pty.spawn(path.join(process.env.ProgramFiles,cfg.bashRelative),cfg.args,{name:cfg.terminal,cols:cfg.columns,rows:cfg.rows,cwd:dir,env:{...process.env,PS1:cfg.prompt,INPUTRC:cfg.inputrc,HISTFILE:cfg.historyFile,TERM:cfg.terminal,SFTP_TEST_SEED:seed.replace(/\\/g,'/'),SFTP_TEST_DUMP:dump.replace(/\\/g,'/')},useConpty:true});
  child.onData(data=>{transcript+=data;for(const fn of [...waiters])fn();});
  await wait(/SFTP_COMMAND_TEST>/,0);
  child.write(String.raw`set -o emacs; __sftp_load() { READLINE_LINE=$(cat "$SFTP_TEST_SEED"); READLINE_POINT=$(printf '%s' "$READLINE_LINE" | wc -m); }; bind -x '"\C-x\C-l":__sftp_load'; __sftp_dump() { printf '%s\0%s' "$READLINE_LINE" "$PWD" > "$SFTP_TEST_DUMP"; printf '\033]777;DUMPED\007'; }; bind -x '"\C-x\C-b":__sftp_dump'; printf '\033]777;READY\007'`+'\r');
  await wait(/\x1b\]777;READY\x07/,0);
  const terminal={alternateScreenActive:true,frontend:{isAlternateScreenActive:()=>true},sendInput:text=>child.write(text)};
  const drafts=['',"echo unfinished 'quote",'printf tiếng-Việt 日本語', 'echo '+ 'long'.repeat(65), 'echo one\necho two'];
  for(const [index,draft] of drafts.entries()){
   let offset=transcript.length;child.write('\x03');await wait(/SFTP_COMMAND_TEST>/,offset);
   if(index===0)child.write('previously deleted\x05\x15');
   await fs.writeFile(seed,draft,'utf8');child.write('\x18\x0c');if(index===2)child.write('\x02\x02\x02');
   const before=transcript.length;child.write('\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,before);assert.equal((await fs.readFile(dump,'utf8')).split('\0')[0],draft,'fixture initial draft');
   const id=crypto.randomUUID();send(terminal,"cd -- /tmp; printf '\\033]777;DONE="+id+"\\007'");
   await wait(new RegExp('\\x1b\\]777;DONE='+id+'\\x07'),offset);
   offset=transcript.length;child.write('\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,offset);
   const [saved,cwd]=(await fs.readFile(dump,'utf8')).split('\0');assert.equal(saved,draft,'draft '+index);assert.equal(cwd,'/tmp');
   offset=transcript.length;child.write('x\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,offset);assert.equal((await fs.readFile(dump,'utf8')).split('\0')[0],draft+'x','cursor is restored to the end');
  }
  const done=crypto.randomUUID(),last=transcript.length;
  send(terminal,require('./src/runtime/screen-reporter.cjs').session);
  send(terminal,"printf '%s' ''\nprintf '\\033]777;DONE="+done+"\\007'");
  await wait(new RegExp('\\x1b\\]777;DONE='+done+'\\x07'),last);
  const offset=transcript.length;child.write('\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,offset);assert.equal((await fs.readFile(dump,'utf8')).split('\0')[0],drafts.at(-1)+'x','back-to-back CWD setup and multiline plugin command preserve draft');
  let writes=0;assert.equal(send({alternateScreenActive:true,frontend:{isAlternateScreenActive:()=>true},sendInput:()=>writes++},'cd /'),true);assert.equal(writes,1);writes=0;assert.throws(()=>send({sendInput:()=>writes++},'cd /\x03'),/control characters/);assert.equal(writes,0);
  console.log('PASS: real Bash PTY restores empty, quoted, Unicode, wrapped and multiline drafts after command injection.');
 }finally{child?.kill();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
