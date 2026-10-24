import * as fs from 'fs'

import * as path from 'path'

import { exec } from 'child_process'

import { promisify } from 'util'

import { log } from '../../services/sftp-logger'

const execAsync = promisify(exec)

export type IdMaps = {
  uidToName: Map<number, string>
  gidToName: Map<number, string>
}

export function parsePasswd(content: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of content.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split(':')
    if (parts.length < 2) continue

    const uid = parts.length >= 3 ? parseInt(parts[2], 10) : parseInt(parts[1], 10)
    const name = parts[0]?.trim()
    if (!Number.isNaN(uid) && name) map.set(uid, name)
  }
  return map
}

export function parseGroup(content: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of content.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split(':')
    if (parts.length < 2) continue
    const gid = parts.length >= 3 ? parseInt(parts[2], 10) : parseInt(parts[1], 10)
    const name = parts[0]?.trim()
    if (!Number.isNaN(gid) && name) map.set(gid, name)
  }
  return map
}

export function loadLocalIdMaps(): IdMaps {
  const uidToName = new Map<number, string>()
  const gidToName = new Map<number, string>()
  if (process.platform === 'win32') {
    return { uidToName, gidToName }
  }
  try {
    for (const [k, v] of parsePasswd(fs.readFileSync('/etc/passwd', 'utf8'))) uidToName.set(k, v)
  } catch {   }
  try {
    for (const [k, v] of parseGroup(fs.readFileSync('/etc/group', 'utf8'))) gidToName.set(k, v)
  } catch { /* ignore */ }
  return { uidToName, gidToName }
}

export async function loadWindowsIdMapsAsync(): Promise<IdMaps> {
  const uidToName = new Map<number, string>()
  const gidToName = new Map<number, string>()
  try {
    const [userResult, groupResult] = await Promise.all([
      execAsync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_UserAccount -Filter \'LocalAccount=True\' | ForEach-Object { $_.Name + \':\' + $_.SID }"',
        { encoding: 'utf8', timeout: 8000 },
      ),
      execAsync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Group | ForEach-Object { $_.Name + \':\' + $_.SID }"',
        { encoding: 'utf8', timeout: 8000 },
      ),
    ])
    for (const line of userResult.stdout.split('\n')) {
      const m = line.trim().match(/^([^:]+):S-1-5-21(?:-\d+){3}-(\d+)$/i)
      if (m) uidToName.set(parseInt(m[2], 10), m[1])
    }
    for (const line of groupResult.stdout.split('\n')) {
      const m = line.trim().match(/^([^:]+):S-1-5-21(?:-\d+){3}-(\d+)$/i)
      if (m) gidToName.set(parseInt(m[2], 10), m[1])
    }
  } catch {   }
  return { uidToName, gidToName }
}

function isNumericIdStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d+$/.test(v.trim())
}

export function resolveOwnerDisplay(
  maps: IdMaps,
  name?: string,
  uid?: number,
): string | undefined {
  const numericName = name != null && isNumericIdStr(String(name)) ? parseInt(String(name).trim(), 10) : undefined
  const id = uid ?? numericName
  if (name && !isNumericIdStr(String(name))) return String(name).trim()
  if (id != null) {
    const resolved = maps.uidToName.get(id)
    if (resolved) return resolved
    return String(id)
  }
  return name != null ? String(name) : undefined
}

export function resolveGroupDisplay(
  maps: IdMaps,
  name?: string,
  gid?: number,
): string | undefined {
  const numericName = name != null && isNumericIdStr(String(name)) ? parseInt(String(name).trim(), 10) : undefined
  const id = gid ?? numericName
  if (name && !isNumericIdStr(String(name))) return String(name).trim()
  if (id != null) {
    const resolved = maps.gidToName.get(id)
    if (resolved) return resolved
    return String(id)
  }
  return name != null ? String(name) : undefined
}

export async function execSshCommand(
  sshSession: unknown,
  command: string,
  timeoutMs = 12000,
  opts?: { retryOnEmpty?: boolean },
): Promise<string> {
  const typed = sshSession as { ssh?: {
    openSessionChannel?: () => Promise<unknown>
    activateChannel?: (ch: unknown) => Promise<{
      requestExec: (cmd: string) => Promise<void>
      data$: { subscribe: (o: { next?: (d: Uint8Array) => void; error?: (e: unknown) => void }) => { unsubscribe: () => void } }
      closed$: { subscribe: (fn: () => void) => { unsubscribe: () => void } }
      close: () => Promise<void>
    }>
  } }
  const ssh = typed?.ssh
  if (!ssh?.openSessionChannel || !ssh.activateChannel) {

    const hasSsh = !!typed?.ssh
    const hasOpen = !!typed?.ssh?.openSessionChannel
    const hasActivate = !!typed?.ssh?.activateChannel
    log.warn('[execSshCommand] SSH exec unavailable: hasSsh=', hasSsh, 'hasOpen=', hasOpen, 'hasActivate=', hasActivate)
    return ''
  }

  const execOnce = async (): Promise<string> => {
    let channel: Awaited<ReturnType<NonNullable<typeof ssh.activateChannel>>> | null = null
    try {
      const newCh = await ssh.openSessionChannel()
      channel = await ssh.activateChannel(newCh)
      await channel.requestExec(command)

      const chunks: Uint8Array[] = []
      let channelClosed = false
      await new Promise<void>((resolve, reject) => {

        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let dataSub: { unsubscribe: () => void } | null = null
        let closedSub: { unsubscribe: () => void } | null = null
        const done = (err?: unknown) => {
          if (settled) return
          settled = true
          if (timer != null) clearTimeout(timer)
          try { dataSub?.unsubscribe() } catch { /* ignore */ }
          try { closedSub?.unsubscribe() } catch { /* ignore */ }
          if (err !== undefined) reject(err)
          else resolve()
        }
        dataSub = channel!.data$.subscribe({
          next: d => chunks.push(d),
          error: err => done(err),
        })
        closedSub = channel!.closed$.subscribe(() => {
          channelClosed = true
          done()
        })
        timer = setTimeout(() => {
          if (!channelClosed) {
            try { void channel?.close() } catch { /* ignore */ }
          }
          done()
        }, timeoutMs)
      })

      return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8')
    } catch {
      return ''
    } finally {
      try { await channel?.close() } catch { /* ignore */ }
    }
  }

  const first = await execOnce()
  if (first !== '') return first

  if (opts?.retryOnEmpty !== true) {
    if (opts?.retryOnEmpty === false) {
      log.warn(`execSshCommand empty output (retry explicitly disabled): ${command.slice(0, 80)}`)
    }
    return first
  }
  await new Promise(r => setTimeout(r, 300))
  const second = await execOnce()
  if (second === '') log.warn(`execSshCommand empty output (retried): ${command.slice(0, 80)}`)
  return second
}

