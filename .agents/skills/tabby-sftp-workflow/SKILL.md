---
name: tabby-sftp-workflow
description: Use before code changes, npm commands, tests or plugin operations in the Tabby SFTP++ repository.
---

# tabby-sftp-workflow

## Required workflow

- Read this local skill and applicable parent/nested AGENTS.md before editing code, changing configuration, installing dependencies, running project commands, testing, or deployment operations. Read linked references relevant to the task before acting. Minimal read-only discovery to find these instructions is allowed.
- Keep durable project facts and operational lessons in this local skill or its linked references. Create a focused local skill when a separate subsystem needs one. Update local knowledge when the task establishes a durable fact; do not accumulate transient logs or speculative rules.
- Do not edit global skills unless the user explicitly asks to edit them. A code fix, a discovered constraint, or permission to maintain local knowledge does not authorize a global skill change.
- README.md is not agent memory. Put important agent instructions and project lessons in local skills; edit product documentation only when the task requires it.
- Keep local skills, their required references, and the AGENTS.md entrypoint tracked in Git. When delivery includes committing/pushing, include these files with the relevant change, stage only intended files, and report any remote/authentication failure. Never claim a push succeeded without verifying it.
- Inspect the actual OS, shell, runtime, dependency manifests and scripts before choosing commands. Scope changes to the requested task and preserve unrelated working changes.
- Use the project's declared environment. For Python services use their own .venv (Windows: .venv/Scripts/python.exe; Linux: .venv/bin/python). If required and absent, report the blocker rather than silently creating or replacing it.
- Run relevant checks. If a check needs external infrastructure and cannot connect, report the failing service/check; do not change source, credentials, endpoints or mocks merely to conceal that failure. Isolated tests do not need a live-service preflight.
- Write text as UTF-8 and preserve prompt placeholders and machine-readable contracts.

## Project guidance

- This repository uses a root package.json/package-lock.json and Node.js. Source is in src/ with Webpack; there is no frontend/ folder and no Python backend requirement for its Node-only checks.
- Run npm run typecheck, npm run build, npm test and npm run test:renderer at the repository root. The renderer fixture targets Electron 43.7.0 / Angular 15.2.10 with mocked Tabby APIs. npm run test:native uses the installed russh addon against an isolated loopback server; tests/test-policy.json owns SDK/native runtime paths. The remote Python resume-protocol fixture remains optional and needs an explicitly configured project-compatible interpreter.
- build.config.json owns staging/output/copy/verification; transfer-policy.json owns creation permissions and diagnostics. The source build verifies a candidate before replacing dist. Do not reintroduce minified-bundle patches or native async context into the renderer.
- The installed plugin can be a junction to this checkout, so changing dist affects the next full Tabby restart. Preserve recovery journals, edit copies and staged uploads. See docs/ARCHITECTURE.md and docs/REWRITE-ACCEPTANCE.md.

- Tabby SFTP++ also provides npm run test:terminal for interactive input preservation. It uses the installed node-pty addon and Git Bash in a separate PTY; tests/test-policy.json owns executable/module paths, isolated fixture paths, and timeout. The supported command-injection keymap is Readline-compatible Emacs; see docs/ARCHITECTURE.md.
- Tabby SFTP++ npm run test:screen uses the configured Ubuntu/WSL GNU Screen and installed node-pty to verify commands and draft preservation inside a dedicated screen session. tests/test-policy.json terminalScreen owns platform-specific paths/settings. The test cleans up only its uniquely named session; do not attach to or terminate user screen sessions.

## Navigation return markers

- Last-clicked/opened paths are stored only in the component lifetime, using src/sftp/core/navigation-memory.ts and fileList.navigationMemoryLimit in transfer-policy.json. Local and remote stores are independent; remote identity changes clear its store.
- The host prepares a pending return marker before clearing old selections, restores it only after the current listing succeeds, and uses the existing row-scroll bridge. After the accepted listing succeeds, restore normal selection via selectLocal/selectRemote and its keyboard anchor. The user requested the same appearance and behavior as a click; do not add a second highlight style.
- The FilePane navigationReturnPath input reveals the bounded page and reveals the selected item in flat/grouped rows; the host expands a collapsed group only when needed for a returned item. Same-folder background refresh must not keep snapping the view back.
- test-navigation-memory.cjs checks real local listing with Back/Forward/Up, remote scope/group/async guards and bounded state. Renderer tests cover off-page and grouped normal selection highlighting.

