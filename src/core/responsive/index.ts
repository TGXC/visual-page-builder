/**
 * 响应式断点：断点顺序、overrides 继承合并、有效节点求解。
 *
 * 纯逻辑，不依赖 Vue / DOM / store（见 `docs/decisions.md` D7）。
 * 级联方向：从最宽的启用断点开始，一路合并到目标断点（更窄的覆盖更宽的），
 * 因此导出成 CSS 时刚好对应 min-width 媒体查询的层叠顺序。
 */
import type {
  Breakpoint,
  BreakpointId,
  ConstraintH,
  ConstraintV,
  Constraints,
  Doc,
  Insets,
  LayoutSpec,
  NodeId,
  NodeOverride,
  Page,
  SceneNode,
  SizeSpec,
  StyleSpec,
} from '../schema/types'
import { MAX_VIEWPORT, MIN_VIEWPORT } from '../schema/normalize'
import { computeLayout, type TextMeasure } from '../layout'

/** 预设断点的画布尺寸（未在表里的自定义断点按 minWidth 兜底） */
export const BREAKPOINT_VIEWPORTS: Record<BreakpointId, { w: number; h: number }> = {
  desktop: { w: 1440, h: 900 },
  tablet: { w: 768, h: 1024 },
  mobile: { w: 375, h: 812 },
}

/** 一次编辑里允许改的字段（store 的 NodeEdit 会映射成它） */
export interface ResponsiveEdit {
  layout?: Partial<LayoutSpec>
  style?: Partial<StyleSpec>
  props?: Record<string, unknown>
  order?: number
  hidden?: boolean
}

