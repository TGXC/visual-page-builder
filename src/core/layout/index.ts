/**
 * M2 布局引擎：把「元素树 + 每个节点的 LayoutSpec」算成一份绝对坐标盒表。
 *
 * 为什么要有这一层：M1 的画布是纯 `free`（每个节点自己的 position/size），
 * 只要出现 `vertical / horizontal / grid` 或 `fill / hug / ratio`，位置就不再由节点自己决定，
 * 而是由**父容器**决定。把这件事做成纯函数（不碰 DOM、不碰 Vue），才能在单测里表驱动覆盖，
 * 也才能让画布、导出、PNG 三条产出共用同一份几何。
 *
 * constraints（h/v）只在 `free` 里生效：它描述的是「父容器变宽变窄时，这个绝对定位的子元素怎么跟着动」。
 * 判定基准是「设计尺寸」（`reference`），当前尺寸是 `viewport`；两者相同就等价于不做换算。
 */
import type { Box, Insets, LayoutSpec, NodeId, SceneNode, SizeSpec } from '@/core/schema/types'

const EMPTY_KIDS: SceneNode[] = []

/**
 * 父级 → 子节点（已按 order 排序）的索引，整棵树只建一次。
 *
 * 「脏数据」也要挂进来，否则它们会从布局里凭空消失：
 * - `parentId` 为 null 但不是根节点；
 * - `parentId` 指向一个不存在的节点。
 * 这两类挂到根上。注意 `parentId` 指向存在节点但形成环的那些**故意不**挂根（它们不可达，
 * 也跟着不参与布局，避免环被强行拉平后尺寸无限增长）。
 */
function buildChildrenIndex(nodes: Record<NodeId, SceneNode>, rootId: NodeId): Map<NodeId, SceneNode[]> {
  const index = new Map<NodeId, SceneNode[]>()
  const rescued: SceneNode[] = []
  for (const node of Object.values(nodes)) {
    if (node.id === rootId) continue
    const parentId = node.parentId
    if (parentId !== null && nodes[parentId]) {
      const bucket = index.get(parentId)
      if (bucket) bucket.push(node)
      else index.set(parentId, [node])
    } else {
      rescued.push(node)
    }
  }
  const byOrder = (a: SceneNode, b: SceneNode): number => a.order - b.order || a.id.localeCompare(b.id)
  for (const bucket of index.values()) bucket.sort(byOrder)
  const rootKids = index.get(rootId) ?? []
  rootKids.push(...rescued.sort(byOrder))
  index.set(rootId, rootKids)
  return index
}

export interface LayoutInput {
  nodes: Record<NodeId, SceneNode>
  rootId: NodeId
  /** 当前画布尺寸；缺省用根节点自己的 fixed 尺寸 */
  viewport?: { w: number; h: number }
  /** 设计基准尺寸：constraints 用它换算边距；缺省等于 viewport（不做换算） */
  reference?: { w: number; h: number }
  /** `hug` 的测量函数（浏览器里接真实字体度量）；返回 undefined 表示这次量不了，退回字符估算并标记 estimated */
  measure?: TextMeasure
}

/** 测量函数：拿不到真实字体度量时必须返回 undefined（jsdom / 无 DOM），不能抛错也不能编一个尺寸 */
export type TextMeasure = (node: SceneNode, available: { w: number }) => { w: number; h: number } | undefined

export interface LayoutResult {
  boxes: Record<NodeId, Box>
  /** 尺寸是估算出来的节点（UI 要提示「真实浏览器里会重新量」） */
  estimated: NodeId[]
  /** 超出父容器内容区的节点 */
  overflow: NodeId[]
}

/** 无测量函数时的兜底：字号 × 字宽比 × 字符数，行高比 1.4 */
const FALLBACK_FONT_SIZE = 14
const CHAR_WIDTH_RATIO = 0.55
const LINE_HEIGHT_RATIO = 1.4
/** 溢出容差：亚像素误差不算溢出 */
const OVERFLOW_EPSILON = 0.5

function roundBox(box: Box): Box {
  return { x: box.x, y: box.y, w: box.w, h: box.h }
}

