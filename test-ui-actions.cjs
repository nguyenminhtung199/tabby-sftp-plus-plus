const assert=require('assert/strict'),fs=require('fs'),path=require('path'),Module=require('module');
const fixturePath=path.join(__dirname,'test-transfer-ui.cjs');
const header=fs.readFileSync(fixturePath,'utf8').split('(async()=>{')[0];
const fixture=new Module(fixturePath,module);fixture.filename=fixturePath;fixture.paths=module.paths;
fixture._compile(header+'\nmodule.exports={sandbox,panel};',fixturePath);
const {sandbox,panel}=fixture.exports;
const compiler=require('@angular/compiler'),rows=[],missing=[];
for(const type of sandbox.module.exports.default.__annotations__[0].declarations){
 const metadata=type.__annotations__?.[0];if(!metadata?.template)continue;
 const selector=metadata.selector||(type.prototype.contextMenuItemLabel?'settings':type.name);
 const parsed=compiler.parseTemplate(metadata.template,selector+'.html');assert.ok(!parsed.errors?.length,selector+': '+JSON.stringify(parsed.errors));
 const events=[],actions=new Set();
 function walk(nodes){for(const node of nodes||[]){for(const event of node.outputs||[]){const expression=event.handler.source;events.push({event:event.name,expression});for(const m of expression.matchAll(/(?<![\w.$])([a-zA-Z_]\w*)\s*\(/g))actions.add(m[1]);}walk(node.children);}}
 walk(parsed.nodes);
 for(const action of actions)if(typeof type.prototype[action]!=='function'&&!['onClose','onMinimize'].includes(action)){const instance=/constructor\(\)/.test(type.toString())?new type():null;if(typeof instance?.[action]!=='function')missing.push(selector+':'+action);}
 rows.push({selector,eventCount:events.length,actions:[...actions].sort()});
}
assert.deepEqual(missing,[],'every referenced handler exists on its prototype or as an instance callback');
fs.writeFileSync(path.join(__dirname,'ui-action-inventory.json'),JSON.stringify(rows,null,2)+'\n');
assert.ok(rows.some(row=>row.selector==='sftp-plus-panel'),'main panel is audited');assert.ok(rows.some(row=>row.selector==='settings'),'settings are audited');
console.log('PASS: '+rows.length+' component templates parse; '+rows.reduce((n,row)=>n+row.eventCount,0)+' event bindings audited.');
