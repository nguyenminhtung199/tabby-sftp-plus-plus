export type GroupByMode = 'none' | 'name' | 'modified' | 'type' | 'size'

export const NAV_HEADER_KEY_PREFIX = '\u0000group:'

export function navHeaderKey(bucketKey: string): string {
  return NAV_HEADER_KEY_PREFIX + bucketKey
}

export interface GroupBucket {
  key: string
  labelKey: string

  arg?: string
}

export interface GroupDisplayRow {
  kind: 'header' | 'entry'

  bucket?: GroupBucket

  bucketKey?: string
  label?: string
  collapsed?: boolean
  count?: number
  items?: any[]

  entry?: any
  index?: number
}

const NAME_BUCKETS: GroupBucket[] = [
  { key: 'digit', labelKey: 'group.digit' },
  { key: 'a2h', labelKey: 'group.a2h' },
  { key: 'i2p', labelKey: 'group.i2p' },
  { key: 'q2z', labelKey: 'group.q2z' },
  { key: 'pyAF', labelKey: 'group.pyAF' },
  { key: 'pyGL', labelKey: 'group.pyGL' },
  { key: 'pyMS', labelKey: 'group.pyMS' },
  { key: 'pyTZ', labelKey: 'group.pyTZ' },
  { key: 'other', labelKey: 'group.other' },
]

const MODIFIED_BUCKETS: GroupBucket[] = [
  { key: 'today', labelKey: 'group.today' },
  { key: 'yesterday', labelKey: 'group.yesterday' },
  { key: 'thisWeek', labelKey: 'group.thisWeek' },
  { key: 'thisMonth', labelKey: 'group.thisMonth' },
  { key: 'earlierThisYear', labelKey: 'group.earlierThisYear' },
  { key: 'longAgo', labelKey: 'group.longAgo' },
]

const SIZE_BUCKETS: GroupBucket[] = [
  { key: 'tiny', labelKey: 'group.sizeTiny' },
  { key: 'small', labelKey: 'group.sizeSmall' },
  { key: 'medium', labelKey: 'group.sizeMedium' },
  { key: 'large', labelKey: 'group.sizeLarge' },
  { key: 'huge', labelKey: 'group.sizeHuge' },
  { key: 'super', labelKey: 'group.sizeSuper' },
]

// Escaped boundary characters preserve grouping for Unicode filenames.
const PINYIN_BOUNDS = { g: '\u560e', m: '\u5988', t: '\u584c' }
let _zhCollator: Intl.Collator | null = null
let _zhCollatorOk: boolean | null = null

function zhCompare(a: string, b: string): number | null {
  try {
    if (_zhCollatorOk === null) {
      _zhCollator = new Intl.Collator('zh-u-co-pinyin')

      _zhCollatorOk = _zhCollator.compare('\u963f', '\u531d') < 0 ? true : false
    }
    if (!_zhCollatorOk || !_zhCollator) return null
    return _zhCollator.compare(a, b)
  } catch { _zhCollatorOk = false; return null }
}

function nameBucketKey(name: string): string {
  const ch = (name || '').charAt(0)
  if (!ch) return 'other'
  if (ch >= '0' && ch <= '9') return 'digit'
  const up = ch.toUpperCase()
  if (up >= 'A' && up <= 'H') return 'a2h'
  if (up >= 'I' && up <= 'P') return 'i2p'
  if (up >= 'Q' && up <= 'Z') return 'q2z'

  if (/[\u4e00-\u9fff]/.test(ch)) {
    const cmpG = zhCompare(ch, PINYIN_BOUNDS.g)
    if (cmpG === null) return 'other'
    if (cmpG < 0) return 'pyAF'
    if (zhCompare(ch, PINYIN_BOUNDS.m) < 0) return 'pyGL'
    if (zhCompare(ch, PINYIN_BOUNDS.t) < 0) return 'pyMS'
    return 'pyTZ'
  }
  return 'other'
}

function modifiedBucketKey(ts: number): string {
  if (!ts || ts <= 0) return 'longAgo'
  const d = new Date(ts)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const day = startOfDay(d)
  const today = startOfDay(now)
  const DAY = 24 * 60 * 60 * 1000
  if (day === today) return 'today'
  if (day === today - DAY) return 'yesterday'
  if (day > today - DAY) return 'today'

  const dow = (now.getDay() + 6) % 7
  const weekStart = today - dow * DAY
  if (day >= weekStart) return 'thisWeek'
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'thisMonth'
  if (d.getFullYear() === now.getFullYear()) return 'earlierThisYear'
  return 'longAgo'
}

