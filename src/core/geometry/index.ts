/**
 * 自由画布的纯几何：命中测试、移动、8 向缩放、6px 磁吸、框选相交。
 *
 * 全部是无副作用函数 —— 拖拽交互再复杂，最终都落到「给定盒子与增量，算出新盒子」，
 * 这样 90% 的拖拽逻辑可以在没有 DOM、没有浏览器的情况下测完（见 docs/decisions.md）。
 */
import type { Box, SceneNode } from '../schema/types'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** WebBuilder 的磁吸阈值也是 6px —— 手感保持一致 */
export const SNAP_THRESHOLD = 6

/** 缩放可用的最小边长 */
export const MIN_SIZE = 8

export interface Point {
  x: number
  y: number
}

export interface SnapTargets {
  /** 竖直参考线的 x 坐标（左右边缘、水平中心） */
  x: number[]
  /** 水平参考线的 y 坐标（上下边缘、垂直中心） */
  y: number[]
}

export interface SnapGuide {
  axis: 'x' | 'y'
  at: number
}

export interface SnapResult {
  box: Box
  guides: SnapGuide[]
}

export interface ResizeOptions {
  minW?: number
  minH?: number
  keepRatio?: boolean
}

/** 从节点取出盒子：只有 fixed 尺寸才有像素值，其它模式要等布局引擎算（M2） */
export function rectOf(node: SceneNode): Box {
  const { position, size } = node.layout
  return {
    x: position.x,
    y: position.y,
    w: size.w.kind === 'fixed' ? (size.w.value ?? 0) : 0,
    h: size.h.kind === 'fixed' ? (size.h.value ?? 0) : 0,
  }
}

export function moveBy(box: Box, dx: number, dy: number): Box {
  return { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }
}

export function resizeBox(
  box: Box,
  handle: Handle,
  dx: number,
  dy: number,
  options: ResizeOptions = {},
): Box {
  const minW = options.minW ?? MIN_SIZE
  const minH = options.minH ?? MIN_SIZE
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')

  let x = box.x
  let y = box.y
  let w = box.w
  let h = box.h

  if (east) w = box.w + dx
  if (west) {
    w = box.w - dx
    x = box.x + dx
  }
  if (south) h = box.h + dy
  if (north) {
    h = box.h - dy
    y = box.y + dy
  }

  if (options.keepRatio && (east || west) && (north || south) && box.h !== 0 && box.w !== 0) {
    const ratio = box.w / box.h
    const byWidth = Math.abs(w - box.w) / box.w >= Math.abs(h - box.h) / box.h
    if (byWidth) h = w / ratio
    else w = h * ratio
    if (west) x = box.x + box.w - w
    if (north) y = box.y + box.h - h
  }

  if (w < minW) {
    w = minW
    if (west) x = box.x + box.w - w
  }
  if (h < minH) {
    h = minH
    if (north) y = box.y + box.h - h
  }

  return { x, y, w, h }
}

/** 严格相交：只贴边不算选中（框选时贴着边滑过不能误选） */
export function rectsIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of boxes) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.w)
    maxY = Math.max(maxY, box.y + box.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function nearestAlign(edges: readonly number[], lines: readonly number[], threshold: number) {
  let best: { delta: number; at: number; abs: number } | null = null
  for (const line of lines) {
    for (const edge of edges) {
      const delta = line - edge
      const abs = Math.abs(delta)
      if (abs > threshold) continue
      if (!best || abs < best.abs) best = { delta, at: line, abs }
    }
  }
  return best
}

/**
 * 磁吸：盒子的左/中/右（上/中/下）三条边分别与参考线比较，取最近的一条对齐。
 * 返回的参考线用于画对齐提示（用户要看到「为什么突然对齐了」）。
 */
export function applySnap(box: Box, targets: SnapTargets, threshold = SNAP_THRESHOLD): SnapResult {
  const guides: SnapGuide[] = []
  let x = box.x
  let y = box.y

  const xHit = nearestAlign([box.x, box.x + box.w / 2, box.x + box.w], targets.x, threshold)
  if (xHit) {
    x += xHit.delta
    guides.push({ axis: 'x', at: xHit.at })
  }

  const yHit = nearestAlign([box.y, box.y + box.h / 2, box.y + box.h], targets.y, threshold)
  if (yHit) {
    y += yHit.delta
    guides.push({ axis: 'y', at: yHit.at })
  }

  return { box: { ...box, x, y }, guides }
}

export interface HitEntry {
  id: string
  box: Box
  /** 树里越深的越优先命中 */
  depth: number
}

/** 点选：命中的节点里取层级最深的一个，同层级取渲染在上面的（列表靠后的） */
export function topmostHit(entries: readonly HitEntry[], point: Point): string | null {
  let best: HitEntry | null = null
  for (const entry of entries) {
    const inside =
      point.x >= entry.box.x &&
      point.x <= entry.box.x + entry.box.w &&
      point.y >= entry.box.y &&
      point.y <= entry.box.y + entry.box.h
    if (!inside) continue
    if (!best || entry.depth >= best.depth) best = entry
  }
  return best ? best.id : null
}
