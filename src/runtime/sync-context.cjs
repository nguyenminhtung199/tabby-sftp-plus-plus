// Synchronous nesting only. Never consult Node async_hooks in an Angular renderer.
module.exports=function createContext(){
 let current;
 return {getStore(){return current;},run(value,fn){const parent=current;current=value;try{return fn();}finally{current=parent;}}};
};
