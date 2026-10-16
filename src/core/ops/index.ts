/**
 * 高层操作 → 补丁。编辑器里所有结构变更都从这里产出 `Patch`，
 * 这样 store 只管「什么时候提交历史」，而不重复拼补丁逻辑。
 */
import type { MoveTarget, NodeId, NodePatchData, Page, Patch, SceneNode } from '../schema/types'
import { DEFAULT_STYLE, defaultPropsFor, defaultSizeFor, defaultStyleFor } from '../schema/catalog'
import { createId, defaultLayout } from '../schema/normalize'
import { childrenOf, descendantsOf, isDescendantOf, nextOrder, subtreeIds } from '../tree'
import { unionBox } from '../geometry'

export interface CreateNodeInit {
  parentId: NodeId | null
  order: number
  position?: { x: number; y: number }
  size?: { w: number; h: number }
  props?: Record<string, unknown>
  label?: string
}

export function createNode(type: SceneNode['type'], init: CreateNodeInit): SceneNode {
  const size = init.size ?? defaultSizeFor(type)
  const layout = defaultLayout({ w: size.w, h: size.h })
  return {
    id: createId('n'),
    type,
    parentId: init.parentId,
    order: init.order,
    layout: {
      ...layout,
      position: { x: init.position?.x ?? 0, y: init.position?.y ?? 0 },
    },
    style: defaultStyleFor(type) ?? { ...DEFAULT_STYLE },
    props: { ...defaultPropsFor(type), ...init.props },
    overrides: {},
    meta: { name: init.label, hidden: false, locked: false },
  }
}

export function insertPatch(pageId: string, node: SceneNode): Patch {
  return { op: 'insert', pageId, node }
}

export function updatePatch(pageId: string, id: NodeId, before: NodePatchData, after: NodePatchData): Patch {
  return { op: 'update', pageId, id, before, after }
}

export function movePatch(pageId: string, id: NodeId, before: MoveTarget, after: MoveTarget): Patch {
  return { op: 'move', pageId, id, before, after }
}

/** 删除一组节点（连同子孙）：先删子孙再删自己，逆序撤销时顺序才正确 */
export function removePatches(page: Page, ids: NodeId[]): Patch[] {
  const targets = new Set<NodeId>()
  for (const id of ids) {
    if (!page.nodes[id]) continue
    for (const child of subtreeIds(page.nodes, id)) targets.add(child)
  }
  const ordered = [...targets]
    .map((id) => page.nodes[id])
    .sort((a, b) => depthOf(page, b.id) - depthOf(page, a.id))
  return ordered.map((node) => ({ op: 'remove', pageId: page.id, node }))
}

function depthOf(page: Page, id: NodeId): number {
  let depth = 0
  let cursor = page.nodes[id]?.parentId ?? null
  const seen = new Set<NodeId>()
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    depth += 1
    cursor = page.nodes[cursor]?.parentId ?? null
  }
  return depth
}

