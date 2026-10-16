import { nanoid } from 'nanoid'
import { canonicalNodes, normalizeNodeOrder } from '../tree'
import { hasComponent } from '../components'
import {
  CONTENT_KEYS,
  DEFAULT_BREAKPOINTS,
  DEFAULT_STYLE,
  DEFAULT_THEME_TOKENS,
  DEFAULT_VIEWPORT,
  defaultPropsFor,
  defaultStyleFor,
} from './catalog'
import type {
  Alignment,
  Breakpoint,
  ComponentType,
  ConstraintH,
  ConstraintV,
  Doc,
  Insets,
  Justify,
  LayoutMode,
  LayoutSpec,
  NodeId,
  NodeMeta,
  NodeOverride,
  Page,
  PageId,
  SceneNode,
  SizeKind,
  SizeSpec,
  StyleSpec,
  TextAlign,
  Theme,
} from './types'

/** 坐标/尺寸上限：沿用 v1 的 100000，避免脏数据把画布撑爆 */
export const MAX_COORD = 100_000
/** 文本类属性上限（v1 是 4MB，这里收到 20000 防止脏 JSON 拖垮编辑器） */
export const MAX_TEXT = 20_000
/** 视口宽高的允许区间：收敛层与编辑器自定义视口共用同一对边界 */
export const MIN_VIEWPORT = 200
export const MAX_VIEWPORT = 10_000
const MAX_NAME = 80

