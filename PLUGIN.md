# SFTP++

Independent local Tabby plugin: `tabby-sftp-plus-plus` 1.0.0, forked from DD1024z's MIT-licensed SFTP Plus 2.4.1. The upstream license is preserved in LICENSE. No Tabby application files are modified.

## Paste images and drop local files

Focus the remote file list and press Ctrl+V (Cmd+V on macOS) to upload a clipboard image as a uniquely named `clipboard-...png` into the currently open remote directory. Path/filter/editable fields retain normal text paste. Local/remote file copy-paste remains available when the clipboard does not contain an image. Drag files or directories from File Explorer onto the remote list, or onto a folder row to upload into that folder. These uploads use the existing transfer queue, progress/history and conflict handling. Navigating during preparation does not change the captured destination. Virtual dropped files are streamed to local staging rather than buffered in memory. Staged image/virtual-file copies remain under the Tabby user-data `sftp-plus-plus/uploads` directory for failed-transfer recovery/retry; they are excluded from Git export.

## Local editing

## Resume after reconnect

Interrupted file uploads/downloads retain their staging file and a durable checkpoint in `recovery/resume-state.json`. Once the same server/account reconnects, SFTP++ queues automatic continuation at the saved byte offset. A process restart also restores checkpoints belonging to a terminated process. Progress includes the bytes already transferred. Explicit Cancel removes the checkpoint and does not auto-resume; user-paused jobs remain paused until resumed manually.

Source and destination metadata must still match. The last saved partial chunk is verified before reuse; upload discards any unacknowledged suffix before continuing, so lost ACKs cannot duplicate bytes. Changed source/destination or corrupt partials stop with a conflict. Use Retry and confirm a restart when the source/destination changed. If a partial itself is rejected, cancel it and start a fresh transfer. Files are committed only after completion and metadata/size verification.

The bundled Tabby/russh file handle has no seek. On this build, continuation uses a separate SSH exec channel with **Python 3 (`python3`) on the remote server**; no commands are pasted into the terminal and Tabby core is not modified. The helper reads/writes only the requested chunk, with bounded buffers. Servers without SSH exec/Python 3 retain the partial and show an error; they do not silently restart. Seek-capable adapters can resume through SFTP directly. Checkpoints are saved periodically, so an abrupt machine crash can resend a small tail after the latest durable checkpoint, rather than the whole file.

Resume also applies to image/file-drop uploads, interrupted local-edit downloads and immutable save-upload snapshots. For directory transfers, partial individual files can continue; continuing the remaining directory traversal still uses the existing folder Retry/conflict workflow. Checkpoints, partials and edit snapshots remain local and are not synced to Git.

Run `node test-resume-transfer.cjs` with Python 3 available locally, or set `SFTP_TEST_PYTHON` to its executable. The test exercises the actual Python protocol over a simulated SSH channel, including reconnect/process restart, lost ACKs, changed-source conflicts, corrupt partials and cancellation; it does not connect to a live server.

The settings page no longer includes the About section (version, build time, author and promotional links). Upstream attribution and license remain in this documentation and LICENSE.

Double-click a remote file: queue an **edit-download**, stream the complete file to a durable local copy, verify its size and metadata, then open the Windows default app. Saving queues **edit-upload**, preserving the original bytes and encoding. Both operations appear in the existing transfer queue and Transfer history with size, percentage and speed. Cancelling or failing the download never opens an incomplete file. Large files use bounded buffers rather than loading the entire file into memory. Unchanged local files are not repeatedly hashed. Saving during upload schedules the latest saved contents after the current immutable snapshot finishes.

Local app editing and upload-on-save are always enabled. The internal viewer/editor and their type restrictions, line-number/caret options are removed, along with the hide-author and default-new-tab settings. Sidebar edge uses the same Left/Right segmented controls as other settings. Path mode selects **Manual** or **Remember**. Only Remember saves and restores the last successfully opened folder per session; there is no separate remember switch. Legacy explicit automatic Sync mode becomes Manual; the old separate enabled remember preference moves into Remember mode. Stored folders are retained. **Sync now** remains available for a one-time terminal path sync without changing mode. Native SFTP hiding responds immediately to settings and survives toolbar recreation/reconnect. The Open/close panel shortcut uses the same add/edit/remove chip layout as other shortcuts while preserving Tabby's global shortcut storage and key sequences. Retired options are removed from SFTP++ configuration without touching other Tabby configuration; a private backup is kept before migration.

This follows Bitvise's documented local-edit behavior: [Bitvise SSH Client 6.x release notes](https://bitvise.com/ssh-client-version-history-6). Bitvise also uses aggressive SFTP protocol request pipelining: [performance FAQ](https://bitvise.com/ssh-server-usage-faq). The bundled Tabby russh API only exposes cursor-based file handles, not offset-based protocol requests. SFTP++ downloads copy native memory before disk writes and use sequential network/disk steps; uploads overlap owned disk buffers and network work within 512 KiB, but does **not** claim Bitvise's protocol pipeline or identical throughput. Native handles are never read or written concurrently, avoiding cursor corruption. A future offset-capable adapter can implement that optimization without editing Tabby.

Uploads use unique staging files and verified completion before replacement, with backup/rollback when the server cannot rename over an existing target. Changes to the source or destination during transfer abort replacement. Failed uploads retain local edits. Remote conflicts require confirmation. Verified partial file transfers resume automatically after reconnection; legacy jobs without checkpoints and remaining folder traversal use manual Retry. Edit save retries remain bounded and cancellation blocks reuploading that content.