/** 复制一组节点（含子孙）：新 id、整体偏移、插在原节点之后 */
export function duplicatePatches(page: Page, ids: NodeId[], offset = 16): { patches: Patch[]; newIds: NodeId[] } {
  const patches: Patch[] = []
  const newIds: NodeId[] = []
  const idMap = new Map<NodeId, NodeId>()

  for (const id of ids) {
    const source = page.nodes[id]
    if (!source) continue
    const family = [source, ...descendantsOf(page.nodes, id)]
    for (const node of family) idMap.set(node.id, createId('n'))
  }

  for (const id of ids) {
    const source = page.nodes[id]
    if (!source) continue
    const family = [source, ...descendantsOf(page.nodes, id)]
    const clone = (node: SceneNode, isRoot: boolean): SceneNode => ({
      ...node,
      id: idMap.get(node.id) as NodeId,
      parentId: isRoot ? node.parentId : (idMap.get(node.parentId as NodeId) as NodeId),
      order: isRoot ? node.order + 1 : node.order,
      layout: {
        ...node.layout,
        position: isRoot
          ? { x: node.layout.position.x + offset, y: node.layout.position.y + offset }
          : { ...node.layout.position },
        size: { w: { ...node.layout.size.w }, h: { ...node.layout.size.h } },
        padding: { ...node.layout.padding },
        constraints: { ...node.layout.constraints },
      },
      style: { ...node.style },
      props: { ...node.props },
      overrides: {},
      meta: { ...node.meta },
    })

    // 先插入子孙再插入父节点：父节点插入会把同级 order 后移，子孙不受影响
    const clones = family.map((node) => clone(node, node.id === id))
    for (let index = clones.length - 1; index >= 0; index -= 1) {
      patches.push({ op: 'insert', pageId: page.id, node: clones[index] })
    }
    newIds.push(idMap.get(id) as NodeId)
  }

  return { patches, newIds }
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 以选区包围盒为基准对齐；同时移动父节点与其子孙（被选中的子孙不重复移动） */
export function alignPatches(page: Page, ids: NodeId[], kind: AlignKind): Patch[] {
  const selected = ids.filter((id) => page.nodes[id])
  if (selected.length < 2) return []
  const roots = selected.filter(
    (id) => !selected.some((other) => other !== id && isDescendantOf(page.nodes, other, id)),
  )
  const box = unionBox(roots.map((id) => {
    const node = page.nodes[id]
    const { x, y } = node.layout.position
    return { x, y, w: node.layout.size.w.value ?? 0, h: node.layout.size.h.value ?? 0 }
  }))
  if (!box) return []

  const patches: Patch[] = []
  for (const id of roots) {
    const node = page.nodes[id]
    const { x, y } = node.layout.position
    const w = node.layout.size.w.value ?? 0
    const h = node.layout.size.h.value ?? 0
    let nx = x
    let ny = y
    if (kind === 'left') nx = box.x
    else if (kind === 'hcenter') nx = box.x + (box.w - w) / 2
    else if (kind === 'right') nx = box.x + box.w - w
    else if (kind === 'top') ny = box.y
    else if (kind === 'vcenter') ny = box.y + (box.h - h) / 2
    else if (kind === 'bottom') ny = box.y + box.h - h
    if (nx === x && ny === y) continue
    patches.push(
      updatePatch(
        page.id,
        id,
        { layout: { ...node.layout, position: { x, y } } },
        { layout: { ...node.layout, position: { x: Math.round(nx), y: Math.round(ny) } } },
      ),
    )
  }
  return patches
}

export type LayerDirection = 'up' | 'down' | 'front' | 'back'

/** 上下移层：层级 = 同级 order（数组顺序不再决定层级） */
export function reorderLayerPatch(page: Page, id: NodeId, direction: LayerDirection): Patch | null {
  const node = page.nodes[id]
  if (!node) return null
  const siblings = childrenOf(page.nodes, node.parentId)
  const index = siblings.findIndex((item) => item.id === id)
  if (index < 0) return null

  if (direction === 'front') {
    if (index === siblings.length - 1) return null
    return movePatch(page.id, id, { parentId: node.parentId, order: node.order }, { parentId: node.parentId, order: siblings.length - 1 })
  }
  if (direction === 'back') {
    if (index === 0) return null
    return movePatch(page.id, id, { parentId: node.parentId, order: node.order }, { parentId: node.parentId, order: 0 })
  }
  const target = direction === 'up' ? index + 1 : index - 1
  if (target < 0 || target >= siblings.length) return null
  return movePatch(page.id, id, { parentId: node.parentId, order: node.order }, { parentId: node.parentId, order: target })
}

/** 拖入新组件：落在目标容器末尾 */
export function insertAtEndPatch(page: Page, type: SceneNode['type'], parentId: NodeId | null, position?: { x: number; y: number }): Patch {
  return insertPatch(page.id, createNode(type, { parentId, order: nextOrder(page.nodes, parentId), position }))
}
