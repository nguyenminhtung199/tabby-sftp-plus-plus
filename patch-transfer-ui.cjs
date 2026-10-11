const fs = require('fs'), path = require('path');
module.exports = function patchTransferUI(source) {
    const premature = '||l.percent>=100';
    if (source.split(premature).length !== 2) throw new Error('Transfer completion anchor changed');
    source = source.replace(premature, '||(!m._customStream&&l.percent>=100)');
    const runtime = fs.readFileSync(path.join(__dirname, 'transfer-ui.cjs'), 'utf8').trim().replace(/^module\.exports = /, '').replace(/;$/, '');
    if (source.split('const so=to;').length !== 2) throw new Error('Transfer UI runtime anchor changed');
    return source.replace('const so=to;', `/* TRANSFER_UI_V1 */(${runtime})({Panel:Xi,ProgressRuntime:pi});const so=to;`);
};
