// Test fixtures expose controller tables through fixture prototypes only.
module.exports=function forFixtureClasses(factory){return options=>{
 const roles=['Panel','Settings','FilePane','Decorator','I18n','CwdDialog','ProgressRuntime','Menu','Bookmark'];
 const apis={};for(const role of roles)if(options[role])apis[role]=options[role].prototype;
 return factory({...options,apis});
};};
