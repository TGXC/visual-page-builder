/**
 * 规则式设计检查（M6 / 功能文档 AI3）。
 *
 * 三条铁律里最重要的一条是「离线可用」：不配任何 API key，这个模块也能查出
 * 溢出 / 对比度 / 间距 / 尺寸一致 / 替代文字 / 断点未覆盖六类问题，
 * 并且每条问题都自带一段可直接 `commit()` 的补丁 —— 一键修复不经过 AI。
 *
 * 模块保持纯逻辑（不引 Vue、不碰 DOM）：`computeLayout` 在拿不到字体度量时会退回
 * 字符估算，所以检查结果在 Node 与浏览器里一致，测试也稳定。
 */
import type { Box, Doc, NodeId, Page, PageId, Patch, SceneNode, SizeSpec, Theme } from '../schema/types'
import { applyPatches } from '../patch'
import { computeLayout } from '../layout'
import { childrenOf } from '../tree'
import { baseBreakpointId, breakpointViewport, orderedBreakpoints } from '../responsive'

export type IssueKind =
  | 'overflow'
  | 'contrast'
  | 'spacing'
  | 'size-inconsistent'
  | 'missing-alt'
  | 'missing-label'
  | 'breakpoint-uncovered'

export interface Issue {
  /** 稳定 id：`<kind>:<nodeId>`，UI 用它做 key，也用来定位「修哪一条」 */
  id: string
  kind: IssueKind
  severity: 'error' | 'warn' | 'info'
  pageId: PageId
  nodeId: NodeId
  /** 中文可读描述（面板直接显示） */
  message: string
  /** 一键修复按钮文案 */
  fixLabel: string
  /** 修复补丁；空数组表示这条只能人工处理 */
  patches: Patch[]
}

/** 设计间距阶梯（与主题 token 的 space-sm / space-md / space-lg 对齐） */
export const SPACING_SCALE: readonly number[] = [0, 4, 8, 12, 16, 24, 32, 48, 64]

/** 参与对比度 / 尺寸检查的文本类组件 */
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'heading', 'label', 'button', 'link', 'badge', 'alert'])
/** 需要替代文字的媒体类组件 */
const MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'video', 'avatar'])
/** 需要有可读标签的表单类组件（E8 可访问性） */
const FORM_TYPES: ReadonlySet<string> = new Set([
  'input',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'date',
  'number',
  'file',
])

const AA_NORMAL = 4.5
const AA_LARGE = 3
const SIZE_EPSILON = 0.5
const PAGE_BG_FALLBACK = '#FFFFFF'

export function findPage(doc: Doc, pageKey?: string): Page | null {
  if (!pageKey) return doc.pages.find((page) => page.id === doc.activePageId) ?? doc.pages[0] ?? null
  return (
    doc.pages.find((page) => page.id === pageKey) ??
    doc.pages.find((page) => page.root === pageKey) ??
    doc.pages.find((page) => page.id === doc.activePageId) ??
    doc.pages[0] ??
    null
  )
}

/* ── 颜色与对比度 ───────────────────────────────────────────────────── */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 支持 `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()`；其它格式返回 null（当作「没设置」） */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase()
  if (value === '') return null
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      }
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      }
    }
    return null
  }
  const match = /^rgba?\(([^)]+)\)$/.exec(value)
  if (!match) return null
  const parts = match[1].split(/[,\s/]+/).filter((part) => part !== '')
  if (parts.length < 3) return null
  const channel = (part: string): number => {
    const number = Number.parseFloat(part)
    if (!Number.isFinite(number)) return 0
    return Math.max(0, Math.min(255, Math.round(part.endsWith('%') ? (number / 100) * 255 : number)))
  }
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]) }
}

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 相对亮度 */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
}

/** WCAG 对比度（1 ~ 21）；任一颜色解析不了时返回 21（当作不算问题，避免误报） */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground)
  const bg = parseColor(background)
  if (!fg || !bg) return 21
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const light = Math.max(l1, l2)
  const dark = Math.min(l1, l2)
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
}

/** 黑白二选一里对比度更高的那个文字色：数学上必然 ≥ 4.5，能满足 AA */
export function readableTextColor(background: string): string {
  return contrastRatio('#FFFFFF', background) >= contrastRatio('#000000', background) ? '#FFFFFF' : '#000000'
}

function backgroundOf(nodes: Record<NodeId, SceneNode>, node: SceneNode): string {
  let current: SceneNode | undefined = node
  const seen = new Set<NodeId>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.style.bg !== '') return current.style.bg
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return PAGE_BG_FALLBACK
}

function textOf(node: SceneNode): string {
  const value = node.props.text
  return typeof value === 'string' ? value : ''
}

function isLargeText(node: SceneNode): boolean {
  return node.style.fontSize >= 24 || (node.style.fontWeight >= 700 && node.style.fontSize >= 18.66)
}

