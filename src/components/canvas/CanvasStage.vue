<script setup lang="ts">
/**
 * 画布舞台：选择、框选、移动、8 向缩放、6px 磁吸、从组件面板拖入、双击改文字、右键菜单。
 *
 * 交互全部走 Pointer Events（PLAN 约束：不引拖拽库）。坐标换算是
 * 「client 坐标 → 画布坐标」一个函数，缩放只影响这一步，其余逻辑与缩放无关。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Box, NodeId, SceneNode } from '@/core/schema/types'
import type { Handle, SnapGuide } from '@/core/geometry'
import { applySnap, rectOf, rectsIntersect, resizeBox } from '@/core/geometry'
import { dropParentAt } from '@/core/dnd'
import type { SpacingHint } from '@/core/spacing'
import { spacingHints } from '@/core/spacing'
import { isDescendantOf } from '@/core/tree'
import { useEditorStore } from '@/stores/editor'
import ElementView from './ElementView.vue'

const emit = defineEmits<{ (event: 'context-menu', payload: { x: number; y: number }): void }>()

const store = useEditorStore()
const pageRef = ref<HTMLElement | null>(null)
const editingId = ref<NodeId | null>(null)
const editingValue = ref('')
const editingSub = ref('')
const marquee = ref<Box | null>(null)
const guides = ref<SnapGuide[]>([])
const dropTarget = ref<NodeId | null>(null)
/** 拖动中的等距提示（core/spacing 算出来的纯数据，这里只负责画） */
const spacings = ref<SpacingHint[]>([])

const DRAG_THRESHOLD = 5
const EDGE = 8

interface Interaction {
  mode: 'move' | 'resize' | 'marquee'
  pointerId: number
  startClientX: number
  startClientY: number
  startLocalX: number
  startLocalY: number
  handle: Handle | null
  ids: NodeId[]
  boxes: Map<NodeId, Box>
  startBox: Box
  active: boolean
}

let interaction: Interaction | null = null

const root = computed<SceneNode>(() => store.nodes[store.rootId])
const vw = computed(() => store.viewport().w)
const vh = computed(() => store.viewport().h)

function localPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = pageRef.value?.getBoundingClientRect()
  const scale = store.zoom
  if (!rect) return { x: 0, y: 0 }
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
}

/** 磁吸参考线：同级节点的六条边 + 画布四条边 */
function snapTargets(ids: NodeId[]): { x: number[]; y: number[] } {
  const x = [0, vw.value / 2, vw.value]
  const y = [0, vh.value / 2, vh.value]
  for (const node of Object.values(store.nodes)) {
    if (ids.includes(node.id) || node.id === store.rootId) continue
    if (ids.some((id) => isDescendantOf(store.nodes, id, node.id))) continue
    if (node.meta.hidden) continue
    const box = rectOf(node)
    x.push(box.x, box.x + box.w / 2, box.x + box.w)
    y.push(box.y, box.y + box.h / 2, box.y + box.h)
  }
  return { x, y }
}

function topLevelSelection(): NodeId[] {
  return store.selectedIds.filter(
    (id) => !store.selectedIds.some((other) => other !== id && isDescendantOf(store.nodes, other, id)),
  )
}

/** 指针落在哪个容器里（取最深的那层，排除被拖动的节点及其子孙），拖入分组/换父级都用它 */
function containerAt(point: { x: number; y: number }, exclude: NodeId[] = []): NodeId | null {
  return dropParentAt({
    nodes: store.nodes,
    boxes: store.boxes,
    rootId: store.rootId,
    point,
    exclude,
  })
}

/**
 * 拖到别的容器上时的插入位指示线：新节点会追加到该容器现有子节点的末尾，
 * 所以线画在「最后一个子节点的外侧 + gap」（flow 布局按主轴方向）。
 */
