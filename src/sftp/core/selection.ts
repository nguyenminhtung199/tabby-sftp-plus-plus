export function computeSelection<T extends { fullPath: string }>(
  current: T[],
  entry: T,
  event: MouseEvent,
  idx: number,
  lastIndex: number | null,
  list: readonly T[],
  selectedPaths: Set<string>,
): { selection: T[]; lastIndex: number } {
  if (event.ctrlKey || event.metaKey) {
    const sel = selectedPaths.has(entry.fullPath)
      ? current.filter(e => e.fullPath !== entry.fullPath)
      : [...current, entry]
    return { selection: sel, lastIndex: idx }
  }
  if (event.shiftKey && lastIndex !== null) {
    const [f, t] = lastIndex < idx ? [lastIndex, idx] : [idx, lastIndex]
    const set = new Map(current.map(e => [e.fullPath, e]))
    list.slice(f, t + 1).forEach(e => set.set(e.fullPath, e))
    return { selection: Array.from(set.values()), lastIndex }
  }
  if (selectedPaths.has(entry.fullPath)) {
    return {
      selection: current.length === 1 ? [] : [entry],
      lastIndex: idx,
    }
  }
  return { selection: [entry], lastIndex: idx }
}

export function computeSortToggle(
  currentBy: 'name' | 'size' | 'modified' | 'birthtime',
  currentAsc: boolean,
  newField: 'name' | 'size' | 'modified' | 'birthtime',
  colJustResized: boolean,
): { by: typeof currentBy; asc: boolean } | null {
  if (colJustResized) return null
  return {
    by: newField,
    asc: currentBy === newField ? !currentAsc : true,
  }
}

export class PaneNavHistory {
  private _history: string[] = []
  private _index = -1

  constructor(private readonly max = 50) {}

  get canBack(): boolean { return this._index > 0 }
  get canForward(): boolean { return this._index < this._history.length - 1 }

  push(newPath: string, ignorePush: boolean): void {
    if (ignorePush) return
    if (this._index < this._history.length - 1) {
      this._history = this._history.slice(0, this._index + 1)
    }
    this._history.push(newPath)
    if (this._history.length > this.max) {
      this._history.shift()
    }
    this._index = this._history.length - 1
  }

  back(): string | null {
    if (!this.canBack) return null
    this._index--
    const target = this._history[this._index]
    if (!target || typeof target !== 'string') {
      this._index++
      return null
    }
    return target
  }

  forward(): string | null {
    if (!this.canForward) return null
    this._index++
    const target = this._history[this._index]
    if (!target || typeof target !== 'string') {
      this._index--
      return null
    }
    return target
  }

  clear(): void {
    this._history = []
    this._index = -1
  }
}