/* ── 六类检查 ───────────────────────────────────────────────────────── */

function updatePatch(page: Page, node: SceneNode, after: PatchAfter): Patch {
  return {
    op: 'update',
    pageId: page.id,
    id: node.id,
    before: pick(node, after),
    after,
  }
}

type PatchAfter = {
  layout?: SceneNode['layout']
  style?: SceneNode['style']
  props?: Record<string, unknown>
  overrides?: SceneNode['overrides']
  meta?: SceneNode['meta']
}

function pick(node: SceneNode, keys: PatchAfter): PatchAfter {
  const before: PatchAfter = {}
  if (keys.layout) before.layout = node.layout
  if (keys.style) before.style = node.style
  if (keys.props) before.props = node.props
  if (keys.overrides) before.overrides = node.overrides
  if (keys.meta) before.meta = node.meta
  return before
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 溢出：节点盒超出父容器内容区（`computeLayout` 已经算好，这里只补修复方案） */
function overflowIssues(page: Page, boxes: Record<NodeId, Box>, overflow: NodeId[]): Issue[] {
  return overflow
    .map((id) => {
      const node = page.nodes[id]
      if (!node) return null
      const parent = node.parentId ? page.nodes[node.parentId] : undefined
      const box = boxes[id]
      const issue: Issue = {
        id: `overflow:${id}`,
        kind: 'overflow',
        severity: 'error',
        pageId: page.id,
        nodeId: id,
        message: `「${node.meta.name || node.type}」超出父容器边界`,
        fixLabel: '夹回容器内',
        patches: [],
      }
      if (!parent || !box || parent.layout.mode !== 'free') return issue
      const parentBox = boxes[parent.id]
      if (!parentBox) return issue
      const padding = parent.layout.padding
      const contentW = Math.max(0, parentBox.w - padding.left - padding.right)
      const contentH = Math.max(0, parentBox.h - padding.top - padding.bottom)
      const nextW = box.w > contentW + SIZE_EPSILON ? contentW : box.w
      const nextH = box.h > contentH + SIZE_EPSILON ? contentH : box.h
      const sizeW: SizeSpec = box.w > contentW + SIZE_EPSILON ? { kind: 'fixed', value: contentW } : node.layout.size.w
      const sizeH: SizeSpec = box.h > contentH + SIZE_EPSILON ? { kind: 'fixed', value: contentH } : node.layout.size.h
      const layout = {
        ...node.layout,
        position: {
          x: clamp(node.layout.position.x, 0, Math.max(0, contentW - nextW)),
          y: clamp(node.layout.position.y, 0, Math.max(0, contentH - nextH)),
        },
        size: { w: sizeW, h: sizeH },
      }
      issue.patches = [
        {
          op: 'update',
          pageId: page.id,
          id,
          before: { layout: node.layout },
          after: { layout },
        },
      ]
      return issue
    })
    .filter((issue): issue is Issue => issue !== null)
}

/** 对比度：文本类节点显式设了 color 时按 WCAG AA 检查 */
function contrastIssues(page: Page): Issue[] {
  const issues: Issue[] = []
  for (const node of Object.values(page.nodes)) {
    if (!TEXT_TYPES.has(node.type)) continue
    if (textOf(node) === '' || node.style.color === '') continue
    const background = backgroundOf(page.nodes, node)
    const ratio = contrastRatio(node.style.color, background)
    const required = isLargeText(node) ? AA_LARGE : AA_NORMAL
    if (ratio >= required) continue
    const fixed = readableTextColor(background)
    issues.push({
      id: `contrast:${node.id}`,
      kind: 'contrast',
      severity: 'error',
      pageId: page.id,
      nodeId: node.id,
      message: `「${textOf(node)}」的文字对比度 ${ratio}:1，低于 AA 要求的 ${required}:1（底色 ${background}）`,
      fixLabel: `改成 ${fixed}（≥4.5:1）`,
      patches: [
        updatePatch(page, node, { style: { ...node.style, color: fixed } }),
      ],
    })
  }
  return issues
}

function snapped(value: number): number {
  let best = SPACING_SCALE[0]
  for (const step of SPACING_SCALE) {
    if (Math.abs(step - value) < Math.abs(best - value)) best = step
  }
  return best
}

/** 间距：gap / padding 落在设计阶梯之外 */
function spacingIssues(page: Page): Issue[] {
  const issues: Issue[] = []
  for (const node of Object.values(page.nodes)) {
    const kids = childrenOf(page.nodes, node.id)
    if (kids.length === 0) continue
    const offenders: { label: string; value: number }[] = []
    const padding = node.layout.padding
    const fields: [keyof typeof padding, number][] = [
      ['top', padding.top],
      ['right', padding.right],
      ['bottom', padding.bottom],
      ['left', padding.left],
    ]
    if (node.layout.mode !== 'free' && kids.length >= 2 && !SPACING_SCALE.includes(node.layout.gap)) {
      offenders.push({ label: 'gap', value: node.layout.gap })
    }
    for (const [key, value] of fields) {
      if (!SPACING_SCALE.includes(value)) offenders.push({ label: `padding-${key}`, value })
    }
    if (offenders.length === 0) continue
    const nextPadding = { ...padding }
    for (const [key, value] of fields) nextPadding[key] = snapped(value)
    const nextGap = offenders.some((item) => item.label === 'gap') ? snapped(node.layout.gap) : node.layout.gap
    issues.push({
      id: `spacing:${node.id}`,
      kind: 'spacing',
      severity: 'warn',
      pageId: page.id,
      nodeId: node.id,
      message: `「${node.meta.name || node.type}」的间距 ${offenders.map((item) => `${item.label}=${item.value}`).join(' / ')} 不在设计阶梯 ${SPACING_SCALE.join('/')} 上`,
      fixLabel: '吸附到最近的阶梯值',
      patches: [
        updatePatch(page, node, {
          layout: { ...node.layout, gap: nextGap, padding: nextPadding },
        }),
      ],
    })
  }
  return issues
}

/** 尺寸一致：同一个父容器下 ≥3 个同类型节点里，固定尺寸出现分歧时对齐众数 */
function sizeIssues(page: Page): Issue[] {
  const issues: Issue[] = []
  const parents = new Set<NodeId>(Object.values(page.nodes).map((node) => node.parentId ?? page.root))
  for (const parentId of parents) {
    const kids = childrenOf(page.nodes, parentId)
    const byType = new Map<string, SceneNode[]>()
    for (const kid of kids) {
      if (kid.layout.size.w.kind !== 'fixed' || kid.layout.size.h.kind !== 'fixed') continue
      const list = byType.get(kid.type) ?? []
      list.push(kid)
      byType.set(kid.type, list)
    }
    for (const [type, group] of byType) {
      if (group.length < 3) continue
      const counts = new Map<string, { w: number; h: number; count: number }>()
      for (const node of group) {
        const w = node.layout.size.w.value ?? 0
        const h = node.layout.size.h.value ?? 0
        const key = `${w}x${h}`
        const entry = counts.get(key)
        if (entry) entry.count += 1
        else counts.set(key, { w, h, count: 1 })
      }
      if (counts.size < 2) continue
      const ranked = [...counts.values()].sort((a, b) => b.count - a.count || a.w * a.h - b.w * b.h)
      const majority = ranked[0]
      const deviants = group.filter(
        (node) => (node.layout.size.w.value ?? 0) !== majority.w || (node.layout.size.h.value ?? 0) !== majority.h,
      )
      if (deviants.length === 0) continue
      issues.push({
        id: `size-inconsistent:${parentId}`,
        kind: 'size-inconsistent',
        severity: 'warn',
        pageId: page.id,
        nodeId: parentId,
        message: `同层的 ${group.length} 个「${type}」尺寸不一致，多数是 ${majority.w}×${majority.h}，${deviants.length} 个不同`,
        fixLabel: `统一成 ${majority.w}×${majority.h}`,
        patches: deviants.map((node) =>
          updatePatch(page, node, {
            layout: {
              ...node.layout,
              size: { w: { kind: 'fixed', value: majority.w }, h: { kind: 'fixed', value: majority.h } },
            },
          }),
        ),
      })
    }
  }
  return issues
}

/** 替代文字：图片 / 视频 / 头像既没有 alt 也没有文案 */
function altIssues(page: Page): Issue[] {
  const issues: Issue[] = []
  for (const node of Object.values(page.nodes)) {
    if (!MEDIA_TYPES.has(node.type)) continue
    const alt = typeof node.props.alt === 'string' ? node.props.alt : ''
    if (alt !== '' || textOf(node) !== '') continue
    const fallback = typeof node.meta.name === 'string' && node.meta.name !== '' ? node.meta.name : '图片说明'
    issues.push({
      id: `missing-alt:${node.id}`,
      kind: 'missing-alt',
      severity: 'warn',
      pageId: page.id,
      nodeId: node.id,
      message: `「${node.meta.name || node.type}」缺少替代文字（alt 与文案都为空）`,
      fixLabel: `补上「${fallback}」`,
      patches: [
        updatePatch(page, node, { props: { ...node.props, alt: fallback, text: fallback } }),
      ],
    })
  }
  return issues
}

/** 表单控件没有可读标签（M8 / 功能文档 E8「label 关联」）：没有 label 也没有可见文案 */
function labelIssues(page: Page): Issue[] {
  const issues: Issue[] = []
  for (const node of Object.values(page.nodes)) {
    if (!FORM_TYPES.has(node.type)) continue
    const label = typeof node.props.label === 'string' ? node.props.label : ''
    if (label !== '' || textOf(node) !== '') continue
    const fallback =
      typeof node.meta.name === 'string' && node.meta.name !== '' ? node.meta.name : `${node.type} 标签`
    issues.push({
      id: `missing-label:${node.id}`,
      kind: 'missing-label',
      severity: 'warn',
      pageId: page.id,
      nodeId: node.id,
      message: `「${node.meta.name || node.type}」缺少可读标签（label 与文案都为空）`,
      fixLabel: `补上标签「${fallback}」`,
      patches: [updatePatch(page, node, { props: { ...node.props, label: fallback } })],
    })
  }
  return issues
}

/** 断点未覆盖：启用的窄断点下整页一条覆盖都没有（导出会照搬桌面布局） */function breakpointIssues(doc: Doc, page: Page): Issue[] {
  const base = baseBreakpointId(doc.breakpoints)
  if (!base) return []
  const issues: Issue[] = []
  for (const breakpoint of orderedBreakpoints(doc.breakpoints)) {
    if (breakpoint.id === base) continue
    const covered = Object.values(page.nodes).some(
      (node) => node.overrides[breakpoint.id] !== undefined && Object.keys(node.overrides[breakpoint.id]).length > 0,
    )
    if (covered) continue
    const target = childrenOf(page.nodes, page.root)[0] ?? page.nodes[page.root]
    if (!target) continue
    const viewport = breakpointViewport(breakpoint)
    const existing = target.overrides[breakpoint.id] ?? {}
    // 覆盖里的 size 一旦出现就必须是完整尺寸，所以宽度撑满、高度沿用该断点已有值或节点本身的值
    const size = {
      w: { kind: 'fill' as const },
      h: existing.layout?.size?.h ?? target.layout.size.h,
    }
    const overrides = {
      ...target.overrides,
      [breakpoint.id]: {
        ...existing,
        layout: {
          ...(existing.layout ?? {}),
          size,
        },
      },
    }
    issues.push({
      id: `breakpoint-uncovered:${breakpoint.id}`,
      kind: 'breakpoint-uncovered',
      severity: 'info',
      pageId: page.id,
      nodeId: target.id,
      message: `断点「${breakpoint.label}（${viewport.w}px）」下整页没有任何覆盖，导出会照搬桌面布局`,
      fixLabel: `让「${target.meta.name || target.type}」在 ${breakpoint.label} 下撑满宽度`,
      patches: [updatePatch(page, target, { overrides })],
    })
  }
  return issues
}

/* ── 对外 API ───────────────────────────────────────────────────────── */

export interface AuditResult {
  issues: Issue[]
  /** 与问题一一对应的几何（画布提示用得上） */
  boxes: Record<NodeId, Box>
}

export function audit(doc: Doc, pageKey?: string): AuditResult {
  const page = findPage(doc, pageKey)
  if (!page) return { issues: [], boxes: {} }
  const layout = computeLayout({ nodes: page.nodes, rootId: page.root, viewport: page.viewport })
  const issues = [
    ...overflowIssues(page, layout.boxes, layout.overflow),
    ...contrastIssues(page),
    ...spacingIssues(page),
    ...sizeIssues(page),
    ...altIssues(page),
    ...labelIssues(page),
    ...breakpointIssues(doc, page),
  ]
  return { issues, boxes: layout.boxes }
}

export function auditDoc(doc: Doc, pageKey?: string): Issue[] {
  return audit(doc, pageKey).issues
}

/**
 * 一键修复全部：反复「查 → 修」直到没有可修的问题。
 * 必须迭代而不是把一次审计的补丁摊平 —— 同一条规则可能一次报多条（比如两个断点都未覆盖），
 * 它们的补丁都基于同一个 before，直接摊平会互相覆盖。
 */
export function fixAll(doc: Doc, pageKey?: string): Patch[] {
  const all: Patch[] = []
  let working = doc
  for (let round = 0; round < 8; round += 1) {
    const fixable = auditDoc(working, pageKey).filter((issue) => issue.patches.length > 0)
    if (fixable.length === 0) break
    const round1 = fixable.flatMap((issue) => issue.patches)
    const next = applyPatches(working, round1)
    if (JSON.stringify(next) === JSON.stringify(working)) break
    all.push(...round1)
    working = next
  }
  return all
}

/** 按 issue.id 找修复补丁 */
export function fixOf(doc: Doc, issueId: string, pageKey?: string): Patch[] {
  return auditDoc(doc, pageKey).find((issue) => issue.id === issueId)?.patches ?? []
}

/** 主题里的间距 token（面板显示设计阶梯时用） */
export function themeSpacingSteps(theme: Theme): number[] {
  return Object.entries(theme.tokens)
    .filter(([key]) => key.startsWith('space-'))
    .map(([, value]) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
}
