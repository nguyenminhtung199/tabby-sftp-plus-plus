import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function getTabbyConfigDir(): string {
  const home = os.homedir()
  switch (os.platform()) {
    case 'win32': return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'tabby')
    case 'darwin': return path.join(home, 'Library', 'Application Support', 'tabby')
    default: return path.join(home, '.config', 'tabby')
  }
}

export function detectTabbyThemeMode(): 'light' | 'dark' | '' {
  try {
    const configPath = path.join(getTabbyConfigDir(), 'config.yaml')
    const raw = fs.readFileSync(configPath, 'utf-8')
    const match = raw.match(/^appearance:\s*\n\s+colorSchemeMode:\s*['"]?(\w+)['"]?\s*$/m)
    if (match) {
      const mode = match[1].toLowerCase()
      if (mode === 'dark') return 'dark'
      if (mode === 'light') return 'light'
    }

    const m2 = raw.match(/colorSchemeMode\s*:\s*['"]?(\w+)['"]?\s*$/)
    if (m2) {
      const mode = m2[1].toLowerCase()
      if (mode === 'dark') return 'dark'
      if (mode === 'light') return 'light'
    }
  } catch {}
  return ''
}

export function detectTabbyTheme(): 'light' | 'dark' {

  const cfg = detectTabbyThemeMode()
  if (cfg) return cfg

  let bodyBg = '#1e1e2e'
  try {
    const computedStyle = getComputedStyle(document.documentElement)
    const cssBg = computedStyle.getPropertyValue('--body-bg').trim()
    if (cssBg && cssBg !== '') {
      bodyBg = cssBg
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      bodyBg = prefersDark ? '#1e1e2e' : '#ffffff'
    }
  } catch {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    bodyBg = prefersDark ? '#1e1e2e' : '#ffffff'
  }
  return isColorDark(bodyBg) ? 'dark' : 'light'
}

export function getTabbyAutoColors(): { bg: string; text: string; primary: string; border: string } {
  try {
    const style = getComputedStyle(document.documentElement)
    return {
      bg: style.getPropertyValue('--body-bg').trim() || '#1e1e2e',
      text: style.getPropertyValue('--text-color').trim() || '#cdd6f4',
      primary: style.getPropertyValue('--primary-color').trim() || '#b4befe',
      border: style.getPropertyValue('--border-color').trim() || '#585b70',
    }
  } catch {
    return { bg: '#1e1e2e', text: '#cdd6f4', primary: '#b4befe', border: '#585b70' }
  }
}

export function isColorDark(color: string): boolean {
  let r = 30, g = 30, b = 46
  if (color.startsWith('rgb')) {
    const match = color.match(/\d+/g)
    if (match && match.length >= 3) { r = +match[0]; g = +match[1]; b = +match[2] }
  } else {
    const hex = color.replace('#', '')
    r = parseInt(hex.substring(0, 2), 16) || 30
    g = parseInt(hex.substring(2, 4), 16) || 30
    b = parseInt(hex.substring(4, 6), 16) || 46
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128
}

export function parseColorLuminance(color: string): number {
  try {
    let r = 0, g = 0, b = 0
    if (color.startsWith('rgb')) {
      const m = color.match(/\d+/g)
      if (m && m.length >= 3) { r = +m[0]; g = +m[1]; b = +m[2] }
      else return -1
    } else {
      const hex = color.replace(/[^0-9a-f]/gi, '')
      if (hex.length < 6) return -1
      r = parseInt(hex.slice(0, 2), 16)
      g = parseInt(hex.slice(2, 4), 16)
      b = parseInt(hex.slice(4, 6), 16)
    }
    return 0.299 * r + 0.587 * g + 0.114 * b
  } catch { return -1 }
}

export function loadPrefixed<T>(prefix: string, key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${prefix}.${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

export function savePrefixed(prefix: string, key: string, value: unknown): void {
  try { localStorage.setItem(`${prefix}.${key}`, JSON.stringify(value)) } catch {}
}

export function notifyPanels(eventName: string): void {
  try { window.dispatchEvent(new CustomEvent(eventName)) } catch {}
}
