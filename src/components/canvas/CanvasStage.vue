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
import { SNAP_THRESHOLD, applySnap, rectOf, rectsIntersect, resizeBox } from '@/core/geometry'
import { componentLabel, editKeyOf, getComponent } from '@/core/components'
import { dropParentAt } from '@/core/dnd'
import { instanceIdOf } from '@/core/symbols'
import type { SpacingHint } from '@/core/spacing'
import { spacingHints } from '@/core/spacing'
import { isDescendantOf } from '@/core/tree'
import { resolveStyle } from '@/core/theme'
import { useEditorStore } from '@/stores/editor'
import ElementView from './ElementView.vue'

const emit = defineEmits<{ (event: 'context-menu', payload: { x: number; y: number }): void }>()

const store = useEditorStore()
const pageRef = ref<HTMLElement | null>(null)
const editingId = ref<NodeId | null>(null)
/** 本次双击编辑写回哪个 props 字段（默认 text，输入类写 placeholder） */
const editingKey = ref('text')
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
  /**
   * 按下那一刻的缩放比例。整个拖拽期间都用它把「屏幕位移」换算成「设计像素位移」，
   * 而不是每次 pointermove 重新 `getBoundingClientRect()` 再除一遍：
   * 拖动过程中画布容器可能因为滚动条出现/消失、页面居中方式变化而位移或改变宽度，
   * 用实时 rect 换算会让元素相对鼠标「越拖越偏」，缩放比例越大偏得越明显。
   */
  scale: number
  handle: Handle | null
  ids: NodeId[]
  /**
   * 按下那一刻的**绝对**盒（页面坐标系）。拖拽的位移、吸附、包围盒全在绝对空间里算：
   * `layout.position` 是相对父容器内容框的，父容器一换坐标系（窄断点几何、嵌套容器）
   * 就会和屏幕上的位置对不上，这就是「按在组件后半段、一拖却跑到前半段」的来源（ADR D81）。
   */
  boxes: Map<NodeId, Box>
  /** 按下那一刻的**相对**盒：写回 `setBox()` 要的是它，和 `boxes` 只差一个父级原点 */
  rels: Map<NodeId, Box>
  startBox: Box
  active: boolean
}

let interaction: Interaction | null = null
/** 上一次「从面板拖入」的落点：防同一手势的重复 drop 插两个组件 */
let lastDrop: { type: string; at: number; x: number; y: number } | null = null

const root = computed<SceneNode>(() => view.value[store.rootId])
/** 画布一律渲染「当前断点的有效节点」：断点上的覆盖（隐藏/样式/几何）必须看得见 */
const view = computed<Record<NodeId, SceneNode>>(() => store.viewNodes as Record<NodeId, SceneNode>)
const vw = computed(() => store.viewport().w)
const vh = computed(() => store.viewport().h)

/**
 * 页面网格画在缩放层外面、间距按 zoom 换算：这样 25% 时线距是 2px 也不会糊成一团，
 * 主网格每 64 设计像素一条（参考实现只有 8px 单层，1440 宽会有 180 条线，噪声太大）。
 */
const gridStyle = computed(() => {
  const minor = 8 * store.zoom
  const major = 64 * store.zoom
  return {
    backgroundSize: `${minor}px ${minor}px, ${minor}px ${minor}px, ${major}px ${major}px, ${major}px ${major}px`,
  }
})

/**
 * 页面根 frame 的底色画在这一层（ElementView 对根节点摘掉了 bg）：
 * 网格层是 `.canvas-page` 的子元素，页面底色放在容器上，网格才不会被根盖住。
 */
const pageStyle = computed(() => {
  const node: SceneNode | undefined = view.value[store.rootId]
  const style = node ? resolveStyle(node.style, store.doc.theme) : undefined
  const bg = style?.bg ?? ''
  const radius = style?.radius ?? 0
  return {
    width: `${vw.value * store.zoom}px`,
    height: `${vh.value * store.zoom}px`,
    ...(bg ? { background: bg } : {}),
    ...(radius > 0 ? { borderRadius: `${radius}px` } : {}),
  }
})

