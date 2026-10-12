# Shared white-screen investigation — 2026-10-12

Status: cause not established. This change adds observations; it does not claim a fix.

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
