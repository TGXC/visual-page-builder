import { normalizeNodeOrder } from '../tree'
import {
  CONTENT_KEYS,
  DEFAULT_BREAKPOINTS,
  DEFAULT_STYLE,
  DEFAULT_THEME_TOKENS,
  DEFAULT_VIEWPORT,
  STYLE_KEYS,
  V1_PROP_KEYS,
  V1_TYPES,
  defaultPropsFor,
  defaultSizeFor,
} from './catalog'
import { createId, isRecord, MAX_TEXT, normalizeStyle } from './normalize'
import type {
  ComponentType,
  Doc,
  NodeId,
  NodeMeta,
  Page,
  SceneNode,
  StyleSpec,
} from './types'

/** v1 导出的项目文件带这个 app 标记（参考实现 index.html:1267） */
export const LEGACY_APP_ID = 'visual-builder'
/** v1 自身的收敛上限（参考实现 index.html:372-388） */
export const LEGACY_MAX_PAGES = 50
export const LEGACY_MAX_ELEMENTS_PER_PAGE = 2000

const MAX_COORD = 100_000

interface MigrateContext {
  parentId: NodeId
  order: number
  fallbackId: string
  usedIds: Set<string>
  viewport: { w: number; h: number }
}

function clampInt(value: unknown, fallback: number, min: number, max = MAX_COORD): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function uniqueId(candidate: string, used: Set<string>): string {
  let id = candidate
  let suffix = 2
  while (used.has(id)) id = `${candidate}_${suffix++}`
  used.add(id)
  return id
}

/**
 * 判断一份 JSON 是不是 WebBuilder v1 的项目：
 * ①导出文件形状 `{app:'visual-builder', version:1, pages:[...]}`
 * ②localStorage 存档形状 `{pages:[...], activePageId}`
 */
export function isLegacyProject(raw: unknown): boolean {
  if (!isRecord(raw) || !Array.isArray(raw.pages) || raw.pages.length === 0) return false
  if (raw.app === LEGACY_APP_ID) return true
  return raw.pages.some((page) => isRecord(page) && Array.isArray(page.elements))
}

function legacyViewport(raw: Record<string, unknown>): { w: number; h: number } {
  const viewport = isRecord(raw.viewport) ? raw.viewport : {}
  return {
    w: clampInt(viewport.w ?? raw.viewportW ?? raw.curW, DEFAULT_VIEWPORT.w, 200, 10_000),
    h: clampInt(viewport.h ?? raw.viewportH ?? raw.curH, DEFAULT_VIEWPORT.h, 200, 10_000),
  }
}

function legacyPageName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '未命名页面'
  return raw.trim().slice(0, 40)
}

/**
 * 把 v1 的 22 个白名单属性拆进 style / props / meta 三个桶。
 * 注意 v1 的形状：样式与内容在 `element.props` 里，图层名在 `element.name` 上。
 */
function splitLegacyProps(type: ComponentType, rawElement: unknown): {
  style: StyleSpec
  props: Record<string, unknown>
  meta: NodeMeta
} {
  const element = isRecord(rawElement) ? rawElement : {}
  const source = isRecord(element.props) ? element.props : {}
  const styleSource: Record<string, unknown> = {}
  const props: Record<string, unknown> = {}
  for (const key of V1_PROP_KEYS) {
    const value = source[key]
    if (value === undefined) continue
    if ((STYLE_KEYS as readonly string[]).includes(key)) {
      styleSource[key] = value
    } else if ((CONTENT_KEYS as readonly string[]).includes(key)) {
      if (typeof value === 'string') props[key] = value.slice(0, MAX_TEXT)
      else if (typeof value === 'number' && Number.isFinite(value)) props[key] = String(value)
    }
  }
  // 一次收敛：逐个 Object.assign 会把上一个键覆盖回默认值
  const style = normalizeStyle(styleSource, type)
  // v1 渲染时缺省值来自 DEFAULTS，迁移后同样补齐，保证「看着一样」
  for (const [key, value] of Object.entries(defaultPropsFor(type))) {
    if (!(key in props)) props[key] = value
  }
  // v1 用 Boolean(value) 归一化这两个开关，迁移保持同样语义，避免导入后显隐/锁定跳变
  const meta: NodeMeta = { hidden: Boolean(source.hidden), locked: Boolean(source.locked) }
  if (typeof element.name === 'string' && element.name.trim()) {
    meta.name = element.name.trim().slice(0, 80)
  }
  return { style, props, meta }
}

