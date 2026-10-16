import { computed, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { FieldNode, FieldType } from '@/core/types'
import { visualIndexToOrder } from './useSortable'

/** 超过这个位移才算拖拽，否则视为「点了一下选中」。 */
export const DRAG_THRESHOLD = 5
/** 距画布上下边缘多少像素内开始自动滚动。 */
export const EDGE_SCROLL_ZONE = 40
/** 每次 pointermove 的自动滚动步长（不做 rAF 循环，简单且在测试里可确定）。 */
export const EDGE_SCROLL_STEP = 8

export interface Point {
  x: number
  y: number
}

export interface PointerLike {
  clientX: number
  clientY: number
}

/** 只要求实现用得到的那部分 DOM 接口，测试里就能用普通对象当替身。 */
export interface RectSource {
  getBoundingClientRect(): DOMRect
}

export interface CanvasLike extends RectSource {
  scrollLeft: number
  scrollTop: number
}

export interface DragTarget {
  parentId: string | null
  order: number
}

export interface DragPayload {
  /** null 表示「从组件面板拖入的新字段」 */
  fieldId: string | null
  type: FieldType
  parentId: string | null
  order: number | null
}

export interface DragStartInput {
  pointerId: number
  clientX: number
  clientY: number
  fieldId: string | null
  type: FieldType
  parentId: string | null
  order?: number | null
  label?: string
}

export interface DragState {
  fieldId: string | null
  type: FieldType
  label: string
  parentId: string | null
  originOrder: number | null
  pointerId: number
  startX: number
  startY: number
  clientX: number
  clientY: number
  /** 位移是否已过阈值：没过阈值的按下只用于选中，不会改 schema */
  active: boolean
  target: DragTarget | null
  /** 落点在元素列表里的插入位，给落点指示线用 */
  visualIndex: number | null
}

export interface DragGhost {
  label: string
  x: number
  y: number
}

export interface UseDragFieldOptions {
  /** 画布容器：提供滚动容器与坐标原点 */
  canvas?: () => HTMLElement | null | undefined
  /** 画布缩放倍率（M3 固定 1，接口先留出来） */
  scale?: number | Ref<number>
  /** 同级字段的来源：拖拽本身不认识 store，只认这个回调 */
  fields?: () => FieldNode[]
  onDrop?: (payload: DragPayload, target: DragTarget) => void
  onCancel?: () => void
}

export interface UseDragFieldApi {
  drag: Ref<DragState | null>
  ghost: Ref<DragGhost | null>
  isDragging: ComputedRef<boolean>
  startDrag: (input: DragStartInput) => void
  cancelDrag: () => void
}

/** 指针位置 → 画布坐标系（画布可能有 transform: scale，所以要除以缩放）。 */
export function toCanvasPoint(point: PointerLike, canvas: CanvasLike, scale = 1): Point {
  const rect = canvas.getBoundingClientRect()
  const ratio = scale > 0 ? scale : 1
  return {
    x: (point.clientX - rect.left + canvas.scrollLeft) / ratio,
    y: (point.clientY - rect.top + canvas.scrollTop) / ratio,
  }
}

/** 指针纵坐标落在第几个插入位：逐个数中点，第一个中点在其下方的就是答案。 */
export function findDropIndex(pointerY: number, elements: Iterable<RectSource>): number {
  let index = 0
  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    if (pointerY < rect.top + rect.height / 2) return index
    index += 1
  }
  return index
}

/** 靠近上下边缘时返回滚动步长（带符号），中间返回 0。 */
export function edgeScrollDelta(
  pointerY: number,
  scroller: RectSource,
  zone = EDGE_SCROLL_ZONE,
  step = EDGE_SCROLL_STEP,
): number {
  const rect = scroller.getBoundingClientRect()
  if (pointerY < rect.top + zone) return -step
  if (pointerY > rect.bottom - zone) return step
  return 0
}

/**
 * 拖拽的完整生命周期只做三件事：
 * 1. 按下后先待命，位移过 5px 才进入拖拽（所以选中与拖拽能共存）；
 * 2. 拖动过程**不碰 schema**，只在放手时提交一个补丁（因此不需要逆补丁）；
 * 3. Escape 直接清空本地状态取消，天然安全。
 */
