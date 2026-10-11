// Use the actual installed Tabby implementation (read-only) rather than a plain-object config mock.
const fs=require('fs'),vm=require('vm'),ts=require('../plugins/node_modules/typescript');
module.exports=function createConfigProxy(defaults,real={}){
 const file='C:/Program Files/Tabby/resources/builtin-plugins/tabby-core/src/services/config.service.ts';
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const pieces=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&['isStructuralMember','isNonStructuralObjectMember'].includes(n.name?.text))||(ts.isClassDeclaration(n)&&n.name?.text==='ConfigProxy')).map(n=>n.getText(ast));
 if(pieces.length!==3)throw new Error('Installed Tabby ConfigProxy source changed');
 const context=vm.createContext({exports:{},defaultsJSON:JSON.stringify(defaults),realJSON:JSON.stringify(real)});
 // Fixtures use JSON values only, with same-realm clones so instanceof Object matches production.
 const helpers='const deepClone=v=>v===undefined?v:JSON.parse(JSON.stringify(v));const deepEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);';
 vm.runInContext(helpers+ts.transpileModule(pieces.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,context);
 vm.runInContext('globalThis.backing=JSON.parse(realJSON);globalThis.proxy=new exports.ConfigProxy(backing,JSON.parse(defaultsJSON));',context);
 return {proxy:context.proxy,backing:context.backing};
};
