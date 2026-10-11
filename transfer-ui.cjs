module.exports = function installTransferUI({ Panel, ProgressRuntime }) {
    const outside = (owner, fn) => owner.zone?.runOutsideAngular ? owner.zone.runOutsideAngular(fn) : fn();
    // Native network callbacks, filesystem work and checksum continuations must not
    // trigger a global Angular pass for every chunk. Progress still detects its view.
    for (const method of ['_doUpload', '_doDownload', '_doUploadRaw', '_doDownloadRaw', '_customExternalEdit', '_runQueuedUpload', '_runQueuedDownload']) {
        const original = Panel.prototype[method];
        if (!original) continue;
        Panel.prototype[method] = function (...args) { return outside(this, () => original.apply(this, args)); };
    }
    const start = ProgressRuntime.prototype._startTransferTimer;
    ProgressRuntime.prototype._startTransferTimer = function (...args) { return outside(this.host, () => start.apply(this, args)); };
};