export async function loadRemoteIdMaps(sshSession: unknown): Promise<IdMaps> {

  const passwdOut = await execSshCommand(
    sshSession,
    "getent passwd 2>/dev/null | awk -F: '{print $1\":\"$3}' || awk -F: '{print $1\":\"$3}' /etc/passwd 2>/dev/null",
    12000,
    { retryOnEmpty: true },
  )
  const groupOut = await execSshCommand(
    sshSession,
    "getent group 2>/dev/null | awk -F: '{print $1\":\"$3}' || awk -F: '{print $1\":\"$3}' /etc/group 2>/dev/null",
    12000,
    { retryOnEmpty: true },
  )
  return {
    uidToName: parsePasswd(passwdOut),
    gidToName: parseGroup(groupOut),
  }
}

export class IdNameResolver {
  private maps: IdMaps = { uidToName: new Map(), gidToName: new Map() }
  private loading: Promise<void> | null = null
  private localLoaded = false
  private localLoading: Promise<void> | null = null
  private execDisabled = false
  private execFailCount = 0

  get loaded(): boolean {
    return this.maps.uidToName.size > 0 || this.maps.gidToName.size > 0
  }

  get uidMapReady(): boolean {
    return this.maps.uidToName.size > 0
  }

  get remoteExecDisabled(): boolean {
    return this.execDisabled
  }

  mergeMaps(maps: IdMaps): void {
    for (const [k, v] of maps.uidToName) this.maps.uidToName.set(k, v)
    for (const [k, v] of maps.gidToName) this.maps.gidToName.set(k, v)
  }

  setMaps(maps: IdMaps): void {
    this.maps = maps
  }

  loadLocal(): void {
    if (this.localLoaded) return
    this.maps = loadLocalIdMaps()
    this.localLoaded = true
  }

  ensureLocalMaps(): Promise<void> {
    if (this.localLoaded) return Promise.resolve()
    if (this.localLoading) return this.localLoading
    if (process.platform !== 'win32') {
      this.loadLocal()
      return Promise.resolve()
    }
    this.localLoading = loadWindowsIdMapsAsync().then(maps => {

      this.mergeMaps(maps)
      this.localLoaded = true
    }).finally(() => {
      this.localLoading = null
    })
    return this.localLoading
  }

  loadRemote(sshSession: unknown): Promise<void> {
    if (this.execDisabled) return Promise.resolve()
    if (this.loading) return this.loading
    this.loading = loadRemoteIdMaps(sshSession).then(maps => {
      this.mergeMaps(maps)
      if (!this.uidMapReady) {
        this.execFailCount++
        if (this.execFailCount >= 3) this.execDisabled = true
      } else {
        this.execFailCount = 0
      }
    }).finally(() => {
      this.loading = null
    })
    return this.loading
  }

  ensureUidMap(sshSession: unknown): Promise<void> {
    if (this.uidMapReady || this.execDisabled) return Promise.resolve()
    return this.loadRemote(sshSession)
  }

  reset(): void {
    this.maps = { uidToName: new Map(), gidToName: new Map() }
    this.loading = null
    this.localLoaded = false
    this.localLoading = null
    this.execDisabled = false
    this.execFailCount = 0
  }

  ownerName(name?: string, uid?: number): string | undefined {
    return resolveOwnerDisplay(this.maps, name, uid)
  }

  groupName(name?: string, gid?: number): string | undefined {
    return resolveGroupDisplay(this.maps, name, gid)
  }
}

const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** Validate one entry name before joining paths; reject traversal and device names. */
export function safeEntryName(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0) return null
  const base = path.basename(name)
  if (base === '' || base === '.' || base === '..') return null

  if (/[\x00-\x1f\x7f]/.test(base) || base.includes('/') || base.includes('\\')) return null

  if (process.platform === 'win32') {
    if (WIN_RESERVED_NAME.test(base)) return null
    if (/[. ]$/.test(base)) return null
  }
  return base
}

export function safeJoinUnder(parent: string, name: string, posix = false): string | null {
  const safe = safeEntryName(name)
  if (!safe) return null
  const joinFn = posix ? path.posix.join : path.join
  const resolveFn = posix ? path.posix.resolve : path.resolve
  const normParent = resolveFn(parent)
  const child = resolveFn(joinFn(parent, safe))
  const sep = posix ? '/' : path.sep
  const prefix = normParent.endsWith(sep) ? normParent : normParent + sep
  if (child !== normParent && !child.startsWith(prefix)) return null
  return child
}
