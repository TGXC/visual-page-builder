/**
 * 编辑器 store：文档 + 历史 + 选择 + 视图状态的唯一入口。
 *
 * 一条铁律：所有结构变更都必须走 `commit(label, patches, mergeKey?)`，
 * 它负责入历史、应用补丁、清理失效选中、触发防抖自动保存。
 * 组件绝不直接改 `doc`，否则撤销栈立刻就断了。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  Breakpoint,
  Doc,
  LayoutSpec,
  NodeId,
  NodeMeta,
  NodePatchData,
  Page,
  Patch,
  SceneNode,
  StyleSpec,
} from '@/core/schema/types'
import { createDoc, MAX_VIEWPORT, MIN_VIEWPORT } from '@/core/schema/normalize'
import { parseImportedDoc } from '@/core/schema/parse'
import { applyPatches, invertPatches } from '@/core/patch'
import {
  canRedo,
  canUndo,
  commitEntry,
  createHistory,
  historyLabels,
  historyPosition,
  jumpToEntry,
  redoEntry,
  undoEntry,
  type HistoryState,
} from '@/core/history'
import {
  alignPatches,
  createNode,
  duplicatePatches,
  insertPatch,
  removePatches,
  reorderLayerPatch,
  updatePatch,
  type AlignKind,
  type LayerDirection,
} from '@/core/ops'
import { AUTOSAVE_DELAY, loadDoc, saveDoc } from '@/core/persistence'
import { childrenOf, nextOrder } from '@/core/tree'
import { generateHtml, generateResponsiveCss } from '@/core/codegen'
import { computeLayout } from '@/core/layout'
import { reparentPatches } from '@/core/dnd'
import {
  baseBreakpointId,
  breakpointViewport,
  effectiveNodes,
  effectivePage,
  orderedBreakpoints,
  overrideFlags,
  writeOverride,
  type OverrideFlags,
} from '@/core/responsive'
import { createFromTemplate } from '@/core/templates'
import { measureText } from '@/utils/textMeasure'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
export const ZOOM_STEP = 0.25

export const VIEWPORTS: Record<string, { w: number; h: number; label: string }> = {
  desktop: { w: 1440, h: 900, label: '桌面 1440' },
  tablet: { w: 768, h: 1024, label: '平板 768' },
  mobile: { w: 375, h: 812, label: '手机 375' },
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

/**
 * 一次属性编辑。style / props / meta 允许只给差量，store 会与节点现值浅合并；
 * `NodeEdit` 与 `NodePatchData` 的区别就在这里：后者必须是完整值。
 */
export interface NodeEdit {
  type?: SceneNode['type']
  layout?: LayoutSpec
  style?: Partial<StyleSpec>
  props?: Record<string, unknown>
  overrides?: SceneNode['overrides']
  meta?: Partial<NodeMeta>
}

function initialDoc(): Doc {
  return loadDoc() ?? createDoc('我的站点')
}

