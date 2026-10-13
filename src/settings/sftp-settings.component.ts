import { featureApis, invokeFeature, readFeature, writeFeature } from "../features/api"
﻿/**
 * SFTP++ 设置面板
 * 功能描述：在 Tabby 设置左侧栏注册 SFTP++ 配置入口（语言、主题、布局、其它、数据、关于）
 *   支持双存储模式：Tabby 配置（config.yaml）或 浏览器缓存（localStorage）
 * @创建人：DD1024z + Hy3 preview
 * @创建时间：2026-06-21
 * @修改人：DD1024z + Deepseek-V4.1-Flash
 * @修改时间：2026-09-29 — 导出数据改为「按配置类别可勾选」：点「导出数据」先弹出勾选弹窗
 *              （界面与外观 / 面板与行为 / 传输与冲突 / 书签与记录 / 图标与文件类型，默认全选、
 *              可一键全选·全不选、一类未勾时禁用导出按钮），未勾选的类别**完全不写入** JSON。
 *              安全性来自导入侧的「字段不存在 = 不覆盖」语义 —— 所以「只导外观」的备份导入时
 *              不会清空书签、路径记忆与传输日志。类别→字段映射见 EXPORT_CATEGORY_FIELDS：
 *              ⚠ 新增配置项必须同步登记，否则该字段永远不会被导出（探针会逐键核对）。
 *              ★ 同日二次调整（用户：主要是传输记录要拆出来，其余按设置界面的分类来）：
 *              类别由 5 项改为 9 项，**逐项对齐设置页自己的分区标题与顺序** ——
 *              语言 / 主题 / 布局 / 对象图标 / 其它 / 传输设置 / 快捷键 / 数据 / 传输记录；
 *              「传输记录」(transferLogs) 从原「书签与记录」拆出**独立成项**（它是历史日志、
 *              体积通常最大，备份诉求与其他配置不同）；「数据」项只留书签/路径记忆/面板状态。
 *              类别名直接复用设置页分区标题的 key（settings.language/theme/layout/iconSettings/
 *              other/transferSection/hotkeys/data + transfer.log）⇒ 本次**不新增任何 i18n key**，
 *              并清掉了上一轮为旧分类新增的 5 个 exportCat* key（24 份 .po 同步移除）。
 *              类别增至 9 项 → 新增 .ss-export-list 列表内滚（max-height min(58vh,520px)，常规窗口下 9 行完整可见），
 *              底部按钮不被顶出屏幕。
 *              ★ 同日三次调整（用户：数据改叫「书签数据」、快捷键不要子标题、滚动条对齐 SFTP++ 面板）：
 *              ① 第 8 项类别名由设置页的「数据」(settings.data) 换为新 key settings.exportCatBookmarkData
 *                 （书签数据）—— settings.data 仍被设置页分区标题引用，不能改译文，故另起 key（新增 24 语言 × 1）；
 *                 该项子标题「书签」随之删除（名称已含「书签」）。
 *              ② 「快捷键」项子标题（settings.hotkey）删除 —— 该类只含一项内容，子描述纯冗余。
 *              ③ .ss-export-list 滚动条对齐面板 .sftp-root .pane-list 规格（8px / 圆角 4px /
 *                 三档灰度 0.06·0.28·0.45、按住主色 + Firefox scrollbar-width/color）。
 *                 ⚠ 数值取面板 `:host` 变量定义的**实际生效值**，不是面板 CSS 里
 *                 `var(--_scroll-thumb, rgba(...,0.35))` 那组兜底值（变量始终有定义，兜底轮不到）；
 *                 面板 --_scroll-* 为 :host 私有变量，设置页取不到 ⇒ 写字面值，主色取 --primary-color。
 *              ④ 底部按钮顺序**维持原样**（主操作在左、取消在右）：用户先问「取消不是在左边吗」，随后自行确认
 *                 「取消好像就是在右边」，故不做变更；该顺序也与面板内各对话框、设置页其余三个确认弹窗一致。
 *              ★ 同日四次修复（用户：为什么已经清空数据了，结果似乎还有残留的数据？）：
 *              doClearData 原实现是单层裸循环 `target[k] = defaults[k]`，在第 23 个键 panelHotkeys
 *              （ConfigProxy 的**结构成员** —— 非空对象 ⇒ 只有 getter 没有 setter）处抛 TypeError
 *              → 整个循环中断，其后的 contextMenuOrder / 传输设置 / 图标 / 冲突摘要 / 书签 / 路径记忆 /
 *              面板状态 / 传输日志 / 面板几何**全部没被清掉**；异常还被最外层 catch 吞掉，连带跳过
 *              localStorage 清理、界面刷新与提示 —— 用户看到的「点了清空但还有残留」即此。
 *              现：① localStorage 先清；② config 逐键独立 try/catch（单键失败不牵连其余）+ 新增
 *              `_resetConfigKey()` 对结构成员递归到叶子赋值；③ 补清 Tabby 级 store.hotkeys 里的
 *              「面板开关快捷键」（不在插件子树内，旧实现完全漏掉）；④ 无论 config 侧是否出错都刷新
 *              界面并通知面板，失败时把未清干净的键名附在提示里（正常路径不会走到）。
 *              配套读侧修复：清空后磁盘上 panelHotkeys 会留 `{delete:{}}` 空壳（结构成员的叶子值等于
 *              默认值时会 ConfigProxy 清洗掉）→ _readFromConfig 原先会把空壳读成「未绑定」，现改为
 *              「keys/key 与 enabled 双双缺省 ⇒ 保留默认绑定」，避免清空后 Delete/F2/F5 显示成未绑定。
 *              探针 .workbuddy/verify/clear-data-residual-probe.cjs（37 项；含用宿主机真实 ConfigProxy
 *              复现「旧写法残留 28 键 vs 新写法残留 0 键」的对照实验）。
 *              ★ 同日五次调整（用户：定制右键菜单的边框像定制工具栏那样，使用虚线边框）：
 *              .ss-menu-row 边框由 1px solid rgba(128,128,128,0.25) 改为
 *              1px dashed rgba(128,128,128,0.35) —— 与「定制工具栏」的 .ss-layout-chip 同规格
 *              （同虚线、同灰度），行背景/圆角/内距与拖拽手柄保持不变。
 *              探针 .workbuddy/verify/settings-menu-row-border-probe.cjs（同时锁死与 .ss-layout-chip 的
 *              虚线规格一致性，避免日后单边改动导致两块视觉分叉）。
 *              ★ 同日六次调整（用户：定制工具栏的行高可以对齐定制右键菜单的）：
 *              .ss-layout-chip 垂直内距 7px → 4px（与 .ss-menu-row 的 4px 一致）⇒ 两块行框**精确等高**。
 *              依据：无头浏览器量测 .workbuddy/verify/settings-row-height-bench.html ——
 *              line-height:2 环境下菜单行 34.0px、chip 改前 40.0px、改后 34.0px（34px 与用户截图实测吻合）；
 *              normal 环境下 26.0 / 32.0 / 26.0 ⇒ 差值恒为 6px，**与宿主 line-height 无关**。
 *              本质条件：两块内容盒同高（同字号 + 同 14px 复选框）⇒ 只要垂直内距相同就必然等高
 *              （所以不硬写 height，避免字体/缩放变化后失配）。
 *              ⚠ 量测坑：flex 容器默认 align-items:stretch 会把矮 chip 拉伸到同行最高者，
 *              第一次量测因此得到「padding 4px 也是 40px」的假结果 —— 必须 flex-start 再量。
 *              ★ 同日七次调整（用户：字号大小对齐 Tabby「窗口」菜单里的滑块、也是靠右显示的；
 *              查看编辑器的光标对齐 Tabby 外观的光标形状）：
 *              ① 「字号大小」滑块**整块靠右**：.ss-font-control 加 justify-content:flex-end，
 *                 滑块宽度保持不变（仍 flex:1 + max-width:280px），「13px」落到行尾最右。
 *                 另补两处让右边缘与其它行的控件**落在同一条竖线**上（无头量测 settings-right-align-bench.html）：
 *                 .ss-font-row 补 padding-right:10px（与 .ss-toggle-row 的水平内距一致）；
 *                 .ss-font-val 补 text-align:right（盒宽 36px > 文字 30px，左对齐会内缩 6px）。
 *                 量测：改前「数值文字右边缘 594 vs 开关控件右边缘 590」（右探 4px）⇒ 改后两者均为 590，差 0。
 *                 依据：Tabby 用 .form-line .header{margin-right:auto} 把控件
 *                 顶到行尾（图1 实测「间隔」滑块右边缘 x=1065px 与「窗口框架样式」按钮组右边缘
 *                 x=1064px 重合 = 内容列右边界），故本插件同款处理。
 *                 注：轨道 #111 / 4px、圆点 #aaa / 12px 由宿主全局 input[type=range] 样式提供，
 *                 实测与 Tabby 的滑块逐字相同（截图取样 track 均为 rgb(17,17,17)、thumb 均 rgb(170,170,170)），
 *                 故本次**不动滑块自身样式**，只改位置。
 *              ② 「查看编辑器光标」由 range 滑块改为**图标按钮组**（形制对齐 Tabby 外观页的
 *                 「光标形状」：btn-group + 方块字形按钮 █ │ ▁）；行仍是 .ss-toggle-row ⇒
 *                 按钮组天然靠右。原「2px」数值不再单独渲染，改为各按钮 title。
 *                 ⚠ 该按钮组的**档位语义**在同日九次调整里由「宽度 1–4px」改成「形状三档」，见下。
 *              探针 .workbuddy/verify/settings-right-align-probe.cjs（靠右与形制）
 *              ★ 同日八次调整（用户：快捷键的录制似乎无法录制滚轮的点击和上下滚动）：
 *              面板快捷键录制新增「鼠标中键」与「滚轮上滚/下滚」两类**指针绑定**
 *              （Mouse1 / WheelUp / WheelDown，可带修饰键如 Alt+WheelUp），且可绑到全部 15 个动作
 *              （原鼠标侧键只在 back/forward 两个动作上生效）。两处关键实现：
 *              ① 录制期对 wheel 必须用 `{ capture: true, passive: false }` —— window/document 上的
 *                 wheel 监听默认 passive:true，此时 preventDefault() 是空操作（浏览器只打警告），
 *                 设置页会跟着一起滚，录制框滑出视野；
 *              ② 录制与匹配共用 hotkey-util 的 pointerSpecFromEvent()，同一构造口径 ⇒ 录得出来必然匹配得上。
 *              裸滚轮（无修饰键）绑定会顶掉面板列表的滚动（要触发动作就必须吞掉默认滚动），
 *              保存后明确提示，chip 悬停也有说明（新增 settings.hotkeyWheelHint /
 *              settings.panelHotkeyWheelBareWarning 两个 key，24 语言）。
 *              探针 .workbuddy/verify/panel-pointer-hotkey-probe.cjs
 *              ★ 同日九次调整（用户：查看编辑器光标宽度「也许要改为查看编辑器光标形状了」，
 *              像 Tabby 的光标形状一样三个选项三种形状；另把「定制书签面板」挪到「表格样式」上方、
 *              「字体」挪到「表格样式」下方）：
 *              ① 「查看编辑器光标」由**宽度 1–4px 四档**改为**形状三档**，与宿主逐字同源：
 *                 取值 block / beam / underline（= Tabby 终端 store.terminal.cursor 的三档取值，
 *                 见宿主 tabby-terminal 的 appearanceSettingsTab：id cursorBlock/cursorBeam/cursorUnderline），
 *                 字形 █ │ ▁（照宿主外观页「光标形状」），仍靠右显示；行标签改为 settings.textCaretShape。
 *                 存储：textCaretWidth(number) → textCaretShape('block'|'beam'|'underline')，默认 beam
 *                 （与原 2px 竖线视觉一致；老配置里的宽度值不再读取）。
 *                 配置链路共六处入口必须同步改名 —— 默认值/类型、设置页读写、导出快照、导入回写、
 *                 EXPORT_CATEGORY_FIELDS 登记（漏登记 = 该项永远导不出去，探针 A 段锁键集严格相等）。
 *                 旧 key settings.textCaretWidth / textCaretWidthHint 已从 24 语言 po 中删除
 *                 （迁移脚本 scripts/add-caret-shape-i18n.mjs：删 2 个死 key、加 5 个形状文案 × 24 语言）。
 *              ② 「布局」分区小节重排：定制工具栏 → 定制右键菜单 → 定制书签面板 → 表格样式 → 字体
 *                 （改前：字体 → 定制工具栏 → 定制书签面板 → 定制右键菜单 → 表格样式）。
 *                 前三块都是「面板内容定制」故集中相邻；表格样式与字体收尾。
 *                 ⚠ 搬块时注意：小节由「标题容器 + 正文容器」两部分组成，按 8 空格缩进的 </div>
 *                 切块会只切到标题容器 —— 必须确认正文（字号滑块行 / 书签分组开关 + 顺序 chips）一并搬走。
 *              探针 .workbuddy/verify/caret-shape-probe.cjs（形状与配置链路）、
 *              settings-layout-sections-probe.cjs（小节顺序与块完整性）
 *              传输通道模式选项重排：「优先 TAR / 优先 SFTP」提到「仅 TAR / 仅 SFTP」之前
 *              （用户：把优先的选项提一提、仅 XX 放后），顺序 = 智能 → 优先 TAR → 优先 SFTP → 仅 TAR → 仅 SFTP
 *              同日：传输通道模式行布局与提示调整：
 *              ① 该行原先漏了 ss-toggle-row 类 → 不是两端对齐布局、下拉框未靠右；补上后与并发数/开关行一致右对齐；
 *              ② 新增 .ss-channel-select 固定宽 220px（默认 .ss-select 为 100%/max 280px，在两端对齐行里被撑满、与其它控件不协调）；
 *              ③ 模式说明不再常驻显示在行下方（移除 <p class="ss-channel-desc"> 与 channelModeDesc()），
 *                 改为各 <option> 的 title（悬停选项即显示该模式说明，i18n key 复用 settings.channelMode.*Desc）
 *              2026-09-28 — 传输设置：原「TAR 打包加速」开关升级为「传输通道模式」五选一下拉
 *              （smart/sftpOnly/tarOnly/preferSftp/preferTar）；transferChannelMode 字段替代 transferTarAcceleration，
 *              加载/保存/导出/导入均迁移旧值（false→sftpOnly）；新增 saveChannelMode() 与 channelModeDesc()
 *              2026-09-28 — 定制右键菜单改为复选框启用/停用 + 新增分组依据项；
 *              同日修订：「展开/收起所有分组」已并入「分组依据」子菜单，从定制列表移除
 *              （ContextMenuCustomId 不再含 groupToggleAll，历史配置残留值读取时丢弃）
 *              2026-09-24 — 意见反馈拆分为「报告问题 / 提出需求」两个入口；两类模板均按界面语言路由中/英表单（新增 feature_request.yml / feature_request_en.yml，字段 id 与中文版一致）
 *              2026-09-24 — 意见反馈模板按界面语言路由：中文用 bug_report.yml、其余语言用 bug_report_en.yml（新增英文版表单）
 *              2026-09-24 — 修复反馈环境信息的 Windows 版本取不准：getOSRelease 给的是 NT 内核号（10.0.26200），
 *              Win11 沿用该内核号故被误读成 Win10；改为按 build 反查市场版本名（Windows 11 25H2 (build 26200, x64)）
 *              2026-09-24 — 意见反馈预填环境信息（issues/new?body=）：模板 + Version/Tabby/Platform/Frontend/Plugins，不含隐私字段
 *              2026-09-21 — P2 修复：摘要大小上限统一经 _clampDigestMaxMB 约束到 [1,4096]MB ——
 *              原先只判 >0，输入框的 max="4096" 只是 UI 提示，手动输入与配置导入都能写进极大值
 *              2026-09-21 — 备份导入统一清洗书签、路径记忆与传输日志；
 *              隐藏原生 SFTP 开关同步写入 localStorage，与装饰器双读一致
 *              2026-09-20 — 面板热键支持打开/查看/编辑（默认未绑定）
 *              2026-09-20 — A4 审计修复：ngOnDestroy 补 _teardownPanelHotkeyRecording（面板快捷键录制中关闭设置页会残留 window 捕获监听器且全局热键未恢复）
 *              2026-09-20 — 面板热键绑定检测 Tabby 全局冲突（如 Alt+Enter=全屏）；属性等快捷键同步到右键菜单
 *              2026-09-18 — 定制书签面板开关变更后 notifyPanels，面板即时生效
 */
import { Component, Injectable, Optional, OnDestroy, Inject } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { ConfigService, HotkeysService, PlatformService, HostAppService } from 'tabby-core'
import { defaultSftpPlusConfig, normalizeCaretShape, type CaretShape } from '../tabby/config-provider'
import { SftpI18nService } from '../services/sftp-i18n.service'
import type { Locale } from '../services/sftp-i18n.service'
import { SftpConfigService } from '../services/sftp-config.service'
import { SftpTransferLogService } from '../services/sftp-transfer-log.service'
import { normalizeBookmarkPath } from '../services/sftp-bookmarks.service'
import { SFTP_PLUS_TOGGLE_HOTKEY } from '../tabby/hotkey-provider'
import {
  findHotkeyConflicts,
  formatHotkeyBinding,
  getKeystrokeNameFromEvent,
  isHotkeyRecordingActive,
  readToggleHotkeyBindings,
  setHotkeyRecordingActive,
  eventToPanelHotkeySpec,
  isMouseHotkeySpec,
  isWheelHotkeySpec,
  isPointerHotkeySpec,
  isBareWheelSpec,
  pointerSpecFromEvent,
  normalizePanelHotkeyKeys,
  panelHotkeySpecToTabbyBinding,
  MOUSE_BACK_SPEC,
  MOUSE_FORWARD_SPEC,
  MOUSE_MIDDLE_SPEC,
  WHEEL_UP_SPEC,
  WHEEL_DOWN_SPEC,
  type HotkeyBinding,
} from '../tabby/hotkey-util'
import {
  defaultPanelHotkeys,
  PANEL_HOTKEY_ACTIONS,
  type FileTypeIconRule,
  type PanelHotkeyAction,
} from '../tabby/config-provider'
import { detectSystemLocale, isColorDark, parseColorLuminance } from '@common/utils'
import { DEFAULT_DATE_FORMAT, formatTextExtensionsForInput, normalizeEditableExtensions, setDateFormatPattern } from '../sftp/core/file-utils'
import { DEFAULT_ICON_MAP, BUILTIN_ICON_FILES, BUILTIN_ICON_EXTS, FOLDER_ICON_SVG, resolveSftpPlusBundledIconDir } from '../sftp/core/icon-defaults'
import { ContextMenuAction, FILE_MENU_REGISTRY, DEFAULT_FILE_MENU_ORDER, GROUP_BY_MODES } from '../sftp/components/sftp-context-menu.component'

/** ★ 2026-09-28（同日修订）：右键菜单定制项 id（文件动作 + 分组依据）。
 *  「展开/收起所有分组」已并入「分组依据」子菜单，不再作为独立定制项（用户定稿）。 */
export type ContextMenuCustomId = ContextMenuAction | 'groupBy'

import * as fs from 'fs'
import * as path from 'path'
import { log } from '../services/sftp-logger'
/** Tabby 设置页中 SFTP++ 侧栏项 ID（与 SettingsTabProvider.id 一致） */
export const SFTP_PLUS_SETTINGS_TAB_ID = 'sftp-settings'

/** webpack DefinePlugin 在每次 build 时注入的 ISO 时间戳 */
declare const __SFTP_PLUS_BUILD_TIME__: string

/** 本地存储的 key 前缀（仅浮层面板缓存和旧版兼容，不再用于设置数据） */
const PREFIX = 'sftp-plus-settings'

