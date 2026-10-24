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
