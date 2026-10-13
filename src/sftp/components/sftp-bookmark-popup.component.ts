import { featureApis, invokeFeature, readFeature, writeFeature } from "../../features/api"
﻿/**
 * SFTP++ 书签悬浮菜单（从主面板抽离）
 * 创建人：DD1024z + Hy3
 * 创建时间：2026-08-18
 * 修改人：DD1024z + Composer
 * 修改时间：2026-09-21 — 支持父级动态 width/maxHeight（多拆分窄窗 clamp）
 *              2026-09-20 — 支持设置项：是否按连接/全局分组；分组顺序可定制；
 *              关闭分组后可跨范围自由拖拽，全局书签名称右侧显示「全局」标签；
 *              头部增加「定位当前书签」按钮，滚动到路径匹配项并短暂闪烁
 */
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
  /** 弹层宽度（父级按面板可用空间 clamp） */
  @Input() width = 320
  /** 弹层最大高度（父级按面板剩余高度 clamp） */
  @Input() maxHeight = 420
  @Input() paneLabel = ''
  @Input() pane: 'local' | 'remote' = 'local'
  @Input() addScope: 'connection' | 'global' | null = null
  @Input() newName = ''
  @Input() newPath = ''
  @Input() editingId: string | null = null
  @Input() connectionBookmarks: Bookmark[] = []
  @Input() globalBookmarks: Bookmark[] = []
  /** 扁平模式用的混排列表（保持书签数组中的相对顺序） */
  @Input() allBookmarks: Bookmark[] = []
  /** 是否按连接/全局分组（来自设置） */
  @Input() groupByScope = true
  /** 分组块顺序 */
  @Input() groupOrder: Array<'connection' | 'global'> = ['connection', 'global']
  @Input() dragSourceIdx = -1
  @Input() dragSourceScope: BookmarkScope | null = null
  @Input() dragOverIdx = -1
  @Input() dragOverScope: BookmarkScope | null = null
  @Input() dragOverBottom = false
  /** 当前面板路径（local/remote 当前目录），用于高亮路径匹配的书签 */
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

  /** 定位闪烁中的书签 id */
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

  /** 路径归一化：统一分隔符、去尾部斜杠；本地路径按 Windows 大小写不敏感处理 */
  private _normPath(p: string): string {
    if (!p) return ''
    let s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    if (this.pane === 'local') s = s.toLowerCase()
    return s
  }

  /** 该书签路径是否与当前面板路径一致（用于高亮） */
  isCurrent(b: Bookmark): boolean {
    if (!this.currentPath) return false
    return this._normPath(b.path) === this._normPath(this.currentPath)
  }

  /** 列表中是否存在与当前路径匹配的书签（控制定位按钮可用性） */
  get hasCurrentBookmark(): boolean {
    return this._currentMatches().length > 0
  }

  /** 按当前 UI 顺序收集路径匹配的书签 */
  private _currentMatches(): Bookmark[] {
    if (!this.currentPath) return []
    const list = this.groupByScope
      ? this.groupOrder.flatMap(scope => this.bookmarksOf(scope))
      : this.allBookmarks
    return list.filter(b => this.isCurrent(b))
  }

  /**
   * 滚动到当前路径对应的书签；若有多项同路径则循环定位。
   */
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
