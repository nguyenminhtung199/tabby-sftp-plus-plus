/** Per-pane, bounded, in-memory last-item history; never persisted with file contents. */
export class NavigationMemory {
  private scope: unknown
  private initialized = false
  private paths = new Map<string, string>()
  constructor(private readonly limit: number) {}
  activate(scope: unknown): boolean {
    if (this.initialized && this.scope === scope) return false
    this.initialized = true; this.scope = scope; this.paths.clear(); return true
  }
  remember(folder: string, item: string): void {
    this.paths.delete(folder); this.paths.set(folder, item)
    while (this.paths.size > this.limit) this.paths.delete(this.paths.keys().next().value)
  }
  get(folder: string): string | undefined { return this.paths.get(folder) }
}
