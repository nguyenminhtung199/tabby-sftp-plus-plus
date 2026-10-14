# SFTP++ source architecture

The 2.0 source migration restores the upstream MIT TypeScript source from tag v2.4.1 (cb0317b11843fb54a57372703f344c32337883bb) and retains the stable SFTP++ behavior. It replaces the minified-bundle patch build. It is a source migration and controller-layer rewrite, not an assertion that all upstream internals have been redesigned.

## Where to change behavior

- src/sftp/components/: file pane, context menu, bookmarks, dialogs and transfer views. Editable .view.html/.view.css files contain the actual shipped UI.
- src/sftp/sftp-floating-panel.component.ts: Angular host, existing state and compatibility facade. The host remains large; its upstream layout/navigation code is deliberately retained for parity. Named _base_ methods expose baseline behavior to controllers.
- src/features/: transfer/recovery, external editing, clipboard, context actions, inline names, sidebar, settings, recents and keyboard controllers.
- src/features/bootstrap.ts: the single explicit composition root and supported controller order. Controllers extend plain tables in featureApis rather than mutating Angular class prototypes. Wrapper order is still part of the integration contract and covered by tests; it is not eliminated by renaming it.
- src/features/api.ts and surface.json: the Angular facade contract. Add a facade handler and its contract entry together when adding a controller action. test-source-architecture verifies registration.
- src/runtime/: owned filesystem/metadata/permission helpers, recovery journal, synchronous context and Windows app chooser. Native async-context loading is absent.
- transfer-policy.json: new-file permissions, exclusive open flags and diagnostic limits.
- build.config.json / webpack.config.cjs / scripts/build.cjs: source compilation, staging, verification and artifact publication. No build step reads index.original.js or rewrites minified identifiers.

## Safety and parity

The native crash path was removed. The recovered upstream task-scope source itself documented the same V8 fatal error and disabled its native context path; the old SFTP++ activity/diagnostic additions had reintroduced that path. The restored source now removes the dormant implementation too, preventing accidental reactivation.

Local New file uses exclusive wx. Remote New file uses SFTP WRITE|CREATE|EXCLUSIVE and then verifies 0764. Downloads recheck the local destination before commit; a changed file causes failure/conflict rather than replacement. This last stamp check does not provide an OS-level conditional rename against every possible simultaneous external writer.

ConfigProxy map defaults are explicitly non-structural so newly saved sidebar/path-mode/CWD setup entries persist. Existing config values remain authoritative. The plugin name and configuration namespace remain tabby-sftp-plus-plus.

Global keyboard handlers remain outside Angular. Temporary failed main-process remote.require diagnostics were retired; plugin-level opt-in tracing remains.

## Verification

npm run typecheck; npm run build; npm test; npm run test:renderer; npm run test:native.

The standard tests use the pinned Tabby SDK map for ConfigProxy. Renderer tests use actual Electron 43.7.0 and Angular 15.2.10: compile 16 component factories, render inline fields and test focus/selection/Enter/Escape/menu output. Tabby service APIs are mocked in that renderer fixture. Native tests use the installed russh addon against an isolated loopback server. Neither test replaces acceptance in the actual Tabby SSH session.

The remote Python resume-protocol test remains separate and requires an explicitly configured project-compatible Python runtime. It was not run as part of this migration; its protocol implementation was retained.

## Remaining work

The upstream host and settings classes are still large, and the facade uses a compatibility index signature for retained code. A future extraction should move state and baseline methods into typed controllers subsystem by subsystem. Controller composition still has an explicit order; changing it requires integration checks. Cross-process transfer ownership and lifecycle stress testing deserve further work. These limitations are documented rather than claiming a completely fresh implementation.

## Large directory rendering

FilePane retains the complete filtered/sorted model and renders a bounded page of 200 display rows (transfer-policy.json fileList.pageSize). Group continuations repeat their header. The page controls preserve selection, and click indices remain absolute for Shift selection. Parent keyboard/type-to-find scrolling uses the pane's sftpRevealRow bridge before locating a DOM row. An active inline edit keeps its page mounted. All directory operations and Ctrl+A still use the full model; rubber-band selection covers the displayed page, and Ctrl preserves selections on other pages.

Column values are formatted lazily for rendered cells, cached in a WeakMap, and invalidated on directory/metadata refresh or date-format changes. Rubber-band path lookup is cached for the drag instead of rebuilding a full-directory Map each frame. Sorting and grouping still process the full model synchronously; this change bounds rendering work rather than claiming unlimited directory sizes.

Renderer regression coverage includes 1,000, 10,000 and 50,000 entries, bounded DOM, page controls, keyboard reveal, full-range Shift selection, inline rename focus, grouped pages, collapse and context/open/drag/drop outputs. Transfer correctness is checked separately through the installed russh adapter.

## Independent file-pane updates

FilePane uses Angular OnPush. The full selection-array reference and cell-cache revision are explicit inputs, so selection changes (including a different selection of the same count), metadata refresh and inline edits still update the view. An unchanged sibling file list skips row bindings on unrelated terminal/application ticks and on actions in the other pane. The host panel retains its existing update strategy.

Native wheel and scroll listeners are registered outside Angular and released on destroy. Wheel events still reach the parent hotkey handler synchronously with a non-passive listener; only a consumed shortcut enters Angular. Scroll enters Angular to close an open context/header menu, while ordinary scrolling needs no view update. Keyboard page reveal still performs an explicit child-view update. Dual-pane renderer regressions check these zone boundaries, selection state, metadata repaint, independent pagination and teardown.

## Automatic external-editor sync

transfer-policy.json externalEdit.remoteChangeAction defaults to overwrite: a new local save uploads automatically even when remote size/mtime differs from the previously synchronized baseline. No modal confirmation interrupts each save. The freshly observed remote metadata is still passed to the queue, preserving its check for changes while waiting or transferring. Failed/cancelled uploads retain the local copy and existing retry behavior; unchanged local content is not uploaded. The explicit confirm policy retains the previous prompt/reject workflow when deliberately selected. Permission preservation continues through the existing upload engine.

## Fresh downloads on Open

Every explicit remote Open/Open with (including opening a retained copy from the transfer panel) downloads to a new local path using current remote metadata. Opens for the same server/path are serialized; an already-running save finishes before the next download. The previous watcher is stopped and its local bytes retained. Cross-panel ownership moves to the newest open rather than reusing another panel's cached file. Save still uploads an immutable snapshot with permission preservation. A failed download never opens an older cached copy.

externalEdit.restoreWatchers is false: reconnect/restart retains old edit copies for explicit recovery but does not automatically watch/upload them. Interrupted editor transfers are not automatically resumed. An explicit Open starts fresh; explicit Retry remains available for recovering a failed local save. Regular file transfers retain their automatic recovery behavior. Retired edit snapshots are discarded before a new open so they cannot block the new file's save-upload.

## Two public transfer operations

The persistent Editing ledger and editor-operation filter options are removed. Remote Open produces Download records and local Save produces Upload records in the same queue/history. Legacy edit-upload/edit-download log tags are normalized when loaded or added, and rendered with the regular badges and filters. Idle save watchers do not count as active transfers or suppress the empty history state. Their state is private implementation needed to detect saves, not a public mode. Failed save uploads expose Retry on the Upload record, routed to the original local copy; successful retry removes that failed recovery action.
