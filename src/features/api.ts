/** Shared controller table. Views delegate here; feature modules never mutate class prototypes. */
export const featureApis: Record<string, any> = Object.create(null)
export function invokeFeature(role: string, name: string, owner: any, args: any[]): any {
 const fn = featureApis[role]?.[name]
 if (typeof fn !== 'function') throw new Error('Missing feature handler: '+role+'.'+name)
 return fn.apply(owner,args)
}
export function readFeature(role: string, name: string, owner: any): any {
 const descriptor=Object.getOwnPropertyDescriptor(featureApis[role],name)
 return descriptor?.get ? descriptor.get.call(owner) : descriptor?.value
}
export function writeFeature(role: string, name: string, owner: any, value: any): void {
 const descriptor=Object.getOwnPropertyDescriptor(featureApis[role],name)
 if (!descriptor?.set) throw new Error('Read-only feature property: '+role+'.'+name)
 descriptor.set.call(owner,value)
}
