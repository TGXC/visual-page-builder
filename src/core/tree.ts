import type { FieldNode } from './types'

export interface FieldTreeNode {
  field: FieldNode
  children: FieldTreeNode[]
}

/**
 * 同级字段，按 order 升序。
 * 扁平存储的代价就是每次渲染要派生一次，用 computed 缓存即可。
 */
export function childrenOf(fields: FieldNode[], parentId: string | null): FieldNode[] {
  return fields.filter(f => f.parentId === parentId).sort((a, b) => a.order - b.order)
}

/** 同级按当前 order 排出的 id 列表 */
export function siblingIds(fields: FieldNode[], parentId: string | null): string[] {
  return childrenOf(fields, parentId).map(f => f.id)
}

/** 把一组同级字段的 order 重排为 0..n-1，顺序按传入的 id 数组 */
export function orderSiblings(fields: FieldNode[], parentId: string | null, ids: string[]): FieldNode[] {
  const orderById = new Map(ids.map((id, i) => [id, i]))
  return fields.map(f =>
    f.parentId === parentId && orderById.has(f.id) ? { ...f, order: orderById.get(f.id)! } : f)
}

/** 同级末尾的下标，新增字段时直接用 */
export function nextOrder(fields: FieldNode[], parentId: string | null): number {
  return fields.filter(f => f.parentId === parentId).length
}

/**
 * 扁平数组派生树。父级不存在的孤儿字段不挂树（脏数据不至于让画布崩掉），
 * 但也不会被静默删掉——它在 fields 里，只是渲染不出来。
 */
export function buildTree(fields: FieldNode[]): FieldTreeNode[] {
  const nodes = new Map<string, FieldTreeNode>()
  for (const field of fields) nodes.set(field.id, { field, children: [] })

  const roots: FieldTreeNode[] = []
  for (const field of fields) {
    const node = nodes.get(field.id)!
    const parent = field.parentId === null ? undefined : nodes.get(field.parentId)
    if (parent) parent.children.push(node)
    else if (field.parentId === null) roots.push(node)
  }

  const sortDeep = (list: FieldTreeNode[]): void => {
    list.sort((a, b) => a.field.order - b.field.order)
    for (const node of list) sortDeep(node.children)
  }
  sortDeep(roots)

  return roots
}

/**
 * 全部子孙，深度优先且父在子前。
 * 删除分组容器时先算出要一起删掉的字段；自引用不会死循环。
 */
export function descendantsOf(fields: FieldNode[], id: string): FieldNode[] {
  const result: FieldNode[] = []
  const seen = new Set<string>([id])
  const walk = (parentId: string): void => {
    for (const child of childrenOf(fields, parentId)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      result.push(child)
      walk(child.id)
    }
  }
  walk(id)
  return result
}

/** id 是不是 ancestorId 的子孙（跨层级，不含自己） */
export function isDescendantOf(fields: FieldNode[], ancestorId: string, id: string): boolean {
  if (ancestorId === id) return false
  const byId = new Map(fields.map(f => [f.id, f]))
  // 祖先本身不在字段表里（父级已被删掉），链路已经断了
  if (!byId.has(ancestorId)) return false
  const seen = new Set<string>([id])
  let current = byId.get(id)
  while (current && current.parentId !== null) {
    if (current.parentId === ancestorId) return true
    if (seen.has(current.parentId)) return false
    seen.add(current.parentId)
    current = byId.get(current.parentId)
  }
  return false
}

/** 按树的前序展开（父在子前） */
export function flattenTree(nodes: FieldTreeNode[]): FieldNode[] {
  const out: FieldNode[] = []
  const walk = (list: FieldTreeNode[]): void => {
    for (const node of list) {
      out.push(node.field)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * 把扁平数组规范化为「树的前序」摆放。
 * 数组顺序本身不是语义（语义由 parentId + order 决定），但如果不规范化，
 * 同一个逻辑状态会因为操作历史不同而序列化成不同 JSON——撤销后 `JSON.stringify`
 * 比对不上、localStorage 也会反复重写。所以每次改完都归一化一次。
 * 父级已被删掉的孤儿字段排在末尾（order、id 兜底），保证顺序唯一确定。
 */
export function normalizeFieldOrder(fields: FieldNode[]): FieldNode[] {
  const ordered = flattenTree(buildTree(fields))
  const placed = new Set(ordered.map(f => f.id))
  const orphans = fields
    .filter(f => !placed.has(f.id))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [...ordered, ...orphans]
}
