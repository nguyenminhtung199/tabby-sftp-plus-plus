# Temporary diagnostics and removal checklist

Added for the Tabby white-screen/hang investigation on 2026-10-12. Cause is still under investigation. Remove temporary diagnostics after live reproductions establish the fix.

## Local activation and deactivation

Run these commands from the SFTP++ repository root:

- Enable both plugin and Tabby diagnostics: npm run diagnostics:on, then fully restart Tabby.
- Disable: npm run diagnostics:off, then fully restart Tabby. This removes only enable-drop-trace and enable-tabby-trace under recovery/. It retains all recovery data and existing logs.
- Removing enable-tabby-trace detaches main-process observers at the next two-second tick and stops renderer heartbeat at its next tick if those processes respond. Restart is still required to remove the existing plugin method wrappers and Angular/browser error observers.

## Private local output

- recovery/drop-trace.jsonl: plugin action/queue/transfer stages, shared UI boundaries and stripped error frames.
- recovery/tabby-runtime.jsonl: new main-process observer events, renderer unresponsive/responsive/gone/loading/destroyed, GPU/utility exit reason, application quit, main exception monitor, main heartbeat and age of last renderer heartbeat. Numeric process CPU and memory metrics assist hang analysis.
- recovery/tabby-runtime.previous.jsonl: one rotated backup. Current and backup are limited to approximately 2 MiB each; new records are bounded and stop after the configured count.
- Tabby's pre-existing main-process-errors.log at its user-data root: existing Tabby logging, unchanged by this patch. Its prior GPU killed records alone do not prove the cause.

New observers log no terminal input, clipboard image, file content, server address, URL, window title, IPC payload, or credentials. All output stays in ignored recovery/. Heartbeats continue in the main process when renderer JavaScript stops responding; a stopped main heartbeat also has other possible explanations, including quitting or the diagnostics limit.

The loader uses Tabby's existing @electron/remote support to load a small observer module in the main process. It does not modify the installed app.asar, enable a debug port, or replace application error handlers. Startup is deferred and opt-in; installation errors are recorded as renderer:diagnostics-install:error. Live readiness is confirmed only by main:diagnostics:ready in the new log, not by a successful build.

## Source removal after verification

1. Run diagnostics:off and restart Tabby before deleting source modules.
2. Remove TEMP_TABBY_DIAGNOSTICS_V1 loader invocation from build.cjs and its two copy-list entries. Delete tabby-diagnostics-loader.cjs, tabby-main-diagnostics.cjs and test-tabby-diagnostics.cjs, and remove tabbyDiagnostics policy.
3. Remove DROP_DIAGNOSTICS_V1 invocation and drop-diagnostics.cjs copy entry when plugin diagnostics are no longer needed. Remove the temporary sidebar:pin stage traces while preserving actual pin logic. Remove diagnostic calls in clipboard-upload.cjs, patch-transfer-ui.cjs, transfer-engine.cjs, resume-transfer.cjs and any remaining runtime modules. Keep actual fixes, transfer engine and permissions policy.
4. Remove diagnostics-control.cjs, its npm scripts and diagnostic-only tests (test-drop-diagnostics.cjs and test-shared-ui-diagnostics.cjs), and dropDiagnostics policy once nothing consumes them.
5. Rebuild dist, run relevant behavior tests, commit and push main. Verify no diagnostic markers/hooks remain in the resulting bundle. Retain this investigation record if useful.
6. Once logs have been reviewed, optionally delete only the three named diagnostic JSONL files. Preserve recovery/state.json, edit and transfer recovery files, and staged uploads.

Electron event contracts: https://www.electronjs.org/docs/latest/api/web-contents and https://www.electronjs.org/docs/latest/api/app . Tests simulate these event emitters; live Tabby execution is still required to confirm readiness and reproduce the hang.