/** 多选时给一个整体包围框（ElementView 自己只画各自的描边，画不出这个） */
const multiBox = computed<Box | null>(() => {
  if (store.selectedIds.length < 2) return null
  const boxes = store.selectedIds.map((id) => store.boxes[id]).filter((box): box is Box => Boolean(box))
  return boxes.length >= 2 ? unionOf(boxes) : null
})

/**
 * 被点节点到根的链（含自己、不含根）。
 * 层级点选规则：第一次点选最外层分区，再点往里钻，点到底再循环回分区；Alt 直接选被点的那个。
 */
function pathOf(id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const seen = new Set<NodeId>()
  let cursor: NodeId | null = id
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const node: SceneNode | undefined = view.value[cursor]
    if (!node) break
    out.unshift(node.id)
    cursor = node.parentId
  }
  return out.filter((item) => item !== store.rootId)
}

function pickTarget(hitId: NodeId, deep: boolean): NodeId {
  const path = pathOf(hitId)
  if (path.length === 0) return store.rootId
  if (deep) return path[path.length - 1]
  const current = store.primary?.id
  const at = current ? path.indexOf(current) : -1
  if (at >= 0) return path[(at + 1) % path.length]
  return path[0]
}

function localPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = pageRef.value?.getBoundingClientRect()
  const scale = store.zoom
  if (!rect) return { x: 0, y: 0 }
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
}

/**
 * 拖拽过程中的设计坐标：从按下点（`startLocal`）累加屏幕位移 ÷ 按下时的缩放比例。
 * 不用实时 `localPoint()`，这样画布容器中途位移（滚动条出现、居中被挤动）也不会让元素跟着鼠标漂：
 * 元素相对鼠标的位置在整个拖拽期间保持不变。
 */
function dragPoint(active: Interaction, clientX: number, clientY: number): { x: number; y: number } {
  const scale = active.scale || 1
  return {
    x: active.startLocalX + (clientX - active.startClientX) / scale,
    y: active.startLocalY + (clientY - active.startClientY) / scale,
  }
}

/**
 * 磁吸阈值按缩放换算：默认 6 设计像素在 200% 缩放下是 12 屏幕像素，
 * 拖起来会「离得还远就吸住、相对鼠标偏移一下」，改成固定 6 **屏幕**像素。
 */
function snapThreshold(active: Interaction): number {
  return SNAP_THRESHOLD / (active.scale || 1)
}

