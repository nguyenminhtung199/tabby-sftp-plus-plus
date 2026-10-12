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