const dropHint = computed(() => {
  const id = dropTarget.value
  if (!id) return null
  const box = store.boxes[id]
  const layout = store.nodes[id]?.layout
  if (!box || !layout) return null
  const padding = layout.padding
  const axis: 'x' | 'y' = layout.mode === 'horizontal' ? 'x' : 'y'
  const moving = interaction ? interaction.ids : []
  const originX = box.x + padding.left
  const originY = box.y + padding.top
  let at = axis === 'x' ? originX : originY
  for (const node of Object.values(store.nodes)) {
    if (node.parentId !== id || node.meta.hidden || moving.includes(node.id)) continue
    const child = store.boxes[node.id]
    if (!child) continue
    at = Math.max(at, axis === 'x' ? child.x + child.w : child.y + child.h)
  }
  if (at > (axis === 'x' ? originX : originY)) at += layout.gap
  const start = axis === 'x' ? originY : originX
  const length =
    axis === 'x' ? Math.max(0, box.h - padding.top - padding.bottom) : Math.max(0, box.w - padding.left - padding.right)
  return { axis, at, start, length, box }
})

function beginMove(event: PointerEvent, node: SceneNode): void {
  const ids = store.selectedIds.includes(node.id) ? topLevelSelection() : [node.id]
  const boxes = new Map<NodeId, Box>()
  for (const id of ids) {
    const target = store.nodes[id]
    if (target) boxes.set(id, rectOf(target))
  }
  interaction = {
    mode: 'move',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLocalX: localPoint(event.clientX, event.clientY).x,
    startLocalY: localPoint(event.clientX, event.clientY).y,
    handle: null,
    ids,
    boxes,
    startBox: unionOf([...boxes.values()]),
    active: false,
  }
}

function unionOf(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.w))
  const bottom = Math.max(...boxes.map((box) => box.y + box.h))
  return { x, y, w: right - x, h: bottom - y }
}

function onStagePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const target = event.target as HTMLElement | null
  const canClosest = typeof target?.closest === 'function'
  const handleEl = canClosest ? target.closest('[data-handle]') : null
  const nodeEl = canClosest ? (target.closest('[data-node-id]') as HTMLElement | null) : null

  if (editingId.value) commitTextEdit()

  onStagePointerMove(event)

  if (handleEl && nodeEl) {
    const id = nodeEl.dataset.nodeId as NodeId
    const node = store.nodes[id]
    if (!node || node.meta.locked) return
    store.select(id)
    interaction = {
      mode: 'resize',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLocalX: localPoint(event.clientX, event.clientY).x,
      startLocalY: localPoint(event.clientX, event.clientY).y,
      handle: handleEl.getAttribute('data-handle') as Handle,
      ids: [id],
      boxes: new Map([[id, rectOf(node)]]),
      startBox: rectOf(node),
      active: true,
    }
    attach()
    return
  }

  if (nodeEl) {
    const id = nodeEl.dataset.nodeId as NodeId
    const node = store.nodes[id]
    if (!node) return
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    if (!store.selectedIds.includes(id)) store.select(id, additive)
    else if (additive) store.select(id, true)
    if (node.meta.locked) return
    beginMove(event, node)
    attach()
    return
  }

  // 空白处：框选
  store.clearSelection()
  const point = localPoint(event.clientX, event.clientY)
  interaction = {
    mode: 'marquee',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLocalX: point.x,
    startLocalY: point.y,
    handle: null,
    ids: [],
    boxes: new Map(),
    startBox: { x: point.x, y: point.y, w: 0, h: 0 },
    active: false,
  }
  attach()
}

function attach(): void {
  window.addEventListener('pointermove', onStagePointerMove)
  window.addEventListener('pointerup', onStagePointerUp)
  window.addEventListener('pointercancel', onStagePointerUp)
  window.addEventListener('keydown', onKeyDownWhileDragging)
}

function detach(): void {
  window.removeEventListener('pointermove', onStagePointerMove)
  window.removeEventListener('pointerup', onStagePointerUp)
  window.removeEventListener('pointercancel', onStagePointerUp)
  window.removeEventListener('keydown', onKeyDownWhileDragging)
}

function onKeyDownWhileDragging(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !interaction) return
  cancelDrag()
}

function cancelDrag(): void {
  interaction = null
  marquee.value = null
  guides.value = []
  dropTarget.value = null
  spacings.value = []
  detach()
}

