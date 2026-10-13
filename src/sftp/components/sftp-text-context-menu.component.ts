/**
 * SFTP++ 文本/图片查看·编辑对话框的轻量右键菜单
 * 功能描述：为查看（只读）/编辑（可写）对话框的 textarea / 图片提供右键菜单，
 *            支持 复制选中 / 复制全部 / 复制图片 / 复制地址 / 全选 / 剪切 / 粘贴。
 * 创建人：DD1024z + Hy3
 * 创建时间：2026-08-24
 * @修改人：DD1024z + Claude Opus 5
 * @修改时间：2026-09-21 — P2 修复：菜单坐标经视口 clamp，靠窗口右/下边缘打开时不再被裁切
 *              2026-08-26 — 关闭机制最终定案：overlay 模板 (click)；本组件只保留 Esc/滚轮/缩放
 *              2026-08-26 — OnPush + 仅在 visible 时挂 document 监听，避免无菜单时每个
 *                            keydown/wheel 都脏检查；配合父对话框区外打开菜单消卡顿
 */
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'

export type TextMenuAction =
  | 'copySelection' | 'copyAll' | 'copyAddress' | 'cut' | 'paste' | 'selectAll'

@Component({
  selector: 'sftp-text-context-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: require('./sftp-text-context-menu.component.view.html'),
  styles: [require('./sftp-text-context-menu.component.view.css')],
})
export class SftpTextContextMenuComponent implements OnChanges, OnDestroy {
  @ViewChild('menuEl') menuEl?: ElementRef<HTMLDivElement>

  @Input() visible = false
  @Input() x = 0
  @Input() y = 0
  @Input() mode: 'text' | 'image' = 'text'
  @Input() editable = false
  @Input() hasSelection = false
  @Input() canPaste = false
  @Input() hasImage = false
  @Input() hasAddress = false

  @Output() action = new EventEmitter<TextMenuAction>()
  @Output() close = new EventEmitter<void>()

  @Input() i18n!: SftpI18nService

  private _docListening = false
  private readonly _onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.visible || ev.key !== 'Escape') return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    this.zone.run(() => this.close.emit())
  }
  private readonly _onWheelOrResize = (): void => {
    if (!this.visible) return
    this.zone.run(() => this.close.emit())
  }

  constructor(
    private readonly zone: NgZone,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  /**
   * ★ 2026-09-21 P2 修复：实际渲染坐标（经视口 clamp）。
   * 原先直接用 clientX/clientY 定位，在窗口右/下边缘打开菜单会被裁切掉一部分项。
   * 文件列表菜单早有 _clampMenu，这里补齐同样处理。
   */
  left = 0
  top = 0
  private _clampTimer: ReturnType<typeof setTimeout> | null = null

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      if (this._clampTimer) { clearTimeout(this._clampTimer); this._clampTimer = null }
      if (this.visible) {
        this.left = this.x
        this.top = this.y
        this._attachDocListeners()
        // 渲染后量实际尺寸再回收到视口内（此时 *ngIf 已生成节点）
        this.zone.runOutsideAngular(() => {
          this._clampTimer = setTimeout(() => {
            this._clampTimer = null
            this._clampIntoViewport()
          })
        })
      } else {
        this._detachDocListeners()
      }
    } else if (changes['x'] || changes['y']) {
      this.left = this.x
      this.top = this.y
    }
    this.cdr.markForCheck()
  }

  private _clampIntoViewport(): void {
    const el = this.menuEl?.nativeElement
    if (!el) return
    const PAD = 6
    const rect = el.getBoundingClientRect()
    let left = this.x
    let top = this.y
    if (left + rect.width > window.innerWidth - PAD) left = Math.max(PAD, window.innerWidth - rect.width - PAD)
    if (top + rect.height > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - rect.height - PAD)
    if (left === this.left && top === this.top) return
    this.zone.run(() => {
      this.left = left
      this.top = top
      this.cdr.markForCheck()
    })
  }

  ngOnDestroy(): void {
    if (this._clampTimer) { clearTimeout(this._clampTimer); this._clampTimer = null }
    this._detachDocListeners()
  }

  /** 点击菜单项：先关闭再向上派发动作 */
  do(a: TextMenuAction): void {
    if (!this.editable && (a === 'cut' || a === 'paste')) return
    if ((a === 'copySelection' || a === 'cut') && !this.hasSelection) return
    if (a === 'paste' && !this.canPaste) return
    if ((a === 'copyAll' && this.mode === 'image') && !this.hasImage) return
    if (a === 'copyAddress' && !this.hasAddress) return
    this.close.emit()
    this.action.emit(a)
  }

  private _attachDocListeners(): void {
    if (this._docListening) return
    this._docListening = true
    // ★ 在 Angular zone 外挂监听：避免菜单打开期间每个 keydown/wheel 触发整树 CD
    this.zone.runOutsideAngular(() => {
      document.addEventListener('keydown', this._onKeyDown, true)
      document.addEventListener('wheel', this._onWheelOrResize, { capture: true, passive: true })
      window.addEventListener('resize', this._onWheelOrResize)
    })
  }

  private _detachDocListeners(): void {
    if (!this._docListening) return
    this._docListening = false
    document.removeEventListener('keydown', this._onKeyDown, true)
    document.removeEventListener('wheel', this._onWheelOrResize, true)
    window.removeEventListener('resize', this._onWheelOrResize)
  }
}
