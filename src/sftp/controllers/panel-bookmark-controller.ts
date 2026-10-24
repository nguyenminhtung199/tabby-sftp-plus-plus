import * as path from 'path'
import { Bookmark, SftpBookmarksService, normalizeBookmarkPath } from '../../services/sftp-bookmarks.service'
import type { BookmarkScope } from '../core/panel-types'
import { SftpPanelViewerController } from './panel-viewer-controller'

export abstract class SftpPanelBookmarkController extends SftpPanelViewerController {

  protected hostInfo!: string
  protected _isNarrowLayout!: boolean
  protected localPath!: string
  protected localPathInput!: string
  protected remotePath!: string
  protected remotePathInput!: string
  protected bookmarks!: SftpBookmarksService
  protected saveCurrentPath(): void { /* overridden by subclass */ }
  protected _pushLocalNav(_newPath: string): void { /* overridden by subclass */ }
  protected _pushRemoteNav(_newPath: string): void { /* overridden by subclass */ }

  showBookmarks = false

  protected _bookmarkJustOpened = false
  bookmarkPane: 'local' | 'remote' = 'local'
  bookmarkAddScope: 'connection' | 'global' | null = null
  newBookmarkName = ''
  newBookmarkPath = ''
  bookmarkPopupX = 0
  bookmarkPopupY = 0

  bookmarkPopupW = 320

  bookmarkPopupMaxH = 420

  bookmarkArrowLeft = 24

  dragSourceIdx = -1
  dragSourceScope: BookmarkScope = 'all'
  dragOverIdx = -1
  dragOverScope: BookmarkScope = 'all'
  dragOverBottom = false

  closeBookmarkPanelOnSelect = false

  bookmarkPanelGroupByScope = true

  bookmarkPanelGroupOrder: Array<'connection' | 'global'> = ['connection', 'global']
  protected _editingBookmarkId: string | null = null

