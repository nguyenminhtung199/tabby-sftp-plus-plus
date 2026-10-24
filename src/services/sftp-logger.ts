export type SftpLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'log'

export interface SftpLoggerLike {
  debug(...args: any[]): void
  info(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
  log(...args: any[]): void
}

interface TabbyLogger {
  debug?(...args: any[]): void
  info?(...args: any[]): void
  warn?(...args: any[]): void
  error?(...args: any[]): void
  log?(...args: any[]): void
}

interface TabbyLogServiceLike {
  create(name: string): TabbyLogger
}

const SCOPE = 'sftp-plus'

const PREFIX = '[SFTP++]'

const MAX_ARG_CHARS = 2000

function clampText(s: string): string {
  return s.length > MAX_ARG_CHARS ? `${s.slice(0, MAX_ARG_CHARS)}…(+${s.length - MAX_ARG_CHARS})` : s
}

function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a
  if (a === null) return 'null'
  if (a === undefined) return 'undefined'
  if (a instanceof Error) return formatError(a)

  if (typeof a === 'function') return `[Function ${(a as { name?: string }).name || 'anonymous'}]`
  if (typeof a === 'object') {
    try {
      return clampText(JSON.stringify(a))
    } catch {

      return Object.prototype.toString.call(a)
    }
  }
  return clampText(String(a))
}

function formatError(e: Error): string {
  const extra = e as Error & { code?: unknown; errno?: unknown; syscall?: unknown; path?: unknown }
  const bits: string[] = []
  if (extra.code !== undefined) bits.push(`code=${String(extra.code)}`)
  if (extra.errno !== undefined) bits.push(`errno=${String(extra.errno)}`)
  if (extra.syscall !== undefined) bits.push(`syscall=${String(extra.syscall)}`)
  if (extra.path !== undefined) bits.push(`path=${String(extra.path)}`)
  const frames = (e.stack || '')
    .split('\n')
    .slice(1, 3)
    .map(s => s.trim())
    .filter(Boolean)
    .join(' < ')
  const head = e.message ? `${e.name || 'Error'}: ${e.message}` : String(e)
  return `${head}${bits.length ? ` (${bits.join(', ')})` : ''}${frames ? ` <- ${frames}` : ''}`
}

function formatArgs(args: any[]): string {
  return `${PREFIX} ${args.map(stringifyArg).join(' ')}`
}

function consoleFallback(level: SftpLogLevel, args: any[]): void {
  const fn = (console as any)[level] || console.log

  fn.call(console, formatArgs(args))
}

let bound: SftpLoggerLike | null = null

function getImpl(): SftpLoggerLike {
  if (bound) return bound
  return {
    debug: (...args) => consoleFallback('debug', args),
    info: (...args) => consoleFallback('info', args),
    warn: (...args) => consoleFallback('warn', args),
    error: (...args) => consoleFallback('error', args),
    log: (...args) => consoleFallback('log', args),
  }
}

export function bindSftpLogger(logService: TabbyLogServiceLike | null | undefined): void {
  if (bound || !logService?.create) return
  try {
    const l = logService.create(SCOPE)

    const wrap = (level: SftpLogLevel) => (...args: any[]): void => {
      const line = formatArgs(args)
      const fn = (l as Record<string, unknown>)[level]
      if (typeof fn === 'function') {
        try {
          (fn as (...a: any[]) => void).call(l, line)
          return
        } catch {

        }
      }
      consoleFallback(level, args)
    }
    bound = {
      debug: wrap('debug'),
      info: wrap('info'),
      warn: wrap('warn'),
      error: wrap('error'),
      log: wrap('log'),
    }
  } catch {

  }
}

export const log: SftpLoggerLike = {
  debug: (...args) => getImpl().debug(...args),
  info: (...args) => getImpl().info(...args),
  warn: (...args) => getImpl().warn(...args),
  error: (...args) => getImpl().error(...args),
  log: (...args) => getImpl().log(...args),
}