export function useDragField(options: UseDragFieldOptions = {}): UseDragFieldApi {
  const drag = ref<DragState | null>(null)
  const ghost = ref<DragGhost | null>(null)

  function scaleValue(): number {
    const scale = options.scale
    if (scale === undefined) return 1
    const raw = typeof scale === 'number' ? scale : scale.value
    return raw > 0 ? raw : 1
  }

  function canvasElement(): HTMLElement | null {
    return options.canvas?.() ?? null
  }

  /** 只取同一个父级下的字段元素：跨层级拖拽时不会把子字段算进插入位。 */
  function fieldElements(parentId: string | null): HTMLElement[] {
    const canvas = canvasElement()
    if (!canvas) return []
    const key = parentId ?? ''
    return Array.from(canvas.querySelectorAll<HTMLElement>('.fb-field')).filter(
      element => (element.dataset.parentId ?? '') === key,
    )
  }

  function autoScroll(clientY: number): void {
    const canvas = canvasElement()
    if (!canvas) return
    canvas.scrollTop += edgeScrollDelta(clientY, canvas)
  }

  function updateGhost(state: DragState): void {
    const canvas = canvasElement()
    if (!canvas) {
      ghost.value = { label: state.label, x: state.clientX, y: state.clientY }
      return
    }
    const point = toCanvasPoint(state, canvas, scaleValue())
    ghost.value = { label: state.label, x: point.x + 12, y: point.y + 8 }
  }

  function measure(state: DragState, clientY: number): { target: DragTarget; visualIndex: number } | null {
    const fields = options.fields?.()
    if (!fields) return null
    const visualIndex = findDropIndex(clientY, fieldElements(state.parentId))
    const order = visualIndexToOrder(fields, state.parentId, visualIndex, state.fieldId)
    return { target: { parentId: state.parentId, order }, visualIndex }
  }

  function onPointerMove(event: PointerEvent): void {
    const state = drag.value
    if (!state || event.pointerId !== state.pointerId) return

    state.clientX = event.clientX
    state.clientY = event.clientY

    if (!state.active) {
      const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
      if (moved < DRAG_THRESHOLD) return
      state.active = true
    }

    autoScroll(event.clientY)
    const measured = measure(state, event.clientY)
    state.target = measured?.target ?? null
    state.visualIndex = measured?.visualIndex ?? null
    updateGhost(state)
  }

  function onPointerUp(event: PointerEvent): void {
    const state = drag.value
    if (!state || event.pointerId !== state.pointerId) return

    const active = state.active
    const target = state.target
    const payload: DragPayload = {
      fieldId: state.fieldId,
      type: state.type,
      parentId: state.parentId,
      order: state.originOrder,
    }

    reset()

    if (active && target) options.onDrop?.(payload, target)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    if (!drag.value?.active) return
    event.preventDefault()
    cancelDrag()
    options.onCancel?.()
  }

  /** 窗口失焦时收不到 pointerup，不主动收尾就会留下一个卡住的拖拽状态。 */
  function onWindowBlur(): void {
    if (!drag.value) return
    cancelDrag()
    options.onCancel?.()
  }

  function attach(): void {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
  }

  function detach(): void {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', onWindowBlur)
  }

  function reset(): void {
    detach()
    drag.value = null
    ghost.value = null
  }

  function startDrag(input: DragStartInput): void {
    if (drag.value) return
    drag.value = {
      fieldId: input.fieldId,
      type: input.type,
      label: input.label ?? '',
      parentId: input.parentId,
      originOrder: input.order ?? null,
      pointerId: input.pointerId,
      startX: input.clientX,
      startY: input.clientY,
      clientX: input.clientX,
      clientY: input.clientY,
      active: false,
      target: null,
      visualIndex: null,
    }
    attach()
  }

  function cancelDrag(): void {
    reset()
  }

  const isDragging = computed(() => drag.value?.active ?? false)

  onUnmounted(reset)

  return { drag, ghost, isDragging, startDrag, cancelDrag }
}
