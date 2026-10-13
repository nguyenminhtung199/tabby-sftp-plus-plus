module.exports = function installKeyboardEvents({apis,Panel}) {
 const listeners=new WeakMap();
 const outside=(p,fn)=>p.zone?.runOutsideAngular?p.zone.runOutsideAngular(fn):fn();
 const init=apis.Panel.ngOnInit;
 apis.Panel.ngOnInit=function(...args){
  const result=init?.apply(this,args);if(listeners.has(this))return result;
  const doc=this.elRef?.nativeElement?.ownerDocument||(typeof document!=='undefined'?document:null),win=doc?.defaultView||(typeof window!=='undefined'?window:null),cleanup=[];
  outside(this,()=>{
   for(const [target,event,method] of [[win,'keydown','onWindowKeyDown'],[doc,'keydown','onGlobalKeyDown'],[win,'compositionend','onTypeAheadCompositionEnd']]){
    if(!target?.addEventListener)continue;
    const callback=ev=>{if(this._destroyed)return;const before=ev.defaultPrevented;this[method](ev);if(!before&&ev.defaultPrevented)this._safeDetect?.();};
    target.addEventListener(event,callback);cleanup.push(()=>target.removeEventListener(event,callback));
   }
  });listeners.set(this,cleanup);return result;
 };
 const destroy=apis.Panel.ngOnDestroy;
 apis.Panel.ngOnDestroy=function(...args){listeners.get(this)?.forEach(fn=>fn());listeners.delete(this);return destroy?.apply(this,args);};
 const sync=apis.Panel._startCwdSync;
 apis.Panel._startCwdSync=function(...args){return outside(this,()=>sync?.apply(this,args));};
};