function migrateElement(rawElement: unknown, ctx: MigrateContext): SceneNode {
  const source = isRecord(rawElement) ? rawElement : {}
  const type: ComponentType = typeof source.type === 'string' && V1_TYPES.includes(source.type)
    ? (source.type as ComponentType)
    : 'rect'
  const fallback = defaultSizeFor(type)
  const id = uniqueId(
    typeof source.id === 'string' && source.id.trim() ? source.id.trim() : ctx.fallbackId,
    ctx.usedIds,
  )
  const { style, props, meta } = splitLegacyProps(type, source)
  return {
    id,
    type,
    parentId: ctx.parentId,
    order: ctx.order,
    layout: {
      mode: 'free',
      position: {
        x: clampInt(source.x, 20, 0),
        y: clampInt(source.y, 20, 0),
      },
      size: {
        w: { kind: 'fixed', value: clampInt(source.w, fallback.w, 1) },
        h: { kind: 'fixed', value: clampInt(source.h, fallback.h, 1) },
      },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      columns: 1,
      align: 'start',
      justify: 'start',
      wrap: false,
      constraints: { h: 'left', v: 'top' },
    },
    style,
    props,
    overrides: {},
    meta,
  }
}

function legacyRootFrame(id: NodeId, viewport: { w: number; h: number }): SceneNode {
  return {
    id,
    type: 'frame',
    parentId: null,
    order: 0,
    layout: {
      mode: 'free',
      position: { x: 0, y: 0 },
      size: { w: { kind: 'fixed', value: viewport.w }, h: { kind: 'fixed', value: viewport.h } },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      columns: 1,
      align: 'start',
      justify: 'start',
      wrap: false,
      constraints: { h: 'left', v: 'top' },
    },
    style: { ...DEFAULT_STYLE },
    props: {},
    overrides: {},
    meta: { hidden: false, locked: false },
  }
}

/**
 * WebBuilder v1 项目 → Studio v2 文档。
 * 迁移原则：坐标、尺寸、类型、属性一个都不能变（「不倒退」），只是换了容器与层级表达。
 * 无法识别的内容返回 null，调用方据此提示「不是有效的 WebBuilder 项目」。
 */
export function migrateFromWebBuilderV1(
  raw: unknown,
  options: { name?: string } = {},
): Doc | null {
  if (!isRecord(raw) || !Array.isArray(raw.pages) || raw.pages.length === 0) return null
  const viewport = legacyViewport(raw)
  const usedPageIds = new Set<string>()
  const pages: Page[] = raw.pages.slice(0, LEGACY_MAX_PAGES).map((rawPage, pageIndex) => {
    const page = isRecord(rawPage) ? rawPage : {}
    const pageId = uniqueId(
      typeof page.id === 'string' && page.id.trim() ? page.id.trim() : `page_${pageIndex + 1}`,
      usedPageIds,
    )
    const rootId = `root_${pageId}`
    const usedNodeIds = new Set<string>([rootId])
    const nodes: Record<NodeId, SceneNode> = { [rootId]: legacyRootFrame(rootId, viewport) }
    const elements = Array.isArray(page.elements) ? page.elements.slice(0, LEGACY_MAX_ELEMENTS_PER_PAGE) : []
    elements.forEach((element, index) => {
      const node = migrateElement(element, {
        parentId: rootId,
        order: index,
        fallbackId: `el_${pageIndex + 1}_${index + 1}`,
        usedIds: usedNodeIds,
        viewport,
      })
      nodes[node.id] = node
    })
    return {
      id: pageId,
      name: legacyPageName(page.name),
      path: pageIndex === 0 ? '/' : `/${pageId}`,
      root: rootId,
      nodes: normalizeNodeOrder(nodes),
      viewport: { ...viewport },
    }
  })

  const legacyActive = typeof raw.activePageId === 'string' ? raw.activePageId : ''
  const savedIndex = raw.pages.findIndex((page) => isRecord(page) && page.id === legacyActive)
  const activePageId = pages[savedIndex >= 0 && savedIndex < pages.length ? savedIndex : 0].id

  return {
    version: 2,
    id: createId('doc'),
    name: options.name
      ?? (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'WebBuilder 导入的项目'),
    pages,
    activePageId,
    breakpoints: DEFAULT_BREAKPOINTS.map((breakpoint) => ({ ...breakpoint })),
    theme: { tokens: { ...DEFAULT_THEME_TOKENS } },
  }
}