function onStagePointerMove(event: PointerEvent): void {
  const point = localPoint(event.clientX, event.clientY)
  store.pointer = point
  // pointermove 也会挂在 window 上（拖拽过程中），window 没有 closest
  const hoverTarget = event.target as HTMLElement | null
  const hovered = typeof hoverTarget?.closest === 'function' ? (hoverTarget.closest('[data-node-id]') as HTMLElement | null) : null
  store.hoveredId = hovered ? (hovered.dataset.nodeId as NodeId) : null

  if (!interaction) return
  const dx = event.clientX - interaction.startClientX
  const dy = event.clientY - interaction.startClientY
  if (!interaction.active && interaction.mode !== 'marquee' && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  interaction.active = true

  if (interaction.mode === 'marquee') {
    const x = Math.min(interaction.startLocalX, point.x)
    const y = Math.min(interaction.startLocalY, point.y)
    marquee.value = { x, y, w: Math.abs(point.x - interaction.startLocalX), h: Math.abs(point.y - interaction.startLocalY) }
    return
  }

  if (interaction.mode === 'resize' && interaction.handle) {
    const box = resizeBox(
      interaction.startBox,
      interaction.handle,
      point.x - interaction.startLocalX,
      point.y - interaction.startLocalY,
      { minW: EDGE, minH: EDGE, keepRatio: event.shiftKey && interaction.handle.length === 2 },
    )
    const target = interaction.ids[0]
    const snapped = applySnap(box, snapTargets(interaction.ids))
    guides.value = snapped.guides
    store.setBox(target, snapped.box, '缩放元素', 'resize')
    return
  }

  // 移动：先算包围盒的目标位置，吸附后再整体位移
  const candidate: Box = {
    ...interaction.startBox,
    x: interaction.startBox.x + (point.x - interaction.startLocalX),
    y: interaction.startBox.y + (point.y - interaction.startLocalY),
  }
  const snapped = applySnap(candidate, snapTargets(interaction.ids))
  guides.value = snapped.guides
  // 落点容器和当前父级不同才算「换父级」：拖到自己容器里仍然是普通移动
  const container = containerAt(point, interaction.ids)
  const sameParent = interaction.ids.every((id) => (store.nodes[id]?.parentId ?? store.rootId) === container)
  dropTarget.value = container && !sameParent ? container : null
  const shiftX = snapped.box.x - interaction.startBox.x
  const shiftY = snapped.box.y - interaction.startBox.y
  for (const id of interaction.ids) {
    const start = interaction.boxes.get(id)
    if (!start) continue
    store.setBox(id, { x: start.x + shiftX, y: start.y + shiftY, w: start.w, h: start.h }, '移动元素', 'move')
  }
  // 等距提示：必须在 setBox 之后算，才拿到移动后的盒子
  spacings.value = spacingHints({
    nodes: store.nodes,
    boxes: store.boxes,
    rootId: store.rootId,
    ids: interaction.ids,
  })
}

function onStagePointerUp(event: PointerEvent): void {
  if (!interaction) return
  if (interaction.mode === 'marquee' && marquee.value) {
    const box = marquee.value
    const hit = Object.values(store.nodes)
      .filter((node) => node.id !== store.rootId && !node.meta.hidden && node.parentId === store.rootId)
      .filter((node) => rectsIntersect(rectOf(node), box))
      .map((node) => node.id)
    if (hit.length > 0) store.selectMany(hit)
  }
  const wasActive = interaction.active
  const dragging = interaction.mode === 'move' ? [...interaction.ids] : []
  const target = dropTarget.value
  interaction = null
  marquee.value = null
  guides.value = []
  dropTarget.value = null
  spacings.value = []
  detach()
  // 换父级：位置由 core/dnd 按布局盒换算到新容器的内容框，元素在屏幕上不动
  if (wasActive && target) store.reparent(dragging, target)
  if (wasActive) store.pushToast('已更新', 'info')
  void event
}

function onDrop(event: DragEvent): void {
  const type = event.dataTransfer?.getData('text/plain') || 'text'
  const point = localPoint(event.clientX, event.clientY)
  const parentId = containerAt(point) ?? store.rootId
  store.insertComponent(type as SceneNode['type'], { parentId, position: { x: point.x, y: point.y } })
}

function onStageContextMenu(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const nodeEl = typeof target?.closest === 'function' ? (target.closest('[data-node-id]') as HTMLElement | null) : null
  if (nodeEl) {
    const id = nodeEl.dataset.nodeId as NodeId
    if (!store.selectedIds.includes(id)) store.select(id)
  }
  emit('context-menu', { x: event.clientX, y: event.clientY })
}

function startEdit(id: NodeId): void {
  const node = store.nodes[id]
  if (!node) return
  editingId.value = id
  editingValue.value = String(node.props.text ?? '')
  editingSub.value = String(node.props.sub ?? '')
}

function commitTextEdit(): void {
  const id = editingId.value
  if (!id) return
  const node = store.nodes[id]
  editingId.value = null
  if (!node) return
  const next: Record<string, unknown> = { ...node.props, text: editingValue.value }
  if (node.type === 'header' || node.type === 'card') next.sub = editingSub.value
  store.updateNode(id, { props: next }, `text:${id}`)
}

const editingBox = computed(() => {
  if (!editingId.value) return null
  const node = store.nodes[editingId.value]
  return node ? rectOf(node) : null
})

onBeforeUnmount(() => {
  detach()
})
</script>

<template>
  <div
    class="canvas-stage"
    @pointerdown="onStagePointerDown"
    @pointermove="onStagePointerMove"
    @dragover.prevent
    @drop.prevent="onDrop"
    @contextmenu.prevent="onStageContextMenu"
  >
    <div
      ref="pageRef"
      class="canvas-page"
      :style="{ width: `${vw * store.zoom}px`, height: `${vh * store.zoom}px` }"
    >
      <div class="canvas-page__inner" :style="{ width: `${vw}px`, height: `${vh}px`, transform: `scale(${store.zoom})` }">
        <ElementView :node="root" :nodes="store.nodes" :scale="store.zoom" @edit-text="startEdit" />

        <span
          v-for="(guide, index) in guides"
          :key="`${guide.axis}-${index}-${guide.at}`"
          class="canvas-guide"
          :class="`canvas-guide--${guide.axis}`"
          :style="guide.axis === 'x' ? { left: `${guide.at}px` } : { top: `${guide.at}px` }"
        />

        <div
          v-if="marquee"
          class="canvas-marquee"
          :style="{ left: `${marquee.x}px`, top: `${marquee.y}px`, width: `${marquee.w}px`, height: `${marquee.h}px` }"
        />

        <div
          v-if="dropHint"
          class="canvas-drop-hint"
          :style="{
            left: `${dropHint.box.x}px`,
            top: `${dropHint.box.y}px`,
            width: `${dropHint.box.w}px`,
            height: `${dropHint.box.h}px`,
          }"
        />
        <span
          v-if="dropHint"
          class="canvas-insert-line"
          :class="`canvas-insert-line--${dropHint.axis}`"
          :style="
            dropHint.axis === 'x'
              ? { left: `${dropHint.at}px`, top: `${dropHint.start}px`, height: `${dropHint.length}px` }
              : { top: `${dropHint.at}px`, left: `${dropHint.start}px`, width: `${dropHint.length}px` }
          "
        />

        <span
          v-for="(hint, index) in spacings"
          :key="`space-${hint.axis}-${index}-${hint.from}`"
          class="canvas-spacing"
          :class="[`canvas-spacing--${hint.axis}`, { 'is-equal': hint.equal }]"
          :data-gap="hint.gap"
          :style="
            hint.axis === 'x'
              ? { left: `${hint.from}px`, width: `${hint.gap}px`, top: `${hint.cross}px` }
              : { top: `${hint.from}px`, height: `${hint.gap}px`, left: `${hint.cross}px` }
          "
        >
          <i class="canvas-spacing__label">{{ hint.gap }}</i>
        </span>

        <div
          v-if="editingBox"
          class="canvas-text-editor"
          :style="{ left: `${editingBox.x}px`, top: `${editingBox.y}px`, width: `${Math.max(160, editingBox.w)}px` }"
        >
          <input
            v-model="editingValue"
            class="canvas-text-editor__input"
            data-role="text-editor"
            autofocus
            @keydown.enter.prevent="commitTextEdit"
            @keydown.esc="editingId = null"
            @blur="commitTextEdit"
          >
          <input
            v-if="editingId && (store.nodes[editingId].type === 'header' || store.nodes[editingId].type === 'card')"
            v-model="editingSub"
            class="canvas-text-editor__input canvas-text-editor__input--sub"
            data-role="sub-editor"
            placeholder="副标题"
            @keydown.enter.prevent="commitTextEdit"
            @keydown.esc="editingId = null"
            @blur="commitTextEdit"
          >
        </div>
      </div>
    </div>
  </div>
</template>
