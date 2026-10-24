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

  @Input() fileIconUrl: string | null = null
  @Input() currIdx = 1
  @Input() totalIdx = 1
  @Output() resolve = new EventEmitter<string>()
  @ViewChild('overlayEl', { static: false }) overlayEl?: ElementRef<HTMLDivElement>

  formatSize = formatSize
  formatDate = formatDate

  compact = false
  private _focusTimer: ReturnType<typeof setTimeout> | null = null
  private _ro: ResizeObserver | null = null

  constructor(private cdr: ChangeDetectorRef) {}

  formatConflictMtime(ms?: number): string {
    if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) < 86400000) return '—'
    return formatDate(ms)
  }

  get mtimeDiffers(): boolean {
    const d = this.data
    if (!d) return false
    const localOk = d.localMtime != null && Number(d.localMtime) >= 86400000
    const remoteOk = d.remoteMtime != null && Number(d.remoteMtime) >= 86400000
    if (!localOk || !remoteOk) return false
    return d.localMtime !== d.remoteMtime
  }

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

    const next = (h > 0 && h < 480) || (w > 0 && w < 420)
    if (next === this.compact) return
    this.compact = next
    try { this.cdr.detectChanges() } catch { /* ignore */ }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()

      this.resolve.emit('cancel')
    }

    if (event.key === 'Enter') {
      // Preserve native Enter activation for the focused action button.
      event.stopPropagation()
      if ((event.target as HTMLElement | null)?.closest?.('button')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      this.resolve.emit('skip')
    }
  }

  shortDigest(d?: string | null): string {
    if (!d) return ''
    if (this.compact && d.length > 18) return `${d.slice(0, 8)}…${d.slice(-6)}`
    return d
  }

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
      return `${formatted} (${bytes.toLocaleString('en-US')} B)`
    }
    return formatted
  }

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