export interface OverrideFlags {
  layout: boolean
  style: boolean
  props: boolean
  hidden: boolean
  order: boolean
  empty: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 启用中的断点，按 minWidth 从宽到窄（同宽按声明顺序） */
export function orderedBreakpoints(breakpoints: readonly Breakpoint[]): Breakpoint[] {
  return breakpoints
    .filter((breakpoint) => breakpoint.enabled)
    .map((breakpoint, index) => ({ breakpoint, index }))
    .sort((a, b) => b.breakpoint.minWidth - a.breakpoint.minWidth || a.index - b.index)
    .map((entry) => ({ ...entry.breakpoint }))
}

/** 基准（最宽）断点，全禁用时 null */
export function baseBreakpointId(breakpoints: readonly Breakpoint[]): BreakpointId | null {
  return orderedBreakpoints(breakpoints)[0]?.id ?? null
}

/** 「从基准断点继承到目标断点」的断点链（含两端）；目标未知/未启用时为空 */
export function cascadeIds(breakpoints: readonly Breakpoint[], targetId: BreakpointId): BreakpointId[] {
  const ordered = orderedBreakpoints(breakpoints)
  const index = ordered.findIndex((breakpoint) => breakpoint.id === targetId)
  if (index < 0) return []
  return ordered.slice(0, index + 1).map((breakpoint) => breakpoint.id)
}

/** 断点的预览画布尺寸：预设优先，自定义按 minWidth 兜底 */
export function breakpointViewport(breakpoint: Breakpoint): { w: number; h: number } {
  const preset = BREAKPOINT_VIEWPORTS[breakpoint.id]
  if (preset) return { ...preset }
  if (breakpoint.minWidth <= 0) return { ...BREAKPOINT_VIEWPORTS.mobile }
  return {
    w: clamp(Math.round(breakpoint.minWidth), MIN_VIEWPORT, MAX_VIEWPORT),
    h: BREAKPOINT_VIEWPORTS.desktop.h,
  }
}

/** 与布局盒同形；这里只用到四个数，避免 core/responsive 反向依赖 core/layout 的值 */
export interface BoxLike {
  x: number
  y: number
  w: number
  h: number
}

/** 贴边/居中的判定容差（px）：差值在这个范围内就认为「作者是故意贴边/居中的」 */
const ANCHOR_EPSILON = 2
/** 宽度/高度超过内容区的这个比例，就认为它是「整宽/整高块」，换算时两端拉伸 */
const SPAN_RATIO = 0.85

function inferConstraintH(box: BoxLike, content: BoxLike): ConstraintH {
  if (content.w <= 0) return 'left'
  const span = box.w / content.w
  const leftGap = box.x - content.x
  const rightGap = content.x + content.w - (box.x + box.w)
  const centerGap = Math.abs(box.x + box.w / 2 - (content.x + content.w / 2))
  if (span >= SPAN_RATIO) return 'left-right'
  if (Math.abs(leftGap) <= ANCHOR_EPSILON && Math.abs(rightGap) <= ANCHOR_EPSILON) return 'left-right'
  if (Math.abs(rightGap) <= ANCHOR_EPSILON) return 'right'
  if (centerGap <= ANCHOR_EPSILON) return 'center'
  return 'left'
}

function inferConstraintV(box: BoxLike, content: BoxLike): ConstraintV {
  if (content.h <= 0) return 'top'
  const span = box.h / content.h
  const bottomGap = content.y + content.h - (box.y + box.h)
  const centerGap = Math.abs(box.y + box.h / 2 - (content.y + content.h / 2))
  if (span >= SPAN_RATIO) return 'top-bottom'
  if (Math.abs(bottomGap) <= ANCHOR_EPSILON) return 'bottom'
  if (centerGap <= ANCHOR_EPSILON) return 'center'
  return 'top'
}

/**
 * 由几何推断锚定（M23）：作者在基准宽度下把元素摆在哪儿，就按那儿决定它怎么跟着容器变。
 *
 * 规则刻意**不推断 `scale`**：等比缩放会让窄断点里的小组件（按钮、标签）缩成邮票大小，
 * 而且在窄断点上拖它时，位移与尺寸都要乘缩放系数，手感会「跟不上鼠标」。需要缩放时
 * 由属性面板手动选（`scale` 仍在数据模型与布局引擎里保留）。
 */
export function inferConstraints(box: BoxLike, content: BoxLike): Constraints {
  return { h: inferConstraintH(box, content), v: inferConstraintV(box, content) }
}

/**
 * 给整页（或某个容器子树）推断锚定：在**基准断点**跑一次布局，按每个节点相对父内容框的
 * 位置套 `inferConstraints`。返回的只是建议值，写回文档由 store 决定（M23）。
 */
export function inferPageConstraints(
  nodes: Record<NodeId, SceneNode>,
  rootId: NodeId,
  viewport: { w: number; h: number },
  measure?: TextMeasure,
): Record<NodeId, Constraints> {
  const boxes = computeLayout({ nodes, rootId, viewport, reference: viewport, measure }).boxes
  const out: Record<NodeId, Constraints> = {}
  for (const node of Object.values(nodes)) {
    if (node.id === rootId) continue
    const box = boxes[node.id]
    const parent = node.parentId ? nodes[node.parentId] : undefined
    const parentBox = node.parentId ? boxes[node.parentId] : undefined
    if (!box || !parent || !parentBox) continue
    const padding = parent.layout.padding
    const content: BoxLike = {
      x: parentBox.x + padding.left,
      y: parentBox.y + padding.top,
      w: Math.max(0, parentBox.w - padding.left - padding.right),
      h: Math.max(0, parentBox.h - padding.top - padding.bottom),
    }
    out[node.id] = inferConstraints(box, content)
  }
  return out
}

/**
 * 布局用的有效节点：在 `effectiveNodes` 基础上加上「手动优先」（M23）。
 *
 * 只要级联链上某个断点手动改过 position / size，这个节点在该断点就不该再被 constraints
 * 换算（否则用户挪一下就被换算推走）。做法是把锚定钉成 `left/top`——`applyConstraints`
 * 对 left/top 是恒等变换。基准断点没有覆盖，返回原有效节点。
 */
export function nodesForLayout(
  nodes: Record<NodeId, SceneNode>,
  breakpoints: readonly Breakpoint[],
  targetId: BreakpointId,
): Record<NodeId, SceneNode> {
  const ids = cascadeIds(breakpoints, targetId)
  const out = effectiveNodes(nodes, breakpoints, targetId)
  if (ids.length <= 1) return out
  for (const node of Object.values(nodes)) {
    const manual = ids.some((id) => {
      const layout = node.overrides[id]?.layout
      return Boolean(layout && (layout.position || layout.size))
    })
    if (!manual) continue
    // 用户在面板里显式选过锚定（override 里带 constraints）时，手动锚定优先于「拖过就钉住」
    const anchored = ids.some((id) => node.overrides[id]?.layout?.constraints !== undefined)
    if (anchored) continue
    const effective = out[node.id]
    if (!effective) continue
    out[node.id] = {
      ...effective,
      layout: { ...effective.layout, constraints: { ...effective.layout.constraints, h: 'left', v: 'top' } },
    }
  }
  return out
}

/**
 * 该断点对应的媒体查询；基准断点返回 null（它就是默认样式）。
 * 上界取「更宽一级的 minWidth - 0.02」，避免 1200px 整数宽同时命中两段。
 */
export function mediaQueryForBreakpoint(
  breakpoints: readonly Breakpoint[],
  targetId: BreakpointId,
): string | null {
  const ordered = orderedBreakpoints(breakpoints)
  const index = ordered.findIndex((breakpoint) => breakpoint.id === targetId)
  if (index <= 0) return null
  const upper = Math.round((ordered[index - 1].minWidth - 0.02) * 100) / 100
  return `@media (max-width: ${upper}px)`
}

function cloneLayout(layout: LayoutSpec): LayoutSpec {
  return {
    ...layout,
    position: { ...layout.position },
    size: { w: { ...layout.size.w }, h: { ...layout.size.h } },
    padding: { ...layout.padding },
    constraints: { ...layout.constraints },
  }
}

function mergeLayout(base: LayoutSpec, partial: Partial<LayoutSpec>): LayoutSpec {
  const next: LayoutSpec = { ...base, ...partial }
  if (partial.position) next.position = { ...base.position, ...partial.position } as { x: number; y: number }
  if (partial.size) {
    const size = partial.size as { w?: SizeSpec; h?: SizeSpec }
    next.size = {
      w: size.w ? { ...base.size.w, ...size.w } : { ...base.size.w },
      h: size.h ? { ...base.size.h, ...size.h } : { ...base.size.h },
    }
  }
  if (partial.padding) next.padding = { ...base.padding, ...partial.padding } as Insets
  if (partial.constraints) next.constraints = { ...base.constraints, ...partial.constraints } as Constraints
  return next
}

/** 深克隆到「有效节点」形态：overrides 清空，嵌套对象不与原节点共享 */
function cloneEffective(node: SceneNode): SceneNode {
  return {
    ...node,
    layout: cloneLayout(node.layout),
    style: { ...node.style },
    props: { ...node.props },
    meta: { ...node.meta },
    overrides: {},
  }
}

function applyOverride(node: SceneNode, override: NodeOverride | undefined): SceneNode {
  if (!override) return node
  return {
    ...node,
    order: override.order ?? node.order,
    layout: override.layout ? mergeLayout(node.layout, override.layout) : node.layout,
    style: override.style ? { ...node.style, ...override.style } : node.style,
    props: override.props ? { ...node.props, ...override.props } : node.props,
    meta: override.hidden === undefined ? node.meta : { ...node.meta, hidden: override.hidden },
  }
}

function applyEdit(node: SceneNode, edit: ResponsiveEdit): SceneNode {
  return {
    ...node,
    order: edit.order ?? node.order,
    layout: edit.layout ? mergeLayout(node.layout, edit.layout) : node.layout,
    style: edit.style ? { ...node.style, ...edit.style } : node.style,
    props: edit.props ? { ...node.props, ...edit.props } : node.props,
    meta: edit.hidden === undefined ? node.meta : { ...node.meta, hidden: edit.hidden },
  }
}

function sameSize(a: SizeSpec, b: SizeSpec): boolean {
  return a.kind === b.kind && (a.value ?? 0) === (b.value ?? 0)
}

function diffLayout(below: LayoutSpec, desired: LayoutSpec): Partial<LayoutSpec> | undefined {
  const out: Partial<LayoutSpec> = {}
  if (desired.mode !== below.mode) out.mode = desired.mode
  if (desired.gap !== below.gap) out.gap = desired.gap
  if (desired.columns !== below.columns) out.columns = desired.columns
  if (desired.align !== below.align) out.align = desired.align
  if (desired.justify !== below.justify) out.justify = desired.justify
  if (desired.wrap !== below.wrap) out.wrap = desired.wrap
  if (desired.position.x !== below.position.x || desired.position.y !== below.position.y) {
    out.position = { ...desired.position }
  }
  if (!sameSize(desired.size.w, below.size.w) || !sameSize(desired.size.h, below.size.h)) {
    out.size = { w: { ...desired.size.w }, h: { ...desired.size.h } }
  }
  if (
    desired.padding.top !== below.padding.top ||
    desired.padding.right !== below.padding.right ||
    desired.padding.bottom !== below.padding.bottom ||
    desired.padding.left !== below.padding.left
  ) {
    out.padding = { ...desired.padding }
  }
  if (desired.constraints.h !== below.constraints.h || desired.constraints.v !== below.constraints.v) {
    out.constraints = { ...desired.constraints }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 求某个断点下的有效节点（原节点 + 继承链上的覆盖） */
export function effectiveNode(
  node: SceneNode,
  breakpoints: readonly Breakpoint[],
  targetId: BreakpointId,
): SceneNode {
  let current = cloneEffective(node)
  for (const id of cascadeIds(breakpoints, targetId)) {
    current = applyOverride(current, node.overrides[id])
  }
  return current
}

export function effectiveNodes(
  nodes: Record<NodeId, SceneNode>,
  breakpoints: readonly Breakpoint[],
  targetId: BreakpointId,
): Record<NodeId, SceneNode> {
  const out: Record<NodeId, SceneNode> = {}
  for (const id of Object.keys(nodes)) {
    out[id] = effectiveNode(nodes[id], breakpoints, targetId)
  }
  return out
}

export function effectivePage(
  page: Page,
  breakpoints: readonly Breakpoint[],
  targetId: BreakpointId,
): Page {
  return { ...page, nodes: effectiveNodes(page.nodes, breakpoints, targetId) }
}

export function effectiveDoc(doc: Doc, targetId: BreakpointId): Doc {
  return { ...doc, pages: doc.pages.map((page) => effectivePage(page, doc.breakpoints, targetId)) }
}

/**
 * 在某个断点下写入一次编辑，返回**只含差异**的覆盖对象。
 *
 * - 基准断点返回 null：编辑本来就该落在节点上（调用方走普通 updateNode）。
 * - 差异是相对「更宽一级的有效值」算的，所以「改回继承值」会自动让覆盖消失，
 *   导出时也不必写多余的媒体查询规则。
 * - 已有覆盖里未被这次编辑触碰的键会保留。
 */
export function writeOverride(
  node: SceneNode,
  breakpoints: readonly Breakpoint[],
  targetId: BreakpointId,
  edit: ResponsiveEdit,
): NodeOverride | null {
  const ids = cascadeIds(breakpoints, targetId)
  if (ids.length <= 1) return null
  const below = ids
    .slice(0, -1)
    .reduce<SceneNode>((acc, id) => applyOverride(acc, node.overrides[id]), cloneEffective(node))
  const desired = applyEdit(applyOverride(below, node.overrides[targetId]), edit)
  const override: NodeOverride = {}

  const style: Partial<StyleSpec> = {}
  for (const key of Object.keys(desired.style) as (keyof StyleSpec)[]) {
    if (desired.style[key] !== below.style[key]) {
      ;(style as Record<string, unknown>)[key] = desired.style[key]
    }
  }
  if (Object.keys(style).length > 0) override.style = style

  const props: Record<string, unknown> = {}
  for (const key of Object.keys(desired.props)) {
    if (desired.props[key] !== below.props[key]) props[key] = desired.props[key]
  }
  if (Object.keys(props).length > 0) override.props = props

  const layout = diffLayout(below.layout, desired.layout)
  if (layout) override.layout = layout
  if (desired.order !== below.order) override.order = desired.order
  if (desired.meta.hidden !== below.meta.hidden) override.hidden = desired.meta.hidden

  return isEmptyOverride(override) ? null : override
}

export function isEmptyOverride(override: NodeOverride | undefined): boolean {
  if (!override) return true
  if (override.layout && Object.keys(override.layout).length > 0) return false
  if (override.style && Object.keys(override.style).length > 0) return false
  if (override.props && Object.keys(override.props).length > 0) return false
  if (override.hidden !== undefined) return false
  if (override.order !== undefined) return false
  return true
}

/** UI 打点用：该断点上有哪些类别的覆盖 */
export function overrideFlags(node: SceneNode, targetId: BreakpointId): OverrideFlags {
  const override = node.overrides[targetId]
  const layout = Boolean(override?.layout && Object.keys(override.layout).length > 0)
  const style = Boolean(override?.style && Object.keys(override.style).length > 0)
  const props = Boolean(override?.props && Object.keys(override.props).length > 0)
  const hidden = override?.hidden !== undefined
  const order = override?.order !== undefined
  return {
    layout,
    style,
    props,
    hidden,
    order,
    empty: !layout && !style && !props && !hidden && !order,
  }
}