## Internal drag moves

- Same-pane internal drags move through PanelPasteAdapter in cut mode, sharing conflict resolution; cross-pane drags retain upload/download. A folder row targets that folder; the Up toolbar button targets the parent. Same-folder drops do nothing; self/descendant targets are rejected before conflict scanning.
- Internal payloads carry the panel scope; remote moves also require the same live SFTP session as dragstart. Do not use drag-out cached OS files for internal moves. External Explorer drops keep their copy/upload behavior.

## Plugin self update

- src/runtime/plugin-updater.cjs owns one shared updater for the process. It checks the configured Git origin/main outside Angular, initially after 10 seconds and then every 30 minutes while a panel exists. Timers/listeners stop with the last panel. Documentation-only commits do not offer an update: only dist/package changes do. Settings are in transfer-policy.json pluginUpdate.
- This updater supports the Git checkout/junction installation: validate exact repository root, origin and main; require a verified dist artifact; apply a clean fast-forward to the advertised commit. Never reset/stash user changes, install dependencies silently, or edit Tabby core/configuration. A changed runtime dependency manifest requires manual installation.
- Use the host HostAppService.relaunch() API only after successful update verification. Active/queued/paused transfers, file conflicts, inline changes and active save-upload work in any subscribed panel block restart. If work starts during update, keep Restart Tabby available for a later click. Idle save watchers are not active transfers.
- test-plugin-updater.cjs uses an isolated local bare Git remote and cloned installations to verify actual check/update, dirty/diverged/foreign/build guards and restart ordering without restarting the user's Tabby. Renderer checks use the real production button markup and a mocked host relaunch API.

## Dual-pane drag performance

- FilePane attaches dragover/dragenter/dragleave listeners outside Angular, alongside its scroll bridge. Main panel supplies stable dragHoverHandler callbacks; do not replace those with Angular output/template hover listeners. Actual drop still emits in Angular and uses the existing transfer pipeline. Header drops remain blocked and Up remains a valid target.
- PanelFileDnd applies a temporary ordinary selection-style background only to the hovered folder/Up target, and clears it on blank space/leave/reset/end. Main panel must not bind dragOver to these transient hover fields, which would invalidate OnPush file lists. Listener teardown belongs to FilePane lifecycle.
- Remote drag-out warmup timers run outside Angular. Hovering a local pane or a different remote folder cancels a pending/active cache; hovering the remote origin retains OS drag-out support.
- Renderer regression uses both 50,000-entry models with bounded pages, alternating hover across both panes and the column header. After pending page setup settles, hover must add zero row selection bindings, even with application ticks. Preserve actual drop/Up, border cleanup, row-child transitions and listener disposal. test-internal-move.cjs also checks cache cancellation and retained origin support.

- Drag feedback must follow the user's Explorer preference: ordinary folder-row highlight and native copy/move cursor. Blank space/file rows use the displayed directory. Do not add a footer, destination path badge, dashed outline, pane-wide border or a separate current/root drop zone. Keep actual selection unchanged.

## English-only source and notifications

- The plugin uses only locale/en-US.po. Remove language pickers and language import/export options; do not detect or change the host language. SftpI18nService retains its caller facade and ignores legacy locale-setting requests. Legacy stored language keys are ignored.
- Keep code comments and user-visible fallback text in English. Non-English historical comments were removed with AST checks rather than replacing code text blindly. Pinyin boundary data and Unicode terminal fixtures remain escaped so arbitrary Unicode filenames and terminal input still work. Do not remove Unicode handling when cleaning language.
- Toasts are positioned 16px above the panel bottom, expire automatically after 2-5 seconds, have no close button and do not pause when hovered. Avoid later top-position overrides. test-english-source.cjs checks catalogs, old locale settings, interpolation, settings/export choices and source/bundle text; Electron tests verify actual toast geometry.

## Explorer collision batches and folder progress

