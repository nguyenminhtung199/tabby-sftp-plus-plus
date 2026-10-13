/**
 * SFTP++ 传输队列面板（从主面板抽离）
 * 创建人：DD1024z + Hy3
 * 创建时间：2026-07-11
 * 修改人：DD1024z + Deepseek-V4.1-Flash
 * 修改时间：2026-09-26 — 新增「预估剩余时间」显示（etaText）：用 bytesTotal/bytesDone 与
 *              EMA 平滑后的数值速率 speedBps 估算，随速度/百分比一同展示；总量未知、
 *              暂停、排队、已跳过、或字节停止推进 >5s 时自动隐藏，不给假数字
 *              （⚠「停流即隐藏」已于当日二次修正中**删除**，见下方最后一条）
 *              2026-09-26 — 传输方式标签配色与「传输记录」对话框统一（以记录面板为基准）：
 *              原 📦打包加速=绿 #22c55e、且无描边，记录面板则是
 *              📦青 #26c6da、⚡橙 #ff9800、带 1px 描边 —— 同一笔传输在两个面板显示成两个
 *              颜色（用户截图比对指出）。现两处逐字一致；绿色另留给「成功」语义避免误读
 *              2026-09-26 — 进度条改「跨两列铺满整行」(.bar 加 grid-column: 1/-1)，同时放宽
 *              ETA 停显阈值 5s→30s 并给 ETA 固定槽位宽度。原先进度条装在 .transfer-main 内，
 *              而 .transfer 是 grid 1fr/auto —— 右侧 stats 一旦多出「剩余 3m36s」，第一列
 *              就被压窄，进度条右端实测从 x=1421 缩到 x=1347（用户两图比对：「没延续到
 *              右边」且长度来回跳）。ETA 的 5s 阈值又短于一次 russh 读重试周期（10s 硬超时
 *              + 最长 3s 退避），配合「delta=0 时速度保留旧值」不闪烁的设计，就出现「速度
 *              还在、剩余时间忽有忽无」。现进度条宽度只取决于面板宽度
 *              2026-09-26 — ETA 去掉固定槽位宽（用户二次反馈「剩余时间和进度间距太大」）：
 *              像素实测「76%」与「剩余 5s」之间空 58px，而下一条 flex gap 只有 16px ——
 *              多出的 ~42px 就是 `min-width: 76px; text-align: right` 里短文本吃不掉的槽位
 *              （「剩余 5s」只占 ~34px，右对齐把余量全顶在左侧）。进度条跨整行后槽位防抖
 *              已无意义（抖动影响不到进度条），改为宽度跟随内容；同时给 ETA 加 `*ngIf`，
 *              空串时整段不渲染 —— 只留空 span 它仍是 flex item，会白吃左右各一个 gap
 *              2026-09-26 — 剩余时间两处修正（用户第三次反馈）：
 *              ① **删掉「停流即隐藏」（原 ETA_STALL_HIDE_MS）**：文件夹通道的 bytesDone 只在
 *                 「一个文件传完」时跳变（transfer-ops 里 `ctx.bytesDone += sz` 之后才上报），
 *                 一个 84.9MB 的文件传 8 分钟期间没有任何进度事件 ⇒ 按停流隐藏会把**正在传输**
 *                 的剩余时间抹掉。用户明确要求「即便是没有变化，起码也要显示着之前的预估不要
 *                 消失」。现在只要测到过可信速率就始终显示，**不再有任何时间条件参与判定**
 *                 （顺带彻底消除「忽有忽无」）。估算 >24h 时用 `>24h` 占位，仍是「有值」。
 *              ② 配合面板侧修掉「首个速度窗口 deltaTime=纪元毫秒 ⇒ 速率 1e-9」的毒值
 *                 （见 sftp-floating-panel.component.ts 的 _updateFolderProgress），
 *                 本文件不再读取已删除的 `lastProgressAt` 字段
 *              2026-09-26 — 剩余时间三次修正（用户第四次反馈「似乎又完全不会动了」）：
 *              发散与停摆统一显示 `∞`（原 `>24h`）—— `speedBps` 被如实置 0 时（面板/
 *              协调器连续 15s 零字节推进，见 SPEED_STALL_ZERO_MS）也走同一占位；
 *              而「从未测到速率」仍返回空串，避免开传瞬间先闪一句 ∞。
 *              目录条目本身也改为字节级实时上报（见 transfer-ops 的 downloadRaw onProgress），
 *              整行在单个大文件期间不再静止
 */
