/**
 * M2：拖动时的等距提示。
 *
 * 拖动一个（或一组）节点时，找出同一父容器里、在垂直/水平方向上有重叠的最近邻居，
 * 给出「到左边邻居多远 / 到右边邻居多远」。如果两侧间距相等（阈值内），把两条提示
 * 标成 `equal` —— 画布上高亮，用来对齐等间距排布。
 *
 * 纯逻辑：只吃 nodes / boxes / ids，不碰 DOM 与 store。
 */
import type { Box, NodeId, SceneNode } from '../schema/types'
import { SNAP_THRESHOLD, unionBox } from '../geometry'

/** 太远的邻居不提示：否则一个 1440 宽的页面上到处是距离标 */
export const MAX_HINT_GAP = 400

export interface SpacingHint {
  /** 间距所在的轴：x = 水平邻居，y = 垂直邻居 */
  axis: 'x' | 'y'
  gap: number
  /** 与另一侧的间距相等（等距）→ 界面高亮 */
  equal: boolean
  /** 沿轴方向的线段起止（画线用） */
  from: number
  to: number
  /** 垂直轴上的中点位置与长度（线段贴在两盒的重叠区） */
  cross: number
  crossSize: number
}

export interface SpacingQuery {
  nodes: Record<NodeId, SceneNode>
  boxes: Record<NodeId, Box>
  rootId: NodeId
  ids: NodeId[]
}

interface Side {
  gap: number
  from: number
  to: number
  cross: number
  crossSize: number
}

/** 两段区间在某一轴上的重叠长度（<= 0 视为不重叠） */
function overlapOf(startA: number, sizeA: number, startB: number, sizeB: number): number {
  return Math.min(startA + sizeA, startB + sizeB) - Math.max(startA, startB)
}

export function spacingHints(query: SpacingQuery): SpacingHint[] {
  const { nodes, boxes, rootId, ids } = query
  const dragged = new Set(ids)
  const target = unionBox(ids.map((id) => boxes[id]).filter(Boolean) as Box[])
  const first = nodes[ids[0]]
  if (!target || !first) return []

  const parentId = first.parentId ?? null
  const siblings = Object.values(nodes).filter(
    (node) =>
      node.id !== rootId &&
      !dragged.has(node.id) &&
      !node.meta.hidden &&
      (node.parentId ?? null) === parentId &&
      Boolean(boxes[node.id]),
  )

  // 主轴 = 间距方向，横轴 = 用来判断「算不算邻居」的重叠方向
  const buildSides = (axis: 'x' | 'y'): { before: Side | null; after: Side | null } => {
    const mainStart = axis === 'x' ? target.x : target.y
    const mainSize = axis === 'x' ? target.w : target.h
    const crossStart = axis === 'x' ? target.y : target.x
    const crossSize = axis === 'x' ? target.h : target.w
    const mainEnd = mainStart + mainSize

    let before: Side | null = null
    let after: Side | null = null
    for (const sibling of siblings) {
      const box = boxes[sibling.id]
      const sMainStart = axis === 'x' ? box.x : box.y
      const sMainSize = axis === 'x' ? box.w : box.h
      const sMainEnd = sMainStart + sMainSize
      const sCrossStart = axis === 'x' ? box.y : box.x
      const sCrossSize = axis === 'x' ? box.h : box.w
      const overlap = overlapOf(crossStart, crossSize, sCrossStart, sCrossSize)
      if (overlap <= 0) continue

      const cross = Math.max(crossStart, sCrossStart) + overlap / 2
      if (sMainEnd <= mainStart) {
        const gap = mainStart - sMainEnd
        if (gap > MAX_HINT_GAP) continue
        if (!before || gap < before.gap) before = { gap, from: sMainEnd, to: mainStart, cross, crossSize: overlap }
      } else if (sMainStart >= mainEnd) {
        const gap = sMainStart - mainEnd
        if (gap > MAX_HINT_GAP) continue
        if (!after || gap < after.gap) after = { gap, from: mainEnd, to: sMainStart, cross, crossSize: overlap }
      }
    }
    return { before, after }
  }

  const hints: SpacingHint[] = []
  for (const axis of ['x', 'y'] as const) {
    const { before, after } = buildSides(axis)
    if (!before && !after) continue
    const equal = Boolean(before && after && Math.abs(before.gap - after.gap) <= SNAP_THRESHOLD)
    for (const side of [before, after]) {
      if (side) hints.push({ axis, gap: side.gap, equal, from: side.from, to: side.to, cross: side.cross, crossSize: side.crossSize })
    }
  }
  return hints
}
