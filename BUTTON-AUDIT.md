# Button and action audit

The audit covers the templates of all 16 declared components, including the main panel, settings, context menus, bookmarks, file panes, create/delete/permission/conflict dialogs, transfer queue and Transfer history. `test-ui-actions.cjs` parses these templates with Angular, verifies all referenced method/callback handlers exist, and records 619 event bindings in `ui-action-inventory.json`. This is a code/binding audit, not a claim that every gesture was manually exercised in a live Tabby window.

## Findings and fixes

- The previous change sent zero-byte New File through the streamed upload/progress/recovery path. New File now uses its original upload path, then sets and verifies 0764. It no longer runs through the stream engine.
- Installed russh `stat()` spreads a native metadata object and returns only `type` and `size`. A loopback test against the actual installed addon confirmed `permissions` is undefined; Tabby then maps it to mode 0. Plugin upload/edit/history/retry metadata now uses the plain attributes returned by directory listing for this adapter. Missing files, permission-denied listings and symlink loops are reported explicitly. The native session and Tabby application files are not modified.
- New File/Rename existence checks use directory listing and propagate access errors, rather than treating failures as a missing file.
- Context-menu dispatch now returns and catches the asynchronous results of Upload, Paste, Rename, Refresh and the other existing actions; their errors no longer escape through a discarded promise. Open/Open with/Download retain the deferred, captured-selection path.
- Crash dumps record a native ACCESS_VIOLATION (0xc0000005). The exact renderer crash was not reproduced in the isolated fixture; passing JavaScript tests alone does not prove it is eliminated.

## Validation

Passed: menu/edit/download handling and creation; permission preservation; plain native metadata; local editing and upload-on-save; bounded native download buffers; transfer progress/history/pause/retry/cancel; image paste and file drop; bookmark/recent persistence through the installed ConfigProxy; template/handler audit.

`test-native-sftp.cjs` loads the installed native russh addon in a separate process and starts a temporary SSH/SFTP server on loopback. Eight empty creations + chmod + save-upload + downloads completed with exact file contents and preserved permissions. It uses no production server or saved credentials. Its RxJS 7 alias is test-only; the existing Angular 9 tests keep RxJS 6.

To run environment-specific checks, set `SFTP_TEST_RUSSH_ROOT` to the installed app's unpacked `node_modules/russh` directory and `SFTP_TEST_TABBY_CORE_MAP` to the installed `tabby-core/dist/index.js.map`. The original stat behavior can be inspected with `node test-native-sftp.cjs --probe-original-stat` in this isolated fixture.

The real Tabby window must load the new bundle after a complete restart. Manual live-window verification remains necessary for the reported white-screen symptom.

## Clipboard follow-up

The same-path paste branch previously reached conflict detection and hashing before eventually skipping the identical source. It now exits before those operations. Keyboard/DOM paste also previously preferred a stale Windows clipboard image over files copied inside the plugin; internal files now take priority. Reentrant paste and rejected paste promises are contained. Tests cover repeated same-folder copy/cut, normalized paths, mixed selections, different destinations, retained clipboard, menu dispatch and image priority. The native fixture checks ten self-pastes cause zero adapter calls and leave bytes unchanged. The live white-screen symptom still requires verification in the Tabby window.

## Explorer drop follow-up

Drop processing previously started preparing/queuing uploads during the native Explorer drop callback, and _streamUploadOne used statSync on the local file. The callback now captures File/path/destination, then defers staging/upload preparation outside Angular. Queue metadata is asynchronous and validates the captured session. Pending drop tasks are cancelled on panel destruction. Regression checks verify no upload starts inside the drop callback, UI event-loop progress while stat is pending, fixed destinations during navigation, and a one-byte Explorer-style drop through the actual native adapter. Live-window responsiveness still needs manual verification.

## Live reproduction instrumentation

Because isolated tests did not reproduce the user's live freeze and Computer Use cannot initialize in the current Windows sandbox, private opt-in diagnostic logging was added for the drop preparation, queue, upload and repaint path. It is activated only with recovery/enable-drop-trace and writes bounded asynchronous records plus heartbeat lag to recovery/drop-trace.jsonl. This is instrumentation to capture an actual failing interaction, not another claimed freeze fix. The next reproduction requires a complete Tabby restart, one Explorer drop, then inspecting the last completed/started phase and heartbeat. No credentials, file contents, source paths or server addresses are recorded.

## Confirmed live drop TypeError

The captured live reproduction ended at onDrop:error with TypeError after 6 ms, before _safeDetect, deferred preparation or upload started. The handler assigned panel._remoteDragOver=false, but the actual Panel exposes that field through a getter without a setter. Strict-mode assignment to this accessor reproduces TypeError. The fix calls the existing file-DnD controller reset() instead. A bundle regression uses the actual Panel prototype and Jt controller, proves the old assignment throws, and verifies the fixed Explorer drop completes and clears hover state. Bundle tests now isolate APPDATA so tracing does not write test events into the live user log.

## Image paste follow-up

The live image attempt produced a staging PNG but had no subsequent queue trace; the image-specific read/encode/stage steps were not previously instrumented. This does not establish a definitive native crash cause. Image handling now defers clipboard reads/PNG encoding and staging through the same outside-Angular scheduled preparation path as Explorer drops. A pending image task is shared by duplicate paste events. PNG bytes are copied to an owned Buffer before asynchronous disk writes. Context-menu image paste captures a selected folder before closing the menu. Image phase records are flushed before native read/encode/stage/queue to retain the last reached step even on failure. Regression tests use the real bundled Panel and native SFTP adapter; the actual Electron NativeImage read/encode still requires the user's live reproduction.

## Latest live image trace

PID 19512 completed image read, encode and staging (594437 bytes), then recorded image:queue:start at 2026-10-12T09:40:14.580Z. No later queue phases were persisted and that renderer PID subsequently disappeared. This localizes the failure to the queue transition, but does not yet identify the exact failing instruction. Diagnostic mode now flushes records before async queue/preflight stages and records queue:entry:create, queue:paint and queue:pump before running them. Normal logging-disabled behavior is preserved. No crash fix is claimed from this instrumentation alone.

## Detailed transfer diagnostics and Ctrl+V routing

Queue jobs carry an operation/job context across delayed pumping; spans retain parent relationships. Upload/download trace local/remote metadata, opening handles, reads/writes (offset and byte counts for the first configured chunks), handle close/sync, size/permission verification, commit, completion and cleanup. Heartbeat shows queue counts in both directions and named inflight spans with age. Error records retain type/code and function+line+column frames while excluding file paths and contents.

The latest live reproduction (PID 2192) loaded the detailed operationId format but had no customPasteImage entry. The old SFTP plugin is no longer in the installed plugin manifest, so a duplicate-plugin explanation is unsupported. Native availableFormats was still called inline before image paste, and is now removed from key/menu/DOM callbacks; image probing is deferred and normal editable controls are exempt. An opt-in clipboard:key-route record captures ownership/focus/pane booleans and is synchronously appended before fallback dispatch so a crash cannot discard this one critical record. No clipboard contents or arbitrary keystrokes are logged. This identifies routing before the transfer path; a new live reproduction is still required to confirm the crash cause.