/** 内容框：父容器的 padding 之内才是子元素的坐标系原点 */
function contentRect(box: Box, padding: Insets): Box {
  const w = Math.max(0, box.w - padding.left - padding.right)
  const h = Math.max(0, box.h - padding.top - padding.bottom)
  return { x: box.x + padding.left, y: box.y + padding.top, w, h }
}

function toBox(rect: Box, position: { x: number; y: number }): Box {
  return {
    x: rect.x + position.x,
    y: rect.y + position.y,
    w: rect.w,
    h: rect.h,
  }
}

/** 文本类的 hug 估算：没有浏览器度量时的保底值 */
export function estimateTextSize(node: SceneNode): { w: number; h: number } {
  const candidates = [node.props.text, node.props.sub, node.props.placeholder]
  if (typeof node.meta.name === 'string') candidates.push(node.meta.name)
  const text = candidates.find((value): value is string => typeof value === 'string' && value !== '')
  if (!text) return { w: 0, h: 0 }
  const fontSize = node.style.fontSize > 0 ? node.style.fontSize : FALLBACK_FONT_SIZE
  const lines = text.split('\n')
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const lineHeight = fontSize * (node.style.lineHeight > 0 ? node.style.lineHeight : LINE_HEIGHT_RATIO)
  const padding = node.layout.padding
  return {
    w: Math.ceil(longest * fontSize * CHAR_WIDTH_RATIO) + padding.left + padding.right,
    h: Math.ceil(lines.length * lineHeight) + padding.top + padding.bottom,
  }
}

/** 同一个 id 在一次遍历里只排一次，环状数据靠它兜底 */
type Seen = Set<NodeId>

function sizeValue(spec: SizeSpec, fallback: number): number {
  if (spec.kind === 'fixed') return Math.max(0, spec.value ?? 0)
  return Math.max(0, fallback)
}

