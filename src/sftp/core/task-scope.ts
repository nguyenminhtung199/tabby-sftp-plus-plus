/** Cancellation refs are passed by task owners. Native async context is never loaded in this renderer. */
export interface TaskCancelRef { current: any; active?: Set<any> }
export function createTaskScope(): TaskCancelRef { return { current: null, active: new Set<any>() } }
export function runInTaskScope<T>(_ref: TaskCancelRef, fn: () => T): T { return fn() }
export function currentTaskScope(): TaskCancelRef | undefined { return undefined }