  toggleBookmarksForPane(pane: 'local' | 'remote', event?: MouseEvent): void {
    if (this.showBookmarks && this.bookmarkPane === pane) {

      this.closeBookmarks()
      return
    }
    this.bookmarkPane = pane
    this.bookmarkAddScope = null
    this.newBookmarkPath = pane === 'local' ? this.localPath : this.remotePath
    this.newBookmarkName = ''

    const btn = (event?.currentTarget ?? event?.target) as HTMLElement | null
    const rootEl = (this.elRef?.nativeElement as HTMLElement)?.querySelector('.sftp-root') as HTMLElement | null
    if (!btn || !rootEl) {
      this.bookmarkPopupX = 80
      this.bookmarkPopupY = 87
      this.bookmarkPopupW = 320
      this.bookmarkPopupMaxH = 420
      this.bookmarkArrowLeft = 160
      this._bookmarkJustOpened = true
      this.showBookmarks = true
      queueMicrotask(() => { this._bookmarkJustOpened = false })
      return
    }
    const btnRect = btn.getBoundingClientRect()
    const rootRect = rootEl.getBoundingClientRect()
    const paneHost = btn.closest('sftp-file-pane') as HTMLElement | null
    const paneRect = paneHost?.getBoundingClientRect()
    const paneTitle = btn.closest('.pane-title') as HTMLElement | null
    const titleRect = paneTitle?.getBoundingClientRect()

    const rootW = rootRect.width
    const rootH = rootRect.height
    const margin = 4
    const idealW = 320
    const idealH = 420

    const paneW = paneRect ? paneRect.width : rootW
    const widthCap = this._isNarrowLayout
      ? Math.min(idealW, Math.max(180, Math.floor(paneW * 0.72)))
      : idealW
    const popupW = Math.min(widthCap, Math.max(160, Math.floor(Math.min(rootW, paneW) - margin * 2)))
    this.bookmarkPopupW = popupW

    let left = btnRect.left - rootRect.left
    if (!this._isNarrowLayout && pane === 'local') {

      if (paneRect) {
        const paneLeft = paneRect.left - rootRect.left
        const paneRight = paneRect.right - rootRect.left
        left = paneRight - popupW - 2
        left = Math.max(paneLeft + margin, left)
      } else {
        left = btnRect.right - rootRect.left - popupW
        left = Math.max(margin, left)
      }
      left = Math.max(2, Math.min(left, rootW - popupW - 2))
    } else if (!this._isNarrowLayout && pane === 'remote') {

      const paneRight = paneRect ? (paneRect.right - rootRect.left) : rootW
      const paneLeft = paneRect ? (paneRect.left - rootRect.left) : 0
      left = paneRight - popupW - 1
      left = Math.max(paneLeft + margin, left)
      left = Math.max(2, Math.min(left, rootW - popupW - 1))
    } else {

      if (paneRect) {
        const paneLeft = paneRect.left - rootRect.left
        const paneRight = paneRect.right - rootRect.left
        left = paneRight - popupW - 2
        left = Math.max(paneLeft + margin, left)
      } else if (left + popupW > rootW - margin) {
        left = btnRect.right - rootRect.left - popupW
      }
      left = Math.max(margin, Math.min(left, rootW - popupW - margin))
    }
    this.bookmarkPopupX = left

    const anchorBottom = titleRect ? titleRect.bottom : (btnRect.bottom + 4)
    let top = anchorBottom - rootRect.top

    const spaceBelowRoot = Math.max(96, rootRect.bottom - anchorBottom - margin)
    const spaceBelowPane = paneRect
      ? Math.max(96, paneRect.bottom - anchorBottom - margin)
      : spaceBelowRoot
    let maxH = Math.min(idealH, spaceBelowRoot, spaceBelowPane)

    if (top + maxH > rootH - margin) {
      top = Math.max(margin, rootH - margin - maxH)
    }
    if (top + maxH > rootH - margin) {
      maxH = Math.max(96, rootH - margin - top)
    }
    this.bookmarkPopupY = top
    this.bookmarkPopupMaxH = maxH

    const arrowSize = 12
    const arrowLeft = btnRect.left + btnRect.width / 2 - rootRect.left - left - arrowSize / 2
    this.bookmarkArrowLeft = Math.max(12, Math.min(popupW - 24, arrowLeft))
    this._bookmarkJustOpened = true
    this.showBookmarks = true
    queueMicrotask(() => { this._bookmarkJustOpened = false })
  }

  closeBookmarks(): void {
    this.showBookmarks = false
    this.bookmarkAddScope = null
    this._editingBookmarkId = null
    this.newBookmarkName = ''
    this.newBookmarkPath = ''
  }

  openBookmarkAddForm(scope: 'connection' | 'global'): void {
    if (this.bookmarkAddScope === scope) {
      this.bookmarkAddScope = null; return
    }
    this.bookmarkAddScope = scope
    this.newBookmarkPath = this.bookmarkPane === 'local' ? this.localPath : this.remotePath
    this.newBookmarkName = ''
  }

  getAllBookmarksForPane(): Bookmark[] {
    return this.bookmarks.getByType(this.bookmarkPane).filter(b => {
      if (!b.connectionKey) return true

      return b.connectionKey === this.hostInfo
    })
  }

  getBookmarksForPaneType(scope: 'connection' | 'global'): Bookmark[] {
    if (scope === 'global') {
      return this.bookmarks.getGlobal().filter(b => b.type === this.bookmarkPane)
    }

    return this.bookmarks.getByConnection(this.hostInfo).filter(b => b.type === this.bookmarkPane)
  }