import { Component, EventEmitter, Input, Output } from '@angular/core'

import { SftpI18nService } from '../../services/sftp-i18n.service'
import type { PanelTransferItem } from '../core/panel-types'
import { formatPercent, formatSize } from '../core/file-utils'

/**
 * ★ 2026-09-26（二次修正，取代当日的「停流即隐藏」）：**剩余时间一旦测到就不再消失**。
 *
 * 原设计：字节停止推进超过 `ETA_STALL_HIDE_MS`（先 5s 后 30s）即停显，怕拿旧速度算出假预估。
 * 用户实测否掉了这个设计，两条都不成立：
 *  ① **文件夹通道的 bytesDone 只在「一个文件传完」时跳变**（见 transfer-ops 里
 *     `ctx.bytesDone += sz` 之后才上报 progress）—— 一个 84.9MB 的文件传 8 分钟期间
 *     **没有任何进度事件**，于是「停流 >30s 就隐藏」会把**正在正常传输**的剩余时间抹掉；
 *  ② 速度文本本身就是「delta=0 时保留旧值」的语义（避免卡顿闪烁）。剩余时间必须与它同一套
 *     语义 —— 用户原话：「即便是没有变化，起码也要显示着之前的预估剩余时间不要消失呀」。
 *
 * 于是：**只要已经测到过可信速率就始终显示**；只有「还没测到速率」（开传瞬间、排队、暂停、
 * 总量未知）才是空的。这同时彻底消除了「忽有忽无」的抖动 —— 不再有任何时间条件参与显示判定。
 *
 * ★ 2026-09-26（三次修正，用户：「这次似乎又完全不会动了 …… 如果剩余时间很大，那就显示
 *   一个无穷大的字符吧 ∞」）：把「发散」的表现从 `>24h` 改成 **`∞`**，并补上「速率已被
 *   确证为 0」（通道停摆，面板/协调器零推进超阈值会这么置）→ 也显示 `∞`。
 *   与保留旧速率的区别很关键：**旧速率是「上一次的真实测量」，0 是「当前的真实状态」** ——
 *   停摆时只有后者能让用户一眼看出「没在动」，而不是对着一动不动的假数字猜。
 */

/** 剩余时间「发散」上限：超过 24 小时不再给具体数字，改用 `∞` 占位。
 *  注意这不等于「隐藏」：文案骨架保留（用户要求留着），只是不给一个没有参考价值的天文数字。
 *  它同时兜住「速率趋近 0」（如链路每窗口只推进 1 字节）算出的「几百年」。 */
const ETA_MAX_SEC = 24 * 60 * 60
/** 发散 / 停摆时的占位符：作为 `{time}` 传入 `transfer.etaRemaining` → 显示成「剩余 ∞」。
 *  用真符号而不是 `>24h` 这类文字：一是不必按语言翻译，二是「无限久」的语义直白
 *  （用户明确要求），三是**位置与骨架不变**，不会像隐藏那样让整段消失。 */
const ETA_INFINITE_TEXT = '∞'

@Component({
  selector: 'sftp-transfer-queue',
  template: require('./sftp-transfer-queue.component.view.html'),
  styles: [require('./sftp-transfer-queue.component.view.css')],
})
export class SftpTransferQueueComponent {
  @Input() transfers: PanelTransferItem[] = []
  @Input() hidden = false
  @Input() minimized = false
  @Output() hiddenChange = new EventEmitter<boolean>()
  @Output() minimizeChange = new EventEmitter<boolean>()
  @Output() pause = new EventEmitter<PanelTransferItem>()
  @Output() resume = new EventEmitter<PanelTransferItem>()
  @Output() cancel = new EventEmitter<PanelTransferItem>()
  @Output() cancelCurrent = new EventEmitter<PanelTransferItem>()

  formatSize = formatSize
  formatPercent = formatPercent
  @Input() i18n!: SftpI18nService

  /** trackBy：按对象引用，避免 200ms 传输 tick 触发 detectChanges 时重建所有传输行 DOM */
  trackByTransfer = (_: number, t: PanelTransferItem): PanelTransferItem => t

  /** 紧凑徽章文案（空间有限）；悬停看完整方向说明 */
  directionBadge(t: PanelTransferItem): string {
    return t.direction === 'upload'
      ? `⬆ ${this.i18n.t('transfer.upload')}`
      : `⬇ ${this.i18n.t('transfer.download')}`
  }

