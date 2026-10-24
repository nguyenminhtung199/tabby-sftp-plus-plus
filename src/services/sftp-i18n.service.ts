import { invokeFeature } from '../features/api'
import { Injectable, Optional } from '@angular/core'

/** Legacy caller input is accepted, but the plugin always renders English. */
export type Locale = string

function unescapePo(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}

function parsePo(content: string): Record<string, string> {
  const translations: Record<string, string> = {}
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let currentKey = ''
  let currentValue = ''
  let inMsgid = false
  let inMsgstr = false

  for (const line of lines) {
    if (line.startsWith('msgid ')) {
      if (currentKey && currentValue) {
        translations[unescapePo(currentKey)] = unescapePo(currentValue)
      }
      currentKey = line.slice(7, -1) // remove msgid "..."
      currentValue = ''
      inMsgid = true
      inMsgstr = false
    } else if (line.startsWith('msgstr ')) {
      currentValue = line.slice(8, -1) // remove msgstr "..."
      inMsgid = false
      inMsgstr = true
    } else if (inMsgid && line.startsWith('"') && line.endsWith('"')) {

      currentKey += line.slice(1, -1)
    } else if (inMsgstr && line.startsWith('"') && line.endsWith('"')) {

      currentValue += line.slice(1, -1)
    } else {
      inMsgid = false
      inMsgstr = false
    }
  }

  if (currentKey && currentValue) {
    translations[unescapePo(currentKey)] = unescapePo(currentValue)
  }

  return translations
}

const MESSAGES = parsePo(require('../../locale/en-US.po'))

@Injectable()
export class SftpI18nService {
  constructor(@Optional() _configService?: any) {}

  _base_getLocale(): string { return 'en-US' }
  _base_setLocale(_legacyLocale?: string): void {}

  _base_t(key: string, params?: Record<string, string | number>): string {
    let text = MESSAGES[key] || key
    if (params) for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value))
    return text
  }

  getLocale(...args: any[]): any { return invokeFeature('I18n', 'getLocale', this, args) }
  setLocale(...args: any[]): any { return invokeFeature('I18n', 'setLocale', this, args) }
  t(...args: any[]): any { return invokeFeature('I18n', 't', this, args) }
}
export interface SftpI18nService { [key: string]: any }
