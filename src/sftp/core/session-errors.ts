const CHANNEL_DEAD_TEXT: RegExp[] = [
  /session closed/i,
  /session is closed/i,
  /session has ended/i,
  /channel closed/i,
  /no such session/i,
  /not connected/i,
  /connection (?:lost|reset|closed|ended)/i,
  /broken pipe/i,
]

const CHANNEL_DEAD_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTCONN',
  'EPIPE',
  'ERR_SOCKET_CLOSED',
])

export function channelErrorText(e: unknown): string {
  if (e === null || e === undefined) return ''
  if (typeof e === 'string') return e
  const any = e as { message?: unknown; description?: unknown; stack?: unknown }
  const parts: string[] = []
  if (typeof any.description === 'string') parts.push(any.description)
  if (typeof any.message === 'string') parts.push(any.message)
  if (!parts.length && typeof any.stack === 'string') parts.push(any.stack)
  return parts.join(' | ')
}

export function isChannelDeadError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null | undefined)?.code
  if (typeof code === 'string' && CHANNEL_DEAD_CODES.has(code)) return true
  const text = channelErrorText(e)
  if (!text) return false
  return CHANNEL_DEAD_TEXT.some(re => re.test(text))
}
