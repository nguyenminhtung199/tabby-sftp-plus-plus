import { SFTP_PLUS_TOGGLE_HOTKEY } from './hotkey-provider'

export type HotkeyBinding = string | string[]

const _hotkeyState = (() => {
  let active = false
  return {
    get: () => active,
    set: (v: boolean) => { active = v },
  }
})()

export function setHotkeyRecordingActive(active: boolean): void {
  _hotkeyState.set(active)
}

export function isHotkeyRecordingActive(): boolean {
  return _hotkeyState.get()
}

const META_NAME =
  typeof process !== 'undefined' && process.platform === 'darwin' ? '⌘'
    : typeof process !== 'undefined' && process.platform === 'win32' ? 'Win'
      : 'Super'
const ALT_NAME =
  typeof process !== 'undefined' && process.platform === 'darwin' ? '⌥' : 'Alt'
const MOD_ORDER = ['Ctrl', META_NAME, ALT_NAME, 'Shift']

const CODE_MAP: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Space: 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

export function getKeyName(event: KeyboardEvent): string | null {
  const key = event.key
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null
  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (CODE_MAP[event.code]) return CODE_MAP[event.code]
  let code = event.code || key
  code = code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '')
  return code || null
}

export function getKeystrokeNameFromEvent(event: KeyboardEvent): string | null {
  const main = getKeyName(event)
  if (!main) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push(META_NAME)
  if (event.altKey) parts.push(ALT_NAME)
  if (event.shiftKey) parts.push('Shift')

  const ordered = [
    ...MOD_ORDER.filter(m => parts.includes(m)),
    main,
  ]
  return ordered.join('-')
}

export function toHotkeyIdentifier(hotkey: HotkeyBinding): string {
  return Array.isArray(hotkey) ? hotkey.join('$#!') : String(hotkey)
}

export function formatHotkeyBinding(hotkey: HotkeyBinding): string {
  return Array.isArray(hotkey) ? hotkey.join(' › ') : String(hotkey)
}

export function flattenHotkeys(
  store: Record<string, unknown> | null | undefined,
  prefix = '',
): Record<string, HotkeyBinding[]> {
  const out: Record<string, HotkeyBinding[]> = {}
  if (!store || typeof store !== 'object') return out
  for (const [key, value] of Object.entries(store)) {
    const id = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(value)) {
      out[id] = value as HotkeyBinding[]
    } else if (value && typeof value === 'object') {
      Object.assign(out, flattenHotkeys(value as Record<string, unknown>, id))
    }
  }
  return out
}

export function findHotkeyConflicts(
  candidate: HotkeyBinding,
  storeHotkeys: Record<string, unknown> | null | undefined,
  selfId: string = SFTP_PLUS_TOGGLE_HOTKEY,
): string[] {
  const needle = toHotkeyIdentifier(candidate)
  if (!needle) return []
  const flat = flattenHotkeys(storeHotkeys)
  const hits: string[] = []
  for (const [id, bindings] of Object.entries(flat)) {
    if (id === selfId) continue
    for (const binding of bindings) {
      if (toHotkeyIdentifier(binding) === needle) hits.push(id)
    }
  }
  return hits
}

export function readToggleHotkeyBindings(
  storeHotkeys: Record<string, unknown> | null | undefined,
): HotkeyBinding[] {
  const raw = storeHotkeys?.[SFTP_PLUS_TOGGLE_HOTKEY]
  if (!raw) return []
  if (Array.isArray(raw)) return raw as HotkeyBinding[]
  return [raw as HotkeyBinding]
}