export const useEditorStore = defineStore('editor', () => {
  const history = ref<HistoryState>(createHistory(initialDoc()))
  const selectedIds = ref<NodeId[]>([])
  const hoveredId = ref<NodeId | null>(null)
  const pointer = ref({ x: 0, y: 0 })
  const zoom = ref(1)
  const breakpointId = ref('desktop')
  const clipboard = ref<SceneNode[]>([])
  const toasts = ref<Toast[]>([])
  const codeTab = ref<'html' | 'css'>('html')
  let toastSeq = 0

  const doc = computed(() => history.value.base)
  const pages = computed(() => doc.value.pages)
  const activePage = computed<Page>(
    () => doc.value.pages.find((page) => page.id === doc.value.activePageId) ?? doc.value.pages[0],
  )
  const nodes = computed(() => activePage.value.nodes)
  const rootId = computed(() => activePage.value.root)
  const topLevel = computed(() => childrenOf(nodes.value, rootId.value))

  // ── 断点（M3）──────────────────────────────────────────────────────────
  /** 启用中的断点，从宽到窄 */
  const breakpoints = computed<Breakpoint[]>(() => orderedBreakpoints(doc.value.breakpoints))
  const baseBreakpoint = computed<Breakpoint | null>(() => breakpoints.value[0] ?? null)
  /** 当前是否在基准（最宽）断点上编辑：只有基准上的编辑才写节点本身 */
  const isBaseBreakpoint = computed(() => baseBreakpointId(doc.value.breakpoints) === breakpointId.value)
  /**
   * 当前断点下的**有效节点**：结构仍来自原节点，样式/属性/布局叠加上继承链上的覆盖。
   * 画布渲染、选择态属性面板、布局引擎都用它，否则「改了手机断点却看不见」。
   */
  const resolvedNodes = computed(() => effectiveNodes(nodes.value, doc.value.breakpoints, breakpointId.value))
  /** 编辑的几何基准：基准断点用原始节点，窄断点用有效节点（从屏幕上看到的位置接着拖） */
  const editNodes = computed(() => (isBaseBreakpoint.value ? nodes.value : resolvedNodes.value))

  const selection = computed(() => selectedIds.value.map((id) => resolvedNodes.value[id]).filter(Boolean) as SceneNode[])
  const primary = computed<SceneNode | null>(() => selection.value[0] ?? null)
  /** 主选中的原生节点（覆盖标记要读它自己的 overrides，有效节点里 overrides 是空的） */
  const primaryRaw = computed<SceneNode | null>(() => {
    const id = selectedIds.value[0]
    return id ? (nodes.value[id] ?? null) : null
  })
  const EMPTY_FLAGS: OverrideFlags = {
    layout: false,
    style: false,
    props: false,
    hidden: false,
    order: false,
    empty: true,
  }
  /** 主选中在**当前断点**上有没有覆盖（属性面板打点/清除按钮用） */
  const activeOverrideFlags = computed<OverrideFlags>(() =>
    primaryRaw.value ? overrideFlags(primaryRaw.value, breakpointId.value) : EMPTY_FLAGS,
  )
  const canUndoNow = computed(() => canUndo(history.value))
  const canRedoNow = computed(() => canRedo(history.value))
  const labels = computed(() => historyLabels(history.value))
  const position = computed(() => historyPosition(history.value))
  const layout = computed(() =>
    computeLayout({
      nodes: resolvedNodes.value,
      rootId: rootId.value,
      viewport: activePage.value.viewport,
      measure: measureText,
    }),
  )
  /** 全页几何（画布与导出共用；free 之外的模式在这里被算成绝对盒） */
  const boxes = computed(() => layout.value.boxes)
  /**
   * 导出用的页面：基准断点的有效节点 + 基准断点的设计宽度。
   * 导出结果不能随「当前预览在哪个断点」变化（见 `docs/decisions.md` D26）。
   */
  const exportPage = computed<Page>(() => {
    const base = baseBreakpoint.value
    if (!base) return activePage.value
    return {
      ...effectivePage(activePage.value, doc.value.breakpoints, base.id),
      viewport: breakpointViewport(base),
    }
  })
  const exportBoxes = computed(() =>
    computeLayout({
      nodes: exportPage.value.nodes,
      rootId: exportPage.value.root,
      viewport: exportPage.value.viewport,
      measure: measureText,
    }).boxes,
  )
  const exportDoc = computed<Doc>(() => ({
    ...doc.value,
    pages: doc.value.pages.map((page) => (page.id === activePage.value.id ? exportPage.value : page)),
  }))
  const generatedHtml = computed(() => generateHtml(exportDoc.value, activePage.value.id, {}, exportBoxes.value))
  const generatedCss = computed(() => generateResponsiveCss(doc.value, activePage.value.id))

  function pushToast(text: string, kind: Toast['kind'] = 'info'): void {
    toastSeq += 1
    const toast: Toast = { id: toastSeq, text, kind }
    toasts.value = [...toasts.value, toast]
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((item) => item.id !== toast.id)
    }, 2600)
  }

  function commit(label: string, patches: Patch[], mergeKey?: string): void {
    if (patches.length === 0) return
    history.value = commitEntry(history.value, { label, patches, mergeKey, at: Date.now() })
    pruneSelection()
  }

  function pruneSelection(): void {
    const alive = selectedIds.value.filter((id) => nodes.value[id])
    if (alive.length !== selectedIds.value.length) selectedIds.value = alive
  }

  // ── 选择 ──────────────────────────────────────────────────────────────
  function select(id: NodeId | null, additive = false): void {
    if (id === null) {
      selectedIds.value = []
      return
    }
    if (!nodes.value[id]) return
    if (!additive) {
      selectedIds.value = [id]
      return
    }
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((item) => item !== id)
      : [...selectedIds.value, id]
  }

  function selectMany(ids: NodeId[]): void {
    selectedIds.value = ids.filter((id) => Boolean(nodes.value[id]))
  }

  function clearSelection(): void {
    selectedIds.value = []
  }

  // ── 结构变更 ──────────────────────────────────────────────────────────
  function insertComponent(
    type: SceneNode['type'],
    options: { parentId?: NodeId | null; position?: { x: number; y: number } } = {},
  ): NodeId {
    const parentId = options.parentId ?? rootId.value
    const position = options.position ?? { x: 40 + (topLevel.value.length % 6) * 24, y: 40 + (topLevel.value.length % 6) * 24 }
    const node = createNode(type, { parentId, order: nextOrder(nodes.value, parentId), position })
    commit(`添加${type}`, [insertPatch(activePage.value.id, node)])
    selectedIds.value = [node.id]
    return node.id
  }

  function removeSelection(): void {
    if (selectedIds.value.length === 0) return
    const patches = removePatches(activePage.value, selectedIds.value)
    if (patches.length === 0) return
    commit(`删除 ${selectedIds.value.length} 个元素`, patches)
  }

  function duplicateSelection(): void {
    if (selectedIds.value.length === 0) return
    const { patches, newIds } = duplicatePatches(activePage.value, selectedIds.value)
    if (patches.length === 0) return
    commit(`复制 ${selectedIds.value.length} 个元素`, patches)
    selectedIds.value = newIds
  }

  /**
   * 布局面板的入口：只改 `layout`。
   * 切到流式排布时**保留** `layout.position` —— 流式只是暂时忽略它，切回 `free` 就还原
   * （PLAN 的 M2 验收：容器切换布局不丢数据）。
   */
  function updateLayout(id: NodeId, patch: Partial<LayoutSpec>, label = '修改布局'): void {
    const node = editNodes.value[id]
    if (!node) return
    const layout: LayoutSpec = { ...node.layout, ...patch }
    writeEdit(id, { layout }, label, `layout:${id}`)
  }

  /**
   * 拖拽换父级：落点由 `dropParentAt` 按布局盒算，位置换算到新容器的内容框，
   * 所以元素在屏幕上不动。详情见 `core/dnd`。
   */
  function reparent(ids: NodeId[], newParentId: NodeId, label = '移到容器'): void {
    if (ids.length === 0) return
    const patches = reparentPatches(activePage.value, boxes.value, ids, newParentId)
    if (patches.length === 0) return
    commit(label, patches)
    selectedIds.value = ids.filter((id) => Boolean(nodes.value[id]))
  }

  /**
   * 面板只发「差异」：style / props / meta 按浅合并落到节点上，
   * 因此改一个字段不会抹掉同一个对象里的其它字段。
   * layout / overrides 视为整体替换（调用方本来就会传完整值）。
   */
  function mergeEdit(node: SceneNode, edit: NodeEdit): NodePatchData {
    const after: NodePatchData = {}
    if (edit.type !== undefined) after.type = edit.type
    if (edit.layout !== undefined) after.layout = edit.layout
    if (edit.style !== undefined) after.style = { ...node.style, ...edit.style }
    if (edit.props !== undefined) after.props = { ...node.props, ...edit.props }
    if (edit.overrides !== undefined) after.overrides = edit.overrides
    if (edit.meta !== undefined) after.meta = { ...node.meta, ...edit.meta }
    return after
  }

  /**
   * 一次编辑的**唯一出口**：
   * - 基准断点：style / props / meta 浅合并落到节点上（改一个字段不抹掉同对象的其它字段）；
   * - 窄断点：只把**与该断点继承值不同**的部分写进 `overrides[断点]`，
   *   改回继承值时覆盖自动消失（导出也就不必写多余规则）。
   * `meta.name` / `meta.locked` 不是断点维度，任何断点下都写回节点本身。
   */
  function writeEdit(id: NodeId, edit: NodeEdit, label: string, mergeKey?: string): void {
    const node = nodes.value[id]
    if (!node) return
    const pageId = activePage.value.id
    if (isBaseBreakpoint.value) {
      const after = mergeEdit(node, edit)
      const before: NodePatchData = {}
      if (after.type !== undefined) before.type = node.type
      if (after.layout !== undefined) before.layout = node.layout
      if (after.style !== undefined) before.style = node.style
      if (after.props !== undefined) before.props = node.props
      if (after.overrides !== undefined) before.overrides = node.overrides
      if (after.meta !== undefined) before.meta = node.meta
      commit(label, [updatePatch(pageId, id, before, after)], mergeKey)
      return
    }
    const patches: Patch[] = []
    const override = writeOverride(node, doc.value.breakpoints, breakpointId.value, {
      layout: edit.layout,
      style: edit.style,
      props: edit.props,
      hidden: edit.meta?.hidden,
    })
    const overrides: SceneNode['overrides'] = { ...node.overrides }
    if (override) overrides[breakpointId.value] = override
    else delete overrides[breakpointId.value]
    if (JSON.stringify(overrides) !== JSON.stringify(node.overrides)) {
      patches.push(updatePatch(pageId, id, { overrides: node.overrides }, { overrides }))
    }
    const globalMeta: Partial<NodeMeta> = {}
    if (edit.meta?.name !== undefined) globalMeta.name = edit.meta.name
    if (edit.meta?.locked !== undefined) globalMeta.locked = edit.meta.locked
    if (Object.keys(globalMeta).length > 0) {
      patches.push(updatePatch(pageId, id, { meta: node.meta }, { meta: { ...node.meta, ...globalMeta } }))
    }
    commit(label, patches, mergeKey)
  }

  function updateNode(id: NodeId, edit: NodeEdit, mergeKey?: string): void {
    writeEdit(id, edit, '修改属性', mergeKey)
  }

  function updateSelection(edit: NodeEdit, label = '修改属性', mergeKey?: string): void {
    for (const id of selectedIds.value) writeEdit(id, edit, label, mergeKey)
  }

  /** 清除选中元素在当前断点上的覆盖（基准断点没有覆盖可清） */
  function clearOverrides(ids: NodeId[] = selectedIds.value): void {
    if (isBaseBreakpoint.value) return
    const pageId = activePage.value.id
    const patches: Patch[] = []
    for (const id of ids) {
      const node = nodes.value[id]
      if (!node || !node.overrides[breakpointId.value]) continue
      const overrides: SceneNode['overrides'] = { ...node.overrides }
      delete overrides[breakpointId.value]
      patches.push(updatePatch(pageId, id, { overrides: node.overrides }, { overrides }))
    }
    commit(`清除 ${breakpointId.value} 覆盖`, patches)
  }

  function moveSelection(dx: number, dy: number, label = '移动元素', mergeKey?: string): void {
    for (const node of selection.value) {
      const next = {
        ...node.layout,
        position: { x: round(node.layout.position.x + dx), y: round(node.layout.position.y + dy) },
      }
      writeEdit(node.id, { layout: next }, label, mergeKey)
    }
  }

  function setPosition(id: NodeId, x: number, y: number, mergeKey?: string): void {
    const node = editNodes.value[id]
    if (!node) return
    const next = { ...node.layout, position: { x: round(x), y: round(y) } }
    writeEdit(id, { layout: next }, '移动元素', mergeKey)
  }

  function setSize(id: NodeId, w: number, h: number, mergeKey?: string): void {
    const node = editNodes.value[id]
    if (!node) return
    const next = {
      ...node.layout,
      size: { w: { ...node.layout.size.w, value: round(w) }, h: { ...node.layout.size.h, value: round(h) } },
    }
    writeEdit(id, { layout: next }, '缩放元素', mergeKey)
  }

  function setBox(id: NodeId, box: { x: number; y: number; w: number; h: number }, label: string, mergeKey?: string): void {
    const node = editNodes.value[id]
    if (!node) return
    const next = {
      ...node.layout,
      position: { x: round(box.x), y: round(box.y) },
      size: { w: { ...node.layout.size.w, value: round(box.w) }, h: { ...node.layout.size.h, value: round(box.h) } },
    }
    writeEdit(id, { layout: next }, label, mergeKey)
  }

  function align(kind: AlignKind): void {
    const patches = alignPatches(activePage.value, selectedIds.value, kind)
    if (patches.length === 0) return
    commit(`对齐 ${kind}`, patches)
  }

  function layer(id: NodeId, direction: LayerDirection): void {
    const patch = reorderLayerPatch(activePage.value, id, direction)
    if (!patch) return
    commit(`图层 ${direction}`, [patch])
  }

  function nudge(dx: number, dy: number): void {
    if (selectedIds.value.length === 0) return
    moveSelection(dx, dy, '方向键微调')
  }

  // ── 剪贴板 ────────────────────────────────────────────────────────────
  function copySelection(): void {
    if (selection.value.length === 0) return
    clipboard.value = selection.value.map((node) => JSON.parse(JSON.stringify(node)) as SceneNode)
    pushToast(`已复制 ${clipboard.value.length} 个元素`)
  }

  function pasteClipboard(): void {
    if (clipboard.value.length === 0) return
    const patches: Patch[] = []
    const newIds: NodeId[] = []
    for (const source of clipboard.value) {
      const node = createNode(source.type, {
        parentId: rootId.value,
        order: nextOrder(nodes.value, rootId.value),
        position: { x: source.layout.position.x + 16, y: source.layout.position.y + 16 },
        props: { ...source.props },
        label: source.meta.name,
      })
      node.style = { ...source.style }
      node.layout = {
        ...node.layout,
        size: { w: { ...source.layout.size.w }, h: { ...source.layout.size.h } },
      }
      patches.push(insertPatch(activePage.value.id, node))
      newIds.push(node.id)
    }
    commit('粘贴', patches)
    selectedIds.value = newIds
  }

  function copyStyleFrom(id: NodeId): void {
    const node = nodes.value[id]
    if (!node) return
    styleClipboard.value = { ...node.style }
    pushToast('已复制样式')
  }

  function pasteStyleToSelection(): void {
    if (!styleClipboard.value) return
    updateSelection({ style: { ...styleClipboard.value } }, '粘贴样式')
  }

  const styleClipboard = ref<StyleSpec | null>(null)

  // ── 页面 ──────────────────────────────────────────────────────────────
  function addPage(name?: string): void {
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    const index = docNext.pages.length + 1
    const id = `page_${index}_${Math.random().toString(36).slice(2, 6)}`
    const rootNode = createNode('frame', { parentId: null, order: 0, size: { w: viewport().w, h: viewport().h } })
    rootNode.id = `root_${id}`
    rootNode.parentId = null
    const page: Page = {
      id,
      name: name ?? `页面 ${index}`,
      path: `/${id}`,
      root: rootNode.id,
      nodes: { [rootNode.id]: rootNode },
      viewport: { w: viewport().w, h: viewport().h },
    }
    docNext.pages = [...docNext.pages, page]
    docNext.activePageId = id
    setDoc(docNext, `新建页面 ${page.name}`)
  }

  function renamePage(id: string, name: string): void {
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    const page = docNext.pages.find((item) => item.id === id)
    if (!page) return
    page.name = name.slice(0, 40) || '未命名页面'
    setDoc(docNext, '重命名页面')
  }

  function removePage(id: string): void {
    if (doc.value.pages.length <= 1) {
      pushToast('至少要保留一个页面', 'error')
      return
    }
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    docNext.pages = docNext.pages.filter((page) => page.id !== id)
    if (docNext.activePageId === id) docNext.activePageId = docNext.pages[0].id
    setDoc(docNext, '删除页面')
    selectedIds.value = []
  }

  function switchPage(id: string): void {
    if (!doc.value.pages.some((page) => page.id === id)) return
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    docNext.activePageId = id
    setDoc(docNext, '切换页面', true)
    selectedIds.value = []
  }

  /** 页面级变更（加页/改视口/换文档）不走补丁，走「整份替换 + 清空历史」 */
  function setDoc(next: Doc, label = '更新文档', keepHistory = false): void {
    if (keepHistory) {
      history.value = { ...history.value, base: next }
      return
    }
    history.value = createHistory(next)
    void label
  }

  function loadTemplate(id: string): boolean {
    const next = createFromTemplate(id)
    if (!next) return false
    setDoc(next, `载入模板 ${id}`)
    selectedIds.value = []
    pushToast(`已载入模板：${id}`)
    return true
  }

  function newProject(): void {
    setDoc(createDoc('我的站点'), '新建项目')
    selectedIds.value = []
    pushToast('已新建空白项目')
  }

  function importText(text: string): boolean {
    const result = parseImportedDoc(text)
    if (!result.ok) {
      pushToast(result.error, 'error')
      return false
    }
    setDoc(result.doc, '导入文档')
    selectedIds.value = []
    pushToast(result.migratedFromV1 ? '已从 WebBuilder v1 迁移' : '已导入 v2 文档')
    return true
  }

  // ── 视图 ──────────────────────────────────────────────────────────────
  function viewport(): { w: number; h: number; label: string } {
    const page = activePage.value
    const preset = VIEWPORTS[breakpointId.value] ?? VIEWPORTS.desktop
    // 页面自己的设计宽度优先：这样「切预设 / 自定义宽度」与导入文档不会互相打架。
    if (page && page.viewport) {
      const label = page.viewport.w !== preset.w ? `自定义 ${page.viewport.w}` : preset.label
      return { w: page.viewport.w, h: page.viewport.h, label }
    }
    return preset
  }

  /**
   * 改写本页的设计宽高。画布宽度、`Page.viewport`、导出产物三者共用这一个来源，
   * 否则「画布显示 1024、导出的 body 却是 1440」这种漂移迟早会出现。
   */
  function applyViewport(w: number, h: number): void {
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    const page = docNext.pages.find((item) => item.id === docNext.activePageId)
    if (!page) return
    page.viewport = { w, h }
    const root = page.nodes[page.root]
    if (root) {
      root.layout = { ...root.layout, size: { w: { kind: 'fixed', value: w }, h: { kind: 'fixed', value: h } } }
    }
    docNext.pages = docNext.pages.map((item) => (item.id === page.id ? page : item))
    history.value = { ...history.value, base: docNext }
  }

  /**
   * 切换编辑断点。画布宽度跟着断点走（视口是「看文档的姿势」，D17），
   * 这一步只改视图状态、不进历史，所以连续切来切去不会淹没撤销栈。
   */
  function setBreakpoint(id: string): void {
    const breakpoint = doc.value.breakpoints.find((item) => item.id === id && item.enabled)
    breakpointId.value = id
    if (!breakpoint) return
    const size = breakpointViewport(breakpoint)
    applyViewport(size.w, size.h)
  }

  /** 自定义视口宽度（B9 的「自定义」通道）：越界夹取，非法输入忽略。 */
  function setViewportWidth(width: number): void {
    if (!Number.isFinite(width)) return
    const w = Math.round(Math.min(MAX_VIEWPORT, Math.max(MIN_VIEWPORT, width)))
    applyViewport(w, viewport().h)
  }

  function setZoom(value: number): void {
    zoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 100) / 100))
  }

  function zoomBy(delta: number): void {
    setZoom(zoom.value + delta)
  }

  function fitZoom(stageWidth: number): void {
    const { w } = viewport()
    if (!stageWidth) return
    setZoom((stageWidth - 64) / w)
  }

  // ── 历史 ──────────────────────────────────────────────────────────────
  function undo(): void {
    history.value = undoEntry(history.value)
    pruneSelection()
  }

  function redo(): void {
    history.value = redoEntry(history.value)
    pruneSelection()
  }

  function jumpTo(index: number): void {
    history.value = jumpToEntry(history.value, index)
    pruneSelection()
  }

  function revertPatches(patches: Patch[]): void {
    if (patches.length === 0) return
    history.value = { ...history.value, base: applyPatches(history.value.base, invertPatches(patches)) }
  }

  /** 供拖拽预览用：不改历史，只算「如果现在放手会变成什么」 */
  function previewPatches(patches: Patch[]): Doc {
    return applyPatches(history.value.base, patches)
  }

  // ── 自动保存 ──────────────────────────────────────────────────────────
  let saveTimer: number | undefined
  watch(
    doc,
    () => {
      if (saveTimer) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        saveDoc(doc.value)
      }, AUTOSAVE_DELAY)
    },
    { deep: true },
  )

  // 选中项失效（被删/被撤销掉）时同步清理
  watch(
    nodes,
    () => {
      pruneSelection()
    },
    { flush: 'sync' },
  )

  return {
    doc,
    pages,
    activePage,
    nodes,
    resolvedNodes,
    rootId,
    topLevel,
    selectedIds,
    selection,
    primary,
    primaryRaw,
    hoveredId,
    pointer,
    zoom,
    breakpointId,
    breakpoints,
    baseBreakpoint,
    isBaseBreakpoint,
    activeOverrideFlags,
    clipboard,
    styleClipboard,
    toasts,
    codeTab,
    labels,
    position,
    canUndo: canUndoNow,
    canRedo: canRedoNow,
    generatedHtml,
    generatedCss,
    layout,
    boxes,
    viewport,
    select,
    selectMany,
    clearSelection,
    insertComponent,
    removeSelection,
    duplicateSelection,
    reparent,
    updateLayout,
    updateNode,
    updateSelection,
    clearOverrides,
    moveSelection,
    setPosition,
    setSize,
    setBox,
    align,
    layer,
    nudge,
    copySelection,
    pasteClipboard,
    copyStyleFrom,
    pasteStyleToSelection,
    addPage,
    renamePage,
    removePage,
    switchPage,
    loadTemplate,
    newProject,
    importText,
    setBreakpoint,
    setViewportWidth,
    setZoom,
    zoomBy,
    fitZoom,
    undo,
    redo,
    jumpTo,
    revertPatches,
    previewPatches,
    pushToast,
    commit,
  }
})

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export type EditorStore = ReturnType<typeof useEditorStore>