export function computeLayout(input: LayoutInput): LayoutResult {
  const { nodes, rootId } = input
  const root = nodes[rootId]
  if (!root) return { boxes: {}, estimated: [], overflow: [] }

  const rootFixed = root.layout.size
  const fixedW = rootFixed.w.kind === 'fixed' ? (rootFixed.w.value ?? 0) : 0
  const fixedH = rootFixed.h.kind === 'fixed' ? (rootFixed.h.value ?? 0) : 0
  const viewport = input.viewport ?? { w: fixedW, h: fixedH }
  const reference = input.reference ?? viewport
  const needsDesignPass = reference.w !== viewport.w || reference.h !== viewport.h

  const estimated = new Set<NodeId>()
  const overflow = new Set<NodeId>()

  /** 设计尺寸下跑一遍，得到每个节点「作者当时看到的位置」，供 constraints 换算边距 */
  const designBoxes = needsDesignPass ? runPass(reference, undefined) : undefined
  const boxes = runPass(viewport, designBoxes)

  function runPass(current: { w: number; h: number }, design: Record<NodeId, Box> | undefined): Record<NodeId, Box> {
    const out: Record<NodeId, Box> = {}
    const seen: Seen = new Set()
    const rootBox: Box = {
      x: 0,
      y: 0,
      w: Math.max(0, current.w),
      h: Math.max(0, current.h),
    }
    // 子节点索引只在每趟开始时建一次：早期版本每个节点都 childrenOf(nodes, id)，
    // 那是对 1000 个键做一次 Object.values + 排序，整树下来 1000 节点要 950ms（性能判据是 <8ms）。
    const index = buildChildrenIndex(nodes, rootId)
    const subtreeCache = new Map<NodeId, NodeId[]>()
    out[rootId] = rootBox
    seen.add(rootId)
    placeChildren(root, rootBox, out, seen, design ? design[rootId] : undefined, design)
    return out

    function kidsOf(id: NodeId): SceneNode[] {
      return index.get(id) ?? EMPTY_KIDS
    }

    /** 子树 id（不含自己），用于「尺寸变了要重排」时的清理；每趟只算一次 */
    function subtreeOf(id: NodeId): NodeId[] {
      const cached = subtreeCache.get(id)
      if (cached) return cached
      const list: NodeId[] = []
      const stack = kidsOf(id).map((child) => child.id)
      while (stack.length) {
        const nextId = stack.pop() as NodeId
        if (list.includes(nextId)) continue
        list.push(nextId)
        stack.push(...kidsOf(nextId).map((child) => child.id))
      }
      subtreeCache.set(id, list)
      return list
    }

    /** 排一个容器的直接子节点（并递归整棵子树），返回子盒的并集尺寸（相对内容框原点） */
    function placeChildren(
      parent: SceneNode,
      parentBox: Box,
      out: Record<NodeId, Box>,
      seen: Seen,
      designParentBox: Box | undefined,
      design: Record<NodeId, Box> | undefined,
    ): { w: number; h: number } {
      const kids = kidsOf(parent.id)
      if (kids.length === 0) return { w: 0, h: 0 }
      const content = contentRect(parentBox, parent.layout.padding)
      const designContent = designParentBox ? contentRect(designParentBox, parent.layout.padding) : content

      const extents = { w: 0, h: 0 }
      const grow = (box: Box): void => {
        extents.w = Math.max(extents.w, box.x - content.x + box.w)
        extents.h = Math.max(extents.h, box.y - content.y + box.h)
      }

      const emit = (id: NodeId, box: Box): void => {
        out[id] = roundBox(box)
        seen.add(id)
        grow(box)
        checkOverflow(id, box, content)
        const node = nodes[id]
        if (!node) return
        // 没有子节点的 hug 尺寸在摆放阶段已经量好了（measure / estimateTextSize），
        // 这里再按「子节点并集」重算会把它算成 0。
        const grandKids = kidsOf(id)
        if (grandKids.length === 0) return
        // hug 轴要等子节点排完才知道自己多大：先按当前盒排一遍，再按并集修正，必要时重排一次。
        const hugW = node.layout.size.w.kind === 'hug'
        const hugH = node.layout.size.h.kind === 'hug'
        const inner = placeChildren(node, box, out, seen, design ? design[id] : undefined, design)
        if (!hugW && !hugH) return
        const padding = node.layout.padding
        const nextW = hugW ? inner.w + padding.left + padding.right : box.w
        const nextH = hugH ? inner.h + padding.top + padding.bottom : box.h
        if (nextW === box.w && nextH === box.h) return
        const grown: Box = {
          x: box.x,
          y: box.y,
          w: Math.max(0, nextW),
          h: Math.max(0, nextH),
        }
        out[id] = grown
        // 尺寸变了，子节点的 fill/align 结果会跟着变，所以要清掉子树重排。
        for (const descendant of subtreeOf(id)) {
          delete out[descendant]
          seen.delete(descendant)
        }
        seen.add(id)
        out[id] = grown
        placeChildren(node, grown, out, seen, design ? design[id] : undefined, design)
      }

      function checkOverflow(id: NodeId, box: Box, rect: Box): void {
        const outside =
          box.x < rect.x - OVERFLOW_EPSILON ||
          box.y < rect.y - OVERFLOW_EPSILON ||
          box.x + box.w > rect.x + rect.w + OVERFLOW_EPSILON ||
          box.y + box.h > rect.y + rect.h + OVERFLOW_EPSILON
        if (outside) overflow.add(id)
      }

      /** 解析一个节点的自身尺寸；fill 需要父容器的可用尺寸，hug 由调用方后续修正 */
      function resolveSize(node: SceneNode, available: { w: number; h: number }): { w: number; h: number } {
        const { w: sw, h: sh } = node.layout.size
        // 两个轴都是 ratio：以可用宽度为基准，按 w/h 折算高度
        if (sw.kind === 'ratio' && sh.kind === 'ratio') {
          const w = available.w
          return { w, h: ratioOf(sh, w) }
        }
        let w = sw.kind === 'fill' ? available.w : sw.kind === 'ratio' ? 0 : sizeValue(sw, 0)
        let h = sh.kind === 'fill' ? available.h : sh.kind === 'ratio' ? 0 : sizeValue(sh, 0)
        if (sw.kind === 'ratio') w = ratioTimes(sw, h)
        else if (sh.kind === 'ratio') h = ratioOf(sh, w)
        return { w: Math.max(0, w), h: Math.max(0, h) }
      }

      /** ratio 的 value 是 w/h，所以 h 轴要反过来除 */
      function ratioOf(spec: SizeSpec, other: number): number {
        const ratio = ratioValue(spec)
        return other / ratio
      }

      /** 已知高求宽：ratio 是 w/h，所以是乘 */
      function ratioTimes(spec: SizeSpec, other: number): number {
        return other * ratioValue(spec)
      }

      /** ratio 非法（0 / 负数 / 缺省）时按 1 处理 */
      function ratioValue(spec: SizeSpec): number {
        return spec.value && spec.value > 0 ? spec.value : 1
      }

      /** hug 的真实尺寸：叶子靠测量，容器靠子节点并集 */
      function hugSize(node: SceneNode, available: { w: number; h: number }): { w: number; h: number } {
        const kids = kidsOf(node.id)
        if (kids.length === 0) {
          // 测量函数可能「量不了」（jsdom / 无 Canvas），此时必须退回估算，不能把 undefined 当尺寸用
          const measured = input.measure?.(node, { w: available.w })
          if (measured) return measured
          estimated.add(node.id)
          return estimateTextSize(node)
        }
        // 容器：在临时盒里排一遍拿并集（不写进正式结果）
        const scratch: Record<NodeId, Box> = {}
        const probe: Box = { x: 0, y: 0, w: available.w, h: available.h }
        scratch[node.id] = probe
        const inner = placeChildren(node, probe, scratch, new Set(), undefined, undefined)
        return { w: inner.w, h: inner.h }
      }

      /** 交叉轴 align */
      function crossOffset(align: LayoutSpec['align'], free: number): number {
        if (align === 'center') return free / 2
        if (align === 'end') return free
        return 0
      }

      /** free：位置来自节点自己的 position（再按 constraints 锚定），尺寸来自自身 spec */
      function placeFree(child: SceneNode): void {
        const spec = child.layout.size
        const base = resolveSize(child, { w: content.w, h: content.h })
        if (spec.w.kind === 'hug') base.w = hugSize(child, { w: content.w, h: base.h }).w
        if (spec.h.kind === 'hug') base.h = hugSize(child, { w: base.w, h: content.h }).h
        const box = toBox(content, child.layout.position)
        box.w = base.w
        box.h = base.h
        applyConstraints(child, box, content, designContent)
        emit(child.id, box)
      }

      /** constraints：把「设计尺寸下的边距」保留到当前尺寸 */
      function applyConstraints(child: SceneNode, box: Box, cur: Box, designBox: Box): void {
        const { h, v } = child.layout.constraints
        const dw = cur.w - designBox.w
        const dh = cur.h - designBox.h
        const localX = box.x - cur.x
        const localY = box.y - cur.y
        if (h === 'right') box.x = cur.x + localX + dw
        else if (h === 'left-right') box.w = Math.max(0, box.w + dw)
        else if (h === 'center') box.x = cur.x + localX + dw / 2
        else if (h === 'scale') {
          const s = designBox.w === 0 ? 1 : cur.w / designBox.w
          box.x = cur.x + localX * s
          box.w = Math.max(0, box.w * s)
        }
        if (v === 'bottom') box.y = cur.y + localY + dh
        else if (v === 'top-bottom') box.h = Math.max(0, box.h + dh)
        else if (v === 'center') box.y = cur.y + localY + dh / 2
        else if (v === 'scale') {
          const s = designBox.h === 0 ? 1 : cur.h / designBox.h
          box.y = cur.y + localY * s
          box.h = Math.max(0, box.h * s)
        }
      }

      /** 主轴 fill 的节点按 flex-grow 分掉剩余空间 */
      function shareLeftover(ids: NodeId[], leftover: number, sizes: Map<NodeId, number>): void {
        if (ids.length === 0 || leftover <= 0) return
        const each = leftover / ids.length
        for (const id of ids) sizes.set(id, (sizes.get(id) as number) + each)
      }

      const mode = parent.layout.mode
      if (mode === 'free') {
        for (const kid of kids) placeFree(kid)
        return extents
      }

      const main = mode === 'horizontal' ? 'x' : 'y'
      const gap = Math.max(0, parent.layout.gap)

      // 主轴尺寸：fixed/ratio 直接取，hug 先量，fill 先记 0 等后面均分
      const mainSizes = new Map<NodeId, number>()
      const growIds: NodeId[] = []
      const hugContent = new Map<NodeId, { w: number; h: number }>()
      for (const child of kids) {
        const spec = child.layout.size[main === 'x' ? 'w' : 'h']
        if (spec.kind === 'fill') {
          mainSizes.set(child.id, 0)
          growIds.push(child.id)
          continue
        }
        if (spec.kind === 'hug') {
          const measured = hugSize(child, { w: content.w, h: content.h })
          hugContent.set(child.id, measured)
          mainSizes.set(child.id, main === 'x' ? measured.w : measured.h)
          continue
        }
        const resolved = resolveSize(child, { w: content.w, h: content.h })
        mainSizes.set(child.id, main === 'x' ? resolved.w : resolved.h)
      }

      // 分行：水平布局在 wrap 打开时按可用主轴长度折行
      const rows: SceneNode[][] = []
      if (mode === 'horizontal' && parent.layout.wrap) {
        let row: SceneNode[] = []
        let used = 0
        for (const child of kids) {
          const size = mainSizes.get(child.id) as number
          const next = row.length === 0 ? size : used + gap + size
          if (row.length > 0 && next > content.w) {
            rows.push(row)
            row = []
            used = 0
          }
          used = row.length === 0 ? size : used + gap + size
          row.push(child)
        }
        if (row.length) rows.push(row)
      } else {
        rows.push(kids)
      }

      // 主轴富余：vertical/单行 horizontal 用容器主轴长度；折行时逐行分
      if (mode !== 'grid') {
        const containerMain = main === 'x' ? content.w : content.h
        rows.forEach((row, rowIndex) => {
          const isLast = rowIndex === rows.length - 1
          const rowIds = row.filter((child) => growIds.includes(child.id)).map((child) => child.id)
          if (rowIds.length === 0) return
          const used = row.reduce((sum, child) => sum + (mainSizes.get(child.id) as number), 0) + gap * (row.length - 1)
          const free = mode === 'horizontal' && parent.layout.wrap ? content.w - used : containerMain - used
          void isLast
          shareLeftover(rowIds, free, mainSizes)
        })
      }

      const totalMain = Math.max(0, main === 'x' ? content.w : content.h) - 0
      const contentMain = rows.reduce(
        (sum, row) =>
          sum +
          row.reduce((inner, child) => inner + (mainSizes.get(child.id) as number), 0) +
          gap * Math.max(0, row.length - 1),
        0,
      )
      const surplus = totalMain - contentMain
      const justify = parent.layout.justify

      if (mode === 'grid') {
        const columns = Math.max(1, Math.floor(parent.layout.columns) || 1)
        const cellW = Math.max(0, (content.w - gap * (columns - 1)) / columns)
        const rowCount = Math.max(1, Math.ceil(kids.length / columns))
        const rowHeights: number[] = []
        for (let r = 0; r < rowCount; r += 1) {
          const rowKids = kids.filter((_child, index) => Math.floor(index / columns) === r)
          const natural = rowKids.map((child) => {
            const spec = child.layout.size.h
            if (spec.kind === 'fill') return 0
            if (spec.kind === 'hug') return (hugContent.get(child.id) ?? hugSize(child, { w: cellW, h: content.h })).h
            return resolveSize(child, { w: cellW, h: content.h }).h
          })
          rowHeights.push(natural.reduce((max, value) => Math.max(max, value), 0))
        }
        const occupied = rowHeights.reduce((sum, value) => sum + value, 0) + gap * (rowCount - 1)
        const leftoverRows = rowHeights.map((value, index) => (value === 0 ? index : -1)).filter((index) => index >= 0)
        if (occupied < content.h && leftoverRows.length > 0) {
          const each = (content.h - occupied) / leftoverRows.length
          for (const index of leftoverRows) rowHeights[index] = each
        }
        kids.forEach((child, index) => {
          const col = index % columns
          const row = Math.floor(index / columns)
          const specW = child.layout.size.w
          const specH = child.layout.size.h
          const rowHeight = rowHeights[row] ?? 0
          let w = specW.kind === 'fill' ? cellW : resolveSize(child, { w: cellW, h: rowHeight }).w
          if (specW.kind === 'hug') w = (hugContent.get(child.id) ?? hugSize(child, { w: cellW, h: rowHeight })).w
          let h = specH.kind === 'fill' ? rowHeight : resolveSize(child, { w: cellW, h: rowHeight }).h
          if (specH.kind === 'hug') h = (hugContent.get(child.id) ?? hugSize(child, { w: cellW, h: rowHeight })).h
          const cellX = content.x + col * (cellW + gap)
          const cellY = content.y + rowHeights.slice(0, row).reduce((sum, value) => sum + value, 0) + gap * row
          const box: Box = {
            x:
              cellX +
              crossOffset(
                parent.layout.justify === 'end' ? 'end' : parent.layout.justify === 'center' ? 'center' : 'stretch',
                cellW - w,
              ),
            y: cellY + crossOffset(parent.layout.align, rowHeight - h),
            w: Math.min(w, cellW),
            h,
          }
          emit(child.id, box)
        })
        return extents
      }

      // vertical / horizontal：逐行摆放
      let cursor = main === 'x' ? content.x : content.y
      let crossCursor = main === 'x' ? content.y : content.x
      rows.forEach((row, rowIndex) => {
        const rowCross =
          mode === 'horizontal' && parent.layout.wrap
            ? row.reduce((max, child) => {
                const measured = hugContent.get(child.id) ?? resolveSize(child, { w: content.w, h: content.h })
                const spec = child.layout.size.h
                return Math.max(max, spec.kind === 'fill' ? 0 : measured.h)
              }, 0)
            : 0
        const isLastRow = rowIndex === rows.length - 1
        let offset = 0
        if (!(mode === 'horizontal' && parent.layout.wrap) || rows.length === 1) {
          if (justify === 'center') offset = surplus / 2
          else if (justify === 'end') offset = surplus
        }
        let between = gap
        if (justify === 'space-between' && row.length > 1 && surplus > 0 && isLastRow) {
          between = gap + surplus / (row.length - 1)
          offset = 0
        }
        cursor += offset
        row.forEach((child, index) => {
          const node = nodes[child.id]
          if (!node) return
          const mainSize = mainSizes.get(child.id) as number
          const hug = hugContent.get(child.id)
          const resolved = resolveSize(node, { w: content.w, h: content.h })
          let cross = main === 'x' ? resolved.h : resolved.w
          if (hug) cross = main === 'x' ? hug.h : hug.w
          const specCross = node.layout.size[main === 'x' ? 'h' : 'w']
          const crossFree = (main === 'x' ? content.h : content.w) - cross
          if (specCross.kind === 'fill' || parent.layout.align === 'stretch')
            cross = main === 'x' ? content.h : content.w
          if (mode === 'horizontal' && parent.layout.wrap && rowCross > 0 && specCross.kind === 'fill') cross = rowCross
          const alignOffset = crossOffset(parent.layout.align, Math.max(0, crossFree))
          const box: Box =
            main === 'x'
              ? {
                  x: cursor,
                  y: crossCursor + alignOffset,
                  w: mainSize,
                  h: cross,
                }
              : {
                  x: crossCursor + alignOffset,
                  y: cursor,
                  w: cross,
                  h: mainSize,
                }
          emit(child.id, box)
          cursor += mainSize + (index === row.length - 1 ? 0 : between)
        })
        if (mode === 'horizontal' && parent.layout.wrap) {
          crossCursor += (rowCross || 0) + gap
          cursor = content.x
        }
      })

      return extents
    }
  }

  const orderedEstimated = Object.keys(boxes).filter((id) => estimated.has(id))
  const orderedOverflow = Object.keys(boxes).filter((id) => overflow.has(id))
  return { boxes, estimated: orderedEstimated, overflow: orderedOverflow }
}