  directionTitle(t: PanelTransferItem): string {
    const local = this.i18n.t('pane.local')
    const remote = this.i18n.t('pane.remote')
    return t.direction === 'upload'
      ? `⬆ ${this.i18n.t('transfer.upload')}：${local} → ${remote}`
      : `⬇ ${this.i18n.t('transfer.download')}：${remote} → ${local}`
  }

  /** 排队中尚未开传时不标方式；开传后缺省按 SFTP 展示 */
  modeOf(t: PanelTransferItem): 'sftp' | 'tar' | null {
    if (t.queued || t.skippedAsDuplicate) return null
    if (t.transferMode === 'tar' || t.transferMode === 'sftp') {
      return t.transferMode
    }
    return 'sftp'
  }

  /**
   * ★ 2026-09-26：预估剩余时间（“剩余 1m23s”）。
   *
   * 数据来自 `bytesTotal - bytesDone` 与 EMA 平滑后的 `speedBps`，两者都由各 tick 维护。
   * 返回空串的**唯一**原因就是「还不存在可信速率」，绝不因为「时间过去了」而撤回：
   * - 暂停 / 排队中 / 已跳过：不产生字节，算出来的只是噪声；
   * - `bytesTotal <= 0`：扫描失败/兜底时总量未知，无从估算（这是最常见的「显示 --」原因）；
   * - `bytesDone <= 0`：一个字节都还没落地，没有速度可测；
   * - `speedBps` 不是有限数字（undefined/NaN）：**从未测到过速率** —— 开传瞬间会短暂空一下，
   *   随即显示并**保持住**。
   *
   * ⚠ 2026-09-26 二次修正：**已删除**原先的「停流超时即隐藏」（原 `ETA_STALL_HIDE_MS`）。
   *   文件夹通道的 bytesDone 只在「一个文件传完」时跳变，大文件传输期间长时间没有进度事件是
   *   **正常**的；按停流隐藏会把正在传输的剩余时间抹掉（用户实测）。详见文件头常量处注释。
   *   估算超过 `ETA_MAX_SEC`（24h）时显示 `∞` —— 仍是「有值」，不是消失。
   *
   * ⚠ 2026-09-26 三次修正：`speedBps === 0` 与「s>0 但 ETA 发散」一样显示 `∞`。
   *   0 不是「没测到」，而是面板/协调器在**连续零推进超阈值后如实写入的当前状态**
   *   （见 SPEED_STALL_ZERO_MS）：此时显示 ∞ 才是真相，而继续挂着旧速率会让人
   *   对着一动不动的界面猜「到底卡了还是在跑」（用户第四次反馈的原话）。
   */
  etaText(t: PanelTransferItem): string {
    if (t.paused || t.queued || t.skippedAsDuplicate) return ''
    if (!(t.bytesTotal > 0) || !(t.bytesDone > 0)) return ''
    // ★ 2026-09-26：区分「从未测到速率」与「测到过、当前为 0」——
    //   前者（开传瞬间/排队前）不显示，否则一开传就先闪一句「剩余 ∞」；
    //   后者是面板/协调器在连续零推进后如实置的 0，代表**通道此刻没在动**，显示 ∞ 才对。
    const bps = t.speedBps
    if (typeof bps !== 'number' || !isFinite(bps)) return ''
    const remain = t.bytesTotal - t.bytesDone
    if (remain <= 0) return ''
    if (bps <= 0) return this.i18n.t('transfer.etaRemaining', { time: ETA_INFINITE_TEXT })
    const sec = remain / bps
    const time = sec > ETA_MAX_SEC ? ETA_INFINITE_TEXT : this._formatEta(sec * 1000)
    return this.i18n.t('transfer.etaRemaining', { time })
  }

  /** 剩余时间格式化：`38s` / `2m05s` / `1h07m`。与 formatDuration 的差别在于
   *  不显示毫秒、分钟以下不保留小数 —— ETA 是估算，给 `2.3s` 这种精度纯属误导。 */
  private _formatEta(ms: number): string {
    const sec = Math.max(1, Math.round(ms / 1000))
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m${String(sec % 60).padStart(2, '0')}s`
    const hr = Math.floor(min / 60)
    return `${hr}h${String(min % 60).padStart(2, '0')}m`
  }
}
