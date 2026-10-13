/**
 * SFTP++ 文件冲突对话框（从主面板抽离）
 * 功能描述：上传/下载覆盖冲突确认对话框，展示本地/远程两侧文件大小、修改时间、路径供用户选择
 * @创建人：DD1024z + Hy3
 * @创建时间：2026-07-16
 * @修改人：DD1024z + Deepseek-V4.1-Flash
 * @修改时间：2026-09-29 — 两侧内容摘要相同时，「跳过」按钮加绿色高亮（.conflict-btn-skip--identical：
 *              绿色描边 + 浅绿底，与绿色提示条同色，不做实心填充以免抢「覆盖」的主次）——
 *              与 onKeyDown 的 Enter 默认动作（skip）语义对齐，让非破坏性默认项一眼可辨；
 *              内容不同时不加该类，保持普通次要按钮外观
 *              2026-09-21 — 冲突文件名旁图标改用与列表一致的彩色 SVG（fileIconUrl），无映射时回退 emoji
 *              2026-09-21 — 清理过期焦点定时器，并将 Enter 默认动作改为安全的跳过；
 *              右上角增加 × 关闭按钮（等同「取消」）；窄分栏紧凑/可滚动布局
 *              2026-09-21 — 窄分栏：对话框约束在面板内（max 100%）、对比区可滚动、矮/窄启用紧凑样式，避免底部操作被裁切
 *              2026-09-17 — 无效/epoch 修改时间不显示 1970；mtime 对比忽略未就绪值
 *              2026-09-17 — 目录大小扫描中显示「计算中…」；目录冲突文案按方向区分本地/远程
 *              2026-09-07 — issue #15：两侧新增内容摘要行，内容实际相同时显示绿色提示
 */
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'
import type { ConflictFileInfo } from '../core/panel-types'
import { formatDate, formatSize } from '../core/file-utils'

@Component({
  selector: 'sftp-conflict-dialog',
  template: require('./sftp-conflict-dialog.component.view.html'),
  styles: [require('./sftp-conflict-dialog.component.view.css')],
})
export class SftpConflictDialogComponent implements OnChanges, OnDestroy {
  @Input() visible = false
  @Input() data: ConflictFileInfo | null = null
  /** 与文件列表一致的彩色 SVG 图标 URL（file://...）；空则回退 emoji */
  @Input() fileIconUrl: string | null = null
  @Input() currIdx = 1
  @Input() totalIdx = 1
  @Output() resolve = new EventEmitter<string>()
  @ViewChild('overlayEl', { static: false }) overlayEl?: ElementRef<HTMLDivElement>

  formatSize = formatSize
  formatDate = formatDate

  /** 窄/矮分栏时启用紧凑样式 */
  compact = false
  private _focusTimer: ReturnType<typeof setTimeout> | null = null
  private _ro: ResizeObserver | null = null

  constructor(private cdr: ChangeDetectorRef) {}

