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
- The host prepares a pending return marker before clearing old selections, restores it only after the current listing succeeds, and uses the existing row-scroll bridge. Do not turn the marker into selection: Back/Up must not accidentally arm Delete/Copy on an old item.
- The FilePane navigationReturnPath input reveals the bounded page and applies the same marker to flat/grouped rows; the host expands a collapsed group only when needed for a returned item. Same-folder background refresh must not keep snapping the view back.
- test-navigation-memory.cjs checks real local listing with Back/Forward/Up, remote scope/group/async guards and bounded state. Renderer tests cover off-page and grouped highlighting without changing selection.
