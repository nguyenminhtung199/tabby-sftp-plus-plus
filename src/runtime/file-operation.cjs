'use strict';
const { randomUUID } = require('crypto');

// A decision belongs to a user operation, including files discovered later in its folders.
function create(roots = 1) {
    const batch = { id: randomUUID(), pendingRoots: roots, pendingConflicts: 0, decision: 'ask', cancelled: false };
    // Recovery may retain identity, but must ask again after a restart.
    Object.defineProperty(batch, 'toJSON', { value: () => ({ id: batch.id }) });
    return batch;
}
function ensure(batch) {
    return batch && typeof batch.pendingRoots === 'number' && (batch.pendingRoots > 0 || batch.pendingConflicts > 0) ? batch : create();
}
function finish(batch) {
    if (batch) batch.pendingRoots = Math.max(0, batch.pendingRoots - 1);
}
function enqueue(queue, item, batch) {
    if (batch) { item.batch = batch; batch.pendingConflicts++; }
    if (item.transferCtx) {
        item.transferCtx.pendingConflicts = (item.transferCtx.pendingConflicts || 0) + 1;
        item._ctxCounted = true;
    }
    queue.enqueue(item);
}
function settle(item) {
    if (item._ctxCounted) {
        item._ctxCounted = false;
        item.transferCtx.pendingConflicts = Math.max(0, item.transferCtx.pendingConflicts - 1);
    }
    if (item.batch && !item._batchSettled) {
        item._batchSettled = true;
        item.batch.pendingConflicts = Math.max(0, item.batch.pendingConflicts - 1);
    }
}
module.exports = { create, ensure, finish, enqueue, settle };
