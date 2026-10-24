export const SFTP_PANEL_STYLES = `
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      box-sizing: border-box;
      outline: none !important;
      transition: none !important;
    }
    :host(:focus),
    :host(:focus-visible) {
      outline: none !important;
      box-shadow: none !important;
    }


    :host {
      --_bg: var(--sftp-bg, var(--body-bg, #f9fafb));
      --_text: var(--sftp-text, var(--text-color, #1f2937));
      --_primary: var(--sftp-primary, var(--primary-color, #3b82f6));
      --_border: var(--sftp-border, var(--border-color, #e5e7eb));
      --_content: var(--sftp-content, var(--_bg));
      --_fs: var(--sftp-font-size, 13px);
      --_surface: rgba(128, 128, 128, 0.06);
      --_hover: rgba(128, 128, 128, 0.12);
      --_active: rgba(128, 128, 128, 0.18);
      --_input-bg: rgba(128, 128, 128, 0.06);

      --_scroll-track: rgba(128, 128, 128, 0.06);
      --_scroll-thumb: rgba(128, 128, 128, 0.28);
      --_scroll-thumb-hover: rgba(128, 128, 128, 0.45);
    }

    .sftp-root {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
      height: 100%;
      width: 100%;
      min-width: 0;
      padding: 8px;
      gap: 0;
      position: relative;
      background: var(--_bg);
      color: var(--_text);
      font-size: var(--_fs);
      font-family: var(--font-family, 'Segoe UI', sans-serif);
      box-sizing: border-box;
      pointer-events: auto;
      outline: none;
      border: 1px solid var(--_border);
      border-radius: 10px;
      transition: none !important;
      animation: none !important;
    }
    .sftp-root.workspace-mode {
      padding: 0;
      border-radius: 0;
      border: none;
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      height: 100%;
      width: 100%;
    }
    .sftp-root.workspace-mode .sftp-main {
      border-radius: 0;
      flex: 1 1 auto;
      min-height: 0;
    }
    .sftp-root.workspace-mode .sftp-body {
      border-radius: 0;
      flex: 1 1 auto;
      min-height: 0;
    }
    sftp-plus-workspace-tab {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    sftp-plus-workspace-tab .sftp-workspace-tab,
    sftp-plus-workspace-tab sftp-plus-panel {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .sftp-root .sftp-toast {
      position: absolute;
      top: auto;
        bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 200010;
      max-width: min(92%, 560px);
      padding: 6px 14px;
      border-radius: 6px;
      background: var(--_bg);
      border: 1px solid var(--_border);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      font-size: 12px;
      color: var(--_text);
      white-space: normal;
      line-height: 1.4;
      text-align: center;
      pointer-events: auto;
      cursor: default;
      animation: sftp-toast-in 0.18s ease-out;
    }
    @keyframes sftp-toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(6px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .sftp-root .sftp-main {
      flex: 1 1 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;

      overflow: hidden;
      overflow: clip;
      overflow-clip-margin: 4px;
    }

    .sftp-root .sftp-overlays {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 100;
      overflow: visible;
    }
    .sftp-root .sftp-overlays > sftp-delete-dialog,
    .sftp-root .sftp-overlays > sftp-input-dialog,
    .sftp-root .sftp-overlays > sftp-cwd-setup-dialog,
    .sftp-root .sftp-overlays > sftp-bookmark-popup,
    .sftp-root .sftp-overlays > sftp-transfer-log-dialog,
    .sftp-root .sftp-overlays > sftp-conflict-dialog,
    .sftp-root .sftp-overlays > sftp-context-menu,
    .sftp-root .sftp-overlays > sftp-perm-dialog,
    .sftp-root .sftp-overlays > sftp-details-dialog {
      position: absolute;
      inset: 0;
      overflow: visible;
      pointer-events: none;
    }

    .sftp-root .sftp-overlays .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.6);
      z-index: 100;
      pointer-events: auto;
      transition: none !important;
      animation: none !important;
    }
    .sftp-root .sftp-overlays .bookmark-popup,
    .sftp-root .sftp-overlays .context-menu {
      pointer-events: auto;
    }
    .sftp-root:focus,
    .sftp-root:focus-visible {
      outline: none !important;
      box-shadow: none !important;
    }
    .sftp-root .top-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0px 5px 5px 5px;
      background: var(--header-bg, var(--_content));
      border-radius: 8px 8px 0 0;
      flex-shrink: 0;
      border-bottom: 1px solid var(--_border);
    }
    .sftp-root .title { font-weight: 700; color: var(--_primary); font-size: 1.15em; flex-shrink: 0; white-space: nowrap; }

    .sftp-root .host-info {
      font-size: 0.92em; opacity: 0.6; margin-left: 4px;
      flex: 0 1 auto; min-width: 0; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    }

    .sftp-root .disconnect-indicator {
      display: inline-flex; align-items: center; gap: 6px;
      margin-left: 8px; padding: 2px 10px 2px 8px;
      border-radius: 4px;
      background: rgba(239, 68, 68, 0.10);
      border: 1px solid rgba(239, 68, 68, 0.25);
      font-size: 12px;
      flex-shrink: 0;
    }
    .sftp-root .disconnect-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #ef4444; flex-shrink: 0;
      animation: pulse-dot 1.5s ease-in-out infinite;
    }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .sftp-root .disconnect-tag { color: #ef4444; font-weight: 500; }
    .sftp-root .disconnect-indicator .reconnect-btn {
      padding: 1px 8px; border-radius: 3px;
      border: 1px solid rgba(239, 68, 68, 0.4);
      background: transparent;
      color: #ef4444; font-size: 11px; cursor: pointer;
      transition: background 0.12s;
      line-height: 20px;
    }
    .sftp-root .disconnect-indicator .reconnect-btn:hover { background: rgba(239, 68, 68, 0.15); }
    .sftp-root .disconnect-indicator .reconnect-btn:disabled { opacity: 0.4; cursor: default; }
    .sftp-root .top-actions { display: flex; gap: 2px; align-items: center; margin-left: auto; flex-shrink: 0; }
    .sftp-root .btn-link {
      background: none; border: none; color: var(--_text);
      cursor: pointer; border-radius: 4px;
      transition: background 0.15s, opacity 0.15s;
    }
    .sftp-root .btn-link:hover { background: var(--_hover); }

    .sftp-root .top-actions .btn-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      min-width: 28px;
      padding: 0;
      opacity: 0.65;
      line-height: 0;
      box-sizing: border-box;
    }
    .sftp-root .top-actions .btn-icon svg {
      width: 16px;
      height: 16px;
      display: block;
      flex-shrink: 0;
    }
    .sftp-root .top-actions .btn-path-mode svg,
    .sftp-root .top-actions .btn-settings svg {
      width: 17px;
      height: 17px;
    }
    .sftp-root .top-actions .btn-icon:hover { opacity: 1; }
    .sftp-root .top-actions .btn-path-mode:not(.active) { opacity: 0.5; }
    .sftp-root .top-actions .btn-path-mode.active,
    .sftp-root .top-actions .btn-transfer-log.active {
      opacity: 1;
      background: transparent;
    }
    .sftp-root .top-actions .btn-path-mode.active:hover,
    .sftp-root .top-actions .btn-transfer-log.active:hover {
      background: var(--_hover);
    }
    .sftp-root .top-actions .btn-minimize,
    .sftp-root .top-actions .btn-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      min-width: 28px;
      padding: 0;
      box-sizing: border-box;
    }
    .sftp-root .btn-close {
      background: none; border: none; color: var(--_text, var(--text-color, #888));
      cursor: pointer; font-size: 15px; border-radius: 4px;
      line-height: 1;
    }
    .sftp-root .btn-close:hover { background: rgba(244,67,54,0.12); color: #f44336; }


    .sftp-root .sftp-title-menu {
      position: fixed;
      z-index: 901;
      min-width: 176px;
      padding: 4px;
      background: var(--context-menu-background, #2b2b2b);
      color: var(--context-menu-foreground, #e0e0e0);
      border: 1px solid var(--border-color, rgba(255,255,255,0.12));
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      font-size: 12px;
      user-select: none;
    }
    .sftp-root .sftp-title-menu__item {
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
    }
    .sftp-root .sftp-title-menu__item:hover {
      background: var(--border-color, rgba(255,255,255,0.1));
    }


    .sftp-root:not(.workspace-mode) .top-bar { cursor: move; }
    .sftp-root:not(.workspace-mode) .top-bar button,
    .sftp-root:not(.workspace-mode) .top-bar a,
    .sftp-root:not(.workspace-mode) .top-bar .disconnect-indicator { cursor: pointer; }
    .sftp-root:not(.workspace-mode).dragging,
    .sftp-root:not(.workspace-mode).resizing { user-select: none; }
    .sftp-root:not(.workspace-mode).dragging .sftp-main { cursor: move; }
    .sftp-root:not(.workspace-mode).resizing .sftp-main { cursor: nwse-resize; }


    .sftp-root:not(.workspace-mode) .resize-layer {
      position: absolute; inset: 0; z-index: 50; pointer-events: none;
    }
    .sftp-root:not(.workspace-mode) .resize-handle { position: absolute; pointer-events: auto; }
    .sftp-root:not(.workspace-mode) .rh-n  { top: 0; left: 8px; right: 8px; height: 5px; cursor: ns-resize; }
    .sftp-root:not(.workspace-mode) .rh-s  { bottom: 0; left: 8px; right: 8px; height: 5px; cursor: ns-resize; }
    .sftp-root:not(.workspace-mode) .rh-e  { right: 0; top: 8px; bottom: 8px; width: 5px; cursor: ew-resize; }
    .sftp-root:not(.workspace-mode) .rh-w  { left: 0; top: 8px; bottom: 8px; width: 5px; cursor: ew-resize; }
    .sftp-root:not(.workspace-mode) .rh-ne { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }
    .sftp-root:not(.workspace-mode) .rh-nw { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }
    .sftp-root:not(.workspace-mode) .rh-se { bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; }
    .sftp-root:not(.workspace-mode) .rh-sw { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nesw-resize; }
    .sftp-root:not(.workspace-mode) .rh-se::after {
      content: ''; position: absolute; right: 3px; bottom: 3px; width: 9px; height: 9px;
      border-right: 2px solid var(--_border); border-bottom: 2px solid var(--_border); opacity: 0.55;
    }
    .sftp-root:not(.workspace-mode) .resize-handle:hover { background: rgba(128,128,128,0.10); }

  .sftp-root .sftp-body {
      display: flex;
      flex-direction: row;
      gap: 0;
      flex: 1 1 0;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
      border-radius: 8px;
      transition: none !important;
    }

    .sftp-root .pane-splitter {
      flex-shrink: 0;
      width: 5px;
      cursor: ew-resize;
      background: var(--_bg, var(--body-bg, #1e1e2e));
      position: relative;
      z-index: 10;
      transition: none;
    }
    .sftp-root .pane-splitter:hover,
    .sftp-root .pane-splitter.active {
      background: var(--_bg, var(--body-bg, #1e1e2e));
    }
    .sftp-root .pane-splitter::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 3px;
      height: 30px;
      border-radius: 2px;
      background: var(--_primary, #3b82f6);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .sftp-root .pane-splitter:hover::after,
    .sftp-root .pane-splitter.active::after {
      opacity: 1;
    }



    .sftp-root .sftp-body > sftp-file-pane {
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      align-self: stretch;
    }
    .sftp-root sftp-file-pane .pane {
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      overflow: hidden;
    }

    .sftp-root .btn-layout { position: relative; }
    .sftp-root .btn-layout.layout-overridden {
      color: var(--_primary, #3b82f6);
      opacity: 0.95;
    }
    .sftp-root .btn-layout.layout-overridden::after {
      content: '';
      position: absolute;
      right: 1px; bottom: 1px;
      width: 5px; height: 5px;
      border-radius: 50%;
      background: var(--_primary, #3b82f6);
      pointer-events: none;
    }
    .sftp-root .sftp-body.narrow-layout .pane-splitter {
      width: auto;
      height: 5px;
      cursor: ns-resize;
    }
    .sftp-root .sftp-body.narrow-layout .pane-splitter::after {
      width: 30px;
      height: 3px;
    }
    .sftp-root .pane {
      display: flex;
      flex-direction: column;
      position: relative;
      border: 1px solid var(--_border);
      border-radius: 8px;

      min-height: 0;
      min-width: 0;
      transform: translateZ(0);
      transition: none !important;
    }
    .sftp-root .pane-title {
      display: flex;
      gap: 4px; align-items: center; padding: 4px 8px;
      background: var(--_content);
      border-bottom: 1px solid var(--_border);
      border-radius: 8px 8px 0 0;
      min-width: 0;
    }
    .sftp-root .pane-label { font-weight: 600; font-size: 1em; white-space: nowrap; flex-shrink: 0; }
    .sftp-root .pane-path { display: flex; gap: 4px; min-width: 0; overflow: hidden; flex: 1 1 auto; }
    .sftp-root .path-input {
      flex: 1; min-width: 40px; padding: 3px 6px; border-radius: 4px;
      border: 1px solid var(--_border);
      background: var(--input-bg, var(--_input-bg));
      color: var(--_text); font-size: 1em;
      caret-color: var(--_text, currentColor);
      -webkit-text-fill-color: var(--_text, currentColor);
      cursor: text;
      pointer-events: auto;
      user-select: text !important;
      -webkit-user-select: text !important;
      outline: none;
    }
    .sftp-root .path-input:focus,
    .sftp-root .path-input:focus-visible {
      outline: none !important;
      box-shadow: none !important;
    }
    .sftp-root .path-input.path-input--focused {
      border-color: var(--_primary) !important;
    }
    .sftp-root .path-input:not(.path-input--focused) {
      border-color: var(--_border) !important;
      box-shadow: none !important;
    }
    .sftp-root .pane-toolbar-btn {
      padding: 2px 3px; border-radius: 4px;
      border: none;
      background: transparent;
      color: var(--_text); cursor: pointer;
      font-size: 14px; line-height: 1;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sftp-root .pane-toolbar-btn svg {
      width: 16px;
      height: 16px;
      display: block;
      flex-shrink: 0;
    }
    .sftp-root .pane-toolbar-btn:hover { background: var(--_hover); }
    .sftp-root .pane-title .pane-toolbar-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .sftp-root .pane-title .pane-toolbar-btn:disabled:hover {
      background: transparent;
    }
    .sftp-root .pane-title .pane-toolbar-btn.toggle-btn.active { background: var(--_hover); }
    .sftp-root .pane-title .pane-toolbar-btn.bm-btn.active {
      background: var(--_hover);
      color: var(--_primary);
    }

    .sftp-root .pane-toolbar-btn:focus,
    .sftp-root .pane-toolbar-btn:focus-visible,
    .sftp-root .pane-toolbar-btn:active,
    .sftp-root .filter-btn:focus,
    .sftp-root .filter-btn:focus-visible,
    .sftp-root .filter-btn:active,
    .sftp-root .top-actions button:focus,
    .sftp-root .top-actions button:focus-visible,
    .sftp-root .top-actions button:active,
    .sftp-root .btn-close:focus,
    .sftp-root .btn-close:focus-visible,
    .sftp-root .btn-close:active,
    .sftp-root .reconnect-btn:focus,
    .sftp-root .reconnect-btn:focus-visible,
    .sftp-root .reconnect-btn:active {
      outline: none !important;
      box-shadow: none !important;
      -webkit-tap-highlight-color: transparent;
    }
    .sftp-root .pane-actions button {
      padding: 2px 5px; border-radius: 4px;
      border: none;
      background: transparent;
      color: var(--_text); cursor: pointer;
      font-size: 14px; line-height: 1;
    }
    .sftp-root .pane-actions button:hover { background: var(--_hover); }
    .sftp-root .pane-actions button:disabled { opacity: 0.4; cursor: default; }
    .sftp-root .pane-actions .bm-btn { color: var(--_text-muted, inherit); font-weight: 700; font-size: 14px; }
    .sftp-root .pane-actions .bm-btn:hover { background: var(--_hover); }
    .sftp-root .pane-actions .bm-btn.active { background: var(--_hover); color: var(--_primary); }
    .sftp-root .pane-actions .icon-btn { font-size: 14px; min-width: 26px; text-align: center; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .sftp-root .pane-actions .icon-btn svg { display: block; flex-shrink: 0; }
    .sftp-root .pane-actions .toggle-btn { min-width: 26px; padding: 2px 6px; }
    .sftp-root .pane-actions .toggle-btn.active { background: var(--_hover); }

    .sftp-root .pane-filters {
      position: absolute;
      top: 31px;
      left: 0; right: 0;
      z-index: 10;
      display: flex;
      padding: 6px 10px;
      background: var(--_content);
      border: 1px solid var(--_border);
      border-top: none;
      border-radius: 0 0 6px 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      animation: filterFadeIn 0.12s ease;
    }
    @keyframes filterFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sftp-root .filter-input {
      flex: 1; padding: 3px 6px; margin-right: 5px; border-radius: 4px;
      border: 1px solid var(--_border);
      background: var(--input-bg, var(--_input-bg));
      color: var(--_text); font-size: 1em;
      caret-color: var(--_text, currentColor);
      -webkit-text-fill-color: var(--_text, currentColor);
      cursor: text;
      pointer-events: auto;
      user-select: text !important;
      -webkit-user-select: text !important;
      outline: none;
    }
    .sftp-root .filter-input:focus,
    .sftp-root .filter-input:focus-visible {
      border-color: var(--_primary) !important;
      box-shadow: none !important;
      outline: none !important;
    }
    .sftp-root .filter-btn {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; padding: 0; border: none; border-radius: 4px;
      background: transparent; color: var(--_text); cursor: pointer;
      flex-shrink: 0;
    }
    .sftp-root .filter-btn:hover { background: var(--_hover); }
    .sftp-root .filter-confirm { color: #2ecc71; }
    .sftp-root .filter-confirm:hover { background: rgba(46, 204, 113, 0.15); }
    .sftp-root .filter-clear { color: #e74c3c; }
    .sftp-root .filter-clear:hover { background: rgba(231, 76, 60, 0.15); }


    .sftp-root .pane-list-wrap {
      flex: 1 1 0;
      min-height: 0;
      min-width: 0;
      position: relative;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }


    .sftp-root .pane-list {
      flex: 1 1 0;
      min-height: 0;
      height: 0;
      overflow-y: auto; overflow-x: auto;

      min-width: 0;
      padding: 0 10px 10px 10px;

      scrollbar-gutter: stable;

      background: var(--_bg);
      margin: 0;
      position: relative;
      user-select: none;

      scrollbar-width: thin;
      scrollbar-color: var(--_scroll-thumb, rgba(128,128,128,0.35)) var(--_scroll-track, rgba(128,128,128,0.08));
    }

    .sftp-root .pane-list::-webkit-scrollbar { width: 8px; height: 8px; }
    .sftp-root .pane-list::-webkit-scrollbar-track {
      background: var(--_scroll-track, rgba(128,128,128,0.08));
      border-radius: 4px;
    }
    .sftp-root .pane-list::-webkit-scrollbar-thumb {
      background: var(--_scroll-thumb, rgba(128,128,128,0.35));
      border-radius: 4px;
      min-height: 30px;
      min-width: 30px;
      transition: background 0.2s;
    }
    .sftp-root .pane-list::-webkit-scrollbar-thumb:hover {
      background: var(--_scroll-thumb-hover, rgba(128,128,128,0.55));
    }
    .sftp-root .pane-list::-webkit-scrollbar-thumb:active {
      background: var(--_primary, #4dabff);
    }
    .sftp-root .pane-list::-webkit-scrollbar-corner {
      background: var(--_scroll-track, rgba(128,128,128,0.08));
    }

    .sftp-root .rubber-band-rect {
      position: absolute;
      border: 1px dashed rgba(59, 130, 246, 0.7);
      background: rgba(59, 130, 246, 0.12);
      pointer-events: none;
      z-index: 10;
      border-radius: 2px;
    }

    .sftp-root .bookmark-list::-webkit-scrollbar { width: 6px; height: 6px; }
    .sftp-root .bookmark-list::-webkit-scrollbar-track {
      background: var(--_scroll-track, rgba(128,128,128,0.06));
      border-radius: 3px;
    }
    .sftp-root .bookmark-list::-webkit-scrollbar-thumb {
      background: var(--_scroll-thumb, rgba(128,128,128,0.32));
      border-radius: 3px;
    }
    .sftp-root .bookmark-list::-webkit-scrollbar-thumb:hover {
      background: var(--_scroll-thumb-hover, rgba(128,128,128,0.5));
    }
    .sftp-root .entry {
      display: grid;

      grid-template-columns: 24px 200px 80px 140px 70px;
      gap: 4px; padding: 0 8px;
      cursor: pointer; user-select: none;
      align-items: center;
      font-size: 1em;
      line-height: 1.4;
      width: max-content;
      min-width: 100%;
    }
    .sftp-root .entry > span {
      padding: 3px 0;

      min-width: 0;
      contain: inline-size;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sftp-root.has-col-borders .entry > span {
      align-self: stretch;
      display: flex;
      align-items: center;
      min-height: 22px;
    }



    .sftp-root.has-col-borders .entry > span {
      border-right: 1px solid var(--_border, rgba(128,128,128,0.2));
    }


    .sftp-root.has-zebra .entry:not(.header):nth-child(even) { background: var(--_surface); }

    .sftp-root.has-zebra .entry:not(.header):nth-child(even):hover { background: color-mix(in srgb, var(--_primary) 57%, transparent); }

    .sftp-root .entry.selected,
    .sftp-root.has-zebra .entry:not(.header):nth-child(even).selected {
      background: color-mix(in srgb, var(--_primary) 77%, transparent) !important;
    }
    .sftp-root .entry:hover:not(.selected):not(.header) { background: color-mix(in srgb, var(--_primary) 57%, transparent); }

    .sftp-root .entry.hidden-entry > span { opacity: 0.5; }
    .sftp-root .entry.hidden-entry.selected > span,
    .sftp-root .entry.hidden-entry:hover > span { opacity: 0.75; }
    .sftp-root .entry.header {

      background: var(--_content);
      font-weight: 600; font-size: 1em;
      position: sticky; top: 0;
      z-index: 5;
      color: var(--_primary);
      border-bottom: 2px solid var(--_primary);
      padding-top: 6px;
    }

    .sftp-root .entry.header > span { opacity: 1 !important; }



    .sftp-root .entry.group-row {
      display: grid;
      position: static;
      z-index: auto;
      border-bottom: none;
      background: transparent;
      font-weight: 600;
      padding: 0 8px;
      cursor: pointer;
    }

    .sftp-root .entry.group-row > .group-inner {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 2px;
      margin-left: -6px;
      padding: 3px 0;
      min-width: 0;
      contain: none;
      overflow: visible;
      text-overflow: clip;
    }

    .sftp-root .entry.group-row:hover:not(.selected) {
      background: color-mix(in srgb, var(--_primary) 57%, transparent);
    }
    .sftp-root .entry.group-row:hover:not(.selected) > span {
      color: var(--_text);
    }

    .sftp-root .entry.group-row.selected > span { color: var(--_text); opacity: 1; }

    .sftp-root .pane-list.has-groups .entry:not(.header) { margin: 0; }
    .sftp-root .pane-list.has-groups .entry.group-row { margin: 0; }

    .sftp-root.has-zebra .pane-list.has-groups .entry:not(.header):nth-child(even) { background: transparent; }
    .sftp-root.has-zebra .pane-list.has-groups .entry:not(.header):nth-child(even):hover {
      background: color-mix(in srgb, var(--_primary) 57%, transparent);
    }


    .sftp-root .pane-list .entry.nav-focus { box-shadow: inset 3px 0 0 0 var(--_primary); }
    .sftp-root .pane-list .entry.nav-focus:not(.selected) {
      background: color-mix(in srgb, var(--_primary) 30%, transparent);
    }

    .sftp-root .pane-list .entry.group-row.nav-focus > span { color: var(--_text); opacity: 1; }

    .sftp-root .pane-list .entry.group-row.partial {
      background: color-mix(in srgb, var(--_primary) 40%, transparent);
    }
    .sftp-root .pane-list .entry.group-row.partial > span { color: var(--_text); opacity: 1; }
    .sftp-root .group-chevron {
      flex: none; width: 12px; text-align: center;
      cursor: pointer; opacity: 0.8; user-select: none;
    }
    .sftp-root .group-chevron:hover { opacity: 1; color: var(--_primary); }
    .sftp-root .group-label { flex: 0 1 auto; }
    .sftp-root .group-count { flex: none; opacity: 0.55; font-weight: 400; }

    .sftp-root .name, .sftp-root .size, .sftp-root .date, .sftp-root .perms, .sftp-root .mode, .sftp-root .access, .sftp-root .owner, .sftp-root .group, .sftp-root .path, .sftp-root .ext {
      position: relative;
      min-width: 0;
    }
    .sftp-root .col-resize-handle {
      position: absolute;
      right: -1.5px;
      top: 0;
      bottom: 0;
      width: 3px;
      cursor: col-resize;
      z-index: 10;
      background: transparent;
      border-radius: 1px;
      transition: background 0.15s;
    }
    .sftp-root .col-resize-handle:hover,
    .sftp-root .col-resize-handle.resizing {
      background: var(--_primary, #4dabff);
      opacity: 0.7;
    }
    .sftp-root .entry.up-entry { opacity: 0.6; }
    .sftp-root .entry.dim { opacity: 0.5; }


    .sftp-root .icon {
      text-align: center; font-size: 1.08em; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      position: relative;
      justify-self: end;
      width: max-content;
    }

    .sftp-root .entry > span.icon { contain: none; overflow: visible; }
    .sftp-root .icon .custom-file-icon { width: 1.23em; height: 1.23em; object-fit: contain; flex-shrink: 0; }

    .sftp-root .icon .link-badge {
      position: absolute; left: -1px; bottom: 1px;
      width: 12px; height: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--_bg, var(--body-bg, #1e1e1e));
      border: 1px solid var(--_border, rgba(128,128,128,0.3));
      border-radius: 50%;
      color: var(--_primary, #4dabff);
      pointer-events: none;
    }
    .sftp-root .icon .link-badge svg { width: 9px; height: 9px; display: block; }
    .sftp-root .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1em; font-family: inherit; }
    .sftp-root .size { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; text-align: left; }
    .sftp-root .date { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; }
    .sftp-root .perms { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; text-align: left; }
    .sftp-root .mode { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; text-align: left; }
    .sftp-root .access { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; }
    .sftp-root .owner { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; text-align: left; }
    .sftp-root .group { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; text-align: left; }
    .sftp-root .path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; }
    .sftp-root .ext { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1em; font-family: inherit; text-align: left; }
    .sftp-root .sortable { cursor: pointer; display: inline-flex; align-items: center; gap: 2px; }
    .sftp-root .entry.header > span.sortable:not(.name) { cursor: grab; }
    .sftp-root .entry.header > span.sortable.header-col-dragging { cursor: grabbing; }

    .sftp-root .entry.header > span.sortable:hover,
    .sftp-root .entry.header > span.sortable.header-col-resizing {
      align-self: stretch;
      display: inline-flex;
      align-items: center;
      background: color-mix(in srgb, var(--_primary) 16%, transparent);
      color: var(--_primary);
      border-right: 1px solid color-mix(in srgb, var(--_primary) 60%, var(--_border, rgba(128,128,128,0.25)));
      z-index: 2;
      padding-left: 2px;
      padding-right: 2px;
      margin-left: -2px;
      margin-right: -2px;
    }
    .sftp-root .entry.header > span.sortable:hover .col-resize-handle,
    .sftp-root .entry.header > span.sortable.header-col-resizing .col-resize-handle {
      background: var(--_primary, #4dabff);
      opacity: 0.9;
    }

    .sftp-root .entry.header > span.sortable.header-col-dragging {
      opacity: 0.28;
      color: var(--_primary);
      background: color-mix(in srgb, var(--_primary) 10%, transparent);
    }

    .sftp-root .entry.header > span.sortable.header-col-drop-before,
    .sftp-root .entry.header > span.sortable.header-col-drop-after {
      position: relative;
    }
    .sftp-root .entry.header > span.sortable.header-col-drop-before::before,
    .sftp-root .entry.header > span.sortable.header-col-drop-after::after {
      content: '';
      position: absolute;
      top: 1px;
      bottom: 1px;
      width: 2px;
      background: var(--_primary, #4dabff);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--_primary) 30%, transparent);
      border-radius: 2px;
      pointer-events: none;
      z-index: 12;
    }
    .sftp-root .entry.header > span.sortable.header-col-drop-before::before { left: -2px; }
    .sftp-root .entry.header > span.sortable.header-col-drop-after::after { right: -2px; }
    .sftp-root.col-header-reordering,
    .sftp-root.col-header-reordering * {
      user-select: none !important;
      cursor: grabbing !important;
    }

    .header-col-ghost {
      display: inline-flex !important;
      align-items: center;
      gap: 2px;
      padding: 4px 8px !important;
      border-radius: 4px;
      background: color-mix(in srgb, var(--primary-color, #3b82f6) 18%, var(--content-bg, #1e1e2e)) !important;
      color: var(--primary-color, #3b82f6) !important;
      border: 1px solid color-mix(in srgb, var(--primary-color, #3b82f6) 55%, transparent) !important;
      box-shadow: 0 6px 16px rgba(0,0,0,0.28);
      opacity: 0.95;
      font-weight: 600;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      transform: translateY(-1px) rotate(-0.5deg);
    }
    .header-col-ghost .col-resize-handle { display: none !important; }
    .sftp-root .sortable:hover { color: var(--_primary); }
    .sftp-root .sort-arrow { font-size: 11px; opacity: 1; margin-left: 1px; }
    .sftp-root .pane-empty { padding: 20px; text-align: center; opacity: 0.4; font-size: 1em; }


    .sftp-root .pane-loading {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--_bg, var(--body-bg, #1e1e2e)) 92%, transparent);
      pointer-events: none;
    }
    .sftp-root .pane-loading .spinner {
      width: 20px; height: 20px;
      border: 2px solid var(--_border, rgba(128,128,128,0.2));
      border-top: 2px solid var(--_primary, #3b82f6);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    .sftp-root .pane-loading-active { overflow: hidden !important; }
    @keyframes spin { to { transform: rotate(360deg); } }


    .sftp-root .pane-flash {
      animation: flash 0.25s ease-out;
    }
    @keyframes flash {
      0% { background-color: transparent; }
      30% { background-color: rgba(59,130,246,0.06); }
      100% { background-color: transparent; }
    }


    .sftp-root .pane-list-wrap.pane-drag-over .pane-list {
      background-color: color-mix(in srgb, var(--primary-color, #3b82f6) 8%, transparent);
      background-color: rgba(59,130,246,0.08); /* fallback */
    }
    .sftp-root .pane-list-wrap.pane-drag-over::after {
      content: '';
      position: absolute;
      inset: 0;
      border: 2px solid var(--primary-color, #3b82f6);
      border-radius: 0;
      pointer-events: none;
      z-index: 6;
    }

    .sftp-root .pane-actions-bar {
      display: flex; align-items: center;
      padding: 4px 8px; border-top: 1px solid var(--_border);
      background: var(--_content);
      flex-shrink: 0;
      border-radius: 0 0 8px 8px;
    }
    .sftp-root .selection-info { font-size: 1em; opacity: 0.7; min-width: 60px; }
    .sftp-root .size-hint { opacity: 0.5; font-size: 0.85em; }
    .sftp-root .action-buttons { display: flex; gap: 3px; margin-left: auto; }
    .sftp-root .action-buttons button {
      padding: 2px 6px; border-radius: 4px;
      border: 1px solid var(--_border);
      background: var(--_content);
      color: var(--_text); cursor: pointer; font-size: 12px;
    }
    .sftp-root .action-buttons button:hover { background: var(--_hover); }
    .sftp-root .action-buttons button:disabled { opacity: 0.4; cursor: default; }

    .sftp-root .overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;

      transition: none !important;
      animation: none !important;
    }

    .sftp-root .overlay.sftp-delete-overlay,
    .sftp-root sftp-delete-dialog .overlay {
      z-index: 120;
    }
    .sftp-root .dialog {
      background: var(--_bg);
      border: 1px solid var(--_border);
      border-radius: 10px; padding: 16px; min-width: 280px; max-width: 92vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    }
    .sftp-root .dialog-text { margin-bottom: 12px; }
    .sftp-root .dialog-title { display:flex; align-items:center; justify-content:space-between; font-weight: 700; margin-bottom: 12px; color: var(--_primary); }
    .sftp-root .dialog-close { font-size:18px; line-height:1; padding:0 2px; opacity:.6; }
    .sftp-root .dialog-close:hover { opacity:1; }
    .sftp-root .dialog-input {
      width: 100%; padding: 6px 8px; border-radius: 6px;
      border: 1px solid var(--_border);
      background: var(--_input-bg);
      color: var(--_text); font-size: 1em;
      caret-color: var(--_text, currentColor);
      -webkit-text-fill-color: var(--_text, currentColor);
      cursor: text;
      user-select: text !important;
      -webkit-user-select: text !important;
      margin-bottom: 12px; box-sizing: border-box; outline: none;
    }
    .sftp-root .dialog-input:focus,
    .sftp-root .dialog-input:focus-visible {
      border-color: var(--_primary) !important;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35) !important;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--_primary) 35%, transparent) !important;
      outline: none !important;
    }
    .sftp-root .dialog-buttons { display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; }
    .sftp-root .dialog-buttons button {
      padding: 4px 12px; border-radius: 6px;
      border: 1px solid var(--_border);
      background: var(--_content);
      color: var(--_text); cursor: pointer;
    }
    .sftp-root .danger { background: #d32f2f !important; border-color: #ef5350 !important; }

    .sftp-root .delete-dialog {
      background: var(--_bg);
      border: 1px solid var(--_border);
      border-radius: 12px; padding: 20px; min-width: 340px; max-width: 420px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .sftp-root .delete-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .sftp-root .delete-header-icon { flex-shrink: 0; width: 14px !important; height: 14px !important; }
    .sftp-root .delete-warn-icon { flex-shrink: 0; width: 18px !important; height: 18px !important; }
    .sftp-root .delete-title { font-size: 15px; font-weight: 600; color: var(--_text); }
    .sftp-root .delete-text { font-size: 13px; color: var(--_text); margin-bottom: 12px; opacity: 0.85; }
    .sftp-root .delete-preview {
      border: 1px solid var(--_border);
      border-radius: 8px; padding: 12px; margin-bottom: 16px;
      background: var(--_content);
    }
    .sftp-root .delete-preview-row {
      display: flex; align-items: center; gap: 8px;
      font-size: 12px; padding: 2px 0;
    }
    .sftp-root .delete-preview-row + .delete-preview-row { margin-top: 3px; }
    .sftp-root .delete-preview-icon { flex-shrink: 0; color: var(--_text); opacity: 0.6; }
    .sftp-root .delete-preview-name { font-weight: 500; color: var(--_text); }
    .sftp-root .delete-preview-label { color: var(--_text); opacity: 0.5; min-width: 60px; }
    .sftp-root .delete-preview-value { color: var(--_text); }

    .sftp-root .bookmark-popup {
      position: absolute;
      width: 320px;
      max-height: 420px;
      box-sizing: border-box;
      display: flex; flex-direction: column;
      background: var(--_bg);
      border: 1px solid var(--_border);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      z-index: 200;
      overflow: visible;
      transform: translateZ(0);
      transition: none !important;
      animation: none !important;
    }
    .sftp-root .popup-arrow {
      position: absolute; top: -7px;
      width: 12px; height: 12px;
      background: var(--_bg);
      border-left: 1px solid var(--_border);
      border-top: 1px solid var(--_border);
      transform: rotate(45deg);
      z-index: 1;
      pointer-events: none;
    }
    .sftp-root .popup-title {
      padding: 10px 14px 6px;
      font-weight: 700; color: var(--_primary); font-size: 13px;
    }
    .sftp-root .popup-footer {
      display: flex; justify-content: flex-end;
      padding: 6px 10px; border-top: 1px solid var(--_border);
    }
    .sftp-root .popup-footer button {
      padding: 4px 10px; border-radius: 6px; font-size: 11px;
      border: 1px solid var(--_border);
      background: var(--_content);
      color: var(--_text); cursor: pointer;
    }
    .sftp-root .popup-footer button:hover { background: var(--_hover); }
    .sftp-root .bookmark-add-btns { display: flex; gap: 6px; padding: 0 14px 10px; }
    .sftp-root .add-btn {
      display: flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: 6px; font-size: 12px;
      border: 1px solid var(--_border);
      background: var(--_content);
      color: var(--_text); cursor: pointer;
    }
    .sftp-root .add-btn:hover { background: var(--_hover); }
    .sftp-root .add-btn.active { border-color: var(--_primary); background: rgba(59,130,246,0.08); }
    .sftp-root .add-icon { font-weight: 700; font-size: 14px; color: var(--_primary); }
    .sftp-root .bookmark-add-form {
      display: flex; flex-direction: column; gap: 6px;
      padding: 0 10px 10px;
    }
    .sftp-root .bookmark-add-form .bm-form-row {
      display: flex; gap: 6px; align-items: center;
    }
    .sftp-root .bookmark-add-form input {
      width: 100%; padding: 6px 8px; border-radius: 4px;
      border: 1px solid var(--_border);
      background: var(--_input-bg);
      color: var(--_text); font-size: 1em;
      caret-color: var(--_text, currentColor);
      -webkit-text-fill-color: var(--_text, currentColor);
      cursor: text;
      user-select: text !important;
      -webkit-user-select: text !important;
      box-sizing: border-box; outline: none;
    }
    .sftp-root .bookmark-add-form input:focus,
    .sftp-root .bookmark-add-form input:focus-visible {
      border-color: var(--_primary) !important;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35) !important;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--_primary) 35%, transparent) !important;
      outline: none !important;
    }
    .sftp-root .bookmark-add-form .btn-confirm {
      align-self: flex-end;
      padding: 6px 16px; border-radius: 4px;
      border: 1px solid var(--_primary);
      background: var(--_primary);
      color: #fff; cursor: pointer; font-size: 12px; white-space: nowrap;
    }
    .sftp-root .bookmark-add-form .btn-confirm:disabled { opacity: 0.4; }
    .sftp-root .bookmark-scope-label {
      padding: 4px 10px 2px; font-size: 10px; font-weight: 600;
      color: var(--_primary); opacity: 0.6; text-transform: uppercase;
      border-bottom: 1px solid var(--_border); margin-bottom: 2px;
    }
    .sftp-root .bookmark-list {
      flex: 1; overflow-y: auto; min-height: 0;
      padding: 0 4px;
      scrollbar-width: thin;
      scrollbar-color: var(--_scroll-thumb, rgba(128,128,128,0.35)) var(--_scroll-track, rgba(128,128,128,0.06));
    }
    .sftp-root .bookmark-empty {
      padding: 24px 8px; text-align: center;
      font-size: 12px; opacity: 0.4; color: var(--_text);
    }
    .sftp-root .bookmark-item {
      display: flex; align-items: center; gap: 8px;
      padding: 5px 8px; border-radius: 6px; margin: 1px 0;
      cursor: pointer; transition: background 0.1s, opacity 0.15s;
    }
    .sftp-root .bookmark-item:hover { background: var(--_hover); }
    .sftp-root .bookmark-item.dragging { opacity: 0.4; }
    .sftp-root .bookmark-item.drag-over-top {
      border-top: 2px solid var(--_primary);
      padding-top: 3px;
    }
    .sftp-root .bookmark-item.drag-over-bottom {
      border-bottom: 2px solid var(--_primary);
      padding-bottom: 3px;
    }
    .sftp-root .bm-drag-handle {
      flex-shrink: 0; font-size: 14px; line-height: 1; color: var(--_text-muted);
      cursor: grab; opacity: 0.5; user-select: none; letter-spacing: -2px;
    }
    .sftp-root .bm-drag-handle:hover { opacity: 0.8; }
    .sftp-root .bm-info {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; gap: 1px;
    }
    .sftp-root .bm-name {
      font-size: 13px; font-weight: 500; color: var(--_text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sftp-root .bm-path {
      font-size: 10px; color: var(--_text); opacity: 0.45;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sftp-root .bm-remove {
      flex-shrink: 0; width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      border: none; border-radius: 4px; background: transparent;
      color: var(--_text); opacity: 0.3; font-size: 12px;
      cursor: pointer; line-height: 1;
    }
    .sftp-root .bm-remove:hover { opacity: 0.8; background: var(--_hover); }

    .sftp-root .context-menu {
      position: fixed;
      z-index: 902;
      background: var(--_bg);
      border: 1px solid var(--_border);
      border-radius: 6px;
      padding: 4px 0;
      min-width: 140px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    }
    .sftp-root .ctx-item {
      padding: 5px 14px;
      cursor: pointer;
      font-size: 12px;
      color: var(--_text);
      white-space: nowrap;
    }
    .sftp-root .ctx-check {
      display: inline-block;
      width: 14px;
      text-align: center;
    }
    .sftp-root .ctx-item:hover {
      background: var(--_hover);
    }
    .sftp-root .ctx-item.ctx-danger:hover {
      background: rgba(244,67,54,0.15);
      color: #f44336;
    }
    .sftp-root .ctx-sep {
      height: 1px;
      background: var(--_border, #334155);
      margin: 3px 0;
    }
    .sftp-root .ctx-item.ctx-disabled {
      cursor: default;
      opacity: 0.5;
    }
    .sftp-root .ctx-item.ctx-disabled:hover {
      background: transparent;
    }
    .sftp-root .ctx-shortcut {
      float: right;
      margin-left: 20px;
      opacity: 0.5;
      font-size: 11px;
    }
    .sftp-root .mode { font-size: 1em; font-family: inherit; text-align: left; }

    .sftp-root .details-dialog { min-width: 400px; max-width: 500px; }
    .sftp-root .details-body { margin: 8px 0; }
    .sftp-root .details-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .sftp-root .details-table td { padding: 4px 6px; vertical-align: top; border-bottom: 1px solid var(--_border, #334155); }
    .sftp-root .dt-label { width: 80px; opacity: 0.7; white-space: nowrap; }
    .sftp-root .dt-value { word-break: break-all; }
    .sftp-root .dt-path { font-family: monospace; font-size: 11px; }

    .sftp-root .perm-dialog { min-width: 360px; }
    .sftp-root .perm-target-name {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      padding: 4px 8px;
      border-radius: 4px;
      background: var(--_input-bg);
      word-break: break-all;
    }
    .sftp-root .perm-grid {
      display: grid;
      grid-template-columns: 80px repeat(3, auto);
      gap: 8px;
      align-items: center;
      justify-items: center;
      margin: 12px 0;
    }
    .sftp-root .perm-header {
      text-align: center;
      font-size: 12px;
      font-weight: 600;
      color: var(--_primary);
    }
    .sftp-root .perm-label {
      font-size: 12px;
      font-weight: 600;
      justify-self: start;
    }
    .sftp-root .perm-grid input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: var(--_primary);
      cursor: pointer;
    }
    .sftp-root .perm-preview {
      font-family: monospace;
      font-size: 13px;
      padding: 6px 8px;
      border-radius: 4px;
      background: var(--_input-bg);
      border: 1px solid var(--_border);
      color: var(--_text);
      margin-bottom: 12px;
    }

    .sftp-root sftp-transfer-queue {
      display: contents;
      flex-shrink: 0;
    }


    .sftp-root input[type="text"],
    .sftp-root input:not([type]),
    .sftp-root textarea {
      caret-color: var(--_text, currentColor) !important;
      color: var(--_text, inherit) !important;
      -webkit-text-fill-color: var(--_text, currentColor) !important;
    }
    .sftp-root input[type="text"]::placeholder,
    .sftp-root input:not([type])::placeholder,
    .sftp-root textarea::placeholder {
      color: var(--_text, inherit) !important;
      opacity: 0.45;
    }
    .sftp-root input[type="text"]::-webkit-input-placeholder,
    .sftp-root input:not([type])::-webkit-input-placeholder,
    .sftp-root textarea::-webkit-input-placeholder {
      color: var(--_text, inherit) !important;
      opacity: 0.45;
    }
    .sftp-root .log-toolbar select {
      color: var(--_text, inherit) !important;
      background: var(--_content, var(--_bg)) !important;
    }
    .sftp-root .log-toolbar select:focus,
    .sftp-root .log-toolbar select:focus-visible {
      border-color: var(--_primary, #3b82f6) !important;
      box-shadow: 0 0 0 1px var(--_primary, #3b82f6) !important;
      outline: none !important;
    }
  `