/** 面板热键"已清除"哨兵值：用普通可打印字符串（NUL/空串会被 Tabby 的 config 清洗逻辑删除导致 defaults 回退） */
const PANEL_HOTKEY_CLEARED = '__NONE__'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${PREFIX}.${key}`)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (parsed === null || parsed === undefined) return fallback
    // Basic type guard: if fallback is a primitive, ensure parsed matches
    if (typeof fallback === 'string' && typeof parsed !== 'string') return fallback
    if (typeof fallback === 'boolean' && typeof parsed !== 'boolean') return fallback
    if (typeof fallback === 'number' && typeof parsed !== 'number') return fallback
    return parsed
  } catch { return fallback }
}

/** 合并旧开关：allowViewEditAllFiles / allowEditAllFiles / allowViewAllAsText / allowViewAllFiles */
function resolveAllowViewEditAllFiles(cfg: Record<string, unknown> | null | undefined): boolean {
  if (!cfg || typeof cfg !== 'object') return false
  return cfg['allowViewEditAllFiles'] === true
    || cfg['allowEditAllFiles'] === true
    || cfg['allowViewAllAsText'] === true
    || cfg['allowViewAllFiles'] === true
}

function loadAllowViewEditAllFiles(): boolean {
  if (load('allowViewEditAllFiles', false)) return true
  if (load('allowEditAllFiles', false)) return true
  if (load('allowViewAllAsText', false)) return true
  if (load('allowViewAllFiles', false)) return true
  return false
}


const TABLE_SETTINGS_KEY = 'sftp-plus-table'

function loadTableSetting(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(`${TABLE_SETTINGS_KEY}.${key}`)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

/**
 * Windows build 号 → 市场版本代号，按 build 升序（取 ≤ build 的最大条目）
 * 背景：Windows 自 Vista 起内核版本号固定 10.0.<build>，Win10/Win11 共用同一主版本，
 *       只有 build 号能区分（≥22000 = Windows 11），故必须靠此表还原出「25H2」这类用户可辨识的版本名
 */
/**
 * ★ 2026-09-29：导出类别 → 字段名清单（对应设置页「导出数据」弹窗里的勾选项）。
 * ⚠ 铁律：collectAllData() 产出的**每一个**键都必须登记在这里 —— 未登记的键永远不会被导出。
 *   新增配置项时要同步补进本表；探针 .workbuddy/verify/sftp-export-picker-probe.cjs 会拿
 *   collectAllData 的真实产出逐键核对，漏登记会被当场抓出来。
 * ★ 2026-09-29（二次调整，用户要求）：分类口径**逐项对齐设置页自己的分区标题**，
 *   顺序即设置页从下往上的分区顺序 —— 语言 / 主题 / 布局 / 对象图标 / 其它 /
 *   传输设置 / 快捷键 / 数据；并把「传输记录」从原「书签与记录」里**拆出来单独成项**
 *   （它是历史日志、体积通常最大，且备份诉求与其他配置完全不同）。
 *   弹窗里的类别名直接复用设置页分区标题的 key（settings.language/theme/layout/iconSettings/
 *   other/transferSection/hotkeys/data + transfer.log），所以本次**不新增任何 i18n key**。
 */
const EXPORT_CATEGORY_FIELDS: Record<string, string[]> = {
  // 语言（设置页「语言」分区）
  lang: ['lang'],
  // 主题（设置页「主题」分区：配色方案 + 四个自定义色）
  theme: ['theme', 'colorPrimary', 'colorBg', 'colorText', 'colorBorder'],
  // 布局（设置页「布局」分区：面板布局与字体、定制工具栏、定制书签面板、定制右键菜单、表格样式）
  layout: [
    'layoutMode', 'fontSize', 'tableColBorders', 'tableZebra',
    'paneCustomOrder', 'paneHiddenItems',
    'bookmarkPanelGroupByScope', 'bookmarkPanelGroupOrder',
    'contextMenuOrder', 'contextMenuDisabled',
  ],
  // 对象图标（设置页「对象图标」分区）
  icons: ['iconResourceDir', 'fileTypeIcons', 'disabledIconSvgs', 'folderIconSvg'],
  // 其它（设置页「其它」分区：交互、日期格式、查看/编辑、文本编辑器）
  other: [
    'hideAuthorInfo', 'hideNativeSFTPButton', 'defaultPathMode', 'defaultShowHidden',
    'openInNewTabByDefault', 'singleWorkspaceInstance', 'closeBookmarkPanelOnSelect',
    'openOnClick', 'dateFormat', 'openUnsupportedInSystem',
    'allowViewEditAllFiles', 'allowEditAllFiles', 'allowViewAllAsText', 'editableFileExtensions',
    'showTextLineNumbers', 'textCaretShape',
  ],
  // 传输设置（设置页「传输设置」分区：并发、通道模式、冲突摘要、默认路径）
  transfer: [
    'transferUploadConcurrency', 'transferDownloadConcurrency', 'transferChannelMode',
    'conflictDigestEnabled', 'conflictAutoSkipSameContent',
    'conflictDigestMaxSizeMB', 'conflictDigestAlgo',
    'defaultUploadPath', 'defaultDownloadPath',
  ],
  // 快捷键（设置页「快捷键」分区：面板项快捷键）
  hotkeys: ['panelHotkeys'],
  // 数据（书签 / 路径记忆 / 面板状态）
  data: ['bookmarks', 'pathMemory', 'paneState'],
  // 传输记录（★ 2026-09-29 拆出独立成项）
  logs: ['transferLogs'],
}

const WINDOWS_BUILD_RELEASES: Array<[number, string]> = [
  [10240, '1507'], [10586, '1511'], [14393, '1607'], [15063, '1703'], [16299, '1709'],
  [17134, '1803'], [17763, '1809'], [18362, '1903'], [18363, '1909'], [19041, '2004'],
  [19042, '20H2'], [19043, '21H1'], [19044, '21H2'], [19045, '22H2'],
  [22000, '21H2'], [22621, '22H2'], [22631, '23H2'], [26100, '24H2'], [26200, '25H2'],
]

/** Darwin 内核主版本 → macOS 市场版本（19=10.15 Catalina … 24=15 Sequoia、25=26 Tahoe） */
const MACOS_BY_DARWIN: Record<number, string> = {
  19: '10.15', 20: '11', 21: '12', 22: '13', 23: '14', 24: '15', 25: '26',
}

@Component({
  template: require('./sftp-settings.component.view.html'),
  styles: [require('./sftp-settings.component.view.css')],
})
export class SftpSettingsTabComponent implements OnDestroy {
  // @ts-ignore — ts-loader 可能无法正确处理 JSON 模块类型
  /** 插件版本号（webpack 构建时内联 package.json） */
  readonly pkgVersion: string = require('../../package.json').version
  /** 构建时间（webpack 每次 build 时注入，用于确认是否已重新打包） */
  readonly pkgBuildTime: string = typeof __SFTP_PLUS_BUILD_TIME__ !== 'undefined' ? __SFTP_PLUS_BUILD_TIME__ : ''

  /** 格式化构建时间为本地可读字符串 */
  formatBuildTime(): string {
    if (!this.pkgBuildTime) return '—'
    const d = new Date(this.pkgBuildTime)
    if (isNaN(d.getTime())) return this.pkgBuildTime
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  /** 国际化服务（key-based，支持动态切换语言） */
  readonly i18n: SftpI18nService

  /** 主题颜色标签 key 映射（统一走 .po 翻译） */
  private readonly themeLabelKeys: Record<string, string> = {
    '':       'theme.auto',
    dark:     'theme.dark',
    light:    'theme.light',
    blue:     'theme.blue',
    green:    'theme.green',
    purple:   'theme.purple',
    red:      'theme.red',
    custom:   'theme.custom',
  }

  /** 获取主题颜色的翻译标签 */
  themeLabel(c: { value: string; label: string }): string {
    const key = this.themeLabelKeys[c.value]
    return key ? this.i18n.t(key) : c.label
  }

  /** 获取色卡预览背景（Auto 用渐变，其他用固定色） */
  swatchPreviewBg(c: { value: string; bg: string }): string {
    if (c.value === '') return 'linear-gradient(135deg, var(--body-bg, #1e1e2e), var(--text-color, #cdd6f4))'
    if (c.value === 'custom') {
      // 自定义主题：从 localStorage 读取实际保存的配色
      const savedBg = load('bgColor', '')
      return savedBg || c.bg
    }
    return c.bg
  }

  /** 自定义主题预览色：主色 */
  swatchCustomPrimary(c: { value: string; primary?: string }): string {
    if (c.value === 'custom') {
      const saved = load('primaryColor', '')
      return saved || c.primary || 'var(--primary-color, #3b82f6)'
    }
    return c.primary || 'var(--primary-color, #3b82f6)'
  }

  /** 自定义主题预览色：表面色（仅预设主题使用，自定义主题使用 bg） */
  swatchCustomSurface(c: { value: string; surface?: string; bg?: string }): string {
    if (c.value === 'custom') return c.bg || '#313244'
    return c.surface || c.bg || '#313244'
  }

  /** 自定义主题预览色：文字色 */
  swatchCustomText(c: { value: string; text: string }): string {
    if (c.value === 'custom') {
      const saved = load('textColor', '')
      return saved || c.text
    }
    return c.text
  }

  /** 自定义主题预览色：弱化色（仅预设主题使用，自定义主题降低文字透明度） */
  swatchCustomMuted(c: { value: string; muted?: string; text: string }): string {
    if (c.value === 'custom') return c.text  // 无 muted 设置，直接用文字色
    return c.muted || c.text
  }

  /** 自定义主题预览色：边框色 */
  swatchCustomBorder(c: { value: string; border?: string }): string {
    if (c.value === 'custom') {
      const saved = load('borderColor', '')
      return saved || c.border || ''
    }
    return c.border || ''
  }

  /** 支持的语言列表（按语言代码排序） */
  readonly locales: { code: Locale; name: string }[] = [
    { code: 'af-ZA', name: 'Afrikaans' },
    { code: 'bg-BG', name: 'Български' },
    { code: 'cs-CZ', name: 'Čeština' },
    { code: 'da-DK', name: 'Dansk' },
    { code: 'de-DE', name: 'Deutsch' },
    { code: 'en-GB', name: 'English (UK)' },
    { code: 'en-US', name: 'English (US)' },
    { code: 'es-ES', name: 'Español' },
    { code: 'fr-FR', name: 'Français' },
    { code: 'hr-HR', name: 'Hrvatski' },
    { code: 'id-ID', name: 'Bahasa Indonesia' },
    { code: 'it-IT', name: 'Italiano' },
    { code: 'ja-JP', name: '日本語' },
    { code: 'ko-KR', name: '한국어' },
    { code: 'pl-PL', name: 'Polski' },
    { code: 'pt-BR', name: 'Português (Brasil)' },
    { code: 'pt-PT', name: 'Português' },
    { code: 'ru-RU', name: 'Русский' },
    { code: 'sr-Latn', name: 'Srpski' },
    { code: 'sv-SE', name: 'Svenska' },
    { code: 'tr-TR', name: 'Türkçe' },
    { code: 'uk-UA', name: 'Українська' },
    { code: 'zh-CN', name: '中文（简体）' },
    { code: 'zh-TW', name: '中文（繁體）' },
  ]

  /** 界面语言（空 = 自动跟随系统） */
  lang: '' | Locale = (load('lang', '') as string || '') as '' | Locale

  /** 使用界面语言（Auto 模式时检测系统语言） */
  get effectiveLang(): Locale {
    const validLocales: Locale[] = this.locales.map(l => l.code)
    if (this.lang && validLocales.includes(this.lang as Locale)) return this.lang as Locale
    return detectSystemLocale() as Locale
  }

  /** 预设主题（含配色预览色值） */
  colorThemes = [
    { value: '',       label: 'Auto',   bg: '#1e1e2e', text: '#cdd6f4', primary: '#b4befe', surface: '#313244', border: '#585b70', muted: '#6c7086' },
    { value: 'dark',  label: 'Dark',  bg: '#1a1d23', text: '#e8edf5', primary: '#b6b6c3', surface: '#252830', border: '#2d3242', muted: '#5a5f6f' },
    { value: 'light', label: 'Light', bg: '#f0f4f8', text: '#333333', primary: '#2563eb', surface: '#e5e7eb', border: '#d1d5db', muted: '#9ca3af' },
    { value: 'blue',  label: 'Blue',  bg: '#0b1929', text: '#e6f0ff', primary: '#3b9eff', surface: '#0f2035', border: '#1e3a5f', muted: '#5a7ea0' },
    { value: 'green', label: 'Green', bg: '#0a2016', text: '#e8fce8', primary: '#4ade80', surface: '#0e281a', border: '#1a5030', muted: '#4a8a60' },
    { value: 'purple',label: 'Purple',bg: '#160e23', text: '#ebe0fc', primary: '#b794f4', surface: '#1c1430', border: '#3a2558', muted: '#7a5aa0' },
    { value: 'red',   label: 'Red',    bg: '#1a0808', text: '#ffe0dd', primary: '#f87171', surface: '#220a0a', border: '#502020', muted: '#904040' },
    { value: 'custom',label: 'Custom', bg: '#313244', text: '#cdd6f4', primary: '#b4befe', surface: '#45475a', border: '#585b70', muted: '#6c7086' },
  ]

  /** 当前主题 */
  theme: string = load('theme', '')

  /** Auto 模式下检测到的映射主题名（'dark' | 'light' | ''） */
  detectedAutoTheme: 'dark' | 'light' | '' = ''

  /** 判断当前是否为深色模式（读取 Tabby CSS 变量亮度） */
  get isDarkMode(): boolean {
    try {
      const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim()
      if (textColor) {
        const lum = parseColorLuminance(textColor)
        if (lum >= 0) return lum > 128
      }
      // --text-color 不可用 → 尝试 --body-bg
      const bodyBg = getComputedStyle(document.documentElement).getPropertyValue('--body-bg').trim()
      if (bodyBg) {
        const lum = parseColorLuminance(bodyBg)
        if (lum >= 0) return lum < 128  // 背景暗 → 深色模式
      }
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  /** 检测当前 Tabby UI 主题的暗/亮模式（读取 --body-bg CSS 变量） */
  detectAutoTheme(): void {
    let bodyBg = '#1e1e2e'
    try {
      const computedStyle = getComputedStyle(document.documentElement)
      const cssBg = computedStyle.getPropertyValue('--body-bg').trim()
      if (cssBg && cssBg !== '') {
        bodyBg = cssBg
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        bodyBg = prefersDark ? '#1e1e2e' : '#ffffff'
      }
    } catch {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      bodyBg = prefersDark ? '#1e1e2e' : '#ffffff'
    }

    // 使用公共工具判断暗/亮
    this.detectedAutoTheme = isColorDark(bodyBg) ? 'dark' : 'light'
  }

  /** 获取 Auto 映射主题名的显示文本 */
  get autoThemeLabel(): string {
    if (this.detectedAutoTheme === 'dark') return this.i18n.t('settings.dark')
    if (this.detectedAutoTheme === 'light') return this.i18n.t('settings.light')
    return ''
  }

  /** 主题颜色值（从 localStorage 或预设加载） */
  themePrimary = load('primaryColor', '')
  themeBg = load('bgColor', '')
  themeText = load('textColor', '')
  themeBorder = load('borderColor', '')

  /** 面板布局 */
  layoutMode: string = 'auto'
  /** 面板界面字号（px），默认 13，范围 11–18 */
  fontSize = 13

  /** 表格样式设置 */
  showColBorders = loadTableSetting('colBorders', false)
  showZebra = loadTableSetting('zebra', false)

  /** 隐藏原生 SFTP 按钮 */
  hideNativeBtn = load('hideNativeBtn', false)

  /** 默认路径模式（off/remember/sync）：对未在面板上单独切换过的连接生效 */
  defaultPathMode: 'off' | 'remember' | 'sync' = load('defaultPathMode', 'off') as 'off' | 'remember' | 'sync'

  /** 默认显示隐藏文件：对从未按过眼睛按钮的面板生效 */
  defaultShowHidden = load('defaultShowHidden', false)

  /** 热键录制状态 */
  hotkeyRecording = false
  hotkeyRecordingPreview = ''
  hotkeyConflictNames = ''
  hotkeySaveMessage = ''
  private _hotkeyStrokeSub: { unsubscribe(): void } | null = null
  private _hotkeyKeyEventSub: { unsubscribe(): void } | null = null
  private _hotkeyDomHandler: ((ev: KeyboardEvent) => void) | null = null
  private _hotkeyCommitTimer: ReturnType<typeof setTimeout> | null = null
  private _hotkeySafetyTimer: ReturnType<typeof setTimeout> | null = null
  private _hotkeyMsgTimer: ReturnType<typeof setTimeout> | null = null
  private _hotkeyDescCache: Record<string, string> = {}
  private _pendingHotkeyStrokes: string[] = []
  private _hotkeyDisableHeld = false

  /** 当前「切换 SFTP++ 面板」热键绑定文案（来自 Tabby hotkeys 配置） */
  get hotkeyBindingLabel(): string {
    try {
      const list = readToggleHotkeyBindings(this.configService?.store?.hotkeys)
      return list.map(formatHotkeyBinding).filter(Boolean).join(' / ')
    } catch {
      return ''
    }
  }

  /** 工具栏入口在新标签页打开 */
  openInNewTabByDefault = load('openInNewTabByDefault', false)

  /** 新标签页模式：同一 SSH 终端只保留一个 SFTP++ 标签 */
  singleWorkspaceInstance = load('singleWorkspaceInstance', true)
  /** 兼容选项：选中书签后关闭面板 */
  closeBookmarkPanelOnSelect = load('closeBookmarkPanelOnSelect', false)
  /** 书签面板是否按连接/全局分组（默认开启） */
  bookmarkPanelGroupByScope = load('bookmarkPanelGroupByScope', true)
  /** 分组块显示顺序 */
  bookmarkPanelGroupOrder: Array<'connection' | 'global'> = (() => {
    try {
      const raw = load<unknown>('bookmarkPanelGroupOrder', ['connection', 'global'])
      if (Array.isArray(raw) && raw.length) {
        const valid = raw.filter((x): x is 'connection' | 'global' => x === 'connection' || x === 'global')
        if (valid.includes('connection') && valid.includes('global')) {
          return [valid[0], valid.find(x => x !== valid[0])!]
        }
      }
    } catch {}
    return ['connection', 'global']
  })()
  draggingBookmarkGroup: 'connection' | 'global' | null = null
  /** 兼容选项：自定义时间格式（输入框始终显示具体格式，默认为 DEFAULT_DATE_FORMAT） */
  dateFormat = load('dateFormat', '') || DEFAULT_DATE_FORMAT
  /** 默认时间格式 */
  readonly defaultDateFormat = DEFAULT_DATE_FORMAT
  /** 同时进行的上传/下载数上限（1-10，默认 3） */
  uploadConcurrency = 3
  downloadConcurrency = 3
  /** ★ 2026-09-28：传输通道模式（smart/sftpOnly/tarOnly/preferSftp/preferTar） */
  transferChannelMode = 'smart'
  /** ★ 2026-09-07 issue #15：冲突内容摘要相关设置 */
  conflictDigestEnabled = true
  conflictAutoSkipSameContent = true
  conflictDigestMaxSizeMB = 256
  /** 默认上传路径（远程目标目录）；空串 = 使用当前远程目录 */
  defaultUploadPath = ''
  /** 默认下载路径（本地目标目录）；空串 = 使用当前本地目录 */
  defaultDownloadPath = ''
  /** 自定义图标：全局 SVG 资源目录（本地绝对路径） */
  iconResourceDir = ''
  /** 自定义图标规则：扩展名 → svg 文件名（可选 name 为规则名） */
  fileTypeIcons: FileTypeIconRule[] = []
  /** 被禁用的内置图标 svg 文件名 */
  disabledIconSvgs: string[] = []
  /** 文件夹图标 svg 文件名（空串 = 走 emoji 📁，默认 'folder.svg'） */
  folderIconSvg = 'folder.svg'
  /** 图标网格交互状态 */
  _editingRuleKey: string | null = null      // 正在编辑的规则 key（规则名）
  _editingRuleName: string = ''               // 编辑中的规则名
  _editingIconExts: string = ''               // 编辑中的扩展名字符串
  _editingIconSvgName: string = ''            // 编辑中的 svg 文件名（可修改）
  _editingFolderIcon = false                  // 是否在编辑文件夹图标
  _folderIconDraft = ''                       // 文件夹图标编辑草稿
  _folderIconError = ''                       // 文件夹图标编辑错误
  _addingCustomRule = false                   // 是否显示新增自定义规则表单
  _newRuleName = ''                           // 新增规则的规则名
  _newRuleExt = ''                            // 新增规则的扩展名
  _newRuleSvg = ''                            // 新增规则的 svg 文件名
  _iconRuleError = ''                         // 新增/编辑规则时的校验错误提示（空=无错误）
  /** ★ 2026-08-11：隐藏关于区的插件作者信息（开启需点 Star 确认） */
  hideAuthorInfo = false
  /** 隐藏作者信息确认弹窗是否显示 */
  showHideAuthorConfirm = false
  paneCustomOrder: Array<'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'> = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
  /** 被隐藏的工具栏项（设置页定制工具栏中取消勾选的项） */
  paneHiddenItems: string[] = []
  draggingCustomItem: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden' | null = null

  /** ★ 2026-08-22：文件/文件夹打开方式（单击/双击） */
  openOnClick: 'double' | 'single' = load('openOnClick', 'double')
  /** ★ 2026-08-22：查看器不支持的文件改用系统默认程序打开 */
  openUnsupportedInSystem = load('openUnsupportedInSystem', true)
  /** 可查看/编辑文本扩展名；界面展示预置列表，接受 .conf / *.conf / conf，空格分隔。 */
  editableFileExtensionsText = formatTextExtensionsForInput(load<unknown>('editableFileExtensions', []))
  /** 忽略扩展名白名单，允许查看与编辑所有非目录文件（编辑仍受二进制保护）。 */
  allowViewEditAllFiles = loadAllowViewEditAllFiles()
  /** ★ 2026-09-20：查看/编辑器显示行号；查看器插入光标形状（2026-09-29 由宽度改为形状三档） */
  showTextLineNumbers = load('showTextLineNumbers', true)
  textCaretShape: CaretShape = normalizeCaretShape(load<unknown>('textCaretShape', 'beam'))
  /** ★ 2026-09-29：光标形状按钮组选项（三档取值与 Tabby 终端 cursor 逐字一致，字形照宿主外观页的 █ | ▁）
   *  形制对齐 Tabby 外观页「光标形状」的方块字形按钮组；文案 key 同时作为按钮 title。 */
  caretShapeOptions: { shape: CaretShape; glyph: string; labelKey: string }[] = [
    { shape: 'block', glyph: '█', labelKey: 'settings.caretShapeBlock' },
    { shape: 'beam', glyph: '|', labelKey: 'settings.caretShapeBeam' },
    { shape: 'underline', glyph: '▁', labelKey: 'settings.caretShapeUnderline' },
  ]
  /** ★ 2026-08-22（2026-09-28 扩展）：右键菜单定制项（数据驱动渲染）。
   *  顺序数组 + 停用集合共同决定：顺序用于拖拽排序，disabling 用于复选框启用/停用。 */
  contextMenuOrder: ContextMenuCustomId[] = [...DEFAULT_FILE_MENU_ORDER, 'groupBy']
  /** ★ 2026-09-28：被停用的右键菜单项（复选框取消勾选）；空 = 全部启用 */
  contextMenuDisabled: ContextMenuCustomId[] = []
  /** 右键菜单排序拖拽中的项 */
  draggingMenuItem: ContextMenuCustomId | null = null

  /** ★ 2026-08-31：面板内置操作快捷键，一动作可绑多个键
   *  （keys 空数组 = 未绑定即禁用；enabled=false 为双保险标记，防 Tabby config 清洗空数组后 defaults 回退） */
  panelHotkeys: Record<PanelHotkeyAction, { keys: string[]; enabled: boolean }> = defaultPanelHotkeys()
  /** 面板快捷键录制中：当前正在录制的动作（null = 未在录制） */
  panelHotkeyRecording: PanelHotkeyAction | null = null
  /** 面板快捷键录制实时预览串 */
  panelHotkeyRecordingPreview = ''
  /** 面板快捷键录制对应的键盘监听句柄，便于卸载 */
  private _panelHotkeyDomHandler: ((ev: KeyboardEvent) => void) | null = null
  /** 面板快捷键录制对应的鼠标监听句柄（用于录制鼠标侧键/中键） */
  private _panelHotkeyMouseHandler: ((ev: MouseEvent) => void) | null = null
  /** 面板快捷键录制对应的滚轮监听句柄（用于录制滚轮上/下滚） */
  private _panelHotkeyWheelHandler: ((ev: WheelEvent) => void) | null = null
  /** 本次待提交的 spec，用于识别「同一 spec 的连续事件」（滚轮一次操作会连发多个 wheel） */
  private _panelHotkeyPendingSpec = ''
  private _panelHotkeyTimer: any = null
  private _panelHotkeySafeTimer: any = null
  /** 面板快捷键动作枚举（设置页列表顺序） */
  panelHotkeyActions: PanelHotkeyAction[] = [...PANEL_HOTKEY_ACTIONS]

  /** 主题颜色修改确认弹窗 */
  showThemeColorConfirm = false
  /** 待提交的颜色修改 */
  private _pendingColorKey = ''
  private _pendingColorVal = ''
  /** 发起修改时的主题模式（弹窗确认后用于复制色值） */
  private _pendingOrigTheme = ''

  /** 存储模式：仅使用 Tabby 配置存储 */
  storageMode = 'config'
  private readonly transferLogImport: SftpTransferLogService

  constructor(
    @Optional() public configService?: ConfigService,
    @Optional() private hotkeys?: HotkeysService,
    @Optional() private sftpConfig?: SftpConfigService,
    @Optional() @Inject('BOOTSTRAP_DATA') private bootstrapData?: any,
    // ★ 2026-09-24：意见反馈预填环境信息（对齐 Tabby 原生「报告问题」）
    @Optional() private platformService?: PlatformService,
    @Optional() private hostApp?: HostAppService,
  ) {
    // ConfigService 是可选的，如果注入失败（开发环境/Tabby 版本不支持），回退到 localStorage
    this.i18n = new SftpI18nService(configService)
    this.transferLogImport = new SftpTransferLogService(configService)
  }

  /** 缓存事件监听引用，便于 ngOnDestroy 清理（P1-7） */
  private _settingsChangedHandler: (() => void) | null = null

  _base_ngOnInit(): void {
    // 首次加载：刷新配置 + 注册一次性事件监听
    this._refreshFromConfig()

    // 监听面板上的布局切换 → 同步更新设置页显示（只注册一次）
    if (!this._settingsChangedHandler) {
      this._settingsChangedHandler = () => {
        // 从 config store 读取面板端切换的布局
        const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
        if (cfg?.layoutMode) this.layoutMode = cfg.layoutMode as string
        if (typeof cfg?.fontSize === 'number') this.fontSize = this._clampFontSize(cfg.fontSize)
      }
      window.addEventListener('sftp-plus-settings-changed', this._settingsChangedHandler)
    }
  }

  ngOnDestroy(): void {
    this.cancelHotkeyRecording()
    // ★ 2026-09-20 A4 审计修复：此前漏掉「面板操作快捷键」录制链的清理——
    //   录制中关闭/切换设置页会残留两个 window 捕获监听器（最多 12s 到安全定时器才自愈），
    //   期间 Esc 与鼠标侧键被吞、且 hotkeys.disable() 状态未立即恢复（全局热键失效）。
    if (this.panelHotkeyRecording) this._teardownPanelHotkeyRecording()
    if (this._settingsChangedHandler) {
      window.removeEventListener('sftp-plus-settings-changed', this._settingsChangedHandler)
      this._settingsChangedHandler = null
    }
    if (this._hotkeyMsgTimer) {
      clearTimeout(this._hotkeyMsgTimer)
      this._hotkeyMsgTimer = null
    }
  }

  /** 开始录制面板开关快捷键 */
  startHotkeyRecording(): void {
    if (!this.configService?.store || this.hotkeyRecording) return
    this.hotkeyConflictNames = ''
    this.hotkeySaveMessage = ''
    this.hotkeyRecording = true
    this.hotkeyRecordingPreview = ''
    this._pendingHotkeyStrokes = []
    setHotkeyRecordingActive(true)
    void this._ensureHotkeyDescriptions()

    try { this.hotkeys?.clearCurrentKeystrokes?.() } catch { /* ignore */ }
    try {
      this.hotkeys?.disable?.()
      this._hotkeyDisableHeld = true
    } catch {
      this._hotkeyDisableHeld = false
    }

    // 始终用捕获阶段 DOM 监听兜底：按下「当前已绑定热键」时 Tabby 可能不再发 keystroke$
    this._hotkeyDomHandler = (ev: KeyboardEvent) => {
      if (!this.hotkeyRecording) return
      ev.preventDefault()
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        this.cancelHotkeyRecording()
        return
      }
      if (ev.repeat) return
      if (ev.key === 'Control' || ev.key === 'Meta' || ev.key === 'Alt' || ev.key === 'Shift') return
      const stroke = getKeystrokeNameFromEvent(ev)
      if (!stroke) return
      this._pendingHotkeyStrokes = [stroke]
      this.hotkeyRecordingPreview = stroke
      this._scheduleHotkeyCommit()
    }
    window.addEventListener('keydown', this._hotkeyDomHandler, true)

    if (this.hotkeys?.keystroke$?.subscribe) {
      this._hotkeyStrokeSub = this.hotkeys.keystroke$.subscribe((stroke: string) => {
        if (!stroke || !this.hotkeyRecording) return
        // DOM 已捕获过则不再重复追加，避免序列错乱
        if (this._pendingHotkeyStrokes.length === 1 && this._pendingHotkeyStrokes[0] === stroke) {
          this._scheduleHotkeyCommit()
          return
        }
        if (!this._pendingHotkeyStrokes.includes(stroke)) {
          this._pendingHotkeyStrokes.push(stroke)
        }
        this.hotkeyRecordingPreview = this._pendingHotkeyStrokes.join(' › ')
        this._scheduleHotkeyCommit()
      })
    }
    if (this.hotkeys?.keyEvent$?.subscribe) {
      this._hotkeyKeyEventSub = this.hotkeys.keyEvent$.subscribe((ev: any) => {
        if (ev instanceof KeyboardEvent) {
          ev.preventDefault()
          ev.stopPropagation()
        }
      })
    }

    // 安全超时：避免 disable() 后录制中断导致全局热键一直失效
    if (this._hotkeySafetyTimer) clearTimeout(this._hotkeySafetyTimer)
    this._hotkeySafetyTimer = setTimeout(() => {
      if (this.hotkeyRecording) {
        this.cancelHotkeyRecording()
        this._flashHotkeyMessage(this.i18n.t('settings.hotkeyRecordTimeout'))
      }
    }, 12000)
  }

  cancelHotkeyRecording(): void {
    this._teardownHotkeyRecording(false)
  }

  async clearHotkeyBinding(): Promise<void> {
    if (!this.configService?.store) return
    this.cancelHotkeyRecording()
    try {
      if (!this.configService.store.hotkeys) this.configService.store.hotkeys = {}
      this.configService.store.hotkeys[SFTP_PLUS_TOGGLE_HOTKEY] = []
      await this.configService.save()
      this.hotkeyConflictNames = ''
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeyCleared'))
    } catch (e) {
      log.warn('clear hotkey failed', e)
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeySaveFailed'))
    }
  }

  private _scheduleHotkeyCommit(): void {
    if (this._hotkeyCommitTimer) clearTimeout(this._hotkeyCommitTimer)
    // 单键稍短提交，降低与旧热键冲突窗口
    const delay = this._pendingHotkeyStrokes.length > 1 ? 800 : 350
    this._hotkeyCommitTimer = setTimeout(() => {
      this._hotkeyCommitTimer = null
      void this._commitHotkeyRecording()
    }, delay)
  }

  private async _base__commitHotkeyRecording(): Promise<void> {
    const strokes = [...this._pendingHotkeyStrokes]
    this._teardownHotkeyRecording(true)
    if (!strokes.length || !this.configService?.store) return

    const binding: HotkeyBinding = strokes.length === 1 ? strokes[0] : strokes
    const current = readToggleHotkeyBindings(this.configService.store.hotkeys)
    const sameAsCurrent = current.length === 1
      && formatHotkeyBinding(current[0]) === formatHotkeyBinding(binding)
    if (sameAsCurrent) {
      // 又按了一次当前绑定：直接结束录制，不重复写入
      this.hotkeyConflictNames = ''
      return
    }

    const conflicts = findHotkeyConflicts(binding, this.configService.store.hotkeys, SFTP_PLUS_TOGGLE_HOTKEY)
    if (conflicts.length) {
      const names = await this._resolveHotkeyNames(conflicts)
      this.hotkeyConflictNames = names.join(', ')
      const ok = confirm(this.i18n.t('settings.hotkeyConflictConfirm', {
        keys: formatHotkeyBinding(binding),
        names: this.hotkeyConflictNames,
      }))
      if (!ok) {
        this.hotkeyConflictNames = ''
        return
      }
    } else {
      this.hotkeyConflictNames = ''
    }

    try {
      if (!this.configService.store.hotkeys) this.configService.store.hotkeys = {}
      this.configService.store.hotkeys[SFTP_PLUS_TOGGLE_HOTKEY] = [binding]
      await this.configService.save()
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeySaved', {
        keys: formatHotkeyBinding(binding),
      }))
    } catch (e) {
      log.warn('save hotkey failed', e)
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeySaveFailed'))
    }
  }

  private _teardownHotkeyRecording(_keepPreview: boolean): void {
    if (this._hotkeyCommitTimer) {
      clearTimeout(this._hotkeyCommitTimer)
      this._hotkeyCommitTimer = null
    }
    if (this._hotkeySafetyTimer) {
      clearTimeout(this._hotkeySafetyTimer)
      this._hotkeySafetyTimer = null
    }
    try { this._hotkeyStrokeSub?.unsubscribe() } catch { /* ignore */ }
    try { this._hotkeyKeyEventSub?.unsubscribe() } catch { /* ignore */ }
    this._hotkeyStrokeSub = null
    this._hotkeyKeyEventSub = null
    if (this._hotkeyDomHandler) {
      window.removeEventListener('keydown', this._hotkeyDomHandler, true)
      this._hotkeyDomHandler = null
    }
    try { this.hotkeys?.clearCurrentKeystrokes?.() } catch { /* ignore */ }
    if (this._hotkeyDisableHeld) {
      try { this.hotkeys?.enable?.() } catch { /* ignore */ }
      this._hotkeyDisableHeld = false
    }
    setHotkeyRecordingActive(false)
    this.hotkeyRecording = false
    this._pendingHotkeyStrokes = []
    this.hotkeyRecordingPreview = ''
  }

  private _flashHotkeyMessage(msg: string): void {
    this.hotkeySaveMessage = msg
    if (this._hotkeyMsgTimer) clearTimeout(this._hotkeyMsgTimer)
    this._hotkeyMsgTimer = setTimeout(() => {
      this.hotkeySaveMessage = ''
      this._hotkeyMsgTimer = null
    }, 2500)
  }

  /** 开始录制某个面板操作快捷键（追加为新绑定；键盘单键 + 鼠标侧键，区别于 Tabby 多键序列格式） */
  startPanelHotkeyRecording(action: PanelHotkeyAction): void {
    if (this.panelHotkeyRecording) this._teardownPanelHotkeyRecording()
    this.panelHotkeyRecording = action
    this.panelHotkeyRecordingPreview = ''
    setHotkeyRecordingActive(true)
    try { this.hotkeys?.disable?.() } catch { /* ignore */ }

    const commit = (spec: string | null) => {
      if (!spec) return
      this.panelHotkeyRecordingPreview = this.panelHotkeyLabel(spec)
      // ★ 2026-09-29：滚轮一次物理操作会连发多个 wheel 事件，同一 spec 只保留首次的提交计时，
      //   否则事件流持续期间计时器被反复重置，松手后仍要再等一个延迟才提交。
      if (spec === this._panelHotkeyPendingSpec && this._panelHotkeyTimer) return
      if (this._panelHotkeyTimer) clearTimeout(this._panelHotkeyTimer)
      this._panelHotkeyPendingSpec = spec
      this._panelHotkeyTimer = setTimeout(() => {
        this._panelHotkeyTimer = null
        this._commitPanelHotkey(action, spec)
      }, 250)
    }

    this._panelHotkeyDomHandler = (ev: KeyboardEvent) => {
      if (!this.panelHotkeyRecording) return
      ev.preventDefault()
      ev.stopPropagation()
      if (ev.key === 'Escape') { this._teardownPanelHotkeyRecording(); return }
      if (ev.repeat) return
      commit(eventToPanelHotkeySpec(ev))
    }
    // ★ 2026-08-31：鼠标键录制（button 1 = 中键 / 3 = 后退 / 4 = 前进）；
    //   左键(0)与右键(2)返回 null ⇒ 不参与绑定也不吞事件
    this._panelHotkeyMouseHandler = (ev: MouseEvent) => {
      if (!this.panelHotkeyRecording) return
      const spec = pointerSpecFromEvent(ev)
      if (!spec) return
      ev.preventDefault()
      ev.stopPropagation()
      commit(spec)
    }
    // ★ 2026-09-29：滚轮录制。两个要点缺一不可：
    //   ① 只在录制期监听，且捕获阶段就 preventDefault —— 否则设置页自己会跟着滚，
    //      滚到别的行上用户就看不到录制框了；
    //   ② 必须显式 passive:false —— window/document 上的 wheel 监听默认 passive:true，
    //      此时 preventDefault() 是空操作（浏览器只打一条警告），页面照样滚。
    this._panelHotkeyWheelHandler = (ev: WheelEvent) => {
      if (!this.panelHotkeyRecording) return
      ev.preventDefault()
      ev.stopPropagation()
      commit(pointerSpecFromEvent(ev))
    }
    window.addEventListener('keydown', this._panelHotkeyDomHandler, true)
    window.addEventListener('mousedown', this._panelHotkeyMouseHandler, true)
    window.addEventListener('wheel', this._panelHotkeyWheelHandler, { capture: true, passive: false })

    if (this._panelHotkeySafeTimer) clearTimeout(this._panelHotkeySafeTimer)
    this._panelHotkeySafeTimer = setTimeout(() => {
      if (this.panelHotkeyRecording) {
        this._teardownPanelHotkeyRecording()
        this._flashHotkeyMessage(this.i18n.t('settings.hotkeyRecordTimeout'))
      }
    }, 12000)
  }

  private _teardownPanelHotkeyRecording(): void {
    if (this._panelHotkeyTimer) { clearTimeout(this._panelHotkeyTimer); this._panelHotkeyTimer = null }
    if (this._panelHotkeySafeTimer) { clearTimeout(this._panelHotkeySafeTimer); this._panelHotkeySafeTimer = null }
    if (this._panelHotkeyDomHandler) {
      window.removeEventListener('keydown', this._panelHotkeyDomHandler, true)
      this._panelHotkeyDomHandler = null
    }
    if (this._panelHotkeyMouseHandler) {
      window.removeEventListener('mousedown', this._panelHotkeyMouseHandler, true)
      this._panelHotkeyMouseHandler = null
    }
    if (this._panelHotkeyWheelHandler) {
      // 移除只需 capture 标志一致；passive 不参与匹配
      window.removeEventListener('wheel', this._panelHotkeyWheelHandler, { capture: true })
      this._panelHotkeyWheelHandler = null
    }
    this._panelHotkeyPendingSpec = ''
    try { this.hotkeys?.enable?.() } catch { /* ignore */ }
    setHotkeyRecordingActive(false)
    this.panelHotkeyRecording = null
    this.panelHotkeyRecordingPreview = ''
  }

  private async _commitPanelHotkey(action: PanelHotkeyAction, spec: string): Promise<void> {
    this._teardownPanelHotkeyRecording()
    // 不与其它动作的绑定重复
    for (const a of this.panelHotkeyActions) {
      if (a !== action && this.panelHotkeyKeys(a).includes(spec)) {
        this._flashHotkeyMessage(this.i18n.t('settings.panelHotkeyConflict', { keys: this.panelHotkeyLabel(spec) }))
        return
      }
    }
    const list = this.panelHotkeys[action]
    if (list.keys.includes(spec)) {
      this._flashHotkeyMessage(this.i18n.t('settings.hotkeyDuplicate'))
      return
    }
    // ★ 2026-09-20：对照 Tabby 全局热键（如默认 Alt-Enter = 切换全屏），避免绑上却被 Tabby 抢走且无提示
    const tabbyStroke = panelHotkeySpecToTabbyBinding(spec)
    if (tabbyStroke && this.configService?.store?.hotkeys) {
      const conflicts = findHotkeyConflicts(tabbyStroke, this.configService.store.hotkeys, '')
      if (conflicts.length) {
        const names = await this._resolveHotkeyNames(conflicts)
        this.hotkeyConflictNames = names.join(', ')
        const ok = confirm(this.i18n.t('settings.hotkeyConflictConfirm', {
          keys: this.panelHotkeyLabel(spec),
          names: this.hotkeyConflictNames,
        }))
        if (!ok) {
          this.hotkeyConflictNames = ''
          return
        }
        this.hotkeyConflictNames = ''
      }
    }
    list.keys = [...list.keys, spec]
    list.enabled = true
    this._saveToConfig()
    this.notifyPanels()
    // ★ 2026-09-29：裸滚轮（无修饰键）绑定会把面板列表的滚动顶掉——绑上必须明说，
    //   否则用户只会觉得「列表突然滚不动了」（吞事件才能触发动作，二者不可兼得）
    this._flashHotkeyMessage(isBareWheelSpec(spec)
      ? this.i18n.t('settings.panelHotkeyWheelBareWarning', { keys: this.panelHotkeyLabel(spec) })
      : this.i18n.t('settings.hotkeySaved', { keys: this.panelHotkeyLabel(spec) }))
  }

  /** 移除某个动作的单个快捷键绑定 */
  removePanelHotkeyAt(action: PanelHotkeyAction, index: number): void {
    const list = this.panelHotkeys[action]
    if (!list || index < 0 || index >= list.keys.length) return
    list.keys = list.keys.filter((_, i) => i !== index)
    // 全部移除后置 enabled=false 双保险，防止 config 清洗空数组后 defaults 回退
    if (!list.keys.length) list.enabled = false
    this._saveToConfig()
    this.notifyPanels()
    this._flashHotkeyMessage(this.i18n.t('settings.hotkeyCleared'))
  }

  /** 清除某个动作的全部快捷键绑定 */
  clearPanelHotkey(action: PanelHotkeyAction): void {
    this.panelHotkeys[action] = { keys: [], enabled: false }
    this._saveToConfig()
    this.notifyPanels()
    this._flashHotkeyMessage(this.i18n.t('settings.hotkeyCleared'))
  }

  /** 判断某面板快捷键是否已绑定（至少一个有效绑定，且 enabled 未被标记为 false） */
  isPanelHotkeyBound(action: PanelHotkeyAction): boolean {
    return this.panelHotkeyKeys(action).length > 0
  }

  /** 取某动作的绑定列表（已归一化，剔除哨兵/空值）；enabled=false 视为未绑定 */
  panelHotkeyKeys(action: PanelHotkeyAction): string[] {
    const h = (this.panelHotkeys as any)[action]
    if (!h || h.enabled === false) return []
    return normalizePanelHotkeyKeys(h.keys, PANEL_HOTKEY_CLEARED)
  }

  /** 单个绑定的显示文案：指针类用固定符号（鼠标键 MouseN / 滚轮 Wheel↑↓），空格键显示 Space */
  panelHotkeyLabel(spec: string): string {
    if (!spec) return ''
    if (spec === ' ') return 'Space'
    // 带修饰键时只替换主键部分（'Alt+WheelUp' → 'Alt+Wheel↑'）
    const cut = spec.lastIndexOf('+')
    const mods = cut >= 0 ? spec.slice(0, cut + 1) : ''
    const main = cut >= 0 ? spec.slice(cut + 1) : spec
    const special: Record<string, string> = {
      [MOUSE_MIDDLE_SPEC]: 'Mouse1',
      [MOUSE_BACK_SPEC]: 'Mouse3',
      [MOUSE_FORWARD_SPEC]: 'Mouse4',
      [WHEEL_UP_SPEC]: 'Wheel↑',
      [WHEEL_DOWN_SPEC]: 'Wheel↓',
    }
    return mods + (special[main] ?? main)
  }

  /** 是否为指针类绑定（鼠标键/滚轮；模板据此用不同配色区分） */
  isPanelPointerHotkey(spec: string): boolean {
    return isPointerHotkeySpec(spec)
  }

  /** 绑定 chip 的悬停提示：滚轮 → 滚动被顶掉的提醒；鼠标键 → 侧键/中键说明；其余 → 点击重新录制 */
  hotkeyChipHint(spec: string): string {
    if (isWheelHotkeySpec(spec)) return this.i18n.t('settings.hotkeyWheelHint')
    if (isMouseHotkeySpec(spec)) return this.i18n.t('settings.hotkeyMouseHint')
    return this.i18n.t('settings.hotkeyClickToSet')
  }

  /** 重置面板快捷键为默认值 */
  resetPanelHotkeys(): void {
    this.panelHotkeys = defaultPanelHotkeys()
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 面板快捷键动作的标签 i18n key。新增动作复用右键菜单既有文案，避免重复翻译 24 语言 */
  private readonly panelHotkeyLabelKeys: Record<PanelHotkeyAction, string> = {
    delete: 'settings.phk.delete',
    rename: 'settings.phk.rename',
    refresh: 'settings.phk.refresh',
    up: 'settings.phk.up',
    back: 'settings.phk.back',
    forward: 'settings.phk.forward',
    upload: 'app.upload',
    download: 'app.download',
    openLocal: 'file.open',
    viewFile: 'file.view',
    editFile: 'file.edit',
    newFolder: 'file.newFolder',
    newFile: 'file.newFile',
    details: 'file.properties',
    copyPath: 'pane.copyPath',
  }

  panelHotkeyLabelKey(action: PanelHotkeyAction): string {
    return this.panelHotkeyLabelKeys[action] ?? action
  }

  /** 系统修饰键文本（macOS 为 ⌘，其余为 Ctrl） */
  get modKeyText(): string {
    const p = (typeof navigator !== 'undefined' ? navigator.platform : '') || ''
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || ''
    return /Mac|iPod|iPhone|iPad/.test(p || ua) ? '⌘' : 'Ctrl'
  }

  /** 占用清单中把 '${mod}' 占位符替换为系统修饰键 */
  formatOccupiedKeys(keys: string): string {
    return String(keys).replace('${mod}', this.modKeyText)
  }

  /** 「已占用快捷键」清单展开状态（默认收起） */
  occupiedHotkeysExpanded = false

  toggleOccupiedHotkeys(): void {
    this.occupiedHotkeysExpanded = !this.occupiedHotkeysExpanded
  }

  /**
   * 由 SFTP++ 固定占用、用户不可修改的键位（只读展示）。
   * 列出这些可避免用户把上面的可配置快捷键设成已被占用的组合而互相抢触发。
   */
  readonly occupiedHotkeyGroups: Array<{
    titleKey: string
    items: Array<{ keys: string; descKey: string }>
  }> = [
    {
      titleKey: 'settings.occupied.groupPanel',
      items: [
        { keys: '${mod}+A', descKey: 'pane.selectAll' },
        { keys: '${mod}+C', descKey: 'file.copy' },
        { keys: '${mod}+X', descKey: 'file.cut' },
        { keys: '${mod}+V', descKey: 'file.paste' },
        { keys: '↑ ↓', descKey: 'settings.occupied.moveSelection' },
        { keys: '${mod}+Click', descKey: 'settings.occupied.multiSelect' },
        { keys: 'A–Z …', descKey: 'settings.occupied.typeAhead' },
      ],
    },
    {
      titleKey: 'settings.occupied.groupViewer',
      items: [
        { keys: '← →', descKey: 'settings.occupied.prevNextImage' },
      ],
    },
    {
      titleKey: 'settings.occupied.groupDialog',
      items: [
        { keys: 'Esc', descKey: 'settings.occupied.closeDialog' },
        { keys: 'Enter', descKey: 'settings.occupied.confirmDelete' },
      ],
    },
  ]

  private async _ensureHotkeyDescriptions(): Promise<void> {
    if (Object.keys(this._hotkeyDescCache).length) return
    try {
      const list = await this.hotkeys?.getHotkeyDescriptions?.()
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id) this._hotkeyDescCache[item.id] = item.name || item.id
        }
      }
    } catch { /* ignore */ }
  }

  private async _resolveHotkeyNames(ids: string[]): Promise<string[]> {
    await this._ensureHotkeyDescriptions()
    return ids.map(id => this._hotkeyDescCache[id] || id)
  }

  /** 从配置重新加载所有设置并刷新主题（可安全重复调用） */
  private _refreshFromConfig(): void {
    const root = document.documentElement

    // 从 Tabby 配置加载存储的设置
    this._readFromConfig()

    // Auto 模式下检测当前 Tabby UI 主题，并加载对应预设色值
    if (!this.theme) {
      this.detectAutoTheme()
      const autoPreset = this.detectedAutoTheme === 'light' ? this.getPreset('light') : this.getPreset('dark')
      if (autoPreset) {
        this.themePrimary = autoPreset.primary
        this.themeBg = autoPreset.bg
        this.themeText = autoPreset.text
        this.themeBorder = autoPreset.border
      }
      this.clearColorVars()
    } else if (this.theme !== 'custom') {
      const p = this.getPreset(this.theme)
      if (p) {
        this.themePrimary = p.primary
        this.themeBg = p.bg
        this.themeText = p.text
        this.themeBorder = p.border
        this.applyColors(root)
      }
    } else {
      // 自定义主题：从 localStorage 恢复自定义颜色（config 可能被预定义主题覆盖）
      this._restoreCustomColors()
      this.applyColors(root)
    }
  }

  /** 从 Tabby 配置加载所有设置 */
  private _base__readFromConfig(): void {
    try {
      const cfg = this.configService?.store?.['tabby-sftp-plus-plus']
      if (!cfg) return
      if (cfg.lang !== undefined) this.lang = cfg.lang as '' | Locale
      if (cfg.layoutMode !== undefined) this.layoutMode = cfg.layoutMode as string
      if (typeof cfg.fontSize === 'number' && Number.isFinite(cfg.fontSize)) {
        this.fontSize = this._clampFontSize(cfg.fontSize)
      }
      if (cfg.theme !== undefined) this.theme = cfg.theme as string
      if (cfg.colorPrimary !== undefined) this.themePrimary = cfg.colorPrimary as string
      if (cfg.colorBg !== undefined) this.themeBg = cfg.colorBg as string
      if (cfg.colorText !== undefined) this.themeText = cfg.colorText as string
      if (cfg.colorBorder !== undefined) this.themeBorder = cfg.colorBorder as string
      if (cfg.tableColBorders !== undefined) this.showColBorders = cfg.tableColBorders as boolean
      if (cfg.tableZebra !== undefined) this.showZebra = cfg.tableZebra as boolean
      if (cfg.hideNativeSFTPButton !== undefined) this.hideNativeBtn = cfg.hideNativeSFTPButton as boolean
      if (cfg.defaultPathMode === 'off' || cfg.defaultPathMode === 'remember' || cfg.defaultPathMode === 'sync') this.defaultPathMode = cfg.defaultPathMode
      if (cfg.defaultShowHidden !== undefined) this.defaultShowHidden = cfg.defaultShowHidden === true
      if (cfg.openInNewTabByDefault !== undefined) this.openInNewTabByDefault = cfg.openInNewTabByDefault as boolean
      if (cfg.singleWorkspaceInstance !== undefined) this.singleWorkspaceInstance = cfg.singleWorkspaceInstance as boolean
      if (cfg.closeBookmarkPanelOnSelect !== undefined) this.closeBookmarkPanelOnSelect = cfg.closeBookmarkPanelOnSelect as boolean
      if (cfg.bookmarkPanelGroupByScope !== undefined) this.bookmarkPanelGroupByScope = cfg.bookmarkPanelGroupByScope !== false
      if (Array.isArray(cfg.bookmarkPanelGroupOrder) && cfg.bookmarkPanelGroupOrder.length) {
        const valid = (cfg.bookmarkPanelGroupOrder as string[]).filter(
          (x): x is 'connection' | 'global' => x === 'connection' || x === 'global',
        )
        if (valid.includes('connection') && valid.includes('global')) {
          this.bookmarkPanelGroupOrder = [valid[0], valid.find(x => x !== valid[0])!]
        }
      }
      if (cfg.dateFormat !== undefined) {
        this.dateFormat = (cfg.dateFormat as string) || DEFAULT_DATE_FORMAT
        setDateFormatPattern(this.dateFormat)
      }
      if (typeof cfg.transferUploadConcurrency === 'number') this.uploadConcurrency = this._clampConcurrency(cfg.transferUploadConcurrency)
      if (typeof cfg.transferDownloadConcurrency === 'number') this.downloadConcurrency = this._clampConcurrency(cfg.transferDownloadConcurrency)
      // ★ 2026-09-28：传输通道模式（含旧 transferTarAcceleration 开关迁移）
      if ((cfg as any).transferChannelMode && ['smart', 'sftpOnly', 'tarOnly', 'preferSftp', 'preferTar'].includes((cfg as any).transferChannelMode)) {
        this.transferChannelMode = (cfg as any).transferChannelMode
      } else if ((cfg as any).transferTarAcceleration === false) {
        this.transferChannelMode = 'sftpOnly'
      } else {
        this.transferChannelMode = 'smart'
      }
      // ★ 2026-09-07 issue #15：冲突内容摘要
      if (cfg.conflictDigestEnabled !== undefined) this.conflictDigestEnabled = cfg.conflictDigestEnabled !== false
      if (cfg.conflictAutoSkipSameContent !== undefined) this.conflictAutoSkipSameContent = cfg.conflictAutoSkipSameContent !== false
      if (cfg.conflictDigestMaxSizeMB !== undefined) {
        this.conflictDigestMaxSizeMB = this._clampDigestMaxMB(cfg.conflictDigestMaxSizeMB)
      }
      if (typeof cfg.defaultUploadPath === 'string') this.defaultUploadPath = cfg.defaultUploadPath
      if (typeof cfg.defaultDownloadPath === 'string') this.defaultDownloadPath = cfg.defaultDownloadPath
      if (typeof cfg.iconResourceDir === 'string') this.iconResourceDir = cfg.iconResourceDir
      if (Array.isArray(cfg.fileTypeIcons)) {
        this.fileTypeIcons = cfg.fileTypeIcons
          .filter((r: any) => r && typeof r.ext === 'string' && typeof r.svg === 'string')
          .map((r: any) => {
            const rule: FileTypeIconRule = { ext: r.ext, svg: r.svg }
            if (typeof r.name === 'string' && r.name.trim()) rule.name = r.name.trim()
            return rule
          })
      }
      if (Array.isArray(cfg.disabledIconSvgs)) this.disabledIconSvgs = cfg.disabledIconSvgs.filter((s: any) => typeof s === 'string')
      if (typeof cfg.folderIconSvg === 'string') this.folderIconSvg = cfg.folderIconSvg || 'folder.svg'
      // 自动清理指向不存在 svg 的旧规则（仅当图标目录可读时执行，避免误删自定义目录临时不可用的合法规则）
      this._autoCleanInvalidRules()
      if (cfg.hideAuthorInfo !== undefined) this.hideAuthorInfo = cfg.hideAuthorInfo === true
      if (Array.isArray(cfg.paneCustomOrder) && cfg.paneCustomOrder.length) this.paneCustomOrder = cfg.paneCustomOrder as any
      // 一次性迁移：旧默认顺序（hidden 追加在末尾）→ 新默认顺序（hidden 在 filter 前）；用户自定义过的顺序不动
      if (this.paneCustomOrder.join(',') === 'label,back,forward,up,refresh,home,path,filter,bookmark,hidden') {
        this.paneCustomOrder = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
      }
      // 保证 'hidden'（眼睛图标项）始终存在于顺序中：缺失时插到 'filter' 前面（无 filter 则追加末尾）
      if (!this.paneCustomOrder.includes('hidden')) {
        const next = [...this.paneCustomOrder]
        const idx = next.indexOf('filter')
        next.splice(idx >= 0 ? idx : next.length, 0, 'hidden')
        this.paneCustomOrder = next
      }
      // 注意：空数组也要赋值（全部重新勾选后隐藏列表为空，必须覆盖旧值），仅当 config 无该字段时才回退 localStorage
      if (Array.isArray(cfg.paneHiddenItems)) {
        this.paneHiddenItems = cfg.paneHiddenItems as string[]
      } else {
        try {
          const raw = localStorage.getItem('sftp-plus-pane-hidden-items')
          if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) this.paneHiddenItems = parsed as string[] }
        } catch { /* ignore */ }
      }
      // ★ 2026-08-22：交互设置
      if (cfg.openOnClick === 'single' || cfg.openOnClick === 'double') this.openOnClick = cfg.openOnClick
      if (cfg.openUnsupportedInSystem !== undefined) this.openUnsupportedInSystem = cfg.openUnsupportedInSystem === true
      if (cfg.editableFileExtensions !== undefined) {
        this.editableFileExtensionsText = formatTextExtensionsForInput(cfg.editableFileExtensions)
      }
      this.allowViewEditAllFiles = resolveAllowViewEditAllFiles(cfg as Record<string, unknown>)
      if (cfg.showTextLineNumbers !== undefined) this.showTextLineNumbers = cfg.showTextLineNumbers !== false
      if (cfg.textCaretShape !== undefined) this.textCaretShape = normalizeCaretShape(cfg.textCaretShape)
      if (Array.isArray(cfg.contextMenuOrder) && cfg.contextMenuOrder.length) {
        const valid = (cfg.contextMenuOrder as string[]).filter(a => (a in FILE_MENU_REGISTRY)) as ContextMenuAction[]
        // 补齐可能缺失的已知项（保证顺序数组始终含全部文件动作，缺失项追加末尾）
        for (const a of DEFAULT_FILE_MENU_ORDER) if (!valid.includes(a)) valid.push(a)
        this.contextMenuOrder = [...valid, 'groupBy'] as ContextMenuCustomId[]
      }
      if (Array.isArray(cfg.contextMenuDisabled)) {
        // groupToggleAll 已并入分组依据子菜单，不再是独立定制项——历史配置里的该值直接丢弃
        this.contextMenuDisabled = (cfg.contextMenuDisabled as string[])
          .filter(a => (a in FILE_MENU_REGISTRY) || a === 'groupBy') as ContextMenuCustomId[]
      }
      // ★ 2026-08-31：面板内置操作快捷键（多绑定）。与默认值合并保证动作齐全。
      // ★ 2026-08-24 修复：空串/NUL/空数组会被 Tabby config 清洗删除（{} → defaults 回退 F2/F5）。
      //    双保险：无绑定时写 enabled=false（布尔一定保留），读取时据此判为未绑定。
      if (cfg.panelHotkeys && typeof cfg.panelHotkeys === 'object') {
        const ph = cfg.panelHotkeys as any
        const def = this.panelHotkeys
        for (const a of PANEL_HOTKEY_ACTIONS) {
          if (ph[a] && typeof ph[a] === 'object') {
            const isDisabled = ph[a].enabled === false
            // 兼容旧格式 { key: 'Delete' } 与新格式 { keys: ['Delete'] }
            const raw = (ph[a] as any).keys ?? (ph[a] as any).key
            // ★ 2026-09-29：「keys/key 与 enabled 双双缺省」= 清空数据后留下的空壳
            //   （ConfigProxy 对结构成员的叶子，一旦值等于默认值就会被 delete，故「已恢复默认」
            //   在磁盘上表现为 `{}` 而不是 `{keys:['Delete'],enabled:true}`）。
            //   此时必须**保留默认绑定** —— 否则「清空数据」会把 Delete / F2 / F5 等默认快捷键
            //   显示成「未绑定」（看着像删过头，其实是读法把空壳误判成显式解绑）。
            //   注意：显式解绑一定是 `keys: []`（有定义）或 `enabled: false`，不会落到这里。
            if (raw === undefined && !isDisabled) continue
            const keys = isDisabled ? [] : normalizePanelHotkeyKeys(raw, PANEL_HOTKEY_CLEARED)
            def[a] = { keys, enabled: !isDisabled }
          }
        }
        this.panelHotkeys = def
      }
    } catch { /* ignore */ }
  }

  /**
   * 写入 Tabby config（per-property update 避免 ConfigProxy 覆盖问题）
   */
  private async _base__saveToConfig(): Promise<void> {
    try { localStorage.setItem('sftp-plus-pane-custom-order', JSON.stringify(this.paneCustomOrder)) } catch {}
    try { localStorage.setItem('sftp-plus-pane-hidden-items', JSON.stringify(this.paneHiddenItems)) } catch {}
    try { localStorage.setItem('sftp-plus-context-menu-order', JSON.stringify(this.contextMenuOrder)) } catch {}
    try { localStorage.setItem('sftp-plus-context-menu-disabled', JSON.stringify(this.contextMenuDisabled)) } catch {}
    if (!this.configService) return
    try {
      const target = this.configService.store['tabby-sftp-plus-plus']
      if (!target) return  // 配置段未就绪，静默跳过
      target.lang = this.lang
      target.layoutMode = this.layoutMode
      target.fontSize = this.fontSize
      // 同步写入面板读取的嵌套路径（与浮动面板 cycleLayoutMode 一致），修复设置页切换布局后面板不生效
      this.sftpConfig?.set('paneState/layout/mode', this.layoutMode)
      target.theme = this.theme
      target.colorPrimary = this.themePrimary
      target.colorBg = this.themeBg
      target.colorText = this.themeText
      target.colorBorder = this.themeBorder
      target.tableColBorders = this.showColBorders
      target.tableZebra = this.showZebra
      target.hideNativeSFTPButton = this.hideNativeBtn
      target.defaultPathMode = this.defaultPathMode
      target.defaultShowHidden = this.defaultShowHidden
      target.openInNewTabByDefault = this.openInNewTabByDefault
      target.singleWorkspaceInstance = this.singleWorkspaceInstance
      target.closeBookmarkPanelOnSelect = this.closeBookmarkPanelOnSelect
      target.bookmarkPanelGroupByScope = this.bookmarkPanelGroupByScope
      target.bookmarkPanelGroupOrder = this.bookmarkPanelGroupOrder
      target.dateFormat = this.dateFormat
      target.transferUploadConcurrency = this.uploadConcurrency
      target.transferDownloadConcurrency = this.downloadConcurrency
      target.transferChannelMode = this.transferChannelMode
      // ★ 2026-09-07 issue #15：三者均为标量叶子，可直接赋值（符合 ConfigProxy「只有叶子标量可写」的要求）
      target.conflictDigestEnabled = this.conflictDigestEnabled
      target.conflictAutoSkipSameContent = this.conflictAutoSkipSameContent
      target.conflictDigestMaxSizeMB = this.conflictDigestMaxSizeMB
      target.defaultUploadPath = this.defaultUploadPath
      target.defaultDownloadPath = this.defaultDownloadPath
      target.iconResourceDir = this.iconResourceDir
      target.fileTypeIcons = this.fileTypeIcons
      target.disabledIconSvgs = this.disabledIconSvgs
      target.folderIconSvg = this.folderIconSvg
      target.hideAuthorInfo = this.hideAuthorInfo
      target.paneCustomOrder = this.paneCustomOrder
      target.paneHiddenItems = this.paneHiddenItems
      target.openOnClick = this.openOnClick
      target.openUnsupportedInSystem = this.openUnsupportedInSystem
      target.editableFileExtensions = normalizeEditableExtensions(this.editableFileExtensionsText)
      target.allowViewEditAllFiles = this.allowViewEditAllFiles
      target.showTextLineNumbers = this.showTextLineNumbers
      target.textCaretShape = this.textCaretShape
      // 兼容旧字段：同步写入，避免回退旧版插件时丢失开关状态
      target.allowEditAllFiles = this.allowViewEditAllFiles
      target.allowViewAllAsText = this.allowViewEditAllFiles
      target.contextMenuOrder = this.contextMenuOrder
      target.contextMenuDisabled = this.contextMenuDisabled
      // ★ 2026-08-24 修复：panelHotkeys 是 ConfigProxy 的「结构成员」（对象），只有 getter 没有 setter。
      //    直接 `target.panelHotkeys = x` 不生效（严格模式抛 TypeError 被 catch 吞掉 / 非严格静默忽略），
      //    导致绑定从未落盘 → config.yaml 写成 {} → 重启后 defaults 回退 F2/F5。
      //    必须逐叶子赋值：先经 getter 取到嵌套 proxy，再对 keys/enabled 叶子调用 setter。
      // ★ 2026-08-31：改为多绑定 keys[]。空数组会被 config 清洗（等于默认值时 delete），
      //    故同时写 enabled=false 作双保险；并把旧单键字段 key 改写为哨兵，
      //    防止旧值在 keys 被清洗后「复活」成意外绑定。
      const ph = (target as any).panelHotkeys
      if (ph) {
        for (const a of PANEL_HOTKEY_ACTIONS) {
          const dst = ph[a]
          if (dst) {
            const keys = this.panelHotkeyKeys(a)
            dst.keys = keys
            dst.enabled = keys.length > 0 && this.panelHotkeys[a].enabled !== false
            dst.key = PANEL_HOTKEY_CLEARED
          }
        }
      }
      await this.configService.save()
    } catch (e) {
      log.error('Failed to save to config', e)
    }
  }

  /**
   * 迁移数据：localStorage ↔ config.store（切换存储模式时调用）
   */
  saveLang(): void {
    this._saveToConfig()
    this.i18n.setLocale(this.effectiveLang)
    this.notifyPanels()
  }

  private getPreset(value: string): typeof this.colorThemes[0] | undefined {
    return this.colorThemes.find(t => t.value === value)
  }

  private applyColors(root: HTMLElement): void {
    if (!this.themePrimary || !this.themeBg || !this.themeText) return
    root.style.setProperty('--sftp-primary', this.themePrimary)
    root.style.setProperty('--sftp-bg', this.themeBg)
    root.style.setProperty('--sftp-text', this.themeText)
    root.style.setProperty('--sftp-border', this.themeBorder || '')
  }

  private clearColorVars(): void {
    const root = document.documentElement
    root.style.removeProperty('--sftp-primary')
    root.style.removeProperty('--sftp-bg')
    root.style.removeProperty('--sftp-text')
    root.style.removeProperty('--sftp-border')
  }

  setTheme(value: string): void {
    this.theme = value

    const root = document.documentElement
    if (!value) {
      this.clearColorVars()
      this.detectAutoTheme()
      // 加载检测到的明/暗模式的预设色值，让颜色面板有值可显示
      const autoPreset = this.detectedAutoTheme === 'light' ? this.getPreset('light') : this.getPreset('dark')
      if (autoPreset) {
        this.themePrimary = autoPreset.primary
        this.themeBg = autoPreset.bg
        this.themeText = autoPreset.text
        this.themeBorder = autoPreset.border
        // 不保存到 localStorage，避免覆盖自定义配色缓存
      }
      this._saveToConfig()
      this.notifyPanels()
      return
    }

    if (value === 'custom') {
      // 从 localStorage 恢复自定义配色
      this._restoreCustomColors()
      this.applyColors(root)
      this.saveAllColors()
    } else {
      const p = this.getPreset(value)
      if (p) {
        this.themePrimary = p.primary
        this.themeBg = p.bg
        this.themeText = p.text
        this.themeBorder = p.border
        // 不保存到 localStorage，避免覆盖自定义配色缓存
        this.applyColors(root)
      }
      this._saveToConfig()
    }
    this.notifyPanels()
  }

  onColorChange(key: string, val: string): void {
    if (this.theme !== 'custom') {
      // 非自定义模式：记录待修改值，弹窗询问
      this._pendingColorKey = key
      this._pendingColorVal = val
      this._pendingOrigTheme = this.theme
      this.showThemeColorConfirm = true
      return
    }
    // Update the specific color field
    const updates: Record<string, string> = { primary: this.themePrimary, bg: this.themeBg, text: this.themeText, border: this.themeBorder }
    updates[key] = val
    this.themePrimary = updates.primary
    this.themeBg = updates.bg
    this.themeText = updates.text
    this.themeBorder = updates.border
    this.saveAllColors()
    this.applyColors(document.documentElement)
    this.notifyPanels()
  }

  private saveAllColors(): void {
    // 写入 localStorage（load() 依赖 localStorage 读取）
    try { localStorage.setItem(`${PREFIX}.primaryColor`, JSON.stringify(this.themePrimary)) } catch {}
    try { localStorage.setItem(`${PREFIX}.bgColor`, JSON.stringify(this.themeBg)) } catch {}
    try { localStorage.setItem(`${PREFIX}.textColor`, JSON.stringify(this.themeText)) } catch {}
    try { localStorage.setItem(`${PREFIX}.borderColor`, JSON.stringify(this.themeBorder)) } catch {}
    this._saveToConfig()
  }

  /** 从 localStorage 恢复自定义配色（config 中可能被预定义主题覆盖） */
  private _restoreCustomColors(): void {
    const savedPrimary = load('primaryColor', '')
    if (savedPrimary) {
      this.themePrimary = savedPrimary
      this.themeBg = load('bgColor', '#313244')
      this.themeText = load('textColor', '#cdd6f4')
      this.themeBorder = load('borderColor', '#585b70')
    }
  }

  saveTableSettings(): void {
    // 写入 localStorage 供浮动面板读取（面板不支持直接从 config 读取）
    try { localStorage.setItem('sftp-plus-table.colBorders', JSON.stringify(this.showColBorders)) } catch {}
    try { localStorage.setItem('sftp-plus-table.zebra', JSON.stringify(this.showZebra)) } catch {}
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 切换隐藏原生 SFTP 按钮 */
  toggleHideNativeBtn(): void {
    this.hideNativeBtn = !this.hideNativeBtn
    try { localStorage.setItem('sftp-plus-settings.hideNativeBtn', JSON.stringify(this.hideNativeBtn)) } catch {}
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 保存默认路径模式 */
  _base_saveDefaultPathMode(): void {
    if (this.defaultPathMode !== 'off' && this.defaultPathMode !== 'remember' && this.defaultPathMode !== 'sync') this.defaultPathMode = 'off'
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 切换默认显示隐藏文件 */
  toggleDefaultShowHidden(): void {
    this.defaultShowHidden = !this.defaultShowHidden
    this._saveToConfig()
    this.notifyPanels()
  }

  /** ★ 2026-08-22：切换「查看器不支持的文件改用系统默认程序打开」 */
  toggleOpenUnsupportedInSystem(): void {
    this.openUnsupportedInSystem = !this.openUnsupportedInSystem
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 规范化扩展名后保存；例如 `.conf` 与 `*.conf` 都存为 `conf`，展示用空格分隔。 */
  saveEditorOptions(): void {
    this.editableFileExtensionsText = formatTextExtensionsForInput(this.editableFileExtensionsText)
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleAllowViewEditAllFiles(): void {
    this.allowViewEditAllFiles = !this.allowViewEditAllFiles
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleShowTextLineNumbers(): void {
    this.showTextLineNumbers = !this.showTextLineNumbers
    this._saveToConfig()
    this.notifyPanels()
  }

  onTextCaretShapeChange(shape: CaretShape): void {
    this.textCaretShape = normalizeCaretShape(shape)
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 切换工具栏入口默认在新标签页打开 */
  toggleOpenInNewTabByDefault(): void {
    this.openInNewTabByDefault = !this.openInNewTabByDefault
    if (this.openInNewTabByDefault) {
      this.singleWorkspaceInstance = true
    }
    this._saveToConfig()
  }

  /** 切换新标签页模式是否复用已有实例 */
  toggleSingleWorkspaceInstance(): void {
    if (!this.openInNewTabByDefault) return
    this.singleWorkspaceInstance = !this.singleWorkspaceInstance
    this._saveToConfig()
  }

  /* ───────────────────────── 图标网格交互方法 ───────────────────────── */

  /** 内置/旧配置无规则名时的默认展示名 */
  private defaultIconRuleName(svg: string): string {
    const s = (svg || '').trim()
    // 系统默认两项：文件夹 → folder，兜底文件 → file
    if (s === FOLDER_ICON_SVG || s === 'folder.svg') return 'folder'
    if (s === 'default.svg') return 'file'
    return s.replace(/\.svg$/i, '') || s
  }

  /** 规则条目的有效规则名（分组 key） */
  private _ruleNameOf(r: FileTypeIconRule): string {
    const n = (r.name || '').trim()
    // 兼容旧配置：default.svg 曾默认名为 default，统一归并为 file
    if (r.svg === 'default.svg' && (!n || n === 'default')) return 'file'
    if ((r.svg === FOLDER_ICON_SVG || r.svg === 'folder.svg') && (!n || n === 'folder.svg')) return 'folder'
    return n || this.defaultIconRuleName(r.svg)
  }

  /** trackBy：用规则名 key，避免 getter 每次返回新对象导致 *ngFor 频繁重建 DOM */
  trackByIcon(_index: number, item: { key: string }): string {
    return item.key
  }

  get iconGridItems(): { key: string; name: string; svg: string; isBuiltin: boolean; exts: string[] }[] {
    const items: { key: string; name: string; svg: string; isBuiltin: boolean; exts: string[] }[] = []

    // 按规则名聚合所有自定义条目
    const byName = new Map<string, { svg: string; exts: string[] }>()
    for (const r of this.fileTypeIcons) {
      if (!r.svg || r.svg === FOLDER_ICON_SVG) continue
      const name = this._ruleNameOf(r)
      if (!byName.has(name)) byName.set(name, { svg: r.svg, exts: [] })
      const g = byName.get(name)!
      g.svg = r.svg || g.svg
      const e = (r.ext || '').trim().toLowerCase()
      if (e) g.exts.push(e)
    }

    // ① 内置图标单元格：始终展示；扩展名优先取「规则名 = 默认名」的覆盖
    const ordered = [...BUILTIN_ICON_FILES].filter(f => f !== FOLDER_ICON_SVG)
    const defaultIdx = ordered.indexOf('default.svg')
    if (defaultIdx > 0) {
      ordered.splice(defaultIdx, 1)
      ordered.unshift('default.svg')
    }
    const consumed = new Set<string>()
    for (const f of ordered) {
      const key = this.defaultIconRuleName(f)
      const group = byName.get(key)
      const exts = group
        ? [...new Set(group.exts)]
        : [...(BUILTIN_ICON_EXTS[f] || [])]
      items.push({
        key,
        name: key,
        svg: group?.svg || f,
        isBuiltin: true,
        exts,
      })
      consumed.add(key)
    }

    // ② 其余自定义规则：按规则名展示（可与内置共用同一 svg，但独立分类）
    for (const [name, g] of byName) {
      if (consumed.has(name)) continue
      if (!g.svg) continue
      items.push({
        key: name,
        name,
        svg: g.svg,
        isBuiltin: false,
        exts: [...new Set(g.exts)],
      })
    }
    return items
  }

  /** 某个内置图标是否被禁用 */
  isIconDisabled(svg: string): boolean {
    return this.disabledIconSvgs.includes(svg)
  }

  /** 切换图标禁用状态 */
  toggleIconDisable(svg: string): void {
    if (this.isLockedIcon(svg)) return  // default.svg 锁死，不可禁用（系统兜底回退）
    if (this.disabledIconSvgs.includes(svg)) {
      this.disabledIconSvgs = this.disabledIconSvgs.filter(s => s !== svg)
    } else {
      this.disabledIconSvgs = [...this.disabledIconSvgs, svg]
    }
    this._saveToConfig()
  }

  /** 某个 svg 是否为内置图标（文件名在内置列表中） */
  isBuiltinSvg(svg: string): boolean {
    return BUILTIN_ICON_FILES.includes(svg)
  }

  /** ★ 2026-08-25：default.svg 是系统级兜底图标（未匹配文件的统一回退），不可删除/禁用，但允许在编辑页修改其扩展名关联 */
  isLockedIcon(svg: string): boolean {
    return svg === 'default.svg'
  }

  /** 系统保留规则名：file / folder 不可改名 */
  isSystemRuleName(key: string | null | undefined): boolean {
    return key === 'file' || key === 'folder'
  }

  /** svg 文件是否真实存在于有效图标目录 */
  private svgExists(svgName: string): boolean {
    const dir = this.effectiveIconBaseDir
    if (!dir || !svgName) return false
    try { return fs.existsSync(path.join(dir, svgName)) } catch { return false }
  }

  /** 取某规则名当前生效的扩展名列表 */
  private _extsForRuleName(ruleName: string, fallbackSvg?: string): string[] {
    const key = (ruleName || '').trim()
    const fromRules = this.fileTypeIcons
      .filter(r => this._ruleNameOf(r) === key)
      .map(r => (r.ext || '').trim().toLowerCase())
      .filter(Boolean)
    if (fromRules.length) return [...new Set(fromRules)]
    const svg = fallbackSvg || ''
    if (svg && this.defaultIconRuleName(svg) === key) {
      return [...(BUILTIN_ICON_EXTS[svg] || [])]
    }
    return []
  }

  /** 取某规则当前绑定的 svg（无则回退 fallback） */
  private _svgForRuleName(ruleName: string, fallbackSvg = ''): string {
    const key = (ruleName || '').trim()
    const hit = this.fileTypeIcons.find(r => this._ruleNameOf(r) === key && r.svg)
    return hit?.svg || fallbackSvg
  }

  startEditIcon(item: { key: string; name: string; svg: string }): void {
    this._addingCustomRule = false
    this._editingFolderIcon = false
    this._iconRuleError = ''
    this._editingRuleKey = item.key
    this._editingRuleName = item.name
    this._editingIconSvgName = item.svg
    this._editingIconExts = this._extsForRuleName(item.key, item.svg).join(' ')
  }

  /** 取消编辑 */
  cancelEditIcon(): void {
    this._editingRuleKey = null
    this._editingRuleName = ''
    this._editingIconExts = ''
    this._editingIconSvgName = ''
    this._iconRuleError = ''
  }

  /**
   * 解析并规范化图标扩展名输入。
   * 支持空格/逗号/分号分隔；允许省略前导点（test → .test）；全角标点先归一化。
   * 合法形如 `.ext`：以字母或数字开头，后续仅字母/数字/._+-
   */
  private _parseIconExtensions(raw: string): { valid: string[]; invalid: string[] } {
    const normalized = String(raw || '')
      .replace(/[。．]/g, '.')
      .replace(/[，、]/g, ',')
      .replace(/[；;]/g, ';')
      .trim()
    const tokens = normalized.split(/[\s,;|]+/).map(t => t.trim()).filter(Boolean)
    const valid: string[] = []
    const invalid: string[] = []
    const seen = new Set<string>()
    for (const token of tokens) {
      const withDot = token.startsWith('.') ? token : `.${token}`
      const ext = withDot.toLowerCase()
      // 拒绝单独的 "."、含空格、以及非扩展名字符
      if (!/^\.[a-z0-9][a-z0-9._+-]*$/i.test(ext) || ext.length > 32) {
        invalid.push(token)
        continue
      }
      if (!seen.has(ext)) {
        seen.add(ext)
        valid.push(ext)
      }
    }
    return { valid, invalid }
  }

  /** 检测扩展名冲突：返回第一个冲突的 {ext, ownerSvg}，无冲突返回 null */
  private checkExtConflict(extList: string[], excludeRuleName?: string): { ext: string; ownerSvg: string } | null {
    const extMap = new Map<string, string>()
    // 内置默认映射
    for (const [ext, svg] of Object.entries(DEFAULT_ICON_MAP)) {
      const key = ext.toLowerCase()
      if (!extMap.has(key)) extMap.set(key, svg)
    }
    // 自定义规则（排除正在编辑/追加的那条规则名）
    for (const r of this.fileTypeIcons) {
      if (excludeRuleName && this._ruleNameOf(r) === excludeRuleName) continue
      const e = (r.ext || '').trim().toLowerCase()
      if (!e) continue
      extMap.set(e, r.svg)
    }
    // 若排除的是内置默认规则名，同时剔除该内置 svg 在 DEFAULT_ICON_MAP 中的占用
    if (excludeRuleName) {
      for (const [ext, svg] of Object.entries(DEFAULT_ICON_MAP)) {
        if (this.defaultIconRuleName(svg) === excludeRuleName) {
          const key = ext.toLowerCase()
          if (extMap.get(key) === svg) extMap.delete(key)
        }
      }
    }
    for (const ext of extList) {
      const key = (ext || '').trim().toLowerCase()
      const owner = extMap.get(key)
      if (owner) return { ext: key, ownerSvg: owner }
    }
    return null
  }

  /** 确认编辑：按规则名更新 name/svg/扩展名 */
  confirmEditIcon(): void {
    if (!this._editingRuleKey) return
    const oldKey = this._editingRuleKey
    // 系统规则名锁定：file / folder 不允许改名
    const newName = this.isSystemRuleName(oldKey)
      ? oldKey
      : (this._editingRuleName || '').trim()
    const newSvg = this._editingIconSvgName.trim()
    if (!newName) {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmptyName')
      return
    }
    if (!this.svgExists(newSvg)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorMissingSvg')
      return
    }
    // 规则名冲突：不允许与其它规则重名
    if (newName !== oldKey && this.iconGridItems.some(i => i.key === newName)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorNameConflict')
        .replace('{name}', newName)
      return
    }
    const { valid: extList, invalid } = this._parseIconExtensions(this._editingIconExts)
    if (invalid.length) {
      this._iconRuleError = this.i18n.t('settings.iconErrorInvalidExt')
        .replace('{ext}', invalid.join(', '))
      return
    }
    // default.svg 允许空扩展名（兜底图标）；其它图标至少保留一个扩展名
    if (!extList.length && newSvg !== 'default.svg') {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    const conflict = this.checkExtConflict(extList, oldKey)
    if (conflict) {
      this._iconRuleError = this.i18n.t('settings.iconErrorExtConflict')
        .replace('{ext}', conflict.ext).replace('{svg}', conflict.ownerSvg)
      return
    }
    const others = this.fileTypeIcons.filter(r => this._ruleNameOf(r) !== oldKey)
    const newRules: FileTypeIconRule[] = extList.map(ext => ({ ext, svg: newSvg, name: newName }))
    this.fileTypeIcons = [...others, ...newRules]
    this._editingRuleKey = null
    this._editingRuleName = ''
    this._editingIconExts = ''
    this._editingIconSvgName = ''
    this._iconRuleError = ''
    this._saveToConfig()
  }

  /** 切换新增自定义规则表单的显示（"+"单元格用，与下方独立行表单配合） */
  toggleAddCustomRule(): void {
    if (this._addingCustomRule) {
      this.cancelAddCustomRule()
    } else {
      this._editingRuleKey = null
      this._editingFolderIcon = false
      this._iconRuleError = ''
      this._addingCustomRule = true
      this._newRuleName = ''
      this._newRuleExt = ''
      this._newRuleSvg = ''
    }
  }
  /** 显示新增自定义规则表单（保留旧入口兼容） */
  showAddCustomRule(): void {
    this._iconRuleError = ''
    this._addingCustomRule = true
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
  }

  /** 取消新增 */
  cancelAddCustomRule(): void {
    this._addingCustomRule = false
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
    this._iconRuleError = ''
  }

  /** 确认新增自定义规则：以规则名为 key；同名则追加合并，不同名则新建分类 */
  confirmAddCustomRule(): void {
    const name = (this._newRuleName || '').trim()
    const svg = (this._newRuleSvg || '').trim()
    if (!name || !svg || !(this._newRuleExt || '').trim()) {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    if (!this.svgExists(svg)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorMissingSvg')
      return
    }
    const { valid: extList, invalid } = this._parseIconExtensions(this._newRuleExt)
    if (invalid.length) {
      this._iconRuleError = this.i18n.t('settings.iconErrorInvalidExt')
        .replace('{ext}', invalid.join(', '))
      return
    }
    if (!extList.length) {
      this._iconRuleError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    const conflict = this.checkExtConflict(extList, name)
    if (conflict) {
      this._iconRuleError = this.i18n.t('settings.iconErrorExtConflict')
        .replace('{ext}', conflict.ext).replace('{svg}', conflict.ownerSvg)
      return
    }

    const existingSvg = this._svgForRuleName(name, svg)
    // 同名规则若已绑定其它 svg，禁止悄悄改图标，避免分类混乱
    if (existingSvg && existingSvg !== svg && this.fileTypeIcons.some(r => this._ruleNameOf(r) === name)) {
      this._iconRuleError = this.i18n.t('settings.iconErrorNameSvgMismatch')
        .replace('{name}', name).replace('{svg}', existingSvg)
      return
    }

    const isBuiltinDefault = this.isBuiltinSvg(svg) && this.defaultIconRuleName(svg) === name
    const builtin = isBuiltinDefault ? [...(BUILTIN_ICON_EXTS[svg] || [])] : []
    const existing = this._extsForRuleName(name, svg)
    const merged = [...new Set([
      ...builtin.map(e => e.toLowerCase()),
      ...existing.map(e => e.toLowerCase()),
      ...extList,
    ])]
    const others = this.fileTypeIcons.filter(r => this._ruleNameOf(r) !== name)
    this.fileTypeIcons = [
      ...others,
      ...merged.map(ext => ({ ext, svg, name } as FileTypeIconRule)),
    ]
    this._addingCustomRule = false
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
    this._iconRuleError = ''
    this._saveToConfig()
  }

  /** 删除单元格：内置图标=禁用/恢复；自定义规则=按规则名移除全部条目（需确认） */
  deleteIcon(item: { key: string; svg: string; isBuiltin: boolean }): void {
    if (this.isLockedIcon(item.svg)) return  // default.svg 锁死，不可删/禁用
    if (item.isBuiltin) {
      this.toggleIconDisable(item.svg)
    } else {
      const ok = confirm(this.i18n.t('settings.iconDeleteConfirm', { name: item.key }))
      if (!ok) return
      this.fileTypeIcons = this.fileTypeIcons.filter(r => this._ruleNameOf(r) !== item.key)
      this._saveToConfig()
    }
    // 修复：若正在编辑的正是被删除/禁用的图标，关闭编辑表单，避免删完还残留编辑态
    if (this._editingRuleKey === item.key) {
      this._editingRuleKey = null
      this._editingRuleName = ''
      this._editingIconSvgName = ''
      this._editingIconExts = ''
      this._iconRuleError = ''
    }
  }

  /** 进入文件夹图标编辑态 */
  startEditFolderIcon(): void {
    this._addingCustomRule = false
    this._editingRuleKey = null
    this._folderIconError = ''
    this._editingFolderIcon = true
    this._folderIconDraft = this.folderIconSvg || ''
  }
  /** 确认文件夹图标（校验文件存在） */
  confirmEditFolderIcon(): void {
    const svg = (this._folderIconDraft || '').trim()
    if (!svg) {
      this._folderIconError = this.i18n.t('settings.iconErrorEmpty')
      return
    }
    if (!this.svgExists(svg)) {
      this._folderIconError = this.i18n.t('settings.iconErrorMissingSvg')
      return
    }
    this.folderIconSvg = svg
    this._editingFolderIcon = false
    this._folderIconDraft = ''
    this._folderIconError = ''
    this._saveToConfig()
  }
  /** 取消文件夹图标编辑 */
  cancelEditFolderIcon(): void {
    this._editingFolderIcon = false
    this._folderIconDraft = ''
    this._folderIconError = ''
  }
  /** 恢复默认文件夹图标（'folder.svg'） */
  restoreFolderIcon(): void {
    this.folderIconSvg = FOLDER_ICON_SVG
    this._editingFolderIcon = false
    this._folderIconError = ''
    this._saveToConfig()
  }

  /** ★ 2026-09-17：一键恢复对象图标默认配置（目录/规则/禁用/文件夹图标） */
  resetIconSettings(): void {
    this.iconResourceDir = ''
    this.fileTypeIcons = []
    this.disabledIconSvgs = []
    this.folderIconSvg = FOLDER_ICON_SVG
    this._editingRuleKey = null
    this._editingRuleName = ''
    this._editingIconExts = ''
    this._editingIconSvgName = ''
    this._editingFolderIcon = false
    this._folderIconDraft = ''
    this._folderIconError = ''
    this._addingCustomRule = false
    this._newRuleName = ''
    this._newRuleExt = ''
    this._newRuleSvg = ''
    this._iconRuleError = ''
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 启动时自动清理：仅当图标目录可读且包含 svg 时执行（避免临时不可用的自定义目录导致误删） */
  private _autoCleanInvalidRules(): void {
    const dir = this.effectiveIconBaseDir
    if (!dir) return
    let readable = false
    try { readable = Array.isArray(fs.readdirSync(dir)) && fs.readdirSync(dir).some((f: string) => f.toLowerCase().endsWith('.svg')) } catch { return }
    if (!readable) return
    const before = this.fileTypeIcons.length
    this.fileTypeIcons = this.fileTypeIcons.filter(r => r && r.svg && r.ext && this.svgExists(r.svg))
    if (this.fileTypeIcons.length !== before) this._saveToConfig()
  }
  /** 新增一条自定义图标规则（保留兼容旧入口） */
  addIconRule(): void {
    this.showAddCustomRule()
  }
  /** 删除第 i 条自定义图标规则（保留兼容旧入口） */
  removeIconRule(i: number): void {
    this.fileTypeIcons = this.fileTypeIcons.filter((_, idx) => idx !== i)
    this._saveToConfig()
  }
  /** 拼出规则内 svg 的完整 file:// 路径（供预览显示） */
  /** 插件内置图标目录：开发链接 / 手动安装 / 源码三种布局由 resolveSftpPlusBundledIconDir 统一解析 */
  private get _bundledIconDir(): string {
    return resolveSftpPlusBundledIconDir(this.bootstrapData)
  }

  /** 有效图标目录：用户指定优先；留空则回退插件内置目录 */
  private get effectiveIconBaseDir(): string {
    const u = (this.iconResourceDir || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return u ? u : this._bundledIconDir
  }

  iconPreviewPath(svg: string): string {
    const dir = this.effectiveIconBaseDir
    const file = (svg || '').trim().replace(/^\/+/, '')
    if (!dir || !file) return ''
    return dir + '/' + file
  }

  /** 内置图标预览：始终以内置目录为基，不受用户自定义目录影响 */
  bundledIconPreviewPath(svg: string): string {
    const dir = this._bundledIconDir
    const file = (svg || '').trim().replace(/^\/+/, '')
    if (!dir || !file) return ''
    return dir + '/' + file
  }

  /** 内置图标文件名列表（供预览网格渲染） */
  get builtinIconFiles(): string[] { return BUILTIN_ICON_FILES }

  /** 内置图标 → 关联扩展名列表（供预览展示） */
  get builtinIconExts(): Record<string, string[]> { return BUILTIN_ICON_EXTS }

  /** SVG 资源目录输入框的占位符：默认指向插件内置图标目录 */
  get bundledIconDirPlaceholder(): string {
    return this._bundledIconDir
      ? this._bundledIconDir
      : this.i18n.t('settings.iconResourceDirPh')
  }

  /** ★ 2026-08-24：图标目录输入框显示值。默认（未配置）时直接显示内置图标目录实际路径，
   *  而非占位符；输入等于内置目录或为空都视为「使用默认」，存为空字符串。 */
  get iconDirDisplay(): string {
    const v = (this.iconResourceDir || '').trim()
    if (v) return v
    return this._bundledIconDir || ''
  }
  set iconDirDisplay(v: string) {
    const s = (v || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const bundled = (this._bundledIconDir || '').replace(/\\/g, '/').replace(/\/+$/, '')
    // 输入等于内置目录或为空 → 视为默认（存为空字符串）
    this.iconResourceDir = (!s || s === bundled) ? '' : s
  }

  /** 切换「选中书签后关闭面板」 */
  toggleCloseBookmarkPanelOnSelect(): void {
    this.closeBookmarkPanelOnSelect = !this.closeBookmarkPanelOnSelect
    this._saveToConfig()
    this.notifyPanels()
  }

  toggleBookmarkPanelGroupByScope(): void {
    this.bookmarkPanelGroupByScope = !this.bookmarkPanelGroupByScope
    this._saveToConfig()
    this.notifyPanels()
  }

  bookmarkGroupLabel(g: 'connection' | 'global'): string {
    return g === 'connection'
      ? this.i18n.t('bookmark.forConnection')
      : this.i18n.t('bookmark.global')
  }

  onBookmarkGroupDragStart(g: 'connection' | 'global', event: DragEvent): void {
    this.draggingBookmarkGroup = g
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', g)
    }
  }

  onBookmarkGroupDragOver(_g: 'connection' | 'global', event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  onBookmarkGroupDrop(target: 'connection' | 'global', event: DragEvent): void {
    event.preventDefault()
    const source = this.draggingBookmarkGroup
    this.draggingBookmarkGroup = null
    if (!source || source === target) return
    const next = this.bookmarkPanelGroupOrder.filter(x => x !== source)
    const ti = next.indexOf(target)
    if (ti < 0) next.push(source)
    else next.splice(ti, 0, source)
    if (!next.includes('connection')) next.push('connection')
    if (!next.includes('global')) next.push('global')
    this.bookmarkPanelGroupOrder = next.slice(0, 2) as Array<'connection' | 'global'>
    this._saveToConfig()
    this.notifyPanels()
  }

  onBookmarkGroupDragEnd(): void {
    this.draggingBookmarkGroup = null
  }

  resetBookmarkPanel(): void {
    this.bookmarkPanelGroupByScope = true
    this.bookmarkPanelGroupOrder = ['connection', 'global']
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 保存自定义时间格式（input change/blur 触发，避免逐键通知面板）；清空时自动回落默认格式 */
  saveDateFormat(): void {
    this.dateFormat = (this.dateFormat || '').trim() || DEFAULT_DATE_FORMAT
    setDateFormatPattern(this.dateFormat)
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 并发数范围约束（1-10，非法值回落默认 3） */
  private _clampConcurrency(v: unknown): number {
    const n = Number(v)
    if (!Number.isFinite(n)) return 3
    return Math.min(10, Math.max(1, Math.round(n)))
  }

  /** 保存上传/下载并发数（input change 触发） */
  saveConcurrency(): void {
    this.uploadConcurrency = this._clampConcurrency(this.uploadConcurrency)
    this.downloadConcurrency = this._clampConcurrency(this.downloadConcurrency)
    this._saveToConfig()
    this.notifyPanels()
  }

  /** ★ 2026-09-28：保存传输通道模式（下拉选择即生效） */
  saveChannelMode(): void {
    if (!['smart', 'sftpOnly', 'tarOnly', 'preferSftp', 'preferTar'].includes(this.transferChannelMode)) {
      this.transferChannelMode = 'smart'
    }
    this._saveToConfig()
    this.notifyPanels()
  }

  /** ★ 2026-09-07 issue #15：切换冲突内容摘要（关闭后退化为仅按 size+mtime 判定，行为同旧版） */
  toggleConflictDigest(): void {
    this.conflictDigestEnabled = !this.conflictDigestEnabled
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 切换「内容确认相同时自动跳过」（关闭则仅展示摘要，仍会弹框） */
  toggleConflictAutoSkip(): void {
    this.conflictAutoSkipSameContent = !this.conflictAutoSkipSameContent
    this._saveToConfig()
    this.notifyPanels()
  }

  /**
   * 摘要大小上限取值约束：[1, 4096] MB，非法值回落 256。
   * ★ 2026-09-21 P2 修复：原先只判 > 0，没有上界——输入框的 max="4096" 只是 UI 提示，
   * 手动输入/粘贴/导入配置都能写进极大值，随后每次冲突检测都会对巨型文件求 hash。
   */
  private _clampDigestMaxMB(v: unknown): number {
    const mb = Number(v)
    if (!Number.isFinite(mb) || mb <= 0) return 256
    return Math.min(4096, Math.max(1, Math.floor(mb)))
  }

  /** 保存摘要计算的文件大小上限（MB） */
  saveConflictDigestMaxSize(): void {
    this.conflictDigestMaxSizeMB = this._clampDigestMaxMB(this.conflictDigestMaxSizeMB)
    this._saveToConfig()
    this.notifyPanels()
  }

  /** ★ 2026-08-11：切换隐藏作者信息：关闭直接生效；开启需确认（先打开仓库链接，
   *   用户点「我已点 Star 支持」后才隐藏） */
  toggleHideAuthorInfo(): void {
    if (this.hideAuthorInfo) {
      this.hideAuthorInfo = false
      this._saveToConfig()
      return
    }
    this.openGithub()
    this.showHideAuthorConfirm = true
  }

  confirmHideAuthor(): void {
    this.showHideAuthorConfirm = false
    this.hideAuthorInfo = true
    this._saveToConfig()
  }

  cancelHideAuthor(): void { this.showHideAuthorConfirm = false }

  /** 清空按钮：恢复为默认时间格式并立即保存生效 */
  resetDateFormat(): void {
    this.dateFormat = DEFAULT_DATE_FORMAT
    setDateFormatPattern(this.dateFormat)
    this._saveToConfig()
    this.notifyPanels()
  }

  /** 确认：将自动/预设配色复制到自定义并应用修改 */
  confirmThemeColorOverwrite(): void {
    // 加载原始主题的预设色值
    const orig = this._pendingOrigTheme
    let p: typeof this.colorThemes[0] | undefined
    if (!orig) {
      // Auto 模式：使用检测到的明/暗预设
      const themeName = this.detectedAutoTheme === 'light' ? 'light' : 'dark'
      p = this.getPreset(themeName)
    } else {
      p = this.getPreset(orig)
    }
    if (p) {
      this.themePrimary = p.primary
      this.themeBg = p.bg
      this.themeText = p.text
      this.themeBorder = p.border
    }
    this.theme = 'custom'
    // 应用待修改的颜色值
    const updates: Record<string, string> = { primary: this.themePrimary, bg: this.themeBg, text: this.themeText, border: this.themeBorder }
    updates[this._pendingColorKey] = this._pendingColorVal
    this.themePrimary = updates.primary
    this.themeBg = updates.bg
    this.themeText = updates.text
    this.themeBorder = updates.border
    this.saveAllColors()
    this.applyColors(document.documentElement)
    this.notifyPanels()
    this.showThemeColorConfirm = false
  }

  /** 取消：关闭弹窗，不应用修改 */
  cancelThemeColorOverwrite(): void {
    this.showThemeColorConfirm = false
    this._pendingColorKey = ''
    this._pendingColorVal = ''
    // 恢复颜色输入框显示（强制刷新 ngModel 绑定）
    this._refreshColorInputs()
  }

  /** 刷新颜色输入框，确保取消后恢复到原值 */
  private _refreshColorInputs(): void {
    // 从当前主题预设或缓存重新加载颜色值
    if (!this.theme || this.theme === 'custom') {
      // custom 模式下从 localStorage 加载
      this.themePrimary = load('primaryColor', this.themePrimary)
      this.themeBg = load('bgColor', this.themeBg)
      this.themeText = load('textColor', this.themeText)
      this.themeBorder = load('borderColor', this.themeBorder)
    } else {
      // 预设模式从预设值重新加载
      const p = this.getPreset(this.theme)
      if (p) {
        this.themePrimary = p.primary
        this.themeBg = p.bg
        this.themeText = p.text
        this.themeBorder = p.border
      }
    }
  }

  setLayoutMode(mode: string): void {
    this.layoutMode = mode
    this.saveLayoutMode()
  }

  saveLayoutMode(): void {
    try { localStorage.setItem('sftp-plus-layout-mode', this.layoutMode) } catch {}
    this._saveToConfig()
    this.notifyPanels()
  }

  private _clampFontSize(val: number): number {
    const n = Math.round(Number(val) || 13)
    return Math.max(11, Math.min(18, n))
  }

  onFontSizeChange(val: number): void {
    this.fontSize = this._clampFontSize(val)
    void this._saveToConfig().then(() => this.notifyPanels())
  }

  resetFontSize(): void {
    this.fontSize = 13
    void this._saveToConfig().then(() => this.notifyPanels())
  }

  paneCustomItemLabel(item: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden'): string {
    if (item === 'label') return this.i18n.t('settings.paneLabel')
    if (item === 'path') return this.i18n.t('settings.addressBar')
    if (item === 'hidden') return this.i18n.t('pane.showHidden')
    return this.i18n.t(`settings.toolbarItem.${item}`)
  }

  /** 某项工具栏项是否被隐藏（设置页取消勾选） */
  isPaneItemHidden(item: string): boolean {
    return this.paneHiddenItems.includes(item)
  }

  /** 切换某项工具栏项的显示/隐藏，并持久化 */
  togglePaneItemHidden(item: string): void {
    if (this.paneHiddenItems.includes(item)) {
      this.paneHiddenItems = this.paneHiddenItems.filter(i => i !== item)
    } else {
      this.paneHiddenItems = [...this.paneHiddenItems, item]
    }
    this._saveToConfig()
    this.notifyPanels()
  }

  onCustomDragStart(item: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden', event: DragEvent): void {
    this.draggingCustomItem = item
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', item)
    }
  }

  onCustomDragOver(_target: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden', event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  onCustomDrop(target: 'label' | 'path' | 'back' | 'forward' | 'up' | 'refresh' | 'home' | 'filter' | 'bookmark' | 'hidden', event: DragEvent): void {
    event.preventDefault()
    const source = this.draggingCustomItem || (event.dataTransfer?.getData('text/plain') as any)
    if (!source || source === target) return
    const next = this.paneCustomOrder.filter(i => i !== source)
    const targetIndex = next.indexOf(target)
    if (targetIndex < 0) return
    let insertIndex = targetIndex
    const targetEl = event.currentTarget as HTMLElement | null
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      const placeAfter = event.clientX > (rect.left + rect.width / 2)
      if (placeAfter) insertIndex = targetIndex + 1
    }
    next.splice(insertIndex, 0, source)
    this.paneCustomOrder = next as any
    this._saveToConfig()
    this.notifyPanels()
  }

  onCustomDragEnd(): void { this.draggingCustomItem = null }

  resetPaneLayout(): void {
    this.paneCustomOrder = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
    this.paneHiddenItems = []
    this._saveToConfig()
    this.notifyPanels()
  }

  /** ★ 2026-08-22：保存交互类设置（单击/双击打开 + 右键菜单顺序共用） */
  private async saveInteraction(): Promise<void> {
    await this._saveToConfig()
    this.notifyPanels()
  }

  /** ★ 2026-09-28：右键菜单项 id → 显示标签（文件动作复用注册表 i18n key；分组依据用专有 key） */
  contextMenuItemLabel(a: ContextMenuCustomId): string {
    if (a === 'groupBy') return this.i18n.t('pane.groupBy')
    const def = FILE_MENU_REGISTRY[a]
    return def ? this.i18n.t(def.labelKey) : (a as string)
  }

  /** ★ 2026-09-28：右键菜单项是否启用（复选框） */
  isMenuEnabled(a: ContextMenuCustomId): boolean {
    return !this.contextMenuDisabled.includes(a)
  }

  /** ★ 2026-09-28：切换右键菜单项启用/停用（复选框） */
  toggleMenuEnabled(a: ContextMenuCustomId): void {
    if (this.contextMenuDisabled.includes(a)) {
      this.contextMenuDisabled = this.contextMenuDisabled.filter(x => x !== a)
    } else {
      this.contextMenuDisabled = [...this.contextMenuDisabled, a]
    }
    void this.saveInteraction()
  }

  onMenuDragStart(a: ContextMenuCustomId, event: DragEvent): void {
    this.draggingMenuItem = a
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', a)
    }
  }

  onMenuDragOver(_target: ContextMenuCustomId, event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  onMenuDrop(target: ContextMenuCustomId, event: DragEvent): void {
    event.preventDefault()
    const source = this.draggingMenuItem || (event.dataTransfer?.getData('text/plain') as ContextMenuCustomId)
    if (!source || source === target) return
    const next = this.contextMenuOrder.filter(i => i !== source)
    const targetIndex = next.indexOf(target)
    if (targetIndex < 0) return
    let insertIndex = targetIndex
    const targetEl = event.currentTarget as HTMLElement | null
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      const placeAfter = event.clientX > (rect.left + rect.width / 2)
      if (placeAfter) insertIndex = targetIndex + 1
    }
    next.splice(insertIndex, 0, source)
    this.contextMenuOrder = next
    void this.saveInteraction()
  }

  onMenuDragEnd(): void { this.draggingMenuItem = null }

  resetMenuOrder(): void {
    this.contextMenuOrder = [...DEFAULT_FILE_MENU_ORDER, 'groupBy']
    this.contextMenuDisabled = []
    void this.saveInteraction()
  }

  /** 通知所有面板重新读取设置 */
  private notifyPanels(): void {
    // 通过 DOM 事件通知（面板在 ngOnInit 中监听）
    try {
      window.dispatchEvent(new CustomEvent('sftp-plus-settings-changed'))
    } catch (e) { /* 忽略错误 */ }
  }

  // ========== 数据导出导入 ==========

  private _cloneBackupValue(value: unknown, depth = 0): unknown {
    if (depth > 20 || value == null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => this._cloneBackupValue(item, depth + 1))
    const out: Record<string, unknown> = Object.create(null)
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || key === '__nonStructural') continue
      out[key] = this._cloneBackupValue(item, depth + 1)
    }
    return out
  }

  /** 收集所有 SFTP++ 相关的 localStorage 数据（尝试解析 JSON，避免导出双重编码） */
  /** 收集所有 SFTP++ 设置数据（优先从 config.store） */
  private _base_collectAllData(): Record<string, unknown> {
    const data: Record<string, unknown> = {}

    // 从 config.store 读取
    if (this.configService?.store) {
      try {
        const cfg = this.configService.store['tabby-sftp-plus-plus']
        if (cfg) {
          data.lang = cfg.lang ?? ''
          data.layoutMode = cfg.layoutMode ?? 'auto'
          data.fontSize = cfg.fontSize ?? 13
          data.theme = cfg.theme ?? ''
          data.colorPrimary = cfg.colorPrimary ?? ''
          data.colorBg = cfg.colorBg ?? ''
          data.colorText = cfg.colorText ?? ''
          data.colorBorder = cfg.colorBorder ?? ''
          data.tableColBorders = cfg.tableColBorders ?? true
          data.tableZebra = cfg.tableZebra ?? true
          data.hideNativeSFTPButton = cfg.hideNativeSFTPButton ?? false
          data.defaultPathMode = cfg.defaultPathMode ?? 'off'
          data.defaultShowHidden = cfg.defaultShowHidden ?? false
          data.openInNewTabByDefault = cfg.openInNewTabByDefault ?? false
          data.singleWorkspaceInstance = cfg.singleWorkspaceInstance ?? true
          data.closeBookmarkPanelOnSelect = cfg.closeBookmarkPanelOnSelect ?? false
          data.bookmarkPanelGroupByScope = cfg.bookmarkPanelGroupByScope !== false
          data.bookmarkPanelGroupOrder = cfg.bookmarkPanelGroupOrder ?? ['connection', 'global']
          data.dateFormat = cfg.dateFormat ?? ''
          data.transferUploadConcurrency = cfg.transferUploadConcurrency ?? 3
          data.transferDownloadConcurrency = cfg.transferDownloadConcurrency ?? 3
          data.transferChannelMode = (cfg as any).transferChannelMode ?? 'smart'
          data.conflictDigestEnabled = cfg.conflictDigestEnabled ?? true
          data.conflictAutoSkipSameContent = cfg.conflictAutoSkipSameContent ?? true
          data.conflictDigestMaxSizeMB = cfg.conflictDigestMaxSizeMB ?? 256
          data.conflictDigestAlgo = cfg.conflictDigestAlgo === 'sha256' ? 'sha256' : 'sha1'
          data.defaultUploadPath = cfg.defaultUploadPath ?? ''
          data.defaultDownloadPath = cfg.defaultDownloadPath ?? ''
          data.iconResourceDir = cfg.iconResourceDir ?? ''
          data.fileTypeIcons = cfg.fileTypeIcons ?? []
          data.disabledIconSvgs = cfg.disabledIconSvgs ?? []
          data.folderIconSvg = cfg.folderIconSvg ?? 'folder.svg'
          data.openOnClick = cfg.openOnClick ?? 'double'
          data.openUnsupportedInSystem = cfg.openUnsupportedInSystem ?? true
          data.editableFileExtensions = cfg.editableFileExtensions ?? []
          data.allowViewEditAllFiles = resolveAllowViewEditAllFiles(cfg as Record<string, unknown>)
          data.allowEditAllFiles = data.allowViewEditAllFiles
          data.allowViewAllAsText = data.allowViewEditAllFiles
          data.showTextLineNumbers = cfg.showTextLineNumbers !== false
          data.textCaretShape = normalizeCaretShape(cfg.textCaretShape)
          data.contextMenuOrder = cfg.contextMenuOrder ?? [...DEFAULT_FILE_MENU_ORDER, 'groupBy']
          data.panelHotkeys = cfg.panelHotkeys ?? defaultPanelHotkeys()
          data.hideAuthorInfo = cfg.hideAuthorInfo ?? false
          data.paneCustomOrder = cfg.paneCustomOrder ?? ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark']
          data.paneHiddenItems = cfg.paneHiddenItems ?? []
          // 导出书签、路径记忆（传输日志以 localStorage 为准，见下方）
          if (cfg.bookmarks?.length) data.bookmarks = cfg.bookmarks
          if (cfg.pathMemory && Object.keys(cfg.pathMemory).length) data.pathMemory = cfg.pathMemory
          if (cfg.paneState && typeof cfg.paneState === 'object') {
            data.paneState = this._cloneBackupValue(cfg.paneState)
          }
          // 传输日志权威存储在 localStorage，始终合并
          try {
            const logs = localStorage.getItem('sftp-plus-transfer-logs')
            if (logs) data.transferLogs = JSON.parse(logs)
          } catch {}
          return data
        }
      } catch { /* ignore */ }
    }

    // 回退：从 localStorage 读取
    data.lang = load('lang', '')
    data.layoutMode = load('layoutMode', 'auto')
    data.fontSize = 13
    data.theme = load('theme', '')
    data.colorPrimary = load('primaryColor', '')
    data.colorBg = load('bgColor', '')
    data.colorText = load('textColor', '')
    data.colorBorder = load('borderColor', '')
    data.tableColBorders = loadTableSetting('colBorders', false)
    data.tableZebra = loadTableSetting('zebra', true)
    data.hideNativeSFTPButton = load('hideNativeBtn', false)
    data.defaultPathMode = load('defaultPathMode', 'off')
    data.defaultShowHidden = load('defaultShowHidden', false)
    data.openInNewTabByDefault = load('openInNewTabByDefault', false)
    data.singleWorkspaceInstance = load('singleWorkspaceInstance', true)
    data.closeBookmarkPanelOnSelect = load('closeBookmarkPanelOnSelect', false)
    data.bookmarkPanelGroupByScope = load('bookmarkPanelGroupByScope', true)
    data.bookmarkPanelGroupOrder = load('bookmarkPanelGroupOrder', ['connection', 'global'])
    data.dateFormat = load('dateFormat', '')
    data.transferUploadConcurrency = 3
    data.transferDownloadConcurrency = 3
    data.hideAuthorInfo = false
    data.openOnClick = load('openOnClick', 'double')
    data.openUnsupportedInSystem = load('openUnsupportedInSystem', true)
    data.editableFileExtensions = normalizeEditableExtensions(load<unknown>('editableFileExtensions', []))
    data.allowViewEditAllFiles = loadAllowViewEditAllFiles()
    data.allowEditAllFiles = data.allowViewEditAllFiles
    data.allowViewAllAsText = data.allowViewEditAllFiles
    data.showTextLineNumbers = load('showTextLineNumbers', true)
    data.textCaretShape = normalizeCaretShape(load<unknown>('textCaretShape', 'beam'))
    data.conflictDigestEnabled = load('conflictDigestEnabled', true)
    data.conflictAutoSkipSameContent = load('conflictAutoSkipSameContent', true)
    data.conflictDigestMaxSizeMB = load('conflictDigestMaxSizeMB', 256)
    data.conflictDigestAlgo = load<'sha1' | 'sha256'>('conflictDigestAlgo', 'sha1')
    try { data.contextMenuOrder = JSON.parse(localStorage.getItem('sftp-plus-context-menu-order') || '[]') } catch { data.contextMenuOrder = [] }
    try { data.contextMenuDisabled = JSON.parse(localStorage.getItem('sftp-plus-context-menu-disabled') || '[]') } catch { data.contextMenuDisabled = [] }
    data.panelHotkeys = defaultPanelHotkeys()
    try { data.paneCustomOrder = JSON.parse(localStorage.getItem('sftp-plus-pane-custom-order') || '["label","back","forward","up","refresh","home","path","hidden","filter","bookmark"]') } catch { data.paneCustomOrder = ['label', 'back', 'forward', 'up', 'refresh', 'home', 'path', 'hidden', 'filter', 'bookmark'] }
    try { data.paneHiddenItems = JSON.parse(localStorage.getItem('sftp-plus-pane-hidden-items') || '[]') } catch { data.paneHiddenItems = [] }
    // 尝试从 localStorage 读取书签和传输日志
    try {
      const bkm = localStorage.getItem('sftp-plus-bookmarks-v2')
      if (bkm) data.bookmarks = JSON.parse(bkm)
    } catch {}
    try {
      const logs = localStorage.getItem('sftp-plus-transfer-logs')
      if (logs) data.transferLogs = JSON.parse(logs)
    } catch {}
    return data
  }

  /**
   * 按勾选的类别过滤导出数据（★ 2026-09-29）。
   * 未勾选的类别**完全不写入** JSON —— 导入侧对不存在的字段是「不覆盖」语义，
   * 所以「只导外观」的备份在导入时不会清空书签、路径记忆与传输日志。
   */
  private filterExportData(all: Record<string, unknown>): Record<string, unknown> {
    // ★ 2026-09-29：九类，与设置页分区一一对应；顺序与弹窗展示顺序一致
    const picks: Array<[boolean, string]> = [
      [this.exportPickLang, 'lang'],
      [this.exportPickTheme, 'theme'],
      [this.exportPickLayout, 'layout'],
      [this.exportPickIcons, 'icons'],
      [this.exportPickOther, 'other'],
      [this.exportPickTransfer, 'transfer'],
      [this.exportPickHotkeys, 'hotkeys'],
      [this.exportPickData, 'data'],
      [this.exportPickLogs, 'logs'],
    ]
    const out: Record<string, unknown> = {}
    for (const [enabled, category] of picks) {
      if (!enabled) continue
      for (const field of EXPORT_CATEGORY_FIELDS[category] ?? []) {
        if (field in all) out[field] = all[field]
      }
    }
    return out
  }

  /**
   * 导出数据为 JSON 文件。
   * ★ 2026-09-29：改为**按弹窗里勾选的配置类别**导出（原实现无条件导出全部内容，
   *   用户要「只备份外观/只备份书签」时只能全量导出再手动删键）。
   */
  _base_exportData(): void {
    const all = this.collectAllData()
    const data = this.filterExportData(all)
    if (!Object.keys(data).length) {
      // 兜底：一类都没勾（按钮已 disabled，这里防键盘/脚本绕过）→ 不生成空备份文件
      this.showExportDialog = false
      return
    }
    this.showExportDialog = false
    const json = JSON.stringify({ 'tabby-sftp-plus-plus': data }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    a.download = `sftp-plus_backup_${ts}.json`
    a.click()
    // 延迟释放 Blob URL，确保浏览器有足够时间启动下载
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  /**
   * 从 JSON 文件导入数据并写入 Tabby config
   * 写入保护：使用 per-property update 避免 ConfigProxy 值删除
   */
  _base_importData(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input?.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result as string)
        // 防御原型链污染：只接受普通对象
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error(this.i18n.t('settings.invalidFormat'))
        }
        const json: Record<string, any> = Object.create(null)
        for (const k of Object.keys(raw)) {
          if (k === '__proto__' || k === 'constructor') continue
          json[k] = raw[k]
        }

        // 格式校验：兼容新格式（带标识）和旧格式（扁平结构）
        let data = json['tabby-sftp-plus-plus']
        if (!data || typeof data !== 'object') {
          // 拒绝 QuickCmd+ 数据（新格式标识或旧格式前缀）
          if (json['tabby-quick-command-plus'] || json['commands'] || json['groups'] || Object.keys(json).some(k => k.startsWith('qc-plus-'))) {
            throw new Error(this.i18n.t('settings.invalidFormat'))
          }
          // 旧格式兼容：扁平结构直接使用（含 prefixed localStorage 格式转换）
          if (Object.keys(json).some(k => k.startsWith('sftp-plus-'))) {
            data = this._convertOldPrefixedFormat(json)
          } else {
            data = json
          }
        }

        // 写入 config.store（per-property update 写入保护）
        if (this.configService?.store) {
          const target = this.configService.store['tabby-sftp-plus-plus']
          if (data.lang !== undefined) target.lang = data.lang
          if (data.layoutMode !== undefined) target.layoutMode = data.layoutMode
          if (data.fontSize !== undefined) target.fontSize = this._clampFontSize(Number(data.fontSize))
          if (data.theme !== undefined) target.theme = data.theme
          if (data.colorPrimary !== undefined) target.colorPrimary = data.colorPrimary
          if (data.colorBg !== undefined) target.colorBg = data.colorBg
          if (data.colorText !== undefined) target.colorText = data.colorText
          if (data.colorBorder !== undefined) target.colorBorder = data.colorBorder
          if (data.tableColBorders !== undefined) target.tableColBorders = data.tableColBorders
          if (data.tableZebra !== undefined) target.tableZebra = data.tableZebra
          if (data.hideNativeSFTPButton !== undefined) target.hideNativeSFTPButton = data.hideNativeSFTPButton
          if (data.defaultPathMode !== undefined) target.defaultPathMode = data.defaultPathMode
          if (data.defaultShowHidden !== undefined) target.defaultShowHidden = data.defaultShowHidden
          if (data.openInNewTabByDefault !== undefined) target.openInNewTabByDefault = data.openInNewTabByDefault
          if (data.singleWorkspaceInstance !== undefined) target.singleWorkspaceInstance = data.singleWorkspaceInstance
          if (data.closeBookmarkPanelOnSelect !== undefined) target.closeBookmarkPanelOnSelect = data.closeBookmarkPanelOnSelect
          if (data.bookmarkPanelGroupByScope !== undefined) target.bookmarkPanelGroupByScope = data.bookmarkPanelGroupByScope !== false
          if (Array.isArray(data.bookmarkPanelGroupOrder) && data.bookmarkPanelGroupOrder.length) {
            const valid = (data.bookmarkPanelGroupOrder as string[]).filter(
              (x): x is 'connection' | 'global' => x === 'connection' || x === 'global',
            )
            if (valid.includes('connection') && valid.includes('global')) {
              target.bookmarkPanelGroupOrder = [valid[0], valid.find(x => x !== valid[0])!]
            }
          }
          if (data.dateFormat !== undefined) target.dateFormat = data.dateFormat
          if (data.transferUploadConcurrency !== undefined) target.transferUploadConcurrency = data.transferUploadConcurrency
          if (data.transferDownloadConcurrency !== undefined) target.transferDownloadConcurrency = data.transferDownloadConcurrency
          if ((data as any).transferChannelMode !== undefined) target.transferChannelMode = (data as any).transferChannelMode
          if (data.conflictDigestEnabled !== undefined) target.conflictDigestEnabled = data.conflictDigestEnabled !== false
          if (data.conflictAutoSkipSameContent !== undefined) target.conflictAutoSkipSameContent = data.conflictAutoSkipSameContent !== false
          if (data.conflictDigestMaxSizeMB !== undefined) {
            // ★ 2026-09-21 P2：导入的配置同样要 clamp 上界（外部 JSON 不可信）
            target.conflictDigestMaxSizeMB = this._clampDigestMaxMB(data.conflictDigestMaxSizeMB)
          }
          if (data.conflictDigestAlgo !== undefined) target.conflictDigestAlgo = data.conflictDigestAlgo === 'sha256' ? 'sha256' : 'sha1'
          if (data.defaultUploadPath !== undefined) target.defaultUploadPath = data.defaultUploadPath
          if (data.defaultDownloadPath !== undefined) target.defaultDownloadPath = data.defaultDownloadPath
          if (data.iconResourceDir !== undefined) target.iconResourceDir = data.iconResourceDir
          if (data.fileTypeIcons !== undefined) target.fileTypeIcons = data.fileTypeIcons
          if (data.disabledIconSvgs !== undefined) target.disabledIconSvgs = data.disabledIconSvgs
          if (data.folderIconSvg !== undefined) target.folderIconSvg = data.folderIconSvg || 'folder.svg'
          if (data.hideAuthorInfo !== undefined) target.hideAuthorInfo = data.hideAuthorInfo
          if (data.openOnClick !== undefined) target.openOnClick = data.openOnClick
          if (data.openUnsupportedInSystem !== undefined) target.openUnsupportedInSystem = data.openUnsupportedInSystem
          if (data.editableFileExtensions !== undefined) target.editableFileExtensions = normalizeEditableExtensions(data.editableFileExtensions)
          if (data.allowViewEditAllFiles !== undefined || data.allowEditAllFiles !== undefined || data.allowViewAllAsText !== undefined) {
            const on = data.allowViewEditAllFiles === true || data.allowEditAllFiles === true || data.allowViewAllAsText === true
            target.allowViewEditAllFiles = on
            target.allowEditAllFiles = on
            target.allowViewAllAsText = on
          }
          if (data.showTextLineNumbers !== undefined) target.showTextLineNumbers = data.showTextLineNumbers !== false
          if (data.textCaretShape !== undefined) target.textCaretShape = normalizeCaretShape(data.textCaretShape)
          if (data.contextMenuOrder !== undefined) target.contextMenuOrder = data.contextMenuOrder
          if (data.contextMenuDisabled !== undefined) target.contextMenuDisabled = data.contextMenuDisabled
          // ★ 2026-08-24 修复：与 _saveToConfig 同理，panelHotkeys 为结构成员须逐叶子赋值
          if (data.panelHotkeys !== undefined) {
            const ph = (target as any).panelHotkeys
            if (ph) {
              for (const a of PANEL_HOTKEY_ACTIONS) {
                const src = (data.panelHotkeys as any)[a]
                const dst = ph[a]
                if (src && dst) {
                  // 兼容旧备份的单键格式 key 与新格式 keys
                  const keys = normalizePanelHotkeyKeys((src as any).keys ?? (src as any).key, PANEL_HOTKEY_CLEARED)
                  dst.keys = keys
                  dst.enabled = keys.length > 0 && src.enabled !== false
                  dst.key = PANEL_HOTKEY_CLEARED
                }
              }
            }
          }
          if (data.paneCustomOrder !== undefined) target.paneCustomOrder = data.paneCustomOrder
          if (data.paneHiddenItems !== undefined) target.paneHiddenItems = data.paneHiddenItems
          // 导入路径记忆：导出已含 pathMemory，导入须写回，否则备份无法恢复（# 导出导入不对称缺陷修复）
          if (data.pathMemory !== undefined) target.pathMemory = data.pathMemory
          // 导入书签：沿用正常添加路径的规范化规则，拒绝畸形记录和无效路径。
          if (Array.isArray(data.bookmarks)) {
            const ids = new Set<string>()
            target.bookmarks = data.bookmarks.flatMap((raw: any, index: number) => {
              if (!raw || (raw.type !== 'local' && raw.type !== 'remote')) return []
              const normalizedPath = normalizeBookmarkPath(raw.path, raw.type)
              if (!normalizedPath) return []
              let id = typeof raw.id === 'string' ? raw.id.slice(0, 256) : ''
              if (!id || ids.has(id)) id = `import-${Date.now().toString(36)}-${index.toString(36)}`
              ids.add(id)
              return [{
                id,
                name: String(raw.name ?? path.basename(normalizedPath) ?? normalizedPath).slice(0, 512),
                path: normalizedPath,
                type: raw.type,
                connectionKey: raw.connectionKey == null ? undefined : String(raw.connectionKey).slice(0, 512),
                createdAt: Number(raw.createdAt) || Date.now(),
              }]
            })
          }
          if (data.paneState && typeof data.paneState === 'object' && !Array.isArray(data.paneState)) {
            const incoming = data.paneState as Record<string, unknown>
            const paneState = target.paneState && typeof target.paneState === 'object'
              ? target.paneState
              : (target.paneState = {})
            for (const section of ['layout', 'local', 'remote'] as const) {
              const clean = this._cloneBackupValue(incoming[section])
              if (clean && typeof clean === 'object' && !Array.isArray(clean)) {
                paneState[section] = { ...(paneState[section] ?? {}), ...(clean as Record<string, unknown>) }
              }
            }
          }
          this.configService.save()
          // 传输日志只写 localStorage，但必须经过服务层清洗、条数及 4MB 上限。
          if (data.transferLogs !== undefined) {
            if (!this.transferLogImport.replaceFromImport(data.transferLogs)) {
              log.warn('Import transfer logs ignored: expected an array')
            }
          }
          // 路径记忆导入 localStorage（与 saveCurrentPath 统一路径）
          if (data.paneState?.perHost) {
            const paneState = target.paneState && typeof target.paneState === 'object'
              ? target.paneState
              : (target.paneState = {})
            const perHost = paneState.perHost && typeof paneState.perHost === 'object'
              ? paneState.perHost
              : (paneState.perHost = {})
            for (const [host, entry] of Object.entries(data.paneState.perHost)) {
              // 防御：仅允许合法主机名字符，拒绝注入
              if (!/^[a-zA-Z0-9._:-]+$/.test(host)) continue
              const localRaw = typeof (entry as any).savedLocalPath === 'string' ? (entry as any).savedLocalPath.trim() : ''
              if (localRaw && !/[\0-\x1f]/.test(localRaw)) {
                const localNormalized = path.normalize(localRaw)
                if (path.isAbsolute(localNormalized)) {
                  localStorage.setItem(`sftp-plus-saved-local-path.${host}`, localNormalized)
                  const hostState = perHost[host] && typeof perHost[host] === 'object'
                    ? perHost[host]
                    : (perHost[host] = {})
                  hostState.savedLocalPath = localNormalized
                }
              }
              const remoteRaw = typeof (entry as any).savedRemotePath === 'string' ? (entry as any).savedRemotePath.trim() : ''
              if (remoteRaw.startsWith('/') && !/[\0-\x1f]/.test(remoteRaw)) {
                const remoteNormalized = path.posix.normalize(remoteRaw.replace(/\/+/g, '/'))
                localStorage.setItem(`sftp-plus-saved-remote-path.${host}`, remoteNormalized)
                const hostState = perHost[host] && typeof perHost[host] === 'object'
                  ? perHost[host]
                  : (perHost[host] = {})
                hostState.savedRemotePath = remoteNormalized
              }
              const importedMode = (entry as any).pathMode
              if (importedMode === 'off' || importedMode === 'remember' || importedMode === 'sync') {
                localStorage.setItem(`sftp-plus-path-mode.${host}`, importedMode)
                const hostState = perHost[host] && typeof perHost[host] === 'object'
                  ? perHost[host]
                  : (perHost[host] = {})
                hostState.pathMode = importedMode
              }
            }
            this.configService.save()
          }
          alert(this.i18n.t('settings.importComplete'))
        } else {
          alert(this.i18n.t('settings.importUnavailable'))
        }

        // 刷新当前组件属性
        this._refreshFromConfig()
        this.notifyPanels()
      } catch (e: any) {
        alert(e?.message || this.i18n.t('settings.importFailed'))
      }
    }
    reader.readAsText(file)
    input.value = ''
  }

  /**
   * 导出勾选弹窗（★ 2026-09-29）：按配置类别选择性导出。
   * ★ 2026-09-29 二次调整：九个类别**逐项对齐设置页自己的分区标题**
   *   （语言 / 主题 / 布局 / 对象图标 / 其它 / 传输设置 / 快捷键 / 数据 / 传输记录），
   *   其中「传输记录」从原「书签与记录」拆出独立成项。类别名直接复用设置页标题的 i18n key。
   */
  showExportDialog = false
  exportPickLang = true
  exportPickTheme = true
  exportPickLayout = true
  exportPickIcons = true
  exportPickOther = true
  exportPickTransfer = true
  exportPickHotkeys = true
  exportPickData = true
  exportPickLogs = true

  /** 导出类别总数（新增/删除类别时改这里，exportAllPicked 与探针都据此判定） */
  get exportPickTotal(): number { return 9 }

  /** 当前勾选状态数组（顺序与 filterExportData 的 picks 一致） */
  private _exportPicks(): boolean[] {
    return [
      this.exportPickLang, this.exportPickTheme, this.exportPickLayout, this.exportPickIcons,
      this.exportPickOther, this.exportPickTransfer, this.exportPickHotkeys,
      this.exportPickData, this.exportPickLogs,
    ]
  }

  /** 一次性把九类设为同一值（打开弹窗 / 全选 / 全不选共用） */
  private _setAllExportPicks(v: boolean): void {
    this.exportPickLang = v
    this.exportPickTheme = v
    this.exportPickLayout = v
    this.exportPickIcons = v
    this.exportPickOther = v
    this.exportPickTransfer = v
    this.exportPickHotkeys = v
    this.exportPickData = v
    this.exportPickLogs = v
  }

  /** 已勾选的类别数（0 → 禁用导出按钮，避免导出空备份） */
  get exportPickCount(): number {
    return this._exportPicks().filter(Boolean).length
  }

  /** 是否九类全勾（决定底部小按钮显示「全选」还是「全不选」） */
  get exportAllPicked(): boolean {
    return this.exportPickCount === this.exportPickTotal
  }

  /** 打开导出勾选弹窗；每次回到全选，避免上次的勾选残留导致「以为全导出了其实没有」 */
  openExportDialog(): void {
    this._setAllExportPicks(true)
    this.showExportDialog = true
  }

  closeExportDialog(): void {
    this.showExportDialog = false
  }

  /** 全选 / 全不选一键切换 */
  toggleExportAll(): void {
    this._setAllExportPicks(!this.exportAllPicked)
  }

  showClearConfirm = false
  clearConfirmInput = ''

  openClearConfirm(): void {
    this.clearConfirmInput = ''
    this.showClearConfirm = true
    setTimeout(() => {
      const input = document.querySelector('.ss-edit-modal .ss-edit-input') as HTMLInputElement | null
      if (input) input.focus()
    }, 50)
  }
  closeClearConfirm(): void { this.showClearConfirm = false; this.clearConfirmInput = '' }

  /**
   * 把 ConfigProxy 上的单个键恢复为插件默认值。
   *
   * ⚠ 结构成员（非空对象、非数组、无 __nonStructural 标记）在 ConfigProxy 里**只有 getter**：
   *   直接 `target[k] = 默认对象` 会抛 TypeError（严格模式）→ 被外层 catch 吞掉 → 该键及其后所有键都不落盘。
   *   宿主判定口径见 tabby-core `isStructuralMember()`：
   *   `v instanceof Object && !(v instanceof Array) && Object.keys(v).length > 0 && !v.__nonStructural`。
   *   故结构成员必须**递归到叶子**逐项赋值（本文件 _saveToConfig 与 importData 对 panelHotkeys 用的是同一套写法）。
   *
   * 非结构成员（标量 / 数组 / 空对象 / 带 __nonStructural 的对象）走 setter：
   *   ConfigProxy.__setValue 在「新值 deepEqual 默认值」时直接 `delete real[key]`，
   *   所以赋默认值 = 真正抹掉该键（重启后由 defaults 兜底）——这正是「清空」想要的语义。
   */
  private _resetConfigKey(target: any, key: string, def: unknown): void {
    const isStructural = def instanceof Object && !(def instanceof Array)
      && Object.keys(def as object).length > 0 && !(def as { __nonStructural?: boolean }).__nonStructural
    if (isStructural) {
      const cur = target[key]
      if (!cur || typeof cur !== 'object') throw new Error(`structural member "${key}" unavailable`)
      for (const sub of Object.keys(def as object)) {
        this._resetConfigKey(cur, sub, (def as Record<string, unknown>)[sub])
      }
      return
    }
    target[key] = def
  }

  /**
   * 清空所有 SFTP++ 数据（需输入 DELETE 确认）
   *
   * ★ 2026-09-29 修复「点了清空仍有残留」：原实现是单层 for 循环裸赋值 `target[k] = defaults[k]`，
   *   在第 23 个键 `panelHotkeys`（结构成员，只有 getter）处抛 TypeError → 整个循环中断，
   *   其后的 contextMenuOrder / 传输设置 / 图标 / 冲突摘要 / 书签 / 路径记忆 / 面板状态 / 传输日志
   *   **全部没被清掉**；异常还被最外层 catch 吞掉，连带跳过了 localStorage 清理、界面刷新与提示。
   *   现在：① localStorage 先清；② config 逐键独立 try/catch（单键失败不牵连其余）；
   *   ③ 结构成员走 _resetConfigKey 递归；④ 顺带清 Tabby 级「面板开关快捷键」（不在插件子树内）；
   *   ⑤ 无论 config 侧是否出错，都刷新界面并给用户提示。
   */
  async _base_doClearData(): Promise<void> {
    if (this.clearConfirmInput !== 'DELETE') return
    this.showClearConfirm = false
    this.clearConfirmInput = ''
    const failed: string[] = []

    // ① localStorage：所有 sftp-plus-* 键（书签墓碑、传输日志、列宽/排序、路径记忆、面板几何…）
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('sftp-plus-')) keysToRemove.push(k)
      }
      for (const k of keysToRemove) localStorage.removeItem(k)
    } catch (e) {
      failed.push('localStorage')
      log.error('Clear data: localStorage failed', e)
    }

    // ② config.store 恢复默认值（逐键独立，避免一键失败中断整轮）
    try {
      const target = this.configService?.store?.['tabby-sftp-plus-plus']
      if (target) {
        const defaults = defaultSftpPlusConfig()
        for (const k of Object.keys(defaults)) {
          try {
            this._resetConfigKey(target, k, (defaults as unknown as Record<string, unknown>)[k])
          } catch (e) {
            failed.push(k)
            log.error(`Clear data: reset "${k}" failed`, e)
          }
        }
      }
    } catch (e) {
      failed.push('config')
      log.error('Clear data: config reset failed', e)
    }

    // ③ Tabby 级插件热键（面板开关快捷键）不在这棵插件子树里，须单独清
    try {
      const hk = this.configService?.store?.hotkeys as Record<string, unknown> | undefined
      if (hk && hk[SFTP_PLUS_TOGGLE_HOTKEY]) hk[SFTP_PLUS_TOGGLE_HOTKEY] = []
    } catch (e) {
      failed.push('hotkeys')
      log.error('Clear data: hotkeys failed', e)
    }

    try { await this.configService?.save() } catch (e) { log.error('Clear data: save failed', e) }

    // ④ 设置页状态回默认 + 通知面板重读（无论上面是否出错都要做，否则界面仍显示旧值）
    try { this._refreshFromConfig() } catch (e) { log.error('Clear data: refresh failed', e) }
    this.notifyPanels()

    const msg = this.i18n.t('settings.dataCleared')
    // 兜底诊断：正常路径不会走到这里；真出错时把未清干净的键名一并显示，便于回报问题
    alert(failed.length ? `${msg}\n\n⚠ ${failed.join(', ')}` : msg)
  }

  openGithub(): void {
    const url = 'https://github.com/10D24D/Tabby-SFTP-Plus'
    try {
      ;(window as any).require('electron').shell.openExternal(url)
    } catch {
      try { window.open(url, '_blank') } catch { /* ignore */ }
    }
  }

  /** ★ 2026-08-25：打开 NPM 包页面（关于信息-GitHub 源码右侧新增链接） */
  _base_openNpm(): void {
    const url = 'https://www.npmjs.com/package/tabby-sftp-plus-plus'
    try {
      ;(window as any).require('electron').shell.openExternal(url)
    } catch {
      try { window.open(url, '_blank') } catch { /* ignore */ }
    }
  }

  /**
   * 「报告问题」入口：预填环境信息后打开「缺陷报告」issue 表单（按界面语言路由中/英模板）
   *   机制：GitHub issue forms 的字段 `id` 就是 URL query 参数名（官方文档：id 是 URL query
   *        parameter prefills 的规范标识），配合 ?template=<模板文件> 使用即可自动填好环境信息。
   *   注意：本仓库 config.yml 已关闭 blank_issues_enabled，故不能用 ?body= 空白编辑器方案。
   */
  openBugReport(): void {
    this._openIssue('bug')
  }

  /**
   * 「提出需求」入口：预填环境信息后打开「功能需求」issue 表单（按界面语言路由中/英模板）
   */
  openFeatureRequest(): void {
    this._openIssue('feature')
  }

  /** 统一打开 issue 表单：kind=bug 走缺陷报告模板，kind=feature 走功能需求模板；任一异常都回退为纯新建页 */
  private _openIssue(kind: 'bug' | 'feature'): void {
    const url = this._buildIssueUrl(kind)
    try {
      ;(window as any).require('electron').shell.openExternal(url)
    } catch {
      try { window.open(url, '_blank') } catch { /* ignore */ }
    }
  }

  /**
   * 组装 issue 表单 URL（template + 字段预填）；任何异常都回退为纯新建页，绝不阻塞反馈入口
   *
   * ★ 模板按界面语言路由 —— 中文用 bug_report.yml / feature_request.yml，其余语言用对应 _en 版。
   *   两份语言模板的**字段 id 完全一致**，故这套预填参数在两种语言下通用，不需要分叉。
   *   template 参数放在 try 之外，保证预填失败时用户仍落到正确语言的那份表单。
   */
  private _buildIssueUrl(kind: 'bug' | 'feature'): string {
    const zh = this._isChinese()
    const template = kind === 'bug'
      ? (zh ? 'bug_report.yml' : 'bug_report_en.yml')
      : (zh ? 'feature_request.yml' : 'feature_request_en.yml')
    const base = `https://github.com/10D24D/Tabby-SFTP-Plus/issues/new?template=${template}`
    try {
      const params: string[] = []
      const add = (key: string, value: string): void => {
        if (value) params.push(`${key}=${encodeURIComponent(value)}`)
      }
      add('os_version', this._platformLabel())
      add('tabby_version', this._safeStr(() => this.platformService?.getAppVersion?.(), ''))
      add('sftp_plus_version', this.pkgVersion)
      add('tabby_frontend', this._safeStr(() => this.configService?.store?.terminal?.frontend, ''))
      add('installed_plugins', this._pluginsLabel())
      // base 里已带 ?template=…，预填参数一律用 & 追加
      return params.length ? `${base}&${params.join('&')}` : base
    } catch {
      return base
    }
  }

  /**
   * 界面语言是否为中文 —— 决定意见反馈用哪份 issue 模板
   * 依据 effectiveLang（显式设置优先，Auto 时按系统语言），故中文用户默认拿到中文表单；
   * 取不到时按英文处理（对非中文用户更通用）
   */
  private _isChinese(): boolean {
    try {
      return String(this.effectiveLang || '').toLowerCase().startsWith('zh')
    } catch {
      return false
    }
  }

  /**
   * 平台描述：系统市场版本名 + 精确版本号 + CPU 架构，如 `Windows 11 25H2 (build 26200, x64)`
   *
   * ★ 修复「Windows 版本取不准」：PlatformService.getOSRelease() 底层就是 Node 的 os.release()，
   *   而 Windows 11 沿用 NT 10.0 内核号（本机实测 = `Windows 10.0.26200`），
   *   旧写法把内核号原样透出 → issue 里显示 "Windows 10.0.26200"，用户实机却是 Win11。
   *   现改为按 build 号反查市场版本名：≥22000 判为 Windows 11，并用 WINDOWS_BUILD_RELEASES 定位 21H2/25H2 等代号。
   * 隐私红线：仅取系统版本与 CPU 架构，不采集主机名、用户名、文件路径、服务器地址、书签/Profile 名称等敏感字段
   */
  private _platformLabel(): string {
    const host = this._safeStr(() => this.hostApp?.platform, '')
    const arch = (typeof process !== 'undefined' && (process as any)?.arch) ? String((process as any).arch) : ''
    const raw = this._safeStr(() => this.platformService?.getOSRelease?.(), '')
    // getOSRelease() 形如 `Windows 10.0.26200`，剥掉自带平台名前缀，避免拼出「Windows Windows」
    const ver = raw.replace(/^(Windows|macOS|Linux|Darwin)\s+/i, '').trim()

    const build = this._windowsBuild(ver)
    if (build != null) {
      // Server 与客户端常共用同一 build（如 17763 = Win10 1809 / Server 2019），只能靠产品名区分
      if (/server/i.test(this._osProductName())) {
        return this._platformTail('Windows Server', `build ${build}`, arch)
      }
      const release = this._windowsReleaseName(build)
      const name = `Windows ${build >= 22000 ? 11 : 10}${release ? ` ${release}` : ''}`
      return this._platformTail(name, `build ${build}`, arch)
    }

    // macOS：给的是 Darwin 内核号，按主版本映射回市场版本；主版本 < 18 视为已是市场版本，不干预
    const darwin = /^(\d+)\.(\d+)/.exec(ver)
    if (darwin && Number(darwin[1]) >= 18) {
      const mac = MACOS_BY_DARWIN[Number(darwin[1])]
      return this._platformTail(mac ? `macOS ${mac}` : 'macOS', `Darwin ${ver}`, arch)
    }

    // 其他（Linux 等）：平台名 + 原始内核/系统版本
    return this._platformTail(host || 'unknown', ver || undefined, arch)
  }

  /** 从内核版本号 `10.0.26200` 取 build 号；Windows 自 Vista 起统一为 10.0.<build> 格式 */
  private _windowsBuild(ver: string): number | null {
    const m = /^10\.0\.(\d+)(?:\.|$)/.exec(ver || '')
    return m ? Number(m[1]) : null
  }

  /** build 号 → Windows 市场版本代号（26200 → 25H2）；超出已知表返回空串，不猜 */
  private _windowsReleaseName(build: number): string {
    let name = ''
    for (const [b, n] of WINDOWS_BUILD_RELEASES) {
      if (build >= b) name = n
      else break
    }
    return name
  }

  /**
   * 本机系统产品名（best-effort），Windows 下形如 `Windows 11 Pro` / `Windows Server 2025 Standard`
   * 仅用于区分 Server 版；renderer 无 require('os') 或取不到时返回空串，不影响主流程
   */
  private _osProductName(): string {
    try {
      const req = (typeof window !== 'undefined') ? (window as any).require : null
      return String(req ? req('os')?.version?.() ?? '' : '')
    } catch { return '' }
  }

  /** 拼装 `名称 (细节, 架构)`，空项自动略过；名称缺失时回退 unknown */
  private _platformTail(name: string, detail?: string, arch?: string): string {
    const extras = [detail, arch].filter(x => !!x && x !== 'unknown') as string[]
    return extras.length ? `${name || 'unknown'} (${extras.join(', ')})` : (name || 'unknown')
  }

  /** 已安装的非内置插件列表（name@version），便于作者判断插件组合冲突 */
  private _pluginsLabel(): string {
    try {
      const list = (this.bootstrapData?.installedPlugins || []).filter((p: any) => p && !p.isBuiltin)
      const names = list
        .map((p: any) => (p.version ? `${p.name}@${p.version}` : String(p.name || '')))
        .filter(Boolean)
      return names.join(', ') || 'none'
    } catch { return '' }
  }

  /** 安全读取：服务未注入/取值抛错时返回兜底值，绝不让反馈入口本身崩掉 */
  private _safeStr(fn: () => any, fallback = 'unknown'): string {
    try {
      const v = fn()
      return (v === undefined || v === null || v === '') ? fallback : String(v)
    } catch { return fallback }
  }

  /** 转换旧版 prefixed localStorage 格式到新版扁平字段 */
  private _convertOldPrefixedFormat(old: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {}
    const map: Record<string, string> = {
      'sftp-plus-settings.lang': 'lang',
      'sftp-plus-settings.theme': 'theme',
      'sftp-plus-settings.layoutMode': 'layoutMode',
      'sftp-plus-settings.primaryColor': 'colorPrimary',
      'sftp-plus-settings.bgColor': 'colorBg',
      'sftp-plus-settings.textColor': 'colorText',
      'sftp-plus-settings.paneCustomOrder': 'paneCustomOrder',
      'sftp-plus-settings.surfaceColor': 'colorSurface',
      'sftp-plus-settings.borderColor': 'colorBorder',
      'sftp-plus-settings.customPrimaryColor': 'customPrimaryColor',
      'sftp-plus-settings.customBgColor': 'customBgColor',
      'sftp-plus-settings.customTextColor': 'customTextColor',
      'sftp-plus-settings.customBorderColor': 'customBorderColor',
      'sftp-plus-settings.customMutedColor': 'customMutedColor',
      'sftp-plus-layout-mode': 'layoutMode',
      'sftp-plus-table.colBorders': 'tableColBorders',
      'sftp-plus-table.zebra': 'tableZebra',
    }
    for (const [oldKey, newKey] of Object.entries(map)) {
      if (old[oldKey] !== undefined) out[newKey] = old[oldKey]
    }
    // 书签
    if (old['sftp-plus-bookmarks-v2']) out.bookmarks = old['sftp-plus-bookmarks-v2']
    // 传输日志（兼容两种旧版 key：sftp-plus-transfer-log / sftp-plus-transfer-logs）
    if (old['sftp-plus-transfer-logs']) out.transferLogs = old['sftp-plus-transfer-logs']
    else if (old['sftp-plus-transfer-log']) out.transferLogs = old['sftp-plus-transfer-log']
    return out
  }

  // Controller facade: named source methods, one explicit composition root.
  ngOnInit(...args: any[]): any { return invokeFeature("Settings","ngOnInit",this,args) }
  _commitHotkeyRecording(...args: any[]): any { return invokeFeature("Settings","_commitHotkeyRecording",this,args) }
  _readFromConfig(...args: any[]): any { return invokeFeature("Settings","_readFromConfig",this,args) }
  _saveToConfig(...args: any[]): any { return invokeFeature("Settings","_saveToConfig",this,args) }
  saveDefaultPathMode(...args: any[]): any { return invokeFeature("Settings","saveDefaultPathMode",this,args) }
  collectAllData(...args: any[]): any { return invokeFeature("Settings","collectAllData",this,args) }
  exportData(...args: any[]): any { return invokeFeature("Settings","exportData",this,args) }
  importData(...args: any[]): any { return invokeFeature("Settings","importData",this,args) }
  doClearData(...args: any[]): any { return invokeFeature("Settings","doClearData",this,args) }
  openNpm(...args: any[]): any { return invokeFeature("Settings","openNpm",this,args) }
  get customFolderAutocomplete(): any { return readFeature("Settings","customFolderAutocomplete",this) }
  toggleCustomFolderAutocomplete(...args: any[]): any { return invokeFeature("Settings","toggleCustomFolderAutocomplete",this,args) }
  get customSidebarEnabled(): any { return readFeature("Settings","customSidebarEnabled",this) }
  toggleCustomSidebar(...args: any[]): any { return invokeFeature("Settings","toggleCustomSidebar",this,args) }
  get customSidebarSide(): any { return readFeature("Settings","customSidebarSide",this) }
  setCustomSidebarSide(...args: any[]): any { return invokeFeature("Settings","setCustomSidebarSide",this,args) }
  _customCleanConfig(...args: any[]): any { return invokeFeature("Settings","_customCleanConfig",this,args) }
  get customPanelToggleBindings(): any { return readFeature("Settings","customPanelToggleBindings",this) }
  customToggleBindingLabel(...args: any[]): any { return invokeFeature("Settings","customToggleBindingLabel",this,args) }
  customStartToggleRecording(...args: any[]): any { return invokeFeature("Settings","customStartToggleRecording",this,args) }
  _customMergeToggleBinding(...args: any[]): any { return invokeFeature("Settings","_customMergeToggleBinding",this,args) }
  customRemoveToggleBinding(...args: any[]): any { return invokeFeature("Settings","customRemoveToggleBinding",this,args) }
  get customRecentFolderLimit(): any { return readFeature("Settings","customRecentFolderLimit",this) }
  setCustomRecentFolderLimit(...args: any[]): any { return invokeFeature("Settings","setCustomRecentFolderLimit",this,args) }
  get customRecentFolderDwellSeconds(): any { return readFeature("Settings","customRecentFolderDwellSeconds",this) }
  setCustomRecentFolderDwellSeconds(...args: any[]): any { return invokeFeature("Settings","setCustomRecentFolderDwellSeconds",this,args) }
  _customNormalizeOpenMenu(...args: any[]): any { return invokeFeature("Settings","_customNormalizeOpenMenu",this,args) }
}

@Injectable()
export class SftpSettingsTabProvider extends SettingsTabProvider {
  id = SFTP_PLUS_SETTINGS_TAB_ID
  icon = 'folder-open'
  title = 'SFTP++'

  getComponentType(): any {
    return SftpSettingsTabComponent
  }

  async getSettingsTabs(): Promise<Array<{
    title: string
    icon?: string
    weight?: number
    component: any
  }>> {
    return [
      {
        title: 'SFTP++',
        icon: 'folder-open',
        weight: 99,
        component: SftpSettingsTabComponent,
      },
    ]
  }
}

export interface SftpSettingsTabComponent { [key: string]: any }