  /** 过滤 Unix epoch / 0，避免冲突框误显示 1970-01-01 */
  formatConflictMtime(ms?: number): string {
    if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) < 86400000) return '—'
    return formatDate(ms)
  }

  /** 两侧都有有效 mtime 且不相等时才标 ≠ */
  get mtimeDiffers(): boolean {
    const d = this.data
    if (!d) return false
    const localOk = d.localMtime != null && Number(d.localMtime) >= 86400000
    const remoteOk = d.remoteMtime != null && Number(d.remoteMtime) >= 86400000
    if (!localOk || !remoteOk) return false
    return d.localMtime !== d.remoteMtime
  }

  /** 两端都有摘要且不相等时标 ≠（摘要行高亮） */
  get digestDiffers(): boolean {
    const d = this.data
    if (!d) return false
    if (!d.localDigest || !d.remoteDigest) return false
    return d.localDigest !== d.remoteDigest
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      if (this.visible) {
        if (this._focusTimer) clearTimeout(this._focusTimer)
        this._focusTimer = setTimeout(() => {
          this._focusTimer = null
          this.overlayEl?.nativeElement?.focus()
          this._bindCompactObserver()
        })
      } else {
        if (this._focusTimer) {
          clearTimeout(this._focusTimer)
          this._focusTimer = null
        }
        this._unbindCompactObserver()
        this.compact = false
      }
    }
  }

  ngOnDestroy(): void {
    if (this._focusTimer) {
      clearTimeout(this._focusTimer)
      this._focusTimer = null
    }
    this._unbindCompactObserver()
  }

  private _bindCompactObserver(): void {
    this._unbindCompactObserver()
    const el = this.overlayEl?.nativeElement
    if (!el || typeof ResizeObserver === 'undefined') {
      this._updateCompactFromSize(el?.clientWidth ?? 0, el?.clientHeight ?? 0)
      return
    }
    this._ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      this._updateCompactFromSize(cr.width, cr.height)
    })
    this._ro.observe(el)
    this._updateCompactFromSize(el.clientWidth, el.clientHeight)
  }

  private _unbindCompactObserver(): void {
    try { this._ro?.disconnect() } catch { /* ignore */ }
    this._ro = null
  }

  private _updateCompactFromSize(w: number, h: number): void {
    // 高度不足以舒适放下「双栏对比 + 按钮」或宽度明显窄于理想对话框时启用紧凑
    const next = (h > 0 && h < 480) || (w > 0 && w < 420)
    if (next === this.compact) return
    this.compact = next
    try { this.cdr.detectChanges() } catch { /* ignore */ }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      // 与右上角 × /「取消」一致，关闭对话框而不跳过当前项
      this.resolve.emit('cancel')
    }
    // 冲突对话框的 Enter 使用非破坏性默认动作，避免误触直接覆盖本地或远程文件。
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.resolve.emit('skip')
    }
  }

  /** ★ 2026-08-17：格式化后相同但字节数不同时，括号内显示精确值 */
  /** ★ 2026-09-07 issue #15：宽屏显示完整摘要；紧凑模式截断，完整值仍在 title */
  shortDigest(d?: string | null): string {
    if (!d) return ''
    if (this.compact && d.length > 18) return `${d.slice(0, 8)}…${d.slice(-6)}`
    return d
  }

  /** 任一侧仍在扫描目录大小时，不标差异，避免「计算中」对数字误闪 ≠ */
  get sizeDiffers(): boolean {
    const d = this.data
    if (!d || d.localSizePending || d.remoteSizePending) return false
    return d.localSize !== d.remoteSize
  }

  get localSizeLabel(): string {
    const d = this.data
    if (!d) return ''
    if (d.localSizePending) return this.i18n.t('file.sizeCalculating')
    return this.formatSizeWithPrecision(d.localSize, d.remoteSizePending ? d.localSize : d.remoteSize)
  }

  get remoteSizeLabel(): string {
    const d = this.data
    if (!d) return ''
    if (d.remoteSizePending) return this.i18n.t('file.sizeCalculating')
    return this.formatSizeWithPrecision(d.remoteSize, d.localSizePending ? d.remoteSize : d.localSize)
  }

  formatSizeWithPrecision(bytes: number, otherBytes: number): string {
    const formatted = formatSize(bytes)
    if (bytes !== otherBytes && formatted === formatSize(otherBytes)) {
      return `${formatted} (${bytes.toLocaleString()} B)`
    }
    return formatted
  }

  /** ★ 2026-08-11：冲突方向标签（复用既有键拼装，无需新 i18n）：
   *  上传 → 「⬆ 上传：本地 → 远程」；下载 → 「⬇ 下载：远程 → 本地」；同面板冲突不显示 */
  get directionLabel(): string {
    const d = this.data
    if (!d || d.isSamePane) return ''
    const local = this.i18n.t('pane.local')
    const remote = this.i18n.t('pane.remote')
    return d.direction === 'download'
      ? `⬇ ${this.i18n.t('transfer.download')}：${remote} → ${local}`
      : `⬆ ${this.i18n.t('transfer.upload')}：${local} → ${remote}`
  }

  @Input() i18n!: SftpI18nService
}
