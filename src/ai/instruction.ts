/**
 * 选区指令（M6 / AI2）：把 AI 返回的补丁 JSON 收敛成**可信任的 Patch[]**。
 *
 * 两条防线：
 * ①**形状**：模型给的 `before` 一律不信任 —— 我们从当前文档里现取，保证撤销正确；
 * ②**范围**：补丁只能碰选中节点及其子孙（越界引用直接拒绝，功能文档 AI2 验收）。
 */
import type { Doc, NodeId, PageId, Patch, SceneNode } from '../core/schema/types'
import { hasComponent, isContainerType } from '../core/components'
import { applyPatches } from '../core/patch'
import { normalizeNode } from '../core/schema/normalize'
import { childrenOf, subtreeIds } from '../core/tree'
import type { AiProblem } from './types'

/** 一条指令最多允许这么多补丁，防止模型吐一屏 */
export const MAX_AI_PATCHES = 80

/** 补丁里允许改的字段（其他字段一律忽略） */
const PATCH_FIELDS = ['type', 'layout', 'style', 'props', 'overrides', 'meta'] as const

type Field = (typeof PATCH_FIELDS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of PATCH_FIELDS) {
    if (raw[field] !== undefined) out[field] = raw[field]
  }
  return out
}

/**
 * 把模型给的补丁条目收敛成合法 Patch。返回 `null` 表示这条不可用（错误信息进 `errors`）。
 */
function coercePatch(
  page: { id: PageId; nodes: Record<NodeId, SceneNode> },
  raw: Record<string, unknown>,
  errors: AiProblem[],
): Patch | null {
  const op = raw.op
  if (op !== 'insert' && op !== 'remove' && op !== 'update' && op !== 'move') {
    errors.push({ code: 'shape', message: `补丁 op=${String(op)} 不是 insert/remove/update/move` })
    return null
  }
  if (op === 'update') {
    const id = typeof raw.id === 'string' ? raw.id : ''
    const node = page.nodes[id]
    if (!node) {
      errors.push({ code: 'reference', message: `update 的目标 ${id || '(空)'} 不在页面里` })
      return null
    }
    const afterRaw = isRecord(raw.after) ? raw.after : pickFields(raw)
    const after: Record<string, unknown> = {}
    const before: Record<string, unknown> = {}
    for (const field of Object.keys(afterRaw) as Field[]) {
      if (!PATCH_FIELDS.includes(field)) continue
      const value = afterRaw[field]
      if (value === undefined) continue
      if (field === 'style' && isRecord(value)) {
        // 只给了差异就合并到当前样式上，补丁里存的必须是完整对象（applyPatch 是整体替换）
        after.style = { ...node.style, ...value }
        before.style = node.style
      } else if (field === 'layout' && isRecord(value)) {
        after.layout = { ...node.layout, ...value }
        before.layout = node.layout
      } else if (field === 'props') {
        after.props = isRecord(value) ? { ...value } : { ...node.props }
        before.props = { ...node.props }
      } else {
        after[field] = value
        before[field] = (node as unknown as Record<string, unknown>)[field]
      }
    }
    if (Object.keys(after).length === 0) {
      errors.push({ code: 'shape', message: `update ${id} 没有给任何可改字段` })
      return null
    }
    return { op: 'update', pageId: page.id, id, before, after }
  }
  if (op === 'remove') {
    const id = typeof raw.id === 'string' ? raw.id : isRecord(raw.node) && typeof raw.node.id === 'string' ? raw.node.id : ''
    const node = page.nodes[id]
    if (!node) {
      errors.push({ code: 'reference', message: `remove 的目标 ${id || '(空)'} 不在页面里` })
      return null
    }
    if (node.parentId === null) {
      errors.push({ code: 'reference', message: '不能删除页面根节点' })
      return null
    }
    return { op: 'remove', pageId: page.id, node }
  }
  if (op === 'insert') {
    const source = isRecord(raw.node) ? raw.node : raw
    const type = typeof source.type === 'string' ? source.type : ''
    if (!hasComponent(type)) {
      errors.push({ code: 'reference', message: `insert 的组件类型 ${type || '(空)'} 未注册` })
      return null
    }
    const parentId = typeof source.parentId === 'string' ? source.parentId : ''
    const parent = page.nodes[parentId]
    if (!parent) {
      errors.push({ code: 'reference', message: `insert 的父节点 ${parentId || '(空)'} 不在页面里` })
      return null
    }
    if (!isContainerType(parent.type)) {
      errors.push({ code: 'reference', message: `insert 的父节点 ${parentId}（${parent.type}）不是容器` })
      return null
    }
    const order =
      typeof source.order === 'number' && Number.isFinite(source.order)
        ? Math.max(0, Math.trunc(source.order))
        : childrenOf(page.nodes, parentId).length
    const node = normalizeNode({ ...source, type, parentId, order }, typeof source.id === 'string' ? source.id : undefined)
    if (node.parentId !== parentId || node.order !== order) {
      node.parentId = parentId
      node.order = order
    }
    return { op: 'insert', pageId: page.id, node }
  }
  // move
  const id = typeof raw.id === 'string' ? raw.id : ''
  const target = isRecord(raw.to) ? raw.to : isRecord(raw.after) ? raw.after : {}
  const node = page.nodes[id]
  if (!node) {
    errors.push({ code: 'reference', message: `move 的目标 ${id || '(空)'} 不在页面里` })
    return null
  }
  const parentId = typeof target.parentId === 'string' ? target.parentId : node.parentId
  if (parentId === null || !page.nodes[parentId]) {
    errors.push({ code: 'reference', message: `move 的目标父节点 ${String(target.parentId)} 不存在` })
    return null
  }
  if (parentId === id) {
    errors.push({ code: 'reference', message: `move 的目标 ${id} 不能挂到自己下面` })
    return null
  }
  const order =
    typeof target.order === 'number' && Number.isFinite(target.order)
      ? Math.max(0, Math.trunc(target.order))
      : childrenOf(page.nodes, parentId).length
  return {
    op: 'move',
    pageId: page.id,
    id,
    before: { parentId: node.parentId, order: node.order },
    after: { parentId, order },
  }
}