/** 磁吸参考线：同级节点的六条边 + 画布四条边（全部取绝对盒，和拖拽候选框同一坐标系） */
function snapTargets(ids: NodeId[]): { x: number[]; y: number[] } {
  const x = [0, vw.value / 2, vw.value]
  const y = [0, vh.value / 2, vh.value]
  for (const node of Object.values(view.value)) {
    if (ids.includes(node.id) || node.id === store.rootId) continue
    if (ids.some((id) => isDescendantOf(store.nodes, id, node.id))) continue
    if (node.meta.hidden) continue
    const box = store.boxes[node.id]
    if (!box) continue
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

/**
 * 节点 id → 文档里真实存在的节点：实例展开出来的合成节点归到它的实例身上
 * （选中/拖动/缩放都作用在实例，而不是只存在于渲染层的克隆）。
 */
function docNodeOf(id: NodeId): { id: NodeId; node: SceneNode } | null {
  const direct = store.nodes[id]
  if (direct) return { id, node: direct }
  const owner = instanceIdOf(id)
  const ownerNode = store.nodes[owner]
  return ownerNode ? { id: owner, node: ownerNode } : null
}

/** 指针落在哪个容器里（取最深的那层，排除被拖动的节点及其子孙），拖入分组/换父级都用它 */
function containerAt(point: { x: number; y: number }, exclude: NodeId[] = []): NodeId | null {
  return dropParentAt({
    nodes: view.value,
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
  const layout = view.value[id]?.layout
  if (!box || !layout) return null
  const padding = layout.padding
  const axis: 'x' | 'y' = layout.mode === 'horizontal' ? 'x' : 'y'
  const moving = interaction ? interaction.ids : []
  const originX = box.x + padding.left
  const originY = box.y + padding.top
  let at = axis === 'x' ? originX : originY
  for (const node of Object.values(view.value)) {
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
  const rels = new Map<NodeId, Box>()
  for (const id of ids) {
    // 绝对盒（`store.boxes`）才是屏幕上的位置；窄断点下 `store.nodes` 还是基准断点的几何，
    // 从它起拖会让元素瞬间跳回桌面坐标（ADR D81）
    const box = store.boxes[id]
    const rel = view.value[id]
    if (!box || !rel) continue
    boxes.set(id, box)
    rels.set(id, rectOf(rel))
  }
  const start = localPoint(event.clientX, event.clientY)
  interaction = {
    mode: 'move',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLocalX: start.x,
    startLocalY: start.y,
    scale: store.zoom,
    handle: null,
    ids,
    boxes,
    rels,
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

  /*
   * 阻止浏览器的默认「原生拖拽 / 文字选区」：画布里一旦有文字被选中或被拖成原生 drag，
   * 浏览器会开始 native drag（显示一个跟随鼠标的半透明快照），同时给画布发 pointercancel，
   * 我们的 pointer 拖拽就被掐断——表现为「拖到一半组件不跟手了」「好像多出来一个组件」。
   * 双击改文字用的是独立的 `.canvas-text-editor` 输入框，那里的 pointerdown 不能拦。
   */
  const typing = canClosest ? target.closest('.canvas-text-editor') !== null : false
  if (!typing) {
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
  }

  if (editingId.value) commitTextEdit()

  onStagePointerMove(event)

  if (handleEl && nodeEl) {
    const id = nodeEl.dataset.nodeId as NodeId
    const resolved = docNodeOf(id)
    if (!resolved || resolved.node.meta.locked) return
    const targetId = resolved.id
    const node = resolved.node
    store.select(targetId)
    const start = localPoint(event.clientX, event.clientY)
    const absBox = store.boxes[targetId] ?? rectOf(node)
    const relNode = view.value[targetId]
    interaction = {
      mode: 'resize',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLocalX: start.x,
      startLocalY: start.y,
      scale: store.zoom,
      handle: handleEl.getAttribute('data-handle') as Handle,
      ids: [targetId],
      boxes: new Map([[targetId, absBox]]),
      rels: new Map([[targetId, relNode ? rectOf(relNode) : absBox]]),
      startBox: absBox,
      active: true,
    }
    attach()
    return
  }

  if (nodeEl) {
    const id = nodeEl.dataset.nodeId as NodeId
    const resolved = docNodeOf(id)
    if (!resolved) return
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    // 点根节点等于点空白：根是页面容器，选中它没有可做的事（删它还会把画布删白）
    if (resolved.id === store.rootId) {
      store.clearSelection()
      startMarquee(event)
      return
    }
    const targetId = additive ? resolved.id : pickTarget(resolved.id, event.altKey)
    if (!store.selectedIds.includes(targetId)) store.select(targetId, additive)
    else if (additive) store.select(targetId, true)
    const node = view.value[targetId] ?? resolved.node
    if (node.meta.locked) return
    beginMove(event, node)
    attach()
    return
  }

  // 空白处：清空选中并框选
  store.clearSelection()
  startMarquee(event)
}

/** 空白/根节点上的拖拽 = 框选 */
function startMarquee(event: PointerEvent): void {
  const point = localPoint(event.clientX, event.clientY)
  interaction = {
    mode: 'marquee',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLocalX: point.x,
    startLocalY: point.y,
    scale: store.zoom,
    handle: null,
    ids: [],
    boxes: new Map(),
    rels: new Map(),
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
  // 拖拽几何一律用「按下时的 rect + 按下时的缩放」推算，见 `dragPoint()` 上的注释
  const grabbed = dragPoint(interaction, event.clientX, event.clientY)

  if (interaction.mode === 'marquee') {
    const x = Math.min(interaction.startLocalX, grabbed.x)
    const y = Math.min(interaction.startLocalY, grabbed.y)
    marquee.value = {
      x,
      y,
      w: Math.abs(grabbed.x - interaction.startLocalX),
      h: Math.abs(grabbed.y - interaction.startLocalY),
    }
    return
  }

  if (interaction.mode === 'resize' && interaction.handle) {
    const box = resizeBox(
      interaction.startBox,
      interaction.handle,
      grabbed.x - interaction.startLocalX,
      grabbed.y - interaction.startLocalY,
      { minW: EDGE, minH: EDGE, keepRatio: event.shiftKey && interaction.handle.length === 2 },
    )
    const target = interaction.ids[0]
    const snapped = applySnap(box, snapTargets(interaction.ids), snapThreshold(interaction))
    guides.value = snapped.guides
    // 吸附在绝对空间里算；写回 `setBox()` 要换成相对父容器内容框的坐标
    const startRel = interaction.rels.get(target) ?? interaction.startBox
    store.setBox(
      target,
      {
        x: startRel.x + (snapped.box.x - interaction.startBox.x),
        y: startRel.y + (snapped.box.y - interaction.startBox.y),
        w: snapped.box.w,
        h: snapped.box.h,
      },
      '缩放元素',
      'resize',
    )
    return
  }

  // 移动：先算包围盒的目标位置，吸附后再整体位移
  const candidate: Box = {
    ...interaction.startBox,
    x: interaction.startBox.x + (grabbed.x - interaction.startLocalX),
    y: interaction.startBox.y + (grabbed.y - interaction.startLocalY),
  }
  const snapped = applySnap(candidate, snapTargets(interaction.ids), snapThreshold(interaction))
  guides.value = snapped.guides
  // 落点容器和当前父级不同才算「换父级」：拖到自己容器里仍然是普通移动
  const container = containerAt(grabbed, interaction.ids)
  const sameParent = interaction.ids.every((id) => (store.nodes[id]?.parentId ?? store.rootId) === container)
  dropTarget.value = container && !sameParent ? container : null
  const shiftX = snapped.box.x - interaction.startBox.x
  const shiftY = snapped.box.y - interaction.startBox.y
  for (const id of interaction.ids) {
    const start = interaction.rels.get(id)
    if (!start) continue
    store.setBox(id, { x: start.x + shiftX, y: start.y + shiftY, w: start.w, h: start.h }, '移动元素', 'move')
  }
  // 等距提示：必须在 setBox 之后算，才拿到移动后的盒子
  spacings.value = spacingHints({
    nodes: view.value,
    boxes: store.boxes,
    rootId: store.rootId,
    ids: interaction.ids,
  })
}

function onStagePointerUp(event: PointerEvent): void {
  if (!interaction) return
  if (interaction.mode === 'marquee' && marquee.value) {
    const box = marquee.value
    const hitIds = new Set(
      Object.values(view.value)
        .filter((node) => node.id !== store.rootId && !node.meta.hidden && rectsIntersect(rectOf(node), box))
        .map((node) => node.id),
    )
    // 命中祖先就只选祖先：容器被框住时不要再把它的子元素各选一遍（参考实现是扁平模型，我们是树）
    const hit = [...hitIds].filter((id) => {
      let cursor = view.value[id]?.parentId ?? null
      while (cursor !== null && cursor !== store.rootId) {
        if (hitIds.has(cursor)) return false
        cursor = view.value[cursor]?.parentId ?? null
      }
      return true
    })
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

/**
 * 从组件面板拖进来的落点。
 * 只接受「组件面板给的合法类型」：画布里拖图片/链接/选中文字时，浏览器也会发一次原生 drop，
 * `dataTransfer` 里是 URL 或文字，以前会被当成 `text` 插进来——用户看到的就是「拖动时多出一个组件」。
 */
function onDrop(event: DragEvent): void {
  const raw = event.dataTransfer?.getData('text/plain') ?? ''
  if (!raw || !getComponent(raw)) return
  const point = localPoint(event.clientX, event.clientY)
  const parentId = containerAt(point) ?? store.rootId
  // 同一次拖拽偶尔会连发两个 drop（浏览器 + 我们自己的保险）：500ms 内同类型同落点只插一个
  const now = Date.now()
  if (lastDrop && lastDrop.type === raw && now - lastDrop.at < 500 && Math.hypot(lastDrop.x - point.x, lastDrop.y - point.y) < 8) {
    return
  }
  lastDrop = { type: raw, at: now, x: point.x, y: point.y }
  store.insertComponent(raw as SceneNode['type'], { parentId, position: { x: point.x, y: point.y } })
}

function onStageContextMenu(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const nodeEl = typeof target?.closest === 'function' ? (target.closest('[data-node-id]') as HTMLElement | null) : null
  if (nodeEl) {
    const id = nodeEl.dataset.nodeId as NodeId
    // 命中根 frame 等于右键了页面空白：不把根塞进选区（否则菜单里的「删除」会被置灰换文案，
    // 看着就像没有删除项），已有选区保持不动，用户可以直接删掉之前选中的元素。
    if (id !== store.rootId && !store.selectedIds.includes(id)) store.select(id)
  }
  emit('context-menu', { x: event.clientX, y: event.clientY })
}

function startEdit(id: NodeId): void {
  const node = view.value[id]
  if (!node) return
  editingId.value = id
  // M20：不再只认 text —— 输入框/文本域/数字框的可见文字是 placeholder，
  // 双击改 text 会「能输入但画布上看不见」，所以由描述符的 editKey 决定写哪个字段。
  editingKey.value = editKeyOf(node.type)
  editingValue.value = String(node.props[editingKey.value] ?? '')
  editingSub.value = String(node.props.sub ?? '')
}

function commitTextEdit(): void {
  const id = editingId.value
  if (!id) return
  const node = view.value[id]
  editingId.value = null
  if (!node) return
  const next: Record<string, unknown> = { ...node.props, [editingKey.value]: editingValue.value }
  if (node.type === 'header' || node.type === 'card') next.sub = editingSub.value
  store.updateNode(id, { props: next }, `text:${id}`)
}

const editingBox = computed(() => {
  if (!editingId.value) return null
  const node = view.value[editingId.value]
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
    @dragstart.prevent
    @dragover.prevent
    @drop.prevent="onDrop"
    @contextmenu.prevent="onStageContextMenu"
  >
    <div
      v-if="store.selectionPath.length > 0"
      class="canvas-breadcrumb"
      data-role="selection-path"
      @pointerdown.stop
    >
      <button
        v-for="node in store.selectionPath"
        :key="node.id"
        type="button"
        class="canvas-breadcrumb__chip"
        :class="{ 'is-current': node.id === store.primary?.id }"
        data-role="selection-ancestor"
        :data-ancestor-id="node.id"
        @click="store.select(node.id)"
      >
        {{ node.meta.name || componentLabel(node.type) }}
      </button>
    </div>
    <div
      ref="pageRef"
      class="canvas-page"
      :style="pageStyle"
    >
      <div class="canvas-page__grid" data-role="canvas-grid" :style="gridStyle" />
      <!--
        缩放层：必须从左上角（0 0）缩放。默认的 `50% 50%` 会以中心缩放，
        内容相对 `.canvas-page`（宽高已经是 vw×zoom）整体偏移，表现为
        「缩放后组件/占位文字错位、蓝虚线框与画布不重合」。
      -->
      <div
        class="canvas-page__inner"
        :style="{ width: `${vw}px`, height: `${vh}px`, transform: `scale(${store.zoom})`, transformOrigin: '0 0' }"
      >
        <ElementView :node="root" :nodes="view" :scale="store.zoom" @edit-text="startEdit" />

        <div
          v-if="multiBox"
          class="canvas-multibox"
          data-role="multi-box"
          :style="{ left: `${multiBox.x}px`, top: `${multiBox.y}px`, width: `${multiBox.w}px`, height: `${multiBox.h}px` }"
        >
          <span class="canvas-multibox__label">{{ store.selectedIds.length }} 个元素</span>
        </div>

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
            :placeholder="editingKey === 'placeholder' ? '占位文字' : '文字内容'"
            autofocus
            @keydown.enter.prevent="commitTextEdit"
            @keydown.esc="editingId = null"
            @blur="commitTextEdit"
          >
          <input
            v-if="editingId && (view[editingId]?.type === 'header' || view[editingId]?.type === 'card')"
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
