import { siblingIds } from '@/core/tree'
import { useSchemaStore } from '@/stores/schema'
import type { FieldNode } from '@/core/types'
// 只借类型：运行时方向是 useDragField → useSortable，不会成环。
import type { DragPayload, DragTarget } from './useDragField'

/**
 * 「视觉插入位 → 补丁里的 order」是拖拽里唯一容易算错的地方，所以单独抽出来测。
 *
 * visualIndex 是在**含拖拽源自身**的元素列表里数出来的插入位，
 * order 是补丁里的目标下标（不含自己）。两者不是同一个数。
 */

/** 同容器内拖拽时，落点在拖拽源之后要多减 1（因为自己会被摘出去）。 */
export function normalizeDropIndex(visualIndex: number, originIndex: number | null): number {
  if (originIndex === null) return visualIndex
  return visualIndex > originIndex ? visualIndex - 1 : visualIndex
}

/** 把视觉插入位换算成 `move`/`insert` 补丁需要的 order，并裁到合法区间。 */
export function visualIndexToOrder(
  fields: FieldNode[],
  parentId: string | null,
  visualIndex: number,
  movingId: string | null,
): number {
  const ids = siblingIds(fields, parentId)
  const originIndex = movingId === null ? -1 : ids.indexOf(movingId)
  const adjusted = normalizeDropIndex(visualIndex, originIndex >= 0 ? originIndex : null)
  const capacity = originIndex >= 0 ? ids.length - 1 : ids.length
  return Math.max(0, Math.min(adjusted, capacity))
}

/**
 * 排序与建立字段的唯一出口：同容器与跨容器走的是同一个补丁，
 * 差别只在 `before.parentId` 与 `after.parentId` 是否相同，这里不特殊处理。
 */
export function useSortable() {
  const store = useSchemaStore()

  function drop(payload: DragPayload, target: DragTarget): void {
    if (payload.fieldId === null) {
      store.addField(payload.type, target.parentId, target.order)
      return
    }
    store.moveField(payload.fieldId, target.parentId, target.order)
  }

  return { drop }
}
