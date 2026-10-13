const {ipcRenderer}=require('electron'),path=require('path'),fs=require('fs'),Module=require('module'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),cfg=require('../test-policy.json').renderer;
(async()=>{try{
 require('reflect-metadata');require('zone.js');require('@angular/compiler');
 const Angular=require('@angular/core'),Common=require('@angular/common'),Forms=require('@angular/forms'),Browser=require('@angular/platform-browser'),Dynamic=require('@angular/platform-browser-dynamic');
 class CoreModule{}Angular.NgModule({})(CoreModule);
 const generic=new Proxy({__esModule:true,default:CoreModule},{get:(target,key)=>key in target?target[key]:(target[key]=class{})});
 const load=Module._load;Module._load=function(name,...args){if(name.startsWith('tabby-'))return generic;return load.call(this,name,...args);};
 let plugin;try{plugin=require(process.env.SFTP_TEST_BUNDLE_PATH||path.join(root,'dist','index.js'));}finally{Module._load=load;}
 const platform=Dynamic.platformBrowserDynamic();const compiled=platform.injector.get(Angular.CompilerFactory).createCompiler().compileModuleAndAllComponentsSync(plugin.default);assert.equal(compiled.componentFactories.length,16,'all plugin component factories compile in the target renderer');
 const {FilePane,Menu}=plugin.testing;const events=[];
 class Host{constructor(){this.entry={name:'sample.py',fullPath:'/sample.py',isDirectory:false,size:1};this.entries=[this.entry];this.edit={id:1,mode:'remote-rename',pane:'remote',folder:'/',originalPath:'/sample.py',value:'sample.py',isDirectory:false,title:'Rename',busy:false,error:''};this.i18n={t:(key)=>key,getLocale:()=> 'en-US'};this.owner={zone:{runOutsideAngular:fn=>globalThis.Zone.root.run(fn)},customInlineValue:value=>{this.edit={...this.edit,value};},customInlineCommit:()=>{if(this.edit){events.push('commit:'+this.edit.value);this.edit=null;}},customInlineCancel:()=>{events.push('cancel');this.edit=null;}};this.menuEvents=[];}}
 Angular.Component({selector:'fixture-root',template:fs.readFileSync(path.join(__dirname,'host.html'),'utf8')})(Host);
 class FixtureModule{}Angular.NgModule({imports:[Browser.BrowserModule,Common.CommonModule,Forms.FormsModule],declarations:[Host,FilePane,Menu],bootstrap:[Host]})(FixtureModule);
 const module=await platform.bootstrapModule(FixtureModule),app=module.injector.get(Angular.ApplicationRef),host=app.components[0].instance;
 await new Promise(resolve=>setTimeout(resolve,cfg.settleMs));
 let input=document.querySelector('.custom-inline-name');assert.ok(input,'real Angular template must render inline name input');assert.equal(document.activeElement,input);assert.equal(input.selectionEnd,6,'basename selection preserves extension');
 input.value='changed.py';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));app.tick();assert.deepEqual(events,['commit:changed.py']);assert.equal(document.querySelector('.custom-inline-name'),null);
 host.edit={id:2,mode:'remote-touch',pane:'remote',folder:'/',originalPath:null,value:'',isDirectory:false,title:'New file',busy:false,error:''};app.tick();await new Promise(resolve=>setTimeout(resolve,cfg.focusMs));input=document.querySelector('.custom-inline-name');assert.ok(input);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));app.tick();assert.equal(events.at(-1),'cancel');assert.equal(document.querySelector('.custom-inline-name'),null);
 const items=[...document.querySelectorAll('.ctx-item')];const openWith=items.find(e=>e.textContent.includes('Open with'));assert.ok(openWith,'native-app chooser action must render');openWith.dispatchEvent(new MouseEvent('click',{bubbles:true}));assert.ok(host.menuEvents.includes('openWith'));
 module.destroy();ipcRenderer.send('fixture:result',{ok:true,message:'Electron '+process.versions.electron+' / Angular '+Angular.VERSION.full+' render: 16 component factories, inline focus, basename selection, Enter, Escape and Open with menu.'});
}catch(error){ipcRenderer.send('fixture:result',{ok:false,message:error.stack||String(error)});}})();
