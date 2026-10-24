import { featureApis, invokeFeature, readFeature, writeFeature } from "../../features/api"
﻿

import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core'

import { Bookmark } from '../../services/sftp-bookmarks.service'
import { SftpI18nService } from '../../services/sftp-i18n.service'
import type { BookmarkScope } from '../core/panel-types'

@Component({
  selector: 'sftp-bookmark-popup',
  template: require('./sftp-bookmark-popup.component.view.html'),
  styles: [require('./sftp-bookmark-popup.component.view.css')],
})
export class SftpBookmarkPopupComponent {
  @ViewChild('bookmarkList') private bookmarkList?: ElementRef<HTMLElement>

  @Input() top = 0
  @Input() left = 0
  @Input() arrowLeft = 0

  @Input() width = 320

  @Input() maxHeight = 420
  @Input() paneLabel = ''
  @Input() pane: 'local' | 'remote' = 'local'
  @Input() addScope: 'connection' | 'global' | null = null
  @Input() newName = ''
  @Input() newPath = ''
  @Input() editingId: string | null = null
  @Input() connectionBookmarks: Bookmark[] = []
  @Input() globalBookmarks: Bookmark[] = []

  @Input() allBookmarks: Bookmark[] = []

  @Input() groupByScope = true

  @Input() groupOrder: Array<'connection' | 'global'> = ['connection', 'global']
  @Input() dragSourceIdx = -1
  @Input() dragSourceScope: BookmarkScope | null = null
  @Input() dragOverIdx = -1
  @Input() dragOverScope: BookmarkScope | null = null
  @Input() dragOverBottom = false

  @Input() currentPath = ''

  @Output() addScopeClick = new EventEmitter<'connection' | 'global'>()
  @Output() newNameChange = new EventEmitter<string>()
  @Output() newPathChange = new EventEmitter<string>()
  @Output() addBookmark = new EventEmitter<void>()
  @Output() cancelEdit = new EventEmitter<void>()
  @Output() gotoBookmark = new EventEmitter<Bookmark>()
  @Output() removeBookmark = new EventEmitter<string>()
  @Output() contextMenu = new EventEmitter<{ bookmark: Bookmark; event: MouseEvent }>()
  @Output() dragStart = new EventEmitter<{ event: DragEvent; index: number; scope: BookmarkScope }>()
  @Output() dragOver = new EventEmitter<{ event: DragEvent; index: number; scope: BookmarkScope }>()
  @Output() dragEnd = new EventEmitter<void>()
  @Output() drop = new EventEmitter<{ event: DragEvent; index: number; scope: BookmarkScope }>()
  @Output() close = new EventEmitter<void>()

  @Input() i18n!: SftpI18nService

  flashId: string | null = null
  private _locateCycleIdx = -1
  private _flashTimer: ReturnType<typeof setTimeout> | null = null

  bookmarksOf(scope: 'connection' | 'global'): Bookmark[] {
    return scope === 'connection' ? this.connectionBookmarks : this.globalBookmarks
  }

  scopeLabel(scope: 'connection' | 'global'): string {
    return scope === 'connection'
      ? this.i18n.t('bookmark.forConnection')
      : this.i18n.t('bookmark.global')
  }

  private _normPath(p: string): string {
    if (!p) return ''
    let s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    if (this.pane === 'local') s = s.toLowerCase()
    return s
  }

  isCurrent(b: Bookmark): boolean {
    if (!this.currentPath) return false
    return this._normPath(b.path) === this._normPath(this.currentPath)
  }

  get hasCurrentBookmark(): boolean {
    return this._currentMatches().length > 0
  }

  private _currentMatches(): Bookmark[] {
    if (!this.currentPath) return []
    const list = this.groupByScope
      ? this.groupOrder.flatMap(scope => this.bookmarksOf(scope))
      : this.allBookmarks
    return list.filter(b => this.isCurrent(b))
  }

  locateCurrent(): void {
    const matches = this._currentMatches()
    if (!matches.length) return
    this._locateCycleIdx = (this._locateCycleIdx + 1) % matches.length
    const target = matches[this._locateCycleIdx]
    const listEl = this.bookmarkList?.nativeElement
    const item = listEl
      ? Array.from(listEl.querySelectorAll<HTMLElement>('.bookmark-item[data-bm-id]'))
          .find(el => el.getAttribute('data-bm-id') === target.id) ?? null
      : null
    if (item) {
      item.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    if (this._flashTimer) clearTimeout(this._flashTimer)
    this.flashId = target.id
    this._flashTimer = setTimeout(() => {
      this.flashId = null
      this._flashTimer = null
    }, 900)
  }

  // Controller facade: named source methods, one explicit composition root.
  customTrackRecent(...args: any[]): any { return invokeFeature("Bookmark","customTrackRecent",this,args) }
  @Input() customRecentItems: any
}

export interface SftpBookmarkPopupComponent { [key: string]: any }