/** 把 `{ patches: [...] }` 或裸数组收敛成 Patch[]；形状不对就报错 */
export function coercePatches(doc: Doc, pageId: PageId, raw: unknown): { patches: Patch[]; errors: AiProblem[] } {
  const errors: AiProblem[] = []
  const page = doc.pages.find((item) => item.id === pageId)
  if (!page) return { patches: [], errors: [{ code: 'reference', message: `页面 ${pageId} 不存在` }] }
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.patches)
      ? raw.patches
      : null
  if (!list) return { patches: [], errors: [{ code: 'shape', message: '返回里没有 patches 数组' }] }
  if (list.length > MAX_AI_PATCHES) {
    errors.push({ code: 'shape', message: `补丁太多（${list.length} > ${MAX_AI_PATCHES}）` })
    return { patches: [], errors }
  }
  const patches: Patch[] = []
  for (const item of list) {
    if (!isRecord(item)) {
      errors.push({ code: 'shape', message: '补丁条目不是对象' })
      continue
    }
    const patch = coercePatch(page, item, errors)
    if (patch) patches.push(patch)
  }
  return { patches, errors }
}

/** 允许改动的 id 集合：选中节点 + 它们的子孙 */
export function allowedIds(doc: Doc, pageId: PageId, selectionIds: readonly NodeId[]): Set<NodeId> {
  const page = doc.pages.find((item) => item.id === pageId)
  const allowed = new Set<NodeId>(selectionIds)
  if (!page) return allowed
  for (const id of selectionIds) {
    if (!page.nodes[id]) continue
    for (const child of subtreeIds(page.nodes, id)) allowed.add(child)
  }
  return allowed
}

/** 范围校验：补丁只能落在选中子树上 */
export function scopeProblems(
  doc: Doc,
  pageId: PageId,
  patches: readonly Patch[],
  selectionIds: readonly NodeId[],
): AiProblem[] {
  const page = doc.pages.find((item) => item.id === pageId)
  if (!page) return [{ code: 'reference', message: `页面 ${pageId} 不存在` }]
  if (selectionIds.length === 0) return [{ code: 'scope', message: '没有选中任何元素' }]
  const allowed = allowedIds(doc, pageId, selectionIds)
  const problems: AiProblem[] = []
  for (const patch of patches) {
    if (patch.pageId !== pageId) {
      problems.push({ code: 'scope', message: `补丁指向页面 ${patch.pageId}，不是当前页 ${pageId}` })
      continue
    }
    const targets: NodeId[] = []
    if (patch.op === 'update') targets.push(patch.id)
    if (patch.op === 'remove') targets.push(patch.node.id)
    if (patch.op === 'move') {
      targets.push(patch.id)
      if (patch.after.parentId) targets.push(patch.after.parentId)
    }
    if (patch.op === 'insert') {
      if (patch.node.parentId) targets.push(patch.node.parentId)
      if (!isContainerType(page.nodes[patch.node.parentId ?? '']?.type ?? '')) {
        problems.push({ code: 'scope', message: `插入点 ${String(patch.node.parentId)} 不是容器` })
        continue
      }
    }
    for (const target of targets) {
      if (!allowed.has(target)) {
        problems.push({ code: 'scope', message: `补丁想改 ${target}，但它不在选区里` })
        break
      }
    }
  }
  return problems
}

export type InstructionResult = { ok: true; doc: Doc; patches: Patch[] } | { ok: false; errors: AiProblem[] }

/**
 * 完整流程：形状收敛 → 范围校验 → 应用。
 * 任何一步失败都返回错误，调用方不写文档（失败不落库）。
 */
export function applyInstruction(
  doc: Doc,
  pageId: PageId,
  raw: unknown,
  selectionIds: readonly NodeId[],
): InstructionResult {
  // 「没选中元素」是最常见的误用，先于形状校验报出来（面板提示更准确）
  if (selectionIds.length === 0) return { ok: false, errors: [{ code: 'scope', message: '没有选中任何元素' }] }
  const { patches, errors } = coercePatches(doc, pageId, raw)
  if (errors.length > 0) return { ok: false, errors }
  if (patches.length === 0) return { ok: false, errors: [{ code: 'shape', message: '没有可执行的补丁' }] }
  const scope = scopeProblems(doc, pageId, patches, selectionIds)
  if (scope.length > 0) return { ok: false, errors: scope }
  return { ok: true, doc: applyPatches(doc, patches), patches }
}