function sizeBucketKey(size: number): string {
  const KB = 1024, MB = 1024 * KB, GB = 1024 * MB
  const s = Number.isFinite(size) && size > 0 ? size : 0
  if (s < 16 * KB) return 'tiny'
  if (s < 1 * MB) return 'small'
  if (s < 128 * MB) return 'medium'
  if (s < 1 * GB) return 'large'
  if (s < 4 * GB) return 'huge'
  return 'super'
}

export function extDisplay(name: string): string {
  const dot = (name || '').lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = name.slice(dot + 1).trim()
  return ext ? ext.toUpperCase() : ''
}

function bucketFor(e: any, mode: GroupByMode): GroupBucket {
  if (mode === 'name') {
    const key = nameBucketKey(e?.name || '')
    return NAME_BUCKETS.find(b => b.key === key) || NAME_BUCKETS[NAME_BUCKETS.length - 1]
  }
  if (mode === 'modified') {
    const ts = e?.modified?.getTime?.() ?? (e?.mtimeMs ? Number(e.mtimeMs) : 0)
    const key = modifiedBucketKey(ts)
    return MODIFIED_BUCKETS.find(b => b.key === key) || MODIFIED_BUCKETS[MODIFIED_BUCKETS.length - 1]
  }
  if (mode === 'size') {
    const key = sizeBucketKey(Number(e?.size) || 0)
    return SIZE_BUCKETS.find(b => b.key === key) || SIZE_BUCKETS[SIZE_BUCKETS.length - 1]
  }

  if (e?.isDirectory) return { key: 'folder', labelKey: 'group.folder' }
  const ext = extDisplay(e?.name || '')
  return ext
    ? { key: `ext:${ext.toLowerCase()}`, labelKey: 'group.typeFiles', arg: ext }
    : { key: 'noExt', labelKey: 'group.noExt' }
}

export function buildGroupedRows(
  entries: any[],
  mode: GroupByMode,
  reverseGroups: boolean,
  collapsedSet: Set<string>,
  labeler: (b: GroupBucket) => string,
): GroupDisplayRow[] {
  const rows: GroupDisplayRow[] = []
  if (mode === 'none' || !entries || !entries.length) return rows

  const buckets = new Map<string, { bucket: GroupBucket; items: any[]; indexes: number[] }>()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const b = bucketFor(e, mode)
    let g = buckets.get(b.key)
    if (!g) { g = { bucket: b, items: [], indexes: [] }; buckets.set(b.key, g) }
    g.items.push(e)
    g.indexes.push(i)
  }

  let ordered: { bucket: GroupBucket; items: any[]; indexes: number[] }[]
  if (mode === 'type') {
    const fixed = [...buckets.values()].filter(g => g.bucket.key === 'folder')
    const noExt = [...buckets.values()].filter(g => g.bucket.key === 'noExt')
    const exts = [...buckets.values()]
      .filter(g => g.bucket.key.startsWith('ext:'))
      .sort((a, b) => (a.bucket.arg || '').localeCompare(b.bucket.arg || ''))
    ordered = [...fixed, ...exts, ...noExt]
  } else {
    const table = mode === 'name' ? NAME_BUCKETS : mode === 'modified' ? MODIFIED_BUCKETS : SIZE_BUCKETS
    ordered = []
    for (const b of table) {
      const g = buckets.get(b.key)
      if (g) ordered.push(g)
    }

    for (const g of buckets.values()) {
      if (!ordered.includes(g)) ordered.push(g)
    }
  }
  if (reverseGroups) ordered = ordered.slice().reverse()
  for (const g of ordered) {
    const collapsed = collapsedSet.has(g.bucket.key)
    rows.push({
      kind: 'header',
      bucket: g.bucket,
      bucketKey: g.bucket.key,
      label: labeler(g.bucket),
      collapsed,
      count: g.items.length,
      items: g.items,
    })
    if (collapsed) continue
    for (let j = 0; j < g.items.length; j++) {
      rows.push({ kind: 'entry', entry: g.items[j], index: g.indexes[j] })
    }
  }
  return rows
}

export function groupModeSortField(mode: GroupByMode): string | null {
  if (mode === 'name') return 'name'
  if (mode === 'modified') return 'modified'
  if (mode === 'size') return 'size'
  return null
}