- Folder identity alone is not a replace conflict. Same-pane copy/move and cross-pane upload/download merge existing directories recursively, preserving destination-only entries. Conflicts concern duplicate leaves; file/directory or symbolic-link clashes cannot use Replace and offer Keep both/Skip. Existing directory targets bypass archive optimizations so per-file decisions are retained.
- src/runtime/file-operation.cjs owns an operation identity and its Replace all/Skip all/Keep both decision. Propagate the same batch through drag/drop, queued roots, recursion, pending paste and leaf conflicts. New operations and recovery ask again. Cancellation settles only that batch; a folder row owns an explicit cancel reference so concurrent folders cannot cancel each other's native byte streams. Keep moveSource and batch arguments in both root and nested coordinator branches.
- Same-directory Copy generates `name - Copy.ext`, then `name - Copy (2).ext`; same-directory Cut is a no-op. Keep both probes `name (2).ext`, `name (3).ext`, etc. Cut merges remove successful source leaves and only empty source directories; skipped or failed leaves remain at source. Do not delete an entire merged source tree after partial success.
- src/sftp/core/transfer-progress.ts aggregates confirmed bytes plus live per-file bytes across concurrent streams. Skipped bytes advance processed progress but are excluded from transfer speed. Scanning/checking/extracting/conflict waiting are explicit indeterminate phases; live native callbacks update folder progress before a file completes. Folder redraws are coalesced and timer registrations are removed on finish/discard/cancel.
- test-explorer-collisions.cjs covers real local merges, operation scoping, copy naming, Keep both, type clashes, live byte accounting and coordinator argument forwarding. Native loopback tests also cover nested upload/download, empty/zero files, remote-to-remote merge moves, cancellation gates and permission preservation. The fixture uses ASCII SFTP handle tokens: installed russh passes handles through UTF-8, so arbitrary binary handles containing invalid UTF-8 cannot be used as fixture identifiers. This does not alter Tabby or the native addon.

## Conflict preflight snapshots and focused actions

- PasteUseCase scanConflicts owns a per-call map of remote directory listing promises and name maps; pass it through recursion. Use the same snapshot for destination existence/type/size/time and source metadata. It is discarded after preflight, never reused for execution or a later paste, so external changes are visible on the next operation. Missing paths may be absent; permission/connection errors must propagate. Yield periodically during large snapshot scans so renderer timers/input can run.
- For same-pane conflict items, remotePath/remoteFileSize/remoteFileMtime represent the source and localPath/localStat represent the destination, including remote-to-remote moves. Preserve cross-pane upload/download meanings. Do not populate both columns from destination metadata.
- The conflict overlay must allow native Enter activation of focused buttons, stopping propagation to panel shortcuts without preventing the button's default action. Escape retains cancellation; Enter on the overlay itself retains the existing safe Skip fallback.
- test-conflict-preflight.cjs verifies 5,000 duplicate files with three directory reads (destination parent, source folder, destination folder), a timer heartbeat during scan, fresh metadata on the next operation and distinct source/destination sizes/times. Electron tests use sendInputEvent keyDown/char/keyUp to verify actual Chromium activation for single and batch conflict buttons; keyDown alone does not model Enter's full input sequence.

## Transfer preparation and bulk-action performance

- mapSettledConcurrent/mapConcurrent in core/concurrency.ts use a fixed worker set and preserve result ordering/failure semantics. Folder upload/download preparation uses twice the configured file concurrency, while the existing shared limiter still controls actual byte transfers. Gate pause/cancel before preparing an entry and again after acquiring a transfer slot. Do not construct one waiting async task/stat request for every file in a large directory.
- Folder download trusts explicit symlink flags from a current listing; only unknown flags require the lstat/readlink fallback. Keep known links excluded. Coordinator mapping must preserve unknown as undefined and normalize boolean/function flags or file-type mode bits; never invent false for absent metadata.
- Local size scanning shares an eight-operation I/O limiter across nested directories and stats files concurrently within that bound. Paste's local child metadata also uses a bounded worker set.
- ConflictResolveUseCase uses queue.peek for the head and yields during long bulk actions. file-operation.enqueue/settle maintain per-folder pendingConflicts exactly once per queued item, so completing a shared folder does not scan/copy the remaining queue for every leaf. Legacy manually queued items retain the snapshot fallback. Keep producing guards and operation isolation.
- test-transfer-performance.cjs exercises 2,000 files, known/unknown symlink handling, bounded metadata/transfer activity, real local scanning, paused/cancelled workers, ordered settled errors and 5,000 shared-folder Skip-all items with zero queue snapshots and timer heartbeats. Integrity checks, fresh metadata at transfer commit and permission preservation remain mandatory; performance changes must not replace them with stale cached metadata.

