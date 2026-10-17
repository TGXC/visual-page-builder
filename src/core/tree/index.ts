import type { NodeId, SceneNode, SceneNodeTree } from '../schema/types'

/** 内部用于按父级分组的哨兵 key（不会与真实节点 id 冲突） */
const ROOT_KEY = '\u0000root'

function groupKey(parentId: NodeId | null): string {
  return parentId === null ? ROOT_KEY : parentId
}

/** 同级子节点，按 order 升序（order 相同按 id 兜底，保证顺序稳定） */
export function childrenOf(nodes: Record<NodeId, SceneNode>, parentId: NodeId | null): SceneNode[] {
  return Object.values(nodes)
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
}

/**
 * 一次性建好「父 → 子」索引（M8 性能：渲染 1000 节点时 `childrenOf` 的
 * 每次全表扫描会退化成 O(n²)，实测 HTML 生成 293ms → 建索引后个位数毫秒）。
 * 顺序与 `childrenOf` 完全一致，调用方可以放心替换。
 */
export function childrenIndex(nodes: Record<NodeId, SceneNode>): Map<NodeId | null, SceneNode[]> {
  const index = new Map<NodeId | null, SceneNode[]>()
  for (const node of Object.values(nodes)) {
    const key = node.parentId
    const bucket = index.get(key)
    if (bucket) bucket.push(node)
    else index.set(key, [node])
  }
  for (const bucket of index.values()) {
    bucket.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
  }
  return index
}

/** 用索引取同级子节点（`childrenIndex` 建一次，多次复用） */
export function childrenFrom(
  index: Map<NodeId | null, SceneNode[]>,
  parentId: NodeId | null,
): SceneNode[] {
  return index.get(parentId) ?? []
}

export function siblingIds(nodes: Record<NodeId, SceneNode>, parentId: NodeId | null): NodeId[] {
  return childrenOf(nodes, parentId).map((node) => node.id)
}

/** 追加到同级末尾时应使用的 order */
export function nextOrder(nodes: Record<NodeId, SceneNode>, parentId: NodeId | null): number {
  const siblings = childrenOf(nodes, parentId)
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((node) => node.order)) + 1
}

/** 前序展开的子孙（不含自己）；带 seen 防环，脏数据也不会死循环 */
export function descendantsOf(nodes: Record<NodeId, SceneNode>, id: NodeId): SceneNode[] {
  const result: SceneNode[] = []
  const seen = new Set<NodeId>([id])
  const walk = (parentId: NodeId): void => {
    for (const child of childrenOf(nodes, parentId)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      result.push(child)
      walk(child.id)
    }
  }
  walk(id)
  return result
}

/** 沿 parentId 上溯；祖先不存在（父链断了）返回 false */
export function isDescendantOf(
  nodes: Record<NodeId, SceneNode>,
  ancestorId: NodeId,
  id: NodeId,
): boolean {
  const seen = new Set<NodeId>()
  let cursor: NodeId | null = nodes[id]?.parentId ?? null
  while (cursor !== null) {
    if (cursor === ancestorId) return true
    if (seen.has(cursor)) return false
    seen.add(cursor)
    cursor = nodes[cursor]?.parentId ?? null
  }
  return false
}

/** 自己 + 全部子孙的 id */
export function subtreeIds(nodes: Record<NodeId, SceneNode>, id: NodeId): NodeId[] {
  return [id, ...descendantsOf(nodes, id).map((node) => node.id)]
}

/**
 * 按 parentId 分组把 order 重排成连续的 0..n-1（稳定排序：先 order 后 id）。
 * 同一逻辑状态必须序列化成同一份 JSON —— 这是补丁往返与撤销能逐字节比对的前提。
 */
export function normalizeNodeOrder(nodes: Record<NodeId, SceneNode>): Record<NodeId, SceneNode> {
  const groups = new Map<string, SceneNode[]>()
  for (const node of Object.values(nodes)) {
    const key = groupKey(node.parentId)
    const list = groups.get(key)
    if (list) list.push(node)
    else groups.set(key, [node])
  }
  const next: Record<NodeId, SceneNode> = { ...nodes }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
    list.forEach((node, index) => {
      next[node.id] = node.order === index ? node : { ...node, order: index }
    })
  }
  return next
}

/**
 * 把 nodes 的**键顺序**规范成树前序（根 → 按 order 的子孙递归 → 剩下的孤儿按 order/id 兜底）。
 *
 * 为什么需要它：补丁往返（应用后按逆序求逆）要求「同一逻辑状态序列化成同一份 JSON」。
 * 对象键顺序由写入顺序决定，而 insert 只会把新键追加到末尾，于是删掉中间节点再撤销后，
 * 键顺序就和最初不同了 —— JSON.stringify 直接比对不上。把键顺序固定成树前序即可根除。
 * 节点对象本身不复制（引用保留），只重建这个 map。
 */
export function canonicalNodes(nodes: Record<NodeId, SceneNode>): Record<NodeId, SceneNode> {
  const ordered: Record<NodeId, SceneNode> = {}
  const seen = new Set<NodeId>()
  const visit = (node: SceneNode): void => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    ordered[node.id] = node
    for (const child of childrenOf(nodes, node.id)) visit(child)
  }

  for (const root of childrenOf(nodes, null)) visit(root)
  // 孤儿（父级不存在或成环而不可达）按 order/id 排到末尾，保证任何输入都能得到同一份 JSON
  const rest = Object.values(nodes)
    .filter((node) => !seen.has(node.id))
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
  for (const node of rest) visit(node)
  return ordered
}

/**
 * 取 parentId === rootId 的子树森林（children 已按 order 升序）。
 * rootId 传 null 时得到「整片森林」——v2 里就是页面唯一的根容器。
 */
export function treeOf(nodes: Record<NodeId, SceneNode>, rootId: NodeId | null = null): SceneNodeTree[] {
  const build = (parentId: NodeId | null): SceneNodeTree[] =>
    childrenOf(nodes, parentId).map((node) => ({ node, children: build(node.id) }))
  return build(rootId)
}

/** 前序展开森林（与 descendantsOf 的区别：包含根节点本身） */
export function flattenTree(forest: SceneNodeTree[]): SceneNode[] {
  const result: SceneNode[] = []
  for (const item of forest) {
    result.push(item.node)
    result.push(...flattenTree(item.children))
  }
  return result
}
