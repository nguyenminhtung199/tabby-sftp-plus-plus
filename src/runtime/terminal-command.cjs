const policy=require('../../transfer-policy.json').terminalCommands;
// Readline/Emacs: move across the complete input buffer, append a sentinel, then
// park it with backward-kill-word. This covers embedded newlines as well as screen wraps.
// Even an empty draft then
// owns the kill buffer, so restoring cannot accidentally yank an older deleted command.
// Yank restores the whole buffer; one backspace removes only our trailing sentinel.
module.exports=function sendTerminalCommand(terminal,command){
    if(!terminal?.sendInput)return false;
    // screen/tmux can keep the outer terminal in its alternate buffer while a shell
    // is ready inside. The buffer flag cannot identify the foreground program.
    const text=String(command).replace(/[\r\n]+$/,'');
    if(!text)return false;
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw new Error('Terminal command contains unsupported control characters');
    const line=/[\r\n\t]/.test(text)?'eval "$(printf \'%s\' \''+Buffer.from(text).toString('base64')+'\' | base64 -d)"':text;
    terminal.sendInput(policy.park+line+policy.submit+policy.restore);
    return true;
};