## Remote drag hover must stay free of transfer and outer-app work

- FilePane's native dragover/dragenter/dragleave/drop bridge stops propagation within accepted file-drop surfaces; row dragstart/dragend also stop propagation. Hover remains outside Angular, and only drop enters it. Do not let these events bubble into outer Tabby drag handlers. Keep column-header blocking and Up/drop behavior intact.
- onDragStartRemote uses only in-memory ready-cache metadata; never statSync/accessSync/readdirSync a drag-out path during dragstart. Internal payloads start no filesystem/network warmup, including drags held longer than the old 450ms threshold. Warm OS drag-out files only after the pointer leaves the actual .sftp-root; relatedTarget and pointer bounds distinguish pane transitions from leaving the panel. Re-entry cancels warmup immediately on dragenter, before dragover.
- Ready OS cache paths are isolated per SFTP session and keyed by remote path/size/mtime. Warm them asynchronously outside Angular; retain the original basename in a hashed subdirectory. Internal drops always use live remote payloads and the normal transfer queue, never OS cache copies. Dragend/new drag/session changes prevent old warmups from being reused for another operation/server.
- test-remote-drag-hover.cjs checks real dragstart with synchronous stat calls trapped, zero cache work during a 500ms internal hold, null-relatedTarget pane transitions, outside/re-entry cancellation and ready-cache session isolation. Electron tests run production dragstart and hover callbacks across both 50,000-entry panes, trap ancestor drag handlers, wait beyond 450ms and verify exactly one download only after drop. Earlier synthetic-hover tests alone did not cover dragstart, warmup or outer-app propagation.

## Multi-selection responsiveness

- Rubber-band frames update visible row classes and the selection model directly outside Angular. Do not run the whole panel detector for every animation frame; mouseup commits the view once. The rubber-band entry lookup stores only visible paths while retaining off-page Ctrl selections; invalidate it when either the source model or visible path array changes.
- FilePane selection-only input changes preserve pageEntries/pageGroupRows identity. Rebuild page slices only for model, navigation, filter/sort or inline-edit changes. Ctrl/Shift selection must still use absolute full-model indices.
- File icon theme resolution is memoized per pane and filename with a bounded 1,024-name cache. Icon directories/rules/disabled icons, cell revision and _iconResolutionRevision invalidate it. Repeated customSetiPython/iconSrc calls during selection must not rescan theme suffixes. Keep .txt and user icon rules unchanged.
- Click bookkeeping timers run outside Angular; do not add a second application tick 250ms after every selection. syncPaneSelectionVisual changes only rows whose selected class differs.
- test-selection-performance.cjs verifies icon resolution reuse/invalidation, 40 live frames without full-panel rendering, visible-only lookup for 50,000 models, one release commit and full-range Shift selection. Electron tests enable real icon rules and use production selectLocal callbacks for Ctrl/Shift selections with both large panes mounted, preserving page identity and visible selection.


## Inline names and transient notifications

- Rename/new-file/new-folder inputs have no close button. Enter commits; Escape cancels. customInlineBlur commits a valid nonempty name, dismisses an empty draft and lets an existing failed-name edit be abandoned without retrying it. Busy operations remain guarded. Keep both flat/grouped rows and draft rows on the same blur handler.
- Notifications have no close button or hover handlers. showToast preserves short/long defaults and clamps custom durations to 1.5-5 seconds; replacing one cancels its old timer. Preserve bottom positioning. Do not restore hover-paused persistent toasts.
- test-inline-edit.cjs uses real filesystem operations for blur rename/create and empty/error dismissal; test-inline-toast-dismissal.cjs checks all three input layouts and timer replacement/expiry. Electron tests use blur events for failed-name dismissal and verify a hovered notification disappears automatically. The hidden Electron window can change document.activeElement via input.blur() without emitting blur, so dispatch the FocusEvent explicitly in that fixture.
