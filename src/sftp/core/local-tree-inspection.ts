import * as fs from 'fs/promises'
import * as path from 'path'

export type LocalTreeInspection = { size: number; count: number; hasSymlink: boolean }

/** One bounded archive-eligibility pass; timeout prevents scheduling further filesystem work. */
export async function inspectLocalTrees(roots: string[], budgetMs = 3000): Promise<LocalTreeInspection | null> {
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined
  const deadline = Number.isFinite(budgetMs) ? Date.now() + budgetMs : Infinity
  const inspect = async (): Promise<LocalTreeInspection | null> => {
    const queue = roots.map(file => ({ file, depth: 0 })), seen = new Set<string>()
    let cursor = 0, size = 0, count = 0
    while (cursor < queue.length) {
      if (expired || Date.now() >= deadline) return null
      const batch = queue.slice(cursor, cursor + 8); cursor += batch.length
      const results = await Promise.all(batch.map(async item => {
        const stat = await fs.lstat(item.file)
        if (expired) return null
        if (stat.isSymbolicLink() || item.depth > 100) return { item, link: true, size: 0, children: null }
        return { item, link: false, size: stat.size, children: stat.isDirectory() ? await fs.readdir(item.file) : null }
      }))
      if (expired || Date.now() >= deadline) return null
      for (const result of results) {
        if (!result) return null
        const key = path.resolve(result.item.file)
        if (seen.has(key)) continue
        seen.add(key)
        if (result.link) return { size, count, hasSymlink: true }
        if (result.children) {
          for (const name of result.children) {
            if (name === '.' || name === '..' || path.basename(name) !== name) return null
            queue.push({ file: path.join(result.item.file, name), depth: result.item.depth + 1 })
          }
        } else { size += result.size; count++ }
      }
      if (cursor % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    return { size, count, hasSymlink: false }
  }
  try {
    const work = inspect().catch(() => null)
    if (!Number.isFinite(budgetMs)) return await work
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => { expired = true; resolve(null) }, Math.max(0, budgetMs)) })
    return await Promise.race([work, timeout])
  } finally { expired = true; if (timer) clearTimeout(timer) }
}