export interface PanelHotkeyParsed {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export function parsePanelHotkeyKey(spec: string): PanelHotkeyParsed | null {
  if (!spec || !spec.trim()) return null
  const tokens = spec.trim().split('+')
  const key = tokens[tokens.length - 1].trim()
  if (!key) return null
  const mods = tokens.slice(0, -1).map(m => m.trim().toLowerCase())
  return {
    key,
    ctrl: mods.includes('ctrl'),
    alt: mods.includes('alt'),
    shift: mods.includes('shift'),
    meta: mods.includes('meta') || mods.includes('cmd') || mods.includes('win'),
  }
}

export function matchPanelHotkeyKey(event: KeyboardEvent, spec: string): boolean {
  const p = parsePanelHotkeyKey(spec)
  if (!p) return false
  if (event.ctrlKey !== p.ctrl) return false
  if (event.altKey !== p.alt) return false
  if (event.shiftKey !== p.shift) return false
  if (event.metaKey !== p.meta) return false

  const ek = event.key
  if (p.key === 'Space') return ek === ' '
  if (p.key.length === 1) return ek.toLowerCase() === p.key.toLowerCase()
  return ek === p.key
}

export function formatPanelHotkeyKey(spec: string, placeholder = '—'): string {
  if (spec === ' ') return 'Space'
  return spec && spec.trim() ? spec.trim() : placeholder
}

export function eventToPanelHotkeySpec(event: KeyboardEvent): string | null {
  if (event.key === 'Control' || event.key === 'Meta' || event.key === 'Alt' || event.key === 'Shift') return null
  const main = event.key === ' ' ? 'Space' : (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Meta')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(main)
  return parts.join('+')
}

export function panelHotkeySpecToTabbyBinding(spec: string): string | null {

  if (!spec || isPointerHotkeySpec(spec)) return null
  const p = parsePanelHotkeyKey(spec)
  if (!p) return null
  const parts: string[] = []
  if (p.ctrl) parts.push('Ctrl')
  if (p.meta) parts.push(META_NAME)
  if (p.alt) parts.push(ALT_NAME)
  if (p.shift) parts.push('Shift')
  parts.push(p.key.length === 1 ? p.key.toUpperCase() : p.key)
  return parts.join('-')
}

export const MOUSE_MIDDLE_SPEC = 'Mouse1'

export const MOUSE_BACK_SPEC = 'Mouse3'

export const MOUSE_FORWARD_SPEC = 'Mouse4'

export const WHEEL_UP_SPEC = 'WheelUp'

export const WHEEL_DOWN_SPEC = 'WheelDown'

export function pointerMainKeyOfSpec(spec: string): string {
  if (!spec || !spec.trim()) return ''
  const s = spec.trim()
  const cut = s.lastIndexOf('+')
  return cut >= 0 ? s.slice(cut + 1) : s
}

export function isMouseHotkeySpec(spec: string): boolean {
  const k = pointerMainKeyOfSpec(spec)
  return k === MOUSE_MIDDLE_SPEC || k === MOUSE_BACK_SPEC || k === MOUSE_FORWARD_SPEC
}

export function isWheelHotkeySpec(spec: string): boolean {
  const k = pointerMainKeyOfSpec(spec)
  return k === WHEEL_UP_SPEC || k === WHEEL_DOWN_SPEC
}

export function isPointerHotkeySpec(spec: string): boolean {
  return isMouseHotkeySpec(spec) || isWheelHotkeySpec(spec)
}

export function mouseButtonFromSpec(spec: string): number | null {
  const k = pointerMainKeyOfSpec(spec)
  if (k === MOUSE_MIDDLE_SPEC) return 1
  if (k === MOUSE_BACK_SPEC) return 3
  if (k === MOUSE_FORWARD_SPEC) return 4
  return null
}

export function mouseSpecFromButton(button: number): string | null {
  if (button === 1) return MOUSE_MIDDLE_SPEC
  if (button === 3) return MOUSE_BACK_SPEC
  if (button === 4) return MOUSE_FORWARD_SPEC
  return null
}

export function wheelSpecFromDelta(deltaY: number): string | null {
  if (!Number.isFinite(deltaY) || deltaY === 0) return null
  return deltaY < 0 ? WHEEL_UP_SPEC : WHEEL_DOWN_SPEC
}

export function pointerSpecFromEvent(event: MouseEvent | WheelEvent): string | null {

  const isWheel = typeof (event as WheelEvent).deltaY === 'number'
  const main = isWheel
    ? wheelSpecFromDelta((event as WheelEvent).deltaY)
    : mouseSpecFromButton(event.button)
  if (!main) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Meta')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(main)
  return parts.join('+')
}

export function matchPointerHotkeySpecs(event: MouseEvent | WheelEvent, specs: string[]): boolean {
  if (!Array.isArray(specs) || !specs.length) return false
  const spec = pointerSpecFromEvent(event)
  if (!spec) return false
  return specs.some(s => !!s && isPointerHotkeySpec(s) && s === spec)
}

export function isBareWheelSpec(spec: string): boolean {
  return spec === WHEEL_UP_SPEC || spec === WHEEL_DOWN_SPEC
}

export function matchPanelHotkeyKeys(event: KeyboardEvent, specs: string[]): boolean {
  if (!Array.isArray(specs) || !specs.length) return false
  for (const spec of specs) {
    if (isPointerHotkeySpec(spec)) continue
    if (matchPanelHotkeyKey(event, spec)) return true
  }
  return false
}

export function keyboardHotkeySpecs(specs: string[]): string[] {
  if (!Array.isArray(specs)) return []
  return specs.filter(s => s && !isPointerHotkeySpec(s))
}

export function normalizePanelHotkeyKeys(raw: unknown, cleared = '__NONE__'): string[] {
  if (Array.isArray(raw)) {
    return (raw as unknown[]).filter(v => typeof v === 'string')
      .map(v => (v as string).trim())
      .filter(v => !!v && v !== cleared && v.indexOf('\x00') !== 0)
  }
  if (typeof raw === 'string') {
    const v = raw.trim()
    return (v && v !== cleared && v.indexOf('\x00') !== 0) ? [v] : []
  }
  return []
}
