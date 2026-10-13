# Source migration acceptance — 2026-10-13

Baseline: ab2b001 / stable runtime 3d0a78f. Installed dist snapshot is retained locally at recovery/rewrite-baseline/dist. Git history retains the complete old patch build.

Passed: source typecheck; source-only staged build; 19 Node test groups; Angular 15.2.10 / Electron 43.7.0 component-factory and interaction fixture; installed russh native loopback tests (8 exclusive creations, 0764, permission-preserving upload/download, one-byte Explorer drop, self-paste and image paste).

Feature checks retain Open, native Open with, Open terminal here, Copy file name, Save As single download / folder picker batch download, inline Rename/New file/New folder, clipboard/drop queue, external save synchronization, permission policy, transfer/recovery, recents, bookmarks and settings. No Angular prototype mutation in the controller modules; the source build does not consume a minified base.

Before relying on the new build in a live session, restart Tabby completely and try: open an SSH SFTP panel, navigate, rename/create/cancel, Open/Open with/save sync, Save As/download, small drop/image paste, terminal typing after Open terminal here, pin/unpin, and close/reopen a panel. Renderer fixture tests mock Tabby service APIs and do not prove every live gesture.

Rollback the runtime: close Tabby, restore the saved dist snapshot, then reopen. Git-based rollback should restore the whole chosen baseline revision and rebuild its matching dependencies, not mix old dist with new source. Do not reset or remove recovery/state.json, resume-state.json, edit copies or staged uploads during rollback.
