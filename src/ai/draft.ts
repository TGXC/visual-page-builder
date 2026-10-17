/**
 * PageDraft 三重校验（M6 / AI1）。
 *
 * AI 的产出必须过三关才允许落库：
 * ①**结构**：形状对不对、组件类型是否在白名单里、引用（parentId）是否都在本页、必填属性有没有写；
 * ②**收敛层**：交给 `normalizePage` + `normalizeDoc` 跑一遍，节点一个都不能丢；
 * ③**自检**：算一遍布局，检查水平越界 / 兄弟节点几乎完全重叠。
 *
 * 任何一关失败都返回错误列表，调用方**不写文档**（功能文档 AI1：「失败不落库」）。
 */
import type { Doc, Page, PageId } from '../core/schema/types'
import { hasComponent, isContainerType } from '../core/components'
import { createId, isRecord, normalizeDoc, normalizePage } from '../core/schema/normalize'
import { computeLayout } from '../core/layout'
import { childrenOf } from '../core/tree'
import type { AiProblem } from './types'

export interface PageDraft {
  id?: unknown
  name?: unknown
  path?: unknown
  viewport?: unknown
  root?: unknown
  nodes?: unknown
}

export type DraftResult =
  | { ok: true; page: Page; doc: Doc; warnings: string[] }
  | { ok: false; errors: AiProblem[] }

/** 一页草稿最多这么多节点，防止模型吐出天文数字 */
export const MAX_DRAFT_NODES = 120

/** 必填 props 表（缺了就渲染不出有意义的内容） */
const REQUIRED_PROPS: Record<string, readonly string[]> = {
  text: ['text'],
  heading: ['text'],
  label: ['text'],
  button: ['text'],
  link: ['text'],
  badge: ['text'],
  alert: ['text'],
  card: ['text'],
  list: ['text'],
  nav: ['text'],
  tabs: ['text'],
  table: ['text'],
  input: ['text'],
  textarea: ['text'],
  select: ['text'],
  checkbox: ['text'],
  radio: ['text'],
  switch: ['text'],
  slider: ['text'],
  date: ['text'],
  number: ['text'],
  file: ['text'],
  rating: ['text'],
  progress: ['text'],
}

/** 生成页面 id：从名字转 slug，冲突自动加后缀 */
export function draftPageId(doc: Doc, name: string): PageId {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const base = `page_${slug || createId('ai')}`
  if (!doc.pages.some((page) => page.id === base)) return base
  let index = 2
  while (doc.pages.some((page) => page.id === `${base}_${index}`)) index += 1
  return `${base}_${index}`
}

/** 第一关：结构 + 组件白名单 + 引用完整性 */
function shapeProblems(raw: unknown): AiProblem[] {
  const problems: AiProblem[] = []
  if (!isRecord(raw)) {
    return [{ code: 'shape', message: '草稿不是 JSON 对象' }]
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    problems.push({ code: 'shape', message: '缺少页面名 name' })
  }
  if (!isRecord(raw.nodes)) {
    return [...problems, { code: 'shape', message: '缺少节点表 nodes' }]
  }
  const entries = Object.entries(raw.nodes)
  if (entries.length === 0) problems.push({ code: 'shape', message: '节点表是空的' })
  if (entries.length > MAX_DRAFT_NODES) {
    problems.push({ code: 'shape', message: `节点太多（${entries.length} > ${MAX_DRAFT_NODES}）` })
  }
  const ids = new Set(entries.map(([key, value]) => (isRecord(value) && typeof value.id === 'string' ? value.id : key)))
  if (typeof raw.root !== 'string' || raw.root === '') {
    problems.push({ code: 'shape', message: '缺少根节点 id root' })
  } else if (!ids.has(raw.root)) {
    problems.push({ code: 'reference', message: `root=${raw.root} 不在节点表里` })
  }
  for (const [key, value] of entries) {
    if (!isRecord(value)) {
      problems.push({ code: 'shape', message: `节点 ${key} 不是对象` })
      continue
    }
    const nodeId = typeof value.id === 'string' && value.id !== '' ? value.id : key
    if (typeof value.type !== 'string' || !hasComponent(value.type)) {
      problems.push({ code: 'reference', message: `节点 ${key} 的类型 ${String(value.type)} 未注册` })
    }
    const parentId = value.parentId
    if (typeof parentId === 'string' && parentId !== '' && !ids.has(parentId)) {
      problems.push({ code: 'reference', message: `节点 ${key} 的父节点 ${parentId} 不存在` })
    }
    if ((parentId === undefined || parentId === null) && raw.root !== nodeId && raw.root !== key) {
      problems.push({ code: 'reference', message: `节点 ${key} 不是根却没有父节点` })
    }
    // 必填属性必须在**原始草稿**里就写上：收敛层会用描述符默认值补齐，
    // 那是给手工编辑兜底的，不能让模型「忘了写」也蒙混过关。
    const required = REQUIRED_PROPS[typeof value.type === 'string' ? value.type : ''] ?? []
    const props = isRecord(value.props) ? value.props : {}
    for (const field of required) {
      const text = props[field]
      if (typeof text !== 'string' || text.trim() === '') {
        problems.push({ code: 'shape', message: `节点 ${key}（${String(value.type)}）缺少必填属性 ${field}` })
      }
    }
  }
  return problems
}

