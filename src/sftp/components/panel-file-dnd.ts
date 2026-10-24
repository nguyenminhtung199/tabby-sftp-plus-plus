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

  reset(): void {
    this._dragSourcePane = null
    this._dragSameDirNoop = false
    this._localDragOver = false
    this._remoteDragOver = false
  }

  onEntryDragEnd(clearCustomDragPreview: () => void): void {
    clearCustomDragPreview()
    this.reset()
    this.host.cdr.detectChanges()
  }

  onDragOver(ev: DragEvent, targetPane: FileDndPane): void {
    if (this.host.isHeaderReorderActive()) return
    if (this.sameDirectory(ev, targetPane)) {
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'none'
      return
    }
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = this._dragSourcePane === targetPane ? 'move' : 'copy'
  }

  onDragEnter(ev: DragEvent, targetPane: FileDndPane): void {
    if (this.host.isHeaderReorderActive()) return
    if (this.sameDirectory(ev, targetPane)) {
      ev.preventDefault()
      return
    }
    ev.preventDefault()
    const wasOver = targetPane === 'remote' ? this._remoteDragOver : this._localDragOver
    if (targetPane === 'remote') {
      this._remoteDragOver = true
    } else {
      this._localDragOver = true
    }
    // 仅在状态真正翻转时才触发变更检测（拖拽过程中鼠标在子元素间来回移动会反复触发
    // dragenter/dragleave，原实现每次都 detectChanges 全量重绘，导致拖拽卡顿）
    if (!wasOver) this.host.cdr.detectChanges()
  }

  onDragLeave(ev: DragEvent, targetPane: FileDndPane): void {
    if (this.host.isHeaderReorderActive()) return
    ev.preventDefault()
    // 仅当真正离开 pane-list 时才取消高亮（避免鼠标在子元素间移动时误触发 dragleave）
    const related = ev.relatedTarget as Node | null
    const paneList = this.host.elRef.nativeElement.querySelector(`.pane-list.${targetPane}-pane`) as HTMLElement | null
    if (paneList && related && paneList.contains(related)) return
    const wasOver = targetPane === 'remote' ? this._remoteDragOver : this._localDragOver
    if (targetPane === 'remote') {
      this._remoteDragOver = false
    } else {
      this._localDragOver = false
    }
    if (wasOver) this.host.cdr.detectChanges()
  }
}