export function createId(prefix: string): string {
  return `${prefix}_${nanoid(10)}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)))
}

function clampInt(value: unknown, fallback: number, min: number, max = MAX_COORD): number {
  return Math.round(clampNumber(value, fallback, min, max))
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function uniqueId(candidate: string, used: Set<string>): string {
  let id = candidate
  let suffix = 2
  while (used.has(id)) {
    id = `${candidate}_${suffix++}`
  }
  used.add(id)
  return id
}

const LAYOUT_MODES: readonly LayoutMode[] = ['free', 'vertical', 'horizontal', 'grid']
const SIZE_KINDS: readonly SizeKind[] = ['fixed', 'hug', 'fill', 'ratio']
const ALIGNMENTS: readonly Alignment[] = ['start', 'center', 'end', 'stretch']
const JUSTIFIES: readonly Justify[] = ['start', 'center', 'end', 'space-between']
const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right']
const CONSTRAINTS_H: readonly ConstraintH[] = ['left', 'right', 'left-right', 'center', 'scale']
const CONSTRAINTS_V: readonly ConstraintV[] = ['top', 'bottom', 'top-bottom', 'center', 'scale']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function normalizeType(raw: unknown): ComponentType {
  return typeof raw === 'string' && hasComponent(raw) ? (raw as ComponentType) : 'rect'
}

export function defaultLayout(size: { w: number; h: number } = { w: 160, h: 60 }): LayoutSpec {
  return {
    mode: 'free',
    position: { x: 20, y: 20 },
    size: { w: { kind: 'fixed', value: size.w }, h: { kind: 'fixed', value: size.h } },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    gap: 0,
    columns: 1,
    align: 'start',
    justify: 'start',
    wrap: false,
    constraints: { h: 'left', v: 'top' },
  }
}

export function normalizeSize(raw: unknown, fallback: SizeSpec): SizeSpec {
  if (!isRecord(raw)) return { ...fallback }
  const kind = pick(raw.kind, SIZE_KINDS, fallback.kind)
  if (kind === 'fixed') {
    const source = raw.value === undefined ? fallback.value : raw.value
    return { kind, value: clampInt(source, fallback.value ?? 1, 1) }
  }
  if (kind === 'ratio') {
    const source = raw.value === undefined ? fallback.value : raw.value
    return { kind, value: clampNumber(source, fallback.value ?? 1, 0.01, 100) }
  }
  return { kind }
}

function normalizeInsets(raw: unknown): Insets {
  const source = isRecord(raw) ? raw : {}
  return {
    top: clampNumber(source.top, 0, 0, 1000),
    right: clampNumber(source.right, 0, 0, 1000),
    bottom: clampNumber(source.bottom, 0, 0, 1000),
    left: clampNumber(source.left, 0, 0, 1000),
  }
}

export function normalizeLayout(raw: unknown, fallback: LayoutSpec = defaultLayout()): LayoutSpec {
  const source = isRecord(raw) ? raw : {}
  const position = isRecord(source.position) ? source.position : {}
  const constraints = isRecord(source.constraints) ? source.constraints : {}
  // size 是嵌套对象（LayoutSpec.size = {w,h}）；为方便手写/生成的数据，也接受平铺的 w/h
  const size = isRecord(source.size) ? source.size : source
  return {
    mode: pick(source.mode, LAYOUT_MODES, fallback.mode),
    position: {
      x: clampInt(position.x, fallback.position.x, 0),
      y: clampInt(position.y, fallback.position.y, 0),
    },
    size: {
      w: normalizeSize(size.w, fallback.size.w),
      h: normalizeSize(size.h, fallback.size.h),
    },
    padding: normalizeInsets(source.padding),
    gap: clampNumber(source.gap, 0, 0, 1000),
    columns: clampInt(source.columns, 1, 1, 24),
    align: pick(source.align, ALIGNMENTS, fallback.align),
    justify: pick(source.justify, JUSTIFIES, fallback.justify),
    wrap: source.wrap === true,
    constraints: {
      h: pick(constraints.h, CONSTRAINTS_H, 'left'),
      v: pick(constraints.v, CONSTRAINTS_V, 'top'),
    },
  }
}

const NUMBER_STYLE_KEYS = [
  'fontSize', 'fontWeight', 'radius', 'borderWidth', 'shadowBlur',
  'shadowX', 'shadowY', 'lineHeight', 'letterSpacing',
] as const

export function normalizeStyle(raw: unknown, type?: ComponentType): StyleSpec {
  const base: StyleSpec = type ? defaultStyleFor(type) : { ...DEFAULT_STYLE }
  const source = isRecord(raw) ? raw : {}
  for (const key of ['bg', 'color', 'borderColor', 'shadowColor'] as const) {
    if (typeof source[key] === 'string') base[key] = source[key] as string
  }
  for (const key of NUMBER_STYLE_KEYS) {
    if (source[key] !== undefined) base[key] = clampNumber(source[key], base[key], 0, 1000)
  }
  if (source.opacity !== undefined) base.opacity = clampNumber(source.opacity, base.opacity, 0, 1)
  base.align = pick(source.align, TEXT_ALIGNS, base.align)
  return base
}

/** 内容属性只接受字符串/数字/布尔，其余（对象、数组、函数）一律丢弃 */
export function normalizeProps(raw: unknown): Record<string, unknown> {
  const source = isRecord(raw) ? raw : {}
  const props: Record<string, unknown> = {}
  for (const key of CONTENT_KEYS) {
    const value = source[key]
    if (typeof value === 'string') props[key] = value.slice(0, MAX_TEXT)
    else if (typeof value === 'number' && Number.isFinite(value)) props[key] = value
    else if (typeof value === 'boolean') props[key] = value
  }
  // 允许组件通过 props 传自己的额外键（M4 插件式组件需要），同样过滤非法值
  for (const [key, value] of Object.entries(source)) {
    if (key in props) continue
    if (typeof value === 'string') props[key] = value.slice(0, MAX_TEXT)
    else if (typeof value === 'number' && Number.isFinite(value)) props[key] = value
    else if (typeof value === 'boolean') props[key] = value
  }
  return props
}

export function normalizeMeta(raw: unknown): NodeMeta {
  const source = isRecord(raw) ? raw : {}
  const meta: NodeMeta = { hidden: source.hidden === true, locked: source.locked === true }
  if (typeof source.name === 'string' && source.name.trim()) {
    meta.name = source.name.trim().slice(0, MAX_NAME)
  }
  return meta
}

export function normalizeOverrides(raw: unknown): Record<string, NodeOverride> {
  const source = isRecord(raw) ? raw : {}
  const overrides: Record<string, NodeOverride> = {}
  for (const [breakpointId, value] of Object.entries(source)) {
    if (!breakpointId || !isRecord(value)) continue
    const override: NodeOverride = {}
    if (isRecord(value.layout)) override.layout = normalizeLayout(value.layout)
    if (isRecord(value.style)) override.style = normalizeStyle(value.style)
    if (isRecord(value.props)) override.props = normalizeProps(value.props)
    if (value.order !== undefined) override.order = clampInt(value.order, 0, 0, 100_000)
    if (typeof value.hidden === 'boolean') override.hidden = value.hidden
    // 空覆盖对象是「无覆盖」，删掉才能保证同一逻辑状态序列化成同一份 JSON
    if (Object.keys(override).length > 0) overrides[breakpointId] = override
  }
  return overrides
}

export function normalizeNode(raw: unknown, fallbackId?: string): SceneNode {
  const source = isRecord(raw) ? raw : {}
  const type = normalizeType(source.type)
  const id = stringOr(source.id, fallbackId ?? createId('n'))
  return {
    id,
    type,
    parentId: typeof source.parentId === 'string' && source.parentId.length > 0 ? source.parentId : null,
    order: clampInt(source.order, 0, 0, 100_000),
    layout: normalizeLayout(source.layout, defaultLayout()),
    style: normalizeStyle(source.style, type),
    props: normalizeProps(source.props ?? defaultPropsFor(type)),
    overrides: normalizeOverrides(source.overrides),
    meta: normalizeMeta(source.meta),
  }
}

/**
 * 规范化一整页的节点表，并维持三个不变量：
 * ①id 唯一 ②除根容器外不得有 parentId===null ③任何父链都无环
 * 最后按 parentId 分组把 order 重排成连续的 0..n-1。
 */
export function normalizeNodes(raw: unknown, rootId: NodeId): Record<NodeId, SceneNode> {
  const source = isRecord(raw) ? raw : {}
  const nodes: Record<NodeId, SceneNode> = {}
  const usedIds = new Set<string>()
  for (const [key, value] of Object.entries(source)) {
    const node = normalizeNode(value, key)
    node.id = uniqueId(node.id, usedIds)
    nodes[node.id] = node
  }
  for (const node of Object.values(nodes)) {
    const parentId = node.parentId
    if (parentId === null) continue
    if (parentId === node.id || !nodes[parentId]) node.parentId = rootId
  }
  for (const node of Object.values(nodes)) {
    const seen = new Set<NodeId>([node.id])
    let cursor = node.parentId
    while (cursor !== null) {
      if (seen.has(cursor)) {
        node.parentId = rootId
        break
      }
      seen.add(cursor)
      cursor = nodes[cursor]?.parentId ?? null
    }
  }
  for (const node of Object.values(nodes)) {
    if (node.id !== rootId && node.parentId === null) node.parentId = rootId
  }
  return canonicalNodes(normalizeNodeOrder(nodes))
}

export function createRootFrame(id: NodeId, viewport = DEFAULT_VIEWPORT): SceneNode {
  const layout = defaultLayout({ w: viewport.w, h: viewport.h })
  layout.position = { x: 0, y: 0 }
  return {
    id,
    type: 'frame',
    parentId: null,
    order: 0,
    layout,
    style: { ...DEFAULT_STYLE },
    props: {},
    overrides: {},
    meta: { hidden: false, locked: false },
  }
}

export function normalizePage(raw: unknown, fallbackId: string): Page {
  const source = isRecord(raw) ? raw : {}
  const id = stringOr(source.id, fallbackId)
  const root = stringOr(source.root, createId('root'))
  const viewportSource = isRecord(source.viewport) ? source.viewport : {}
  const viewport = {
    w: clampInt(viewportSource.w, DEFAULT_VIEWPORT.w, MIN_VIEWPORT, MAX_VIEWPORT),
    h: clampInt(viewportSource.h, DEFAULT_VIEWPORT.h, MIN_VIEWPORT, MAX_VIEWPORT),
  }
  const nodes = normalizeNodes(source.nodes, root)
  if (!nodes[root]) nodes[root] = createRootFrame(root, viewport)
  const name = stringOr(source.name, '未命名页面').slice(0, 40)
  const rawPath = typeof source.path === 'string' ? source.path.trim() : ''
  const path = rawPath === '' ? '/' : rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  return { id, name, path, root, nodes, viewport }
}

export function normalizeBreakpoints(raw: unknown): Breakpoint[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_BREAKPOINTS.map((b) => ({ ...b }))
  }
  const used = new Set<string>()
  const breakpoints = raw.map((item) => {
    const source = isRecord(item) ? item : {}
    const id = uniqueId(stringOr(source.id, createId('bp')), used)
    return {
      id,
      label: stringOr(source.label, id).slice(0, 20),
      minWidth: clampInt(source.minWidth, 0, 0, 10_000),
      enabled: source.enabled !== false,
    }
  })
  return breakpoints.sort((a, b) => b.minWidth - a.minWidth)
}

export function normalizeTheme(raw: unknown): Theme {
  const source = isRecord(raw) ? raw : {}
  const rawTokens = isRecord(source.tokens) ? source.tokens : {}
  const tokens: Record<string, string> = { ...DEFAULT_THEME_TOKENS }
  for (const [key, value] of Object.entries(rawTokens)) {
    if (typeof value === 'string' && value.length <= 200) tokens[key] = value
  }
  return { tokens }
}

export function createPage(name = '首页', viewport = DEFAULT_VIEWPORT): Page {
  const root = createId('root')
  const nodes: Record<NodeId, SceneNode> = { [root]: createRootFrame(root, viewport) }
  return { id: createId('page'), name, path: '/', root, nodes, viewport: { ...viewport } }
}

export function createDoc(name = '未命名项目'): Doc {
  const page = createPage('首页')
  return {
    version: 2,
    id: createId('doc'),
    name,
    pages: [page],
    activePageId: page.id,
    breakpoints: normalizeBreakpoints(DEFAULT_BREAKPOINTS),
    theme: normalizeTheme({}),
  }
}

/**
 * 导入任何来源（文件 / localStorage / AI / 旧版迁移）的统一收敛入口。
 * 只有「不是对象」才返回 null；其余情况都尽量救回一个合法文档。
 */
export function normalizeDoc(raw: unknown): Doc | null {
  if (!isRecord(raw)) return null
  const rawPages = Array.isArray(raw.pages) ? raw.pages : []
  const usedPageIds = new Set<PageId>()
  const pages: Page[] = rawPages.slice(0, 50).map((page, index) => {
    const normalized = normalizePage(page, `page_${index + 1}`)
    normalized.id = uniqueId(normalized.id, usedPageIds)
    return normalized
  })
  if (pages.length === 0) pages.push(createPage('首页'))
  const rawActive = typeof raw.activePageId === 'string' ? raw.activePageId : ''
  const activePageId = pages.some((p) => p.id === rawActive) ? rawActive : pages[0].id
  return {
    version: 2,
    id: stringOr(raw.id, createId('doc')),
    name: stringOr(raw.name, '未命名项目').slice(0, 60),
    pages,
    activePageId,
    breakpoints: normalizeBreakpoints(raw.breakpoints),
    theme: normalizeTheme(raw.theme),
  }
}
