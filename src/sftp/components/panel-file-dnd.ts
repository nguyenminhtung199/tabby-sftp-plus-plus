/**
 * 文件拖拽悬停与基础状态（不包含 drop 传输实现）
 */
import * as path from 'path'
import { ChangeDetectorRef, ElementRef } from '@angular/core'

export type FileDndPane = 'local' | 'remote'

export interface FileDndHost {
  cdr: ChangeDetectorRef
  elRef: ElementRef
  resolveDropDestDir?(ev: DragEvent, pane: FileDndPane): string | undefined
  isHeaderReorderActive(): boolean
}

export class PanelFileDnd {
  private _localDragOver = false
  private _remoteDragOver = false
  private _dragSourcePane: FileDndPane | null = null
  private _dragSameDirNoop = false
  private _dragSourceDir = ''

  constructor(private readonly host: FileDndHost) {}

  get localDragOver(): boolean { return this._localDragOver }
  get remoteDragOver(): boolean { return this._remoteDragOver }

  setDragSource(pane: FileDndPane, sameDirNoop: boolean, sourceDir = ''): void {
    this._dragSourceDir = sourceDir
    this._dragSourcePane = pane
    this._dragSameDirNoop = sameDirNoop
  }

  isInternalSameDirDrag(targetPane: FileDndPane): boolean {
    return this._dragSameDirNoop && this._dragSourcePane === targetPane
  }

  private sameDirectory(ev: DragEvent, pane: FileDndPane): boolean {
    if (!this.isInternalSameDirDrag(pane)) return false
    const dest = this.host.resolveDropDestDir?.(ev, pane)
    const api = pane === 'local' ? path : path.posix
    return !dest || api.resolve(dest) === api.resolve(this._dragSourceDir)
  }

  /** Hover feedback changes one border, without checking Angular's file lists. */
  private setDragOver(pane: FileDndPane, value: boolean): void {
    const previous = pane === 'local' ? this._localDragOver : this._remoteDragOver
    if (previous === value) return
    if (pane === 'local') this._localDragOver = value
    else this._remoteDragOver = value
    const list = this.host.elRef?.nativeElement?.querySelector?.('.pane-list.' + pane + '-pane') as HTMLElement | null
    list?.closest('.pane-list-wrap')?.classList.toggle('pane-drag-over', value)
  }

  reset(): void {
    this._dragSourcePane = null
    this._dragSameDirNoop = false
    this.setDragOver('local', false)
    this.setDragOver('remote', false)
  }

  onEntryDragEnd(clearCustomDragPreview: () => void): void {
    clearCustomDragPreview()
    this.reset()
  }

  onDragOver(ev: DragEvent, targetPane: FileDndPane): void {
    if (this.host.isHeaderReorderActive()) return
    if (this.sameDirectory(ev, targetPane)) {
      ev.preventDefault()
      this.setDragOver(targetPane, false)
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'none'
      return
    }
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = this._dragSourcePane === targetPane ? 'move' : 'copy'
    this.setDragOver(targetPane, true)
  }

  onDragEnter(ev: DragEvent, targetPane: FileDndPane): void {
    if (this.host.isHeaderReorderActive()) return
    if (this.sameDirectory(ev, targetPane)) {
      ev.preventDefault()
      return
    }
    ev.preventDefault()
    this.setDragOver(targetPane, true)
  }

  onDragLeave(ev: DragEvent, targetPane: FileDndPane): void {
    if (this.host.isHeaderReorderActive()) return
    ev.preventDefault()
    // 仅当真正离开 pane-list 时才取消高亮（避免鼠标在子元素间移动时误触发 dragleave）
    const related = ev.relatedTarget as Node | null
    const paneList = this.host.elRef.nativeElement.querySelector(`.pane-list.${targetPane}-pane`) as HTMLElement | null
    if (paneList && related && paneList.contains(related)) return
    this.setDragOver(targetPane, false)
  }
}
