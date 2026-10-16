/**
 * M2：拖拽换父级。
 *
 * 两条纯逻辑：找落点（几何 → 容器 id）和出补丁（把节点挪进新容器，同时把位置换算过去）。
 *
 * 为什么位置要换算：`layout.position` 是相对**父容器内容框**的坐标。换了父级还留着旧数字，
 * 元素会当场瞬移（而且切回 `free` 时那个数字才是「还原位置」，错一次就永远错）。
 * 所以换父级时按「屏幕盒保持不变」反推新的 position —— 视觉不动，数据也是对的。
 *
 * 判定落点用的是**布局引擎的盒**（`boxes`）：`vertical / grid` 里子节点位置不由自己决定，
 * 拿 `layout.position` 当几何会指到空处。
 */
import type { Box, NodeId, Page, Patch, SceneNode } from '../schema/types'
import { isDescendantOf, subtreeIds } from '../tree'
import { movePatch, updatePatch } from '../ops'
import { isContainerType } from '../components'
import { INSTANCE_TYPE } from '../symbols'

/**
 * 能装下别的节点的类型：问组件注册表（M4 起 `section / container / columns` 等都是容器，
 * 第三方注册的容器类型也一并生效）。
 *
 * 实例例外：它的内容由 master 决定，拖进去的节点下一趟展开就会消失。
 */
export function isContainer(node: SceneNode): boolean {
  return node.type !== INSTANCE_TYPE && isContainerType(node.type)
}

export interface DropQuery {
  nodes: Record<NodeId, SceneNode>
  boxes: Record<NodeId, Box>
  rootId: NodeId
  point: { x: number; y: number }
  /** 正在被拖动的节点：它们自己和子孙都不能当落点（否则会把自己塞进自己里） */
  exclude?: NodeId[]
}

function contains(box: Box, point: { x: number; y: number }): boolean {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h
}

function depthOf(nodes: Record<NodeId, SceneNode>, id: NodeId): number {
  let depth = 0
  let cursor: NodeId | null = nodes[id]?.parentId ?? null
  const guard = new Set<NodeId>([id])
  while (cursor !== null && !guard.has(cursor)) {
    guard.add(cursor)
    depth += 1
    cursor = nodes[cursor]?.parentId ?? null
  }
  return depth
}

/**
 * 指针落在哪个容器里：取**最深**的那个，兜底是页面根；点到画布外返回 null（不换父级）。
 * 被拖动的节点自身、它们的子孙、隐藏容器都不算落点。
 */
export function dropParentAt(query: DropQuery): NodeId | null {
  const { nodes, boxes, rootId, point } = query
  const rootBox = boxes[rootId]
  if (!rootBox || !contains(rootBox, point)) return null

  const blocked = new Set<NodeId>()
  for (const id of query.exclude ?? []) {
    for (const sub of subtreeIds(nodes, id)) blocked.add(sub)
  }

  let best: NodeId = rootId
  let bestDepth = depthOf(nodes, rootId)
  for (const node of Object.values(nodes)) {
    if (node.id === rootId || blocked.has(node.id) || node.meta.hidden) continue
    if (!isContainer(node)) continue
    const box = boxes[node.id]
    if (!box || !contains(box, point)) continue
    const depth = depthOf(nodes, node.id)
    if (depth > bestDepth) {
      best = node.id
      bestDepth = depth
    }
  }
  return best
}

/** 拖动集合里最外层的那些（祖孙同时在集合里时，子节点跟着父节点走，不该单独出补丁） */
function outermost(nodes: Record<NodeId, SceneNode>, ids: NodeId[]): NodeId[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    for (const other of set) {
      if (other !== id && isDescendantOf(nodes, other, id)) return false
    }
    return true
  })
}

function contentOrigin(page: Page, boxes: Record<NodeId, Box>, parentId: NodeId): { x: number; y: number } {
  const box = boxes[parentId]
  const padding = page.nodes[parentId]?.layout.padding
  return {
    x: (box?.x ?? 0) + (padding?.left ?? 0),
    y: (box?.y ?? 0) + (padding?.top ?? 0),
  }
}

/** 屏幕盒 → 指定容器内容框坐标（`layout.position` 该填什么值，元素才停在那儿） */
function localPositionIn(
  page: Page,
  boxes: Record<NodeId, Box>,
  id: NodeId,
  parentId: NodeId,
): { x: number; y: number } | null {
  const box = boxes[id]
  if (!page.nodes[id] || !box || !page.nodes[parentId]) return null
  const origin = contentOrigin(page, boxes, parentId)
  return { x: Math.round(box.x - origin.x), y: Math.round(box.y - origin.y) }
}

/**
 * 屏幕盒 → **当前**父容器内容框坐标。
 * 从流式排布切回 `free`、或把屏幕上看到的位置固化进数据时用它。
 */
export function localPosition(page: Page, boxes: Record<NodeId, Box>, id: NodeId): { x: number; y: number } | null {
  const node = page.nodes[id]
  if (!node) return null
  const parentId = node.parentId && page.nodes[node.parentId] ? node.parentId : page.root
  return localPositionIn(page, boxes, id, parentId)
}

/**
 * 生成「换父级」补丁：每个节点两条（`move` 改父子与顺序，`update` 把 position 换算到新内容框）。
 * 返回空数组表示这次拖拽不该产生任何变更（已经在里面了 / 会成环 / 数据不存在）。
 */
export function reparentPatches(
  page: Page,
  boxes: Record<NodeId, Box>,
  ids: NodeId[],
  newParentId: NodeId,
): Patch[] {
  if (!page.nodes[newParentId]) return []
  const patches: Patch[] = []
  let order = siblingsMaxOrder(page, newParentId) + 1

  for (const id of outermost(page.nodes, ids)) {
    const node = page.nodes[id]
    if (!node || node.id === newParentId) continue
    if (node.parentId === newParentId) continue
    // 移进自己的子孙会成环
    if (isDescendantOf(page.nodes, id, newParentId)) continue
    const position = localPositionIn(page, boxes, id, newParentId)
    if (!position) continue

    patches.push(
      movePatch(page.id, id, { parentId: node.parentId, order: node.order }, { parentId: newParentId, order }),
      updatePatch(page.id, id, { layout: node.layout }, { layout: { ...node.layout, position } }),
    )
    order += 1
  }
  return patches
}

function siblingsMaxOrder(page: Page, parentId: NodeId): number {
  let max = -1
  for (const node of Object.values(page.nodes)) {
    if (node.parentId === parentId && node.order > max) max = node.order
  }
  return max
}
