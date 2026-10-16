/**
 * 命令式撤销的地基：所有文档变更都表示成补丁（功能文档 §6 E1）。
 *
 * 关键约束：
 * ①`applyPatch` 返回新文档，绝不改动入参 —— store 才能拿「上一份 + 新一份」做判断与回滚；
 * ②补丁必须自包含逆信息（`invertPatch` 不需要原文档），否则 100 步历史要存 100 份文档快照；
 * ③每个补丁应用后，同级 `order` 都必须是 0..n-1 连续 —— 由 `normalizeNodeOrder` 兜底。
 */
import type {
  Doc,
  NodeId,
  NodePatchData,
  Page,
  PageId,
  Patch,
  SceneNode,
} from '../schema/types'
import { canonicalNodes, childrenOf, normalizeNodeOrder } from '../tree'
import type { LayoutSpec, NodeOverride, StyleSpec } from '../schema/types'

function cloneLayout(layout: LayoutSpec): LayoutSpec {
  return {
    ...layout,
    position: { ...layout.position },
    size: { w: { ...layout.size.w }, h: { ...layout.size.h } },
    padding: { ...layout.padding },
    constraints: { ...layout.constraints },
  }
}

function cloneStyle(style: StyleSpec): StyleSpec {
  return { ...style }
}

/**
 * 断点覆盖里的 layout 是 `Partial<LayoutSpec>`（只存差异），
 * 所以这里只克隆「确实存在」的那几块，不能按完整的 LayoutSpec 去取 position/size。
 */
function clonePartialLayout(layout: Partial<LayoutSpec>): Partial<LayoutSpec> {
  return {
    ...layout,
    ...(layout.position ? { position: { ...layout.position } } : {}),
    ...(layout.size ? { size: { w: { ...layout.size.w }, h: { ...layout.size.h } } } : {}),
    ...(layout.padding ? { padding: { ...layout.padding } } : {}),
    ...(layout.constraints ? { constraints: { ...layout.constraints } } : {}),
  }
}

function cloneOverrides(overrides: Record<string, NodeOverride>): Record<string, NodeOverride> {
  const next: Record<string, NodeOverride> = {}
  for (const [key, value] of Object.entries(overrides)) {
    next[key] = {
      ...value,
      ...(value.layout ? { layout: clonePartialLayout(value.layout) } : {}),
      ...(value.style ? { style: { ...value.style } } : {}),
      ...(value.props ? { props: { ...value.props } } : {}),
    }
  }
  return next
}

/** 深拷贝到「改一份不会影响另一份」的深度，但不超过 schema 会出现的层级 */
export function cloneNode(node: SceneNode): SceneNode {
  return {
    ...node,
    layout: cloneLayout(node.layout),
    style: cloneStyle(node.style),
    props: { ...node.props },
    overrides: cloneOverrides(node.overrides),
    meta: { ...node.meta },
  }
}

function applyNodeData(node: SceneNode, data: NodePatchData): SceneNode {
  const next = { ...node }
  if (data.type !== undefined) next.type = data.type
  if (data.layout !== undefined) next.layout = cloneLayout(data.layout)
  if (data.style !== undefined) next.style = cloneStyle(data.style)
  if (data.props !== undefined) next.props = { ...data.props }
  if (data.overrides !== undefined) next.overrides = cloneOverrides(data.overrides)
  if (data.meta !== undefined) next.meta = { ...data.meta }
  return next
}

function findPage(doc: Doc, pageId: PageId): Page | undefined {
  return doc.pages.find((page) => page.id === pageId)
}

function withNodes(doc: Doc, pageId: PageId, nodes: Record<NodeId, SceneNode>): Doc {
  return {
    ...doc,
    pages: doc.pages.map((page) =>
      page.id === pageId ? { ...page, nodes: canonicalNodes(normalizeNodeOrder(nodes)) } : page,
    ),
  }
}

/** 把一个补丁应用到文档上；补丁与文档对不上时原样返回 */
export function applyPatch(doc: Doc, patch: Patch): Doc {
  const page = findPage(doc, patch.pageId)
  if (!page) return doc

  const nodes: Record<NodeId, SceneNode> = { ...page.nodes }

  switch (patch.op) {
    case 'insert': {
      const node = patch.node
      if (nodes[node.id]) return doc
      for (const other of Object.values(nodes)) {
        if (other.parentId === node.parentId && other.order >= node.order) {
          nodes[other.id] = { ...other, order: other.order + 1 }
        }
      }
      nodes[node.id] = cloneNode(node)
      break
    }

    case 'remove': {
      const target = nodes[patch.node.id]
      if (!target) return doc
      delete nodes[target.id]
      for (const other of Object.values(nodes)) {
        if (other.parentId === target.parentId && other.order > target.order) {
          nodes[other.id] = { ...other, order: other.order - 1 }
        }
      }
      break
    }

    case 'update': {
      const target = nodes[patch.id]
      if (!target) return doc
      nodes[patch.id] = applyNodeData(target, patch.after)
      break
    }

    case 'move': {
      const target = nodes[patch.id]
      if (!target) return doc
      const from = target.parentId
      const to = patch.after.parentId

      if (from === to) {
        // 同级重排：先把目标摘出来，再插到目标下标
        const ids = childrenOf(nodes, from)
          .map((node) => node.id)
          .filter((id) => id !== patch.id)
        const at = Math.max(0, Math.min(Math.trunc(patch.after.order), ids.length))
        ids.splice(at, 0, patch.id)
        for (const [index, id] of ids.entries()) nodes[id] = { ...nodes[id], order: index }
      } else {
        nodes[patch.id] = { ...target, parentId: to, order: patch.after.order }
        for (const other of Object.values(nodes)) {
          if (other.parentId === from && other.order > patch.before.order) {
            nodes[other.id] = { ...other, order: other.order - 1 }
          }
        }
        for (const other of Object.values(nodes)) {
          if (other.id !== patch.id && other.parentId === to && other.order >= patch.after.order) {
            nodes[other.id] = { ...other, order: other.order + 1 }
          }
        }
      }
      break
    }
  }

  return withNodes(doc, patch.pageId, nodes)
}

export function applyPatches(doc: Doc, patches: readonly Patch[]): Doc {
  let next = doc
  for (const patch of patches) next = applyPatch(next, patch)
  return next
}

/** 求逆：补丁自带逆信息，不需要原文档 */
export function invertPatch(patch: Patch): Patch {
  switch (patch.op) {
    case 'insert':
      return { op: 'remove', pageId: patch.pageId, node: patch.node }
    case 'remove':
      return { op: 'insert', pageId: patch.pageId, node: patch.node }
    case 'update':
      return { op: 'update', pageId: patch.pageId, id: patch.id, before: patch.after, after: patch.before }
    case 'move':
      return { op: 'move', pageId: patch.pageId, id: patch.id, before: patch.after, after: patch.before }
  }
}

/** 撤销一串补丁：必须倒序求逆（后面的操作先撤） */
export function invertPatches(patches: readonly Patch[]): Patch[] {
  return patches.map(invertPatch).reverse()
}