export const FILE_DIALOG_SHARED_STYLES = `
  .overlay {

    position: absolute; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 110;
    transition: none !important; animation: none !important;
  }
  .dialog {
    background: var(--_bg);
    border: 1px solid var(--_border);
    border-radius: 10px; padding: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    display: flex; flex-direction: column;
    box-sizing: border-box;
  }
  .file-dialog-shell {
    width: min(900px, 92vw);
    height: min(80vh, 720px);
    max-width: 100%;
    max-height: 100%;


  }
  .file-dialog-shell.is-maximized {
    width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
  .dialog-title {
    display: flex; align-items: center; justify-content: space-between;
    font-weight: 700; margin-bottom: 6px; color: var(--_primary);
    gap: 12px; flex-shrink: 0;
  }
  .file-dialog-window-btns {
    display: flex; align-items: center; gap: 2px; flex-shrink: 0;
  }
  .file-dialog-win-btn {
    box-sizing: border-box;
    flex: 0 0 28px;
    width: 28px; height: 28px;
    min-width: 28px; min-height: 28px;
    max-width: 28px; max-height: 28px;
    margin: 0; padding: 0;
    border: none; border-radius: 6px;
    background: transparent; color: var(--_text);
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer;
    line-height: 0;
    font-size: 0;
  }
  .file-dialog-win-btn:hover { background: var(--_hover); }
  .file-dialog-win-btn:disabled { opacity: 0.45; cursor: default; }
  .file-dialog-win-btn:disabled:hover { background: transparent; }
  .file-dialog-win-btn svg {
    width: 12px; height: 12px;
    display: block;
    flex-shrink: 0;
  }
  .file-dialog-title {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 13px; flex: 1; min-width: 0;
  }
  .file-dialog-path {
    font-size: 11px; font-family: monospace;
    opacity: 0.65; margin-bottom: 8px;
    word-break: break-all; flex-shrink: 0;
  }
  .file-dialog-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--_border);
    border-radius: 6px;
    background: var(--_content);
    display: flex;
    flex-direction: column;
    scrollbar-width: thin;
    scrollbar-color: var(--_scroll-thumb, rgba(128,128,128,0.4)) var(--_scroll-track, rgba(128,128,128,0.08));
  }
  .file-dialog-body::-webkit-scrollbar,
  .file-dialog-textarea::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .file-dialog-body::-webkit-scrollbar-track,
  .file-dialog-textarea::-webkit-scrollbar-track {
    background: var(--_scroll-track, rgba(128,128,128,0.08));
    border-radius: 4px;
    margin: 2px;
  }
  .file-dialog-body::-webkit-scrollbar-thumb,
  .file-dialog-textarea::-webkit-scrollbar-thumb {
    background: var(--_scroll-thumb, rgba(128,128,128,0.38));
    border-radius: 4px;
    min-height: 28px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  .file-dialog-body::-webkit-scrollbar-thumb:hover,
  .file-dialog-textarea::-webkit-scrollbar-thumb:hover {
    background: var(--_scroll-thumb-hover, rgba(128,128,128,0.55));
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  .file-dialog-body::-webkit-scrollbar-thumb:active,
  .file-dialog-textarea::-webkit-scrollbar-thumb:active {
    background: var(--_primary, #4dabff);
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  .file-dialog-body::-webkit-scrollbar-corner,
  .file-dialog-textarea::-webkit-scrollbar-corner {
    background: transparent;
  }
  .file-dialog-status {
    padding: 24px; text-align: center; font-size: 13px;
  }

  .file-dialog-loading {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--_content, var(--body-bg, #1e1e2e)) 92%, transparent);
    pointer-events: none;
  }
  .file-dialog-loading .spinner {
    width: 24px; height: 24px;
    border: 3px solid var(--_border, rgba(128,128,128,0.25));
    border-top-color: var(--_primary, #4dabff);
    border-radius: 50%;
    animation: sftp-dialog-spin 0.7s linear infinite;
  }
  @keyframes sftp-dialog-spin { to { transform: rotate(360deg); } }
  .file-dialog-error { color: #f44336; }
  .file-dialog-text {
    margin: 0; padding: 12px;
    font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
    color: var(--_text);
    user-select: text;
    flex: 0 0 auto;
  }
  .file-dialog-textarea {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    height: 100%;
    padding: 12px;
    box-sizing: border-box;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--_text);
    font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px; line-height: 1.5;
    resize: none;
    outline: none;
    caret-color: var(--_text, currentColor);
    user-select: text !important;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--_scroll-thumb, rgba(128,128,128,0.4)) var(--_scroll-track, rgba(128,128,128,0.08));
  }

  .file-dialog-textarea:focus {
    box-shadow: inset 0 0 0 1px var(--_primary);
  }

  .file-dialog-editor-wrap {
    display: flex;
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    border-radius: 6px;
  }
  .file-dialog-editor-wrap:focus-within {
    box-shadow: inset 0 0 0 1px var(--_primary);
  }
  .file-dialog-editor-gutter {
    flex: 0 0 auto;
    box-sizing: content-box;
    height: 100%;
    overflow: hidden;
    padding: 12px 16px 12px 8px;
    border-right: 1px solid var(--_border, rgba(128,128,128,0.5));
    margin-right: 0;
    text-align: right;
    color: var(--_text-muted, rgba(128,128,128,0.85));
    font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 18px;
    white-space: pre;
    user-select: none;
    pointer-events: none;
    background: transparent;
  }
  .file-dialog-editor-wrap .file-dialog-textarea {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    padding-left: 16px;
    white-space: pre;
    overflow: auto;
    border-radius: 0;
  }

  .file-dialog-editor-wrap .file-dialog-textarea:focus {
    box-shadow: none;
  }

  .file-dialog-vs {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    height: 100%;
    padding: 12px;
    box-sizing: border-box;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--_text);
    font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 18px;
    outline: none;
    overflow: auto;
    overscroll-behavior: contain;
    position: relative;
    cursor: text !important;
    caret-color: var(--_text, currentColor);
    user-select: text !important;
    scrollbar-width: thin;
    scrollbar-color: var(--_scroll-thumb, rgba(128,128,128,0.4)) var(--_scroll-track, rgba(128,128,128,0.08));
  }
  .file-dialog-vs:focus {
    box-shadow: inset 0 0 0 1px var(--_primary);
  }
  .file-dialog-vs-inner {
    position: relative;
    width: 100%;
    box-sizing: border-box;
  }

  .file-dialog-vs-caret {
    position: absolute;
    z-index: 2;
    width: 2px;
    height: 18px;
    background: var(--_text, #e5e5e5);
    pointer-events: none;
    animation: file-dialog-vs-caret-blink 1.06s step-end infinite;
  }

  .file-dialog-vs-caret.is-block {
    mix-blend-mode: difference;
  }
  @keyframes file-dialog-vs-caret-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .file-dialog-vs-window {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    will-change: transform;
  }
  .file-dialog-vs-line {
    display: flex;
    align-items: stretch;
    height: 18px;
    line-height: 18px;
  }
  .file-dialog-vs-gutter {
    flex: 0 0 auto;

    box-sizing: content-box;
    padding: 0 16px 0 8px;
    border-right: 1px solid var(--_border, rgba(128,128,128,0.5));
    text-align: right;
    color: var(--_text-muted, rgba(128,128,128,0.85));
    user-select: none;
    pointer-events: none;
  }
  .file-dialog-vs-text {
    flex: 1 1 auto;
    min-width: 0;
    padding-left: 16px;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text !important;
  }
  .file-dialog-vs-text-nogutter {
    padding-left: 0;
  }
  .file-dialog-image-wrap {
    display: flex; align-items: center; justify-content: center;
    padding: 12px; min-height: 0; flex: 1;
    position: relative;
  }
  .file-dialog-image {
    max-width: 100%; max-height: 100%;
    object-fit: contain;
  }
  .image-nav {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px;
    padding: 5px 10px; border-radius: 999px;
    background: var(--_content); border: 1px solid var(--_border);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    z-index: 5;
  }
  .image-nav-btn {
    width: 30px; height: 30px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--_border); border-radius: 50%;
    background: transparent; color: var(--_text); cursor: pointer;
  }
  .image-nav-btn svg { width: 16px; height: 16px; }
  .image-nav-btn:hover:not(:disabled) { background: var(--_hover); }
  .image-nav-btn:disabled { opacity: 0.4; cursor: default; }
  .image-nav-pos { font-size: 12px; color: var(--_text); min-width: 52px; text-align: center; user-select: none; }
  .dialog-buttons {
    display: flex; justify-content: flex-end; align-items: center; gap: 8px;
    padding-top: 10px; flex-shrink: 0;
  }
  .dialog-buttons-left {
    margin-right: auto;
    display: flex; gap: 8px; align-items: center;
  }
  .dialog-buttons .file-dialog-system-btn {
    padding: 4px 12px; border-radius: 6px;
    border: 1px solid var(--_border);
    background: var(--_content);
    color: var(--_text); cursor: pointer;
    font-size: 12px; white-space: nowrap;
  }
  .dialog-buttons .file-dialog-system-btn:hover:not(:disabled) { background: var(--_hover); }
  .dialog-buttons .file-dialog-system-btn:disabled { opacity: 0.45; cursor: default; }
  .dialog-buttons button {
    padding: 4px 12px; border-radius: 6px;
    border: 1px solid var(--_border);
    background: var(--_content);
    color: var(--_text); cursor: pointer;
  }
  .dialog-buttons button:disabled { opacity: 0.45; cursor: default; }
  .dialog-buttons .btn-primary {
    background: var(--_primary, #3b82f6);
    border-color: var(--_primary, #3b82f6);
    color: #fff;
  }
  .file-dialog-title-wrap {
    display: flex; align-items: center; gap: 4px;
    flex: 1; min-width: 0;
  }

  .editor-dirty {
    color: #f59e0b;
    font-weight: 700;
    font-size: inherit;
    margin-left: 2px;
  }

  .editor-body {
    overflow: hidden;
  }
`