## Install and build

Run `node sftp-plus-plus/install.cjs` from the Tabby user directory. It builds and installs the independent package, copies the SFTP+ config into `tabby-sftp-plus-plus`, migrates the recovery journal while retaining existing local-file paths, and disables the original `sftp-plus` plugin. The original plugin is retained. Restart Tabby once to activate SFTP++.

Run `node sftp-plus-plus/build.cjs` to rebuild only. `npm pack` inside this directory creates an installable archive. `dist/` is self-contained at runtime; it embeds the original local VS Code Seti font and includes all icon assets. Install development dependencies in this repository with `npm ci --legacy-peer-deps --ignore-scripts`. Build tools use this repository's TypeScript package.

The fork retains the customized sidebar, path-mode Screen support, last folders per session, instant prefix suggestions (hover only highlights; click selects), English UI, yellow folders and Seti Python font. Editing/recovery are integrated into Transfer history. Notifications sit above the bottom edge of the panel.

Migration backups are in `migration-backup/`. Recovery is in `recovery/`; local files are deliberately retained after closing the panel or stopping a watcher.

## Validation

The bookmark popup includes **Recent**, separate from saved bookmarks. It shows the latest **5** qualified folders by default; **Recent folders (1–10)** controls the visible count (at most 10). **Recent folder dwell time (seconds)** defaults to **10**: a folder is added only after staying there longer than this threshold, or immediately when opening/editing a file, starting an upload/download, or confirming create/rename/delete/permissions. Simply selecting files or typing a path does not add a folder. Refreshing the same folder does not restart the timer. Remote history is persistent and isolated by host, port and account; local history is separate. Clicking a Recent row opens that folder through normal navigation. Recent does not change Manual/Remember path mode.

`node test-recent-folders.cjs` checks the dwell threshold, rapid navigation, file actions, deduplicated MRU order, count limit, live setting changes, server/account isolation, disconnect/destroy cleanup, and persistence using the installed Tabby ConfigProxy. The bundle test also parses the updated bookmark popup with Angular.

Recent rows keep stable identities across UI updates, so background refreshes do not replace the row being clicked. Repeated file operations in the current most-recent folder do not rewrite config; rapid changes share a config-save batch. Activity checks and local edit watchers run outside Angular's global change detection. Idle activity checks do not repaint the file list, while active transfers and visible Transfer history continue to update.

Download/Edit entry points, queued transfer execution, byte-transfer loops and the progress timer also run outside Angular; progress still updates the component explicitly. A streamed transfer is completed only after the engine verifies and commits the file, rather than when its byte counter first reaches 100%. `node test-transfer-ui.cjs` checks the real bundled entry points and progress runtime, including a failure after all bytes have transferred. The 300 MiB engine test covers disk-backed download, local editing and save-upload.

`test-transfer-engine.cjs` exercises a 300 MiB disk-backed download/edit/upload, bounded memory, queue limits, progress, pause/resume, cancellation, queued destination changes, failed replacement rollback and preservation of local edits. The existing external-edit, recovery, history, autocomplete, sidebar, Screen reporter and Angular bundle tests are retained. These tests do not substitute for measuring throughput against a live server.

Downloads retain an owned Node buffer, rather than a zero-copy view over native addon memory. The next native read starts only after the previous disk write/checkpoint finishes. `node test-native-buffer.cjs` simulates immediate invalidation of a borrowed native buffer and verifies exact output bytes, including EOF. This removes native memory sharing from the plugin download loop; it is not proof that every native renderer crash is resolved.


Right-click menus isolate mouse down/up and item clicks from the surrounding Tabby terminal. Edit and Download close the menu before starting asynchronously and retain the clicked file/selected files and target folder. Double-click editing and the transfer engine are unchanged. Run node test-context-menu.cjs to validate event isolation, deferred actions, captured selections, errors and teardown against the actual Angular bundle.

The rubber-band selection controller receives mouseup during document capture, before the panel blocks propagation to Tabby. Right/left drag release removes the rectangle and listeners; stationary right clicks continue to open the menu.

### Right-click Edit and Download

Edit calls the same local or remote double-click opening path, including clearing its pending click timer. Explicit Edit also works when single-click opening is selected. Both menu dispatch and direct context commands close the menu and defer work outside Angular. Download opens Tabby's native folder picker, then queues the captured selection into the chosen directory in order. Cancelling the picker, closing the panel, disconnecting or switching sessions starts no download against the old connection. Errors are contained even when notification rendering fails. Existing conflict checks remain unchanged.


### Additional right-click actions

- **Open** replaces the former **Edit** label and opens the file through the same path as double click.
- **Open with…** opens a local application picker (choose the application's .exe on Windows). Remote files use the existing verified local download and upload-on-save session. Reopening an already edited file reuses its local copy. Cancelling the picker starts no transfer; app launch errors are shown in the panel.
- **Open terminal here** is available in the remote pane. It sends a quoted cd command to the current SSH terminal: the selected folder, the parent of a selected file, or the current folder when right-clicking empty space. Use it at a shell prompt. Symlinks to folders are resolved, and terminal control characters are rejected.
- **Copy file name** copies only selected names, one per line, in both local and remote panes.

These actions also appear when an older custom menu order is saved; disabled actions remain hidden. The local pane has one Open item. Existing menu event isolation and deferred error handling are retained.

The menu settings list has one **Open** row shared by local and remote panes. Legacy openLocal/editFile order entries are deduplicated. If either legacy action was disabled, the unified Open remains disabled until re-enabled.