/** 第三关：自检（水平越界 / 几乎完全重叠） */
function selfCheckProblems(page: Page): AiProblem[] {
  const problems: AiProblem[] = []
  const layout = computeLayout({ nodes: page.nodes, rootId: page.root, viewport: page.viewport })
  for (const node of Object.values(page.nodes)) {
    const box = layout.boxes[node.id]
    if (!box) continue
    if (box.x < -1 || box.x + box.w > page.viewport.w + 1) {
      problems.push({
        code: 'self-check',
        message: `节点 ${node.id}（${node.type}）水平越界：${Math.round(box.x)}~${Math.round(box.x + box.w)}，画布宽 ${page.viewport.w}`,
      })
    }
  }
  for (const parent of Object.values(page.nodes)) {
    const kids = childrenOf(page.nodes, parent.id)
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i]
        const b = kids[j]
        if (isContainerType(a.type) || isContainerType(b.type)) continue
        const boxA = layout.boxes[a.id]
        const boxB = layout.boxes[b.id]
        if (!boxA || !boxB) continue
        const overlapW = Math.min(boxA.x + boxA.w, boxB.x + boxB.w) - Math.max(boxA.x, boxB.x)
        const overlapH = Math.min(boxA.y + boxA.h, boxB.y + boxB.h) - Math.max(boxA.y, boxB.y)
        if (overlapW <= 0 || overlapH <= 0) continue
        const smaller = Math.min(boxA.w * boxA.h, boxB.w * boxB.h)
        if (smaller > 0 && (overlapW * overlapH) / smaller > 0.6) {
          problems.push({ code: 'self-check', message: `节点 ${a.id} 与 ${b.id} 几乎完全重叠` })
        }
      }
    }
  }
  return problems
}

/**
 * 三重校验。`options.pageId` 不传时按页面名生成一个不冲突的 id。
 * 返回的 `doc` 已经过 `normalizeDoc`，可以直接 `commitDocEntry()` 落库。
 */
export function validateDraft(doc: Doc, raw: unknown, options: { pageId?: PageId } = {}): DraftResult {
  const errors = shapeProblems(raw)
  if (errors.length > 0) return { ok: false, errors }

  const draft = raw as PageDraft
  const name = String(draft.name).trim().slice(0, 40)
  const pageId = options.pageId ?? draftPageId(doc, name)
  const warnings: string[] = []

  // 第二关：收敛层（结构归一 + 不变量）；节点数必须一个不少
  const page = normalizePage({ ...draft, id: pageId, name }, pageId)
  const rawCount = Object.keys((draft.nodes as Record<string, unknown>) ?? {}).length
  if (Object.keys(page.nodes).length !== rawCount) {
    return {
      ok: false,
      errors: [
        {
          code: 'normalize',
          message: `收敛后节点数从 ${rawCount} 变成 ${Object.keys(page.nodes).length}，草稿里有非法节点被丢弃`,
        },
      ],
    }
  }
  const next = normalizeDoc({
    ...doc,
    pages: [...doc.pages, page],
    activePageId: pageId,
  })
  const stored = next?.pages.find((item) => item.id === pageId)
  if (!next || !stored) {
    return { ok: false, errors: [{ code: 'normalize', message: '整份文档过不了收敛层（normalizeDoc 返回空）' }] }
  }

  // 第三关：自检
  const selfCheck = selfCheckProblems(stored)
  if (selfCheck.length > 0) return { ok: false, errors: selfCheck }

  if (!isContainerType(stored.nodes[stored.root].type)) {
    warnings.push('根节点不是容器类型，后续可能没法往里拖东西')
  }
  return { ok: true, page: stored, doc: next, warnings }
}
