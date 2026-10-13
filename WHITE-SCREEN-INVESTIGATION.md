# Shared white-screen investigation — 2026-10-12

Status: shared crash site confirmed in AsyncLocalStorage.getStore from saved native/JavaScript stacks. The replacement is built and tested; live Tabby acceptance is pending.

## Shared code paths

- Title-bar pin: toggleCustomSidebarPin -> mount.togglePin -> config save dispatch -> mount.layout -> _scheduleLayoutRefresh -> _safeDetect -> ChangeDetectorRef.detectChanges; then another _safeDetect and terminal resize plus window resize event.
- Image paste: customPasteImage -> deferred native image read/PNG encoding -> staging -> _customUploadLocalPaths -> _streamUploadOne -> queue entry creation -> _safeDetect -> upload queue pump.
- Explorer drop: onDrop -> deferred file capture/staging -> _customUploadLocalPaths -> the same upload queue/render path.
- New file: original empty SFTP upload -> apply creation permissions -> remote refresh -> UI detection. No title-bar pin upload/download step exists.

The UI detection path is shared. ConfigService.save emits config changes, which can reconfigure terminal frontends, but config save is not established as common to every failing action. Shared code is a candidate, not proof of causality.

## Existing evidence

- Image reproduction PID 19512 ended at image:queue:start after successful read, PNG encoding and staging. Later reproductions ended after successful _safeDetect records without reaching clipboard route records. Existing logs do not locate their stopping function.
- Windows Application WER events at local UTC+7 17:18, 17:28 and 17:29 report AppHangB1 for Tabby.exe 1.0.238.0, with matching hang signature 1418 / 67246080 and bucket b5edbf067e853387a227794eb0894795. A matching WER bucket does not establish a shared JavaScript function. Referenced dump files were unavailable at inspection.
- No currently running Tabby process during this inspection. Earlier GPU killed messages may coincide with termination and do not establish GPU causality.

## Added observations

Opt-in existing private recovery/drop-trace.jsonl now captures pin config dispatch/return, layout, detection and terminal resize boundaries synchronously. Window error, unhandled promise rejection and NgZone error observers persist error type/code and stripped stack frames. Observers do not cancel events, replace application error handlers, suppress thrown pin errors, or log file contents/credentials. Additional existing prototype diagnostics cover pin/mode/full, layout refresh, close context menu and new file.

Node fixture tests validate diagnostic behavior, real sidebar pin function order and thrown-error propagation. These are not live Tabby UI tests. Computer use remains unavailable due Windows sandbox runtime initialization failure. The built junction installation requires a full Tabby restart to load this instrumentation.

## Temporary Tabby-level observer

See DIAGNOSTICS-CLEANUP.md for all new hooks, local outputs and removal steps. The observer separates main heartbeats from renderer heartbeat age and records native renderer/GPU lifecycle events. Readiness is not confirmed until main:diagnostics:ready appears after a full restart.

## Confirmed native crash site — 2026-10-13

The 09:05:25 (UTC+7) Crashpad dump records renderer process, exception 0xc0000005 at Tabby.exe+0x3a543ce, Electron 43.7.0, and electron.v8-fatal.location = Isolate::PushStackTraceAndDie / electron.v8-fatal.message = null prototype chain root. Its saved JavaScript stack begins getStore -> _safeDetect (drop-diagnostics.cjs) -> customSyncNow -> Angular click listener. A 2026-10-12 upload dump has the same native fault address and getStore -> uploadPathToRemote in the activity/diagnostic wrappers. This locates the shared failure in native AsyncLocalStorage.getStore, not the SFTP write/read operation.

Removed AsyncLocalStorage from activity.cjs and drop-diagnostics.cjs. New sync-context.cjs supports only synchronous nesting; folder ownership after await is resolved from running job server/direction and both source/destination paths. Diagnostic correlations across native await are best-effort; explicit saved queue context is retained. No global async busy flag absorbs unrelated jobs. Tests cover delayed folder children and a concurrent independent file. Full Tabby restart/live reproduction remains required to confirm the observed crashes stop.

The Tabby main diagnostics loader failed at startup with TypeError and has no main:diagnostics:ready entry. This is a separate diagnostic limitation. Added installation stage and stripped frames to locate that failure; do not treat main heartbeats as available until readiness is recorded.