  addBookmark(): void {
    const n = this.newBookmarkName.trim(); const bp = this.newBookmarkPath.trim()
    if (!bp) return
    const name = n || (this.bookmarkPane === 'local'
      ? path.basename(bp)
      : path.posix.basename(bp)) || bp

    if (this._editingBookmarkId) {
      this.bookmarks.update(this._editingBookmarkId, { name, path: bp })
      this._editingBookmarkId = null
      this.newBookmarkName = ''; this.newBookmarkPath = ''; this.bookmarkAddScope = null
      return
    }

    const type = this.bookmarkPane

    const ck = this.bookmarkAddScope === 'connection' ? this.hostInfo : undefined

    const existing = this.bookmarks.getByPath(bp, type)
    if (existing && existing.connectionKey === ck) {
      this.bookmarks.update(existing.id, { name })
      this.newBookmarkName = ''; this.newBookmarkPath = ''; this.bookmarkAddScope = null
      return
    }

    const created = this.bookmarks.add(name, bp, type, ck)
    if (!created) {

      return
    }
    this.newBookmarkName = ''; this.newBookmarkPath = ''; this.bookmarkAddScope = null
  }

  cancelBookmarkEdit(): void {
    this._editingBookmarkId = null
    this.newBookmarkName = ''
    this.newBookmarkPath = ''
    this.bookmarkAddScope = null
  }

  removeBookmark(id: string): void { this.bookmarks.remove(id) }

  onBookmarkContextMenu(bm: Bookmark, ev: MouseEvent): void {
    ev.preventDefault()
    ev.stopPropagation()

    this.bookmarkAddScope = bm.connectionKey ? 'connection' : 'global'
    this.newBookmarkName = bm.name
    this.newBookmarkPath = bm.path
    this._editingBookmarkId = bm.id
    this.cdr.detectChanges()
  }

  gotoBookmark(bm: Bookmark): void {
    const target = normalizeBookmarkPath(bm.path, bm.type) || bm.path
    if (bm.type === 'local') {
      this._pushLocalNav(target)
      this.localPath = target; this.localPathInput = target; this.saveCurrentPath(); void this.refreshLocal()
    } else {
      this._pushRemoteNav(target)
      this.remotePath = target; this.remotePathInput = target; this.saveCurrentPath(); void this.refreshRemote()
    }

    if (this.closeBookmarkPanelOnSelect) {
      this.closeBookmarks()
    }
  }

  onBookmarkDragStart(ev: DragEvent, index: number, scope: BookmarkScope): void {
    this.dragSourceIdx = index
    this.dragSourceScope = scope
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move'
      ev.dataTransfer.setData('text/plain', String(index))
    }
  }

  onBookmarkDragOver(ev: DragEvent, index: number, scope: BookmarkScope): void {

    if (scope !== this.dragSourceScope) return
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
    this.dragOverIdx = index
    this.dragOverScope = scope

    const el = ev.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    this.dragOverBottom = ev.clientY > rect.top + rect.height / 2
  }

  onBookmarkDragEnd(): void {
    this.dragSourceIdx = -1
    this.dragOverIdx = -1
    this.dragOverBottom = false
  }

  onBookmarkDrop(ev: DragEvent, targetIdx: number, scope: BookmarkScope): void {
    ev.preventDefault()

    if (scope !== this.dragSourceScope) return

    const srcIdx = this.dragSourceIdx
    const dropBottom = this.dragOverBottom
    this.dragSourceIdx = -1
    this.dragOverIdx = -1
    this.dragOverBottom = false
    if (srcIdx < 0 || srcIdx === targetIdx) return

    const list = scope === 'all'
      ? this.getAllBookmarksForPane()
      : this.getBookmarksForPaneType(scope)
    if (srcIdx >= list.length || targetIdx >= list.length) return

    const all = this.bookmarks.getAll()
    const moved = list[srcIdx]
    const targetItem = list[targetIdx]
    if (!moved || !targetItem) return
    const fromAllIdx = all.findIndex(b => b.id === moved.id)
    const toAllIdx = all.findIndex(b => b.id === targetItem.id)
    if (fromAllIdx < 0 || toAllIdx < 0) return

    let adjustedTo: number
    if (fromAllIdx < toAllIdx) {
      adjustedTo = dropBottom ? toAllIdx : toAllIdx - 1
    } else {
      adjustedTo = dropBottom ? toAllIdx + 1 : toAllIdx
    }
    if (adjustedTo === fromAllIdx) return
    this.bookmarks.reorder(fromAllIdx, adjustedTo)
  }
}
