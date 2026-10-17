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
  SymbolDef,
  SymbolId,
} from '@/core/schema/types'
import { createDoc, MAX_VIEWPORT, MIN_VIEWPORT } from '@/core/schema/normalize'
import { parseImportedDoc } from '@/core/schema/parse'
import { applyPatches, cloneNode, invertPatches } from '@/core/patch'
import {
  canRedo,
  canUndo,
  commitDocEntry,
  commitEntry,
  createHistory,
  historyLabels,
  historyPosition,
  jumpToEntry,
  redoEntry,
  undoEntry,
  type HistoryState,
} from '@/core/history'
import { auditDoc, fixAll, type Issue } from '@/core/assistant'
import { createAiService, type AiCallLogEntry, type AiOutcome } from '@/ai'
import {
  componentCandidates,
  describeCandidate,
  registerCandidate,
  type ComponentCandidate,
} from '@/ai/component'
import { materialCandidates, materialPatch, type MaterialCandidate } from '@/ai/material'
import { createMockProvider } from '@/ai/mock'
import { OFFLINE_HINT, PROVIDER_FALLBACK_HINT, isOffline, shouldFallback } from '@/ai/offline'
import { createOpenAIProvider } from '@/ai/openai'
import { loadAiSettings, saveAiSettings, type AiSettings } from '@/ai/settings'
import { textCandidates, textPatch, type TextCandidate, type TextTone } from '@/ai/text'
import type { AiProblem, AiProvider } from '@/ai/types'
import type { UsageSummary } from '@/ai/usage'
import { listComponents, registerComponent, subscribeRegistry } from '@/core/components'
import { compileDsl } from '@/core/dsl'
import { loadCustomDsl } from '@/core/persistence/custom'
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
import { childrenOf, isDescendantOf, nextOrder } from '@/core/tree'
import { generateCss, generateHtml, generateVueSfc } from '@/core/codegen'
import { buildSite, type SiteFile } from '@/core/site'
import { computeLayout } from '@/core/layout'
import { reparentPatches } from '@/core/dnd'
import {
  INSTANCE_TYPE,
  captureSymbol,
  expandInstances,
  instanceIdOf,
  instancesOf,
  isSyntheticId,
} from '@/core/symbols'
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
import { createFromTemplate, pageFromTemplate } from '@/core/templates'
import {
  missingTokenRefs,
  removeToken,
  setToken,
  themeTokenEntries,
  type ThemeTokenEntry,
} from '@/core/theme'
import {
  clearVersions,
  loadVersions,
  removeVersion,
  restoreVersion,
  saveVersion,
  versionSummaryOf,
  type VersionEntry,
} from '@/core/versions'
import { decodeDoc, encodeDoc, shareUrl } from '@/core/share'
import { measureText } from '@/utils/textMeasure'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
export const ZOOM_STEP = 0.25

export const VIEWPORTS: Record<string, { w: number; h: number; label: string }> = {
  desktop: { w: 1440, h: 900, label: '桌面' },
  tablet: { w: 768, h: 1024, label: '平板' },
  mobile: { w: 375, h: 812, label: '手机' },
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
  const codeTab = ref<'html' | 'css' | 'vue'>('html')
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
  /**
   * 渲染/布局用的节点表：断点有效值之后再展开组件实例（`instance` → master 子树克隆）。
   * 合成 id 形如 `${实例id}~${masterId}`，只存在于这一层；文档里存的仍是实例节点本身。
   */
  const viewNodes = computed(() =>
    expandInstances({ ...activePage.value, nodes: resolvedNodes.value }, doc.value),
  )
  /** 编辑的几何基准：基准断点用原始节点，窄断点用有效节点（从屏幕上看到的位置接着拖） */
  const editNodes = computed(() => (isBaseBreakpoint.value ? nodes.value : resolvedNodes.value))

  const selection = computed(() => selectedIds.value.map((id) => resolvedNodes.value[id]).filter(Boolean) as SceneNode[])
  const primary = computed<SceneNode | null>(() => selection.value[0] ?? null)
  /**
   * 主选中的祖先链（从根的下级开始、含自己）——画布左上角的面包屑用。
   * 层级点选与 Esc 选父级也靠它，免得用户在深层容器里点不出来。
   */
  const selectionPath = computed<SceneNode[]>(() => {
    const start = selectedIds.value[0]
    if (!start) return []
    const out: SceneNode[] = []
    const seen = new Set<NodeId>()
    let cursor: NodeId | null = start
    while (cursor !== null && cursor !== rootId.value && !seen.has(cursor)) {
      seen.add(cursor)
      const node: SceneNode | undefined = nodes.value[cursor]
      if (!node) break
      out.unshift(node)
      cursor = node.parentId
    }
    return out
  })
  /**
   * 选区里是否至少有一个「删得掉」的元素（排除页面根容器与锁定元素）。
   * 删除按钮 / 右键删除项都按它置灰，避免点了没反应还以为功能坏了。
   */
  const canRemoveSelection = computed(() =>
    selectedIds.value.some((id) => {
      // TS7022：annotate，避免 computed 回调内自我引用推断成 any
      const node: SceneNode | undefined = nodes.value[id]
      return Boolean(node) && id !== rootId.value && !node.meta.locked
    }),
  )
  /** 画布上还有没有元素（工具栏「清空」按钮据此置灰） */
  const canClearPage = computed(() => topLevel.value.length > 0)
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
      nodes: viewNodes.value,
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
    const resolved = effectivePage(activePage.value, doc.value.breakpoints, base.id)
    return {
      ...resolved,
      nodes: expandInstances(resolved, doc.value),
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
  // M5：CSS 页签给出完整样式表（基础规则 + 每个节点的类规则 + 断点媒体查询）
  const generatedCss = computed(() => generateCss(exportDoc.value, activePage.value.id, exportBoxes.value))
  const generatedVue = computed(() => generateVueSfc(exportDoc.value, activePage.value.id, exportBoxes.value))
  /** 整站文件清单（zip 打包用）：index.html + base.css + 每页 html/css */
  function siteFiles(): SiteFile[] {
    return buildSite(exportDoc.value)
  }

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
    const alive = [...new Set(selectedIds.value.map(realId))].filter((id) => nodes.value[id])
    if (alive.length !== selectedIds.value.length || alive.some((id, index) => id !== selectedIds.value[index])) {
      selectedIds.value = alive
    }
  }

  // ── 选择 ──────────────────────────────────────────────────────────────
  /** 选择只能落在文档里真实存在的节点上：点中实例展开出来的子节点时归到实例本身 */
  function realId(id: NodeId): NodeId {
    return isSyntheticId(id) && !nodes.value[id] ? instanceIdOf(id) : id
  }

  function select(id: NodeId | null, additive = false): void {
    if (id === null) {
      selectedIds.value = []
      return
    }
    const target = realId(id)
    if (!nodes.value[target]) return
    if (!additive) {
      selectedIds.value = [target]
      return
    }
    selectedIds.value = selectedIds.value.includes(target)
      ? selectedIds.value.filter((item) => item !== target)
      : [...selectedIds.value, target]
  }

  function selectMany(ids: NodeId[]): void {
    const real = ids.map(realId).filter((id) => Boolean(nodes.value[id]))
    selectedIds.value = [...new Set(real)]
  }

  function clearSelection(): void {
    selectedIds.value = []
  }

  /**
   * 键盘选择（M8 / E8）：按 `viewNodes` 的顺序在整棵树里前后移动选中项。
   * 没有选中时从第一个（或最后一个）开始，绕圈循环。
   */
  function selectNext(step = 1): void {
    const ids = Object.keys(viewNodes.value)
    if (ids.length === 0) return
    const current = primary.value ? realId(primary.value.id) : ''
    const at = ids.indexOf(current)
    const index = at < 0 ? (step > 0 ? 0 : ids.length - 1) : (at + step + ids.length) % ids.length
    const next = ids[index]
    if (next) select(next)
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

  // ── 组件（master / instance，M4） ─────────────────────────────────────
  /** 文档里的组件定义 */
  const symbols = computed<SymbolDef[]>(() => Object.values(doc.value.symbols ?? {}))

  function componentInstances(symbolId: SymbolId): { pageId: string; nodeId: NodeId }[] {
    return instancesOf(doc.value, symbolId)
  }

  /**
   * 把选区里最外层的节点抓成一个组件，原位置替换成它的一个实例。
   * 组件定义不是「页面/组件容器内的节点级」补丁能表达的，所以这一步直接改写历史基准、
   * 不进撤销栈（撤销栈仍是页面节点级补丁，见 `docs/decisions.md` D31）。
   */
  function createComponent(name = '组件'): SymbolId | null {
    const real = selectedIds.value.filter((id) => Boolean(nodes.value[id]))
    if (real.length === 0) return null
    const outermost = real.filter(
      (id) => !real.some((other) => other !== id && isDescendantOf(nodes.value, other, id)),
    )
    const rootSourceId = outermost[0]
    const source = nodes.value[rootSourceId]
    const def = captureSymbol(nodes.value, rootSourceId, name)
    const instance = createNode(INSTANCE_TYPE, {
      parentId: source.parentId,
      order: source.order,
      position: { ...source.layout.position },
    })
    instance.layout = cloneNode(source).layout
    instance.style = { ...source.style }
    instance.props = { symbolId: def.id }
    const patches = [
      ...removePatches(activePage.value, [rootSourceId]),
      insertPatch(activePage.value.id, instance),
    ]
    const applied = applyPatches(doc.value, patches)
    const next: Doc = { ...applied, symbols: { ...(applied.symbols ?? {}), [def.id]: def } }
    history.value = { ...history.value, base: next }
    selectedIds.value = [instance.id]
    return def.id
  }

  /** 插入一个组件实例（节点级补丁，可撤销） */
  function insertInstance(symbolId: SymbolId): NodeId | null {
    const def = doc.value.symbols?.[symbolId]
    if (!def) return null
    const parentId = rootId.value
    const node = createNode(INSTANCE_TYPE, {
      parentId,
      order: nextOrder(nodes.value, parentId),
      position: { x: 40 + (topLevel.value.length % 6) * 24, y: 40 + (topLevel.value.length % 6) * 24 },
    })
    // 实例只带 symbolId：描述符里的默认 props.text 是空串，留着会当成「覆盖成空文案」抹掉 master 内容
    node.props = { symbolId }
    const master = def.nodes[def.root]
    if (master) {
      node.layout.size = { w: { ...master.layout.size.w }, h: { ...master.layout.size.h } }
      node.layout.mode = master.layout.mode
    }
    commit('添加组件实例', [insertPatch(activePage.value.id, node)])
    selectedIds.value = [node.id]
    return node.id
  }

  /**
   * 改组件（master）：补丁的 `pageId` 放组件 id，走同一套补丁 / 撤销管线，
   * 因此「改 master 后所有实例同步」与撤销都成立。
   */
  function updateSymbolNode(symbolId: SymbolId, nodeId: NodeId, edit: NodeEdit, label = '修改组件'): void {
    const node = doc.value.symbols?.[symbolId]?.nodes[nodeId]
    if (!node) return
    const after = mergeEdit(node, edit)
    const before: NodePatchData = {}
    if (after.type !== undefined) before.type = node.type
    if (after.layout !== undefined) before.layout = node.layout
    if (after.style !== undefined) before.style = node.style
    if (after.props !== undefined) before.props = node.props
    if (after.overrides !== undefined) before.overrides = node.overrides
    if (after.meta !== undefined) before.meta = node.meta
    commit(label, [updatePatch(symbolId, nodeId, before, after)], `symbol:${symbolId}:${nodeId}`)
  }

  function removeSelection(): void {
    if (selectedIds.value.length === 0) return
    const exists = selectedIds.value.filter((id) => Boolean(nodes.value[id]))
    // 根节点是页面容器，删掉整页白屏；锁定元素是用户明确保护过的，两者都不删。
    const protectedIds = exists.filter((id) => id === rootId.value || nodes.value[id].meta.locked)
    const removable = exists.filter((id) => !protectedIds.includes(id))
    if (removable.length === 0) {
      // 根被选中是「模板新建页面」时代的遗留状态，文案要说清他不是选中了某个矩形元素。
      const hasRoot = protectedIds.includes(rootId.value)
      const hasLocked = protectedIds.length > (hasRoot ? 1 : 0)
      const text = hasRoot
        ? hasLocked
          ? '这是页面画布本身（删不掉），锁定元素要先解锁'
          : '这是页面画布本身（根容器），删不掉；要删的是画布里的元素'
        : '元素已锁定，先解锁再删除'
      pushToast(text, 'error')
      return
    }
    const patches = removePatches(activePage.value, removable)
    if (patches.length === 0) return
    commit(`删除 ${removable.length} 个元素`, patches)
    if (protectedIds.length > 0) {
      pushToast(`已跳过 ${protectedIds.length} 个锁定元素${protectedIds.includes(rootId.value) ? '（含根节点）' : ''}`)
    }
  }

  /**
   * 一键清空当前页面的所有元素（根容器保留，页面本身还在）。
   * 走一次文档补丁提交，所以 Ctrl+Z 能整页还原 —— 破坏性操作必须可撤销。
   */
  function clearPage(): void {
    const roots = topLevel.value.map((node) => node.id)
    if (roots.length === 0) {
      pushToast('当前页面已经是空的')
      return
    }
    const patches = removePatches(activePage.value, roots)
    if (patches.length === 0) return
    selectedIds.value = []
    commit(`清空页面（${roots.length} 个元素）`, patches)
    pushToast('已清空当前页面的元素，可按 Ctrl+Z 撤销')
  }

  /** Esc / 面包屑的「上一层」：主选中换成它的父分区（父是根时停住） */
  function selectParent(): void {
    const current = primary.value
    if (!current) return
    if (!current.parentId || current.parentId === rootId.value) {
      pushToast('已经是顶层元素')
      return
    }
    select(current.parentId)
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
    commitDoc(`新建页面 ${page.name}`, docNext)
  }

  function renamePage(id: string, name: string): void {
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    const page = docNext.pages.find((item) => item.id === id)
    if (!page) return
    page.name = name.slice(0, 40) || '未命名页面'
    commitDoc('重命名页面', docNext)
  }

  function removePage(id: string): void {
    if (doc.value.pages.length <= 1) {
      pushToast('至少要保留一个页面', 'error')
      return
    }
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    docNext.pages = docNext.pages.filter((page) => page.id !== id)
    if (docNext.activePageId === id) docNext.activePageId = docNext.pages[0].id
    commitDoc('删除页面', docNext)
    selectedIds.value = []
  }

  function switchPage(id: string): void {
    if (!doc.value.pages.some((page) => page.id === id)) return
    const docNext = JSON.parse(JSON.stringify(doc.value)) as Doc
    docNext.activePageId = id
    setDoc(docNext, '切换页面', true)
    selectedIds.value = []
  }

  /**
   * 切换页面只换基线、不动历史：视口/页面是「看文档的姿势」，来回切不该淹没撤销栈。
   * 页面增删、换模板、导入这些真正改文档的动作走 `commitDoc()`（可撤销）。
   */
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
    // 换模板可撤销：否则「载错模板 / 删错了」只能靠刷新页面（M9 用户反馈）。
    commitDoc(`载入模板 ${id}`, next)
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

  /** 自定义视口高度：和宽度一样夹取，宽 × 高一起决定画布纸张尺寸 */
  function setViewportHeight(height: number): void {
    if (!Number.isFinite(height)) return
    const h = Math.round(Math.min(MAX_VIEWPORT, Math.max(MIN_VIEWPORT, height)))
    applyViewport(viewport().w, h)
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

  // ── AI（M6）──────────────────────────────────────────────────────────
  // 铁律（功能文档 AI0）：AI 只产出结构化 JSON，经本地校验后走 commit 入历史，
  // 失败一律不落库；离线时 Mock 供应商照样能生成页面与跑规则检查。
  const aiSettings = ref<AiSettings>(loadAiSettings())
  const aiProviderId = ref<'mock' | 'openai'>('mock')
  const aiBusy = ref(false)
  const aiMessage = ref('')
  const aiLogs = ref<AiCallLogEntry[]>([])
  const aiService = createAiService()

  /** 检查结果跟着文档实时重算，不缓存脏状态 */
  const aiIssues = computed<Issue[]>(() => auditDoc(doc.value, activePage.value.id))
  const aiProviders = computed(() => [
    { id: 'mock', label: '内置规则助手（离线）', ready: true },
    {
      id: 'openai',
      label: `OpenAI 兼容（${aiSettings.value.model}）`,
      ready: aiSettings.value.apiKey.trim() !== '',
    },
  ])

  function aiSyncLogs(): void {
    aiLogs.value = aiService.logs()
  }

  function buildAiProvider(id: string): AiProvider {
    if (id === 'openai') {
      return createOpenAIProvider({
        apiKey: aiSettings.value.apiKey,
        baseUrl: aiSettings.value.baseUrl,
        model: aiSettings.value.model,
      })
    }
    return createMockProvider()
  }

  function aiSetProvider(id: string): void {
    if (id !== 'mock' && id !== 'openai') return
    aiProviderId.value = id
    aiService.setProvider(buildAiProvider(id))
  }

  /** 设置只写本机 localStorage（AI6：密钥不进文档） */
  function aiSaveSettings(next: Partial<AiSettings>): void {
    aiSettings.value = saveAiSettings({ ...aiSettings.value, ...next })
    if (aiProviderId.value === 'openai') aiSetProvider('openai')
  }

  function aiClearLogs(): void {
    aiService.clearLogs()
    aiSyncLogs()
  }

  function problemText(errors: AiProblem[]): string {
    return errors.map((item) => item.message).join('；')
  }

  /** AI1 一句话生成页面：整页插入是一条文档级历史（可一次撤销） */
  async function aiGeneratePage(prompt: string): Promise<boolean> {
    const text = prompt.trim()
    if (text === '') {
      pushToast('先写一句想要什么页面', 'error')
      return false
    }
    aiBusy.value = true
    try {
      const outcome = await aiService.generatePage(doc.value, text, activePage.value.id)
      if (!outcome.ok || !outcome.value) {
        aiMessage.value = problemText(outcome.errors)
        pushToast(`AI 生成失败：${aiMessage.value}`, 'error')
        return false
      }
      const { page, doc: nextDoc, warnings } = outcome.value
      history.value = commitDocEntry(history.value, {
        label: `AI 生成页面：${page.name}`,
        at: Date.now(),
        after: nextDoc,
      })
      // M11：新页面生成后不选根容器 —— 根被选中时按 Delete 只会提示「根节点不能删除」，
      // 用户看到的却是画布上一个被选中的大矩形，很容易当成「删不掉的元素」。
      selectedIds.value = []
      aiMessage.value = `已生成「${page.name}」（${Object.keys(page.nodes).length} 个节点）${warnings.length > 0 ? `｜${warnings.join('；')}` : ''}`
      pushToast('AI 已生成新页面（可撤销）')
      return true
    } finally {
      aiBusy.value = false
      aiSyncLogs()
    }
  }

  /** AI2 选区指令：只影响选中子树，补丁落地后未选中节点逐字节不变 */
  async function aiEditSelection(prompt: string): Promise<boolean> {
    const text = prompt.trim()
    if (text === '') return false
    if (selectedIds.value.length === 0) {
      pushToast('先选中要改的元素', 'error')
      return false
    }
    aiBusy.value = true
    try {
      const outcome = await aiService.editSelection(
        doc.value,
        activePage.value.id,
        [...selectedIds.value],
        text,
      )
      if (!outcome.ok || !outcome.value) {
        aiMessage.value = problemText(outcome.errors)
        pushToast(`AI 编辑失败：${aiMessage.value}`, 'error')
        return false
      }
      if (outcome.value.patches.length === 0) {
        aiMessage.value = 'AI 没有给出任何改动'
        return false
      }
      commit(`AI 编辑：${text.slice(0, 24)}`, outcome.value.patches)
      aiMessage.value = `已应用 ${outcome.value.patches.length} 个补丁`
      return true
    } finally {
      aiBusy.value = false
      aiSyncLogs()
    }
  }

  /** AI3 单条修复：走普通补丁历史 */
  function aiFixIssue(issueId: string): boolean {
    const issue = aiIssues.value.find((item) => item.id === issueId)
    if (!issue) return false
    if (issue.patches.length === 0) {
      pushToast('这条问题没有自动修复方案', 'error')
      return false
    }
    commit(`AI 修复：${issue.fixLabel}`, issue.patches)
    aiMessage.value = `已修复：${issue.fixLabel}`
    return true
  }

  /** AI3 一键修复：补丁序列由 core/assistant 迭代算出，落地仍是一条普通补丁历史 */
  function aiFixAll(): number {
    const before = aiIssues.value.length
    const patches = fixAll(doc.value, activePage.value.id)
    if (patches.length === 0) {
      aiMessage.value = '没有可自动修复的问题'
      return 0
    }
    commit('AI 一键修复', patches)
    const left = aiIssues.value.length
    aiMessage.value = `修复前 ${before} 条，剩余 ${left} 条`
    pushToast('AI 已一键修复（可撤销）')
    return before - left
  }

  // ── AI 进阶（M7）：文案候选 / 素材候选 / 生成自定义组件 / 成本面板 ──────
  const aiTextCandidates = ref<TextCandidate[]>([])
  const aiMaterialCandidates = ref<MaterialCandidate[]>([])
  const aiComponentCandidate = ref<ComponentCandidate | null>(null)
  /** 降级提示（断网或供应商不可用）；空串表示走的是正常供应商 */
  const aiDegraded = ref('')

  const aiOffline = computed(() => isOffline())
  /** 调用记录的成本汇总：跟着日志引用变化重算 */
  const aiUsage = computed<UsageSummary>(() => {
    void aiLogs.value
    return aiService.usageSummary()
  })
  // 组件注册表是模块级普通 Map，注册/卸载后要自己叫醒依赖它的 computed（D31）
  const registryRevision = ref(0)
  subscribeRegistry(() => {
    registryRevision.value += 1
  })
  const aiCustomTypes = computed(() => {
    void registryRevision.value
    return listComponents()
      .filter((item) => item.category === 'custom')
      .map((item) => item.type)
  })

  // 启动即恢复本机存档的自定义组件（AI5：注册过就一直在「我的组件」里）
  aiLoadCustomComponents()

  /** 启动时把本机存档的自定义组件装回注册表（AI5：可导出、跨会话还在） */
  function aiLoadCustomComponents(): number {
    let count = 0
    for (const dsl of loadCustomDsl()) {
      try {
        registerComponent(compileDsl(dsl))
        count += 1
      } catch {
        // 坏存档已在 loadCustomDsl 里被过滤，这里再兜一层
      }
    }
    return count
  }

  /** 供应商失败/断网时用规则式实现兜底（不碰网络） */
  function aiNote(outcome: AiOutcome<unknown>): void {
    if (outcome.ok) return
    const codes = outcome.errors.map((item) => item.code)
    if (shouldFallback(codes, aiOffline.value)) {
      aiDegraded.value = aiOffline.value ? OFFLINE_HINT : PROVIDER_FALLBACK_HINT
    } else {
      aiDegraded.value = ''
      aiMessage.value = problemText(outcome.errors)
    }
  }

  /** AI4 文案：先拿候选（不落库），用户挑一个再提交补丁 */
  async function aiTextOptions(prompt: string, tone: TextTone = 'plain'): Promise<boolean> {
    const text = prompt.trim()
    if (text === '') {
      pushToast('先写一句想要什么文案', 'error')
      return false
    }
    aiBusy.value = true
    aiDegraded.value = ''
    try {
      const outcome = await aiService.textOptions(doc.value, activePage.value.id, text, { tone })
      aiNote(outcome)
      const candidates = outcome.ok && outcome.value ? outcome.value.candidates : textCandidates(text, { tone })
      aiTextCandidates.value = candidates
      aiMessage.value = `${outcome.ok ? '' : '（规则助手）'}${candidates.length} 个文案候选`
      return true
    } finally {
      aiBusy.value = false
      aiSyncLogs()
    }
  }

  /** 应用第 N 个文案候选到当前选中节点（可撤销） */
  function aiApplyText(index: number): boolean {
    const candidate = aiTextCandidates.value[index]
    if (!candidate) return false
    const target = primary.value?.id ?? (selectedIds.value.length > 0 ? selectedIds.value[0] : undefined)
    if (!target) {
      pushToast('先选中要改文案的元素', 'error')
      return false
    }
    const patch = textPatch(activePage.value, target, candidate.text)
    if (!patch) {
      pushToast('目标元素已经不存在了', 'error')
      return false
    }
    commit(`AI 文案：${candidate.text.slice(0, 16)}`, [patch])
    aiMessage.value = `已应用文案「${candidate.text}」`
    return true
  }

  /** AI4 素材：占位图候选（本地编码 PNG，带来源标记） */
  async function aiMaterialOptions(prompt: string): Promise<boolean> {
    const text = prompt.trim() || '宣传配图'
    aiBusy.value = true
    aiDegraded.value = ''
    try {
      const outcome = await aiService.materialOptions(doc.value, activePage.value.id, text)
      aiNote(outcome)
      const candidates = outcome.ok && outcome.value ? outcome.value.candidates : materialCandidates(text)
      aiMaterialCandidates.value = candidates
      aiMessage.value = `${outcome.ok ? '' : '（规则助手）'}${candidates.length} 张素材候选`
      return true
    } finally {
      aiBusy.value = false
      aiSyncLogs()
    }
  }

  /** 应用素材到当前选中的图片节点：写 props.src + 来源标记，缺 alt 补一个 */
  function aiApplyMaterial(index: number, alt = ''): boolean {
    const candidate = aiMaterialCandidates.value[index]
    if (!candidate) return false
    const target = primary.value?.id ?? (selectedIds.value.length > 0 ? selectedIds.value[0] : undefined)
    if (!target) {
      pushToast('先选中要替换的图片', 'error')
      return false
    }
    const patch = materialPatch(activePage.value, target, candidate, alt)
    if (!patch) {
      pushToast('这张素材不可用', 'error')
      return false
    }
    commit('AI 素材：应用配图', [patch])
    aiMessage.value = `已应用素材「${candidate.label}」`
    return true
  }

  /** AI5 生成自定义组件：只出受限 DSL 候选 + 预览，注册要用户再点一次 */
  async function aiComponentOption(prompt: string): Promise<boolean> {
    const text = prompt.trim()
    if (text === '') {
      pushToast('先描述一下想要的组件', 'error')
      return false
    }
    aiBusy.value = true
    aiDegraded.value = ''
    try {
      const outcome = await aiService.componentOption(text)
      aiNote(outcome)
      const candidate = outcome.ok && outcome.value ? outcome.value.candidate : componentCandidates(text)[0]
      aiComponentCandidate.value = candidate
      aiMessage.value = `${outcome.ok ? '' : '（规则助手）'}${describeCandidate(candidate)}`
      return true
    } finally {
      aiBusy.value = false
      aiSyncLogs()
    }
  }

  /** 用户确认后注册：进「我的组件」+ 写本机存档（AI5） */
  function aiRegisterComponent(): boolean {
    const candidate = aiComponentCandidate.value
    if (!candidate) return false
    const descriptor = registerCandidate(candidate)
    aiMessage.value = `已注册「${candidate.dsl.name}」到我的组件`
    pushToast(`组件「${candidate.dsl.name}」已加入我的组件`)
    void descriptor
    return true
  }

  // ── 主题 token / 版本历史 / 分享 / 从模板新建页面（M8）─────────────────
  /** 主题面板的列表数据：按组顺序 + 组内名字排序 */
  const themeTokens = computed<ThemeTokenEntry[]>(() => themeTokenEntries(doc.value.theme))
  /** 当前页引用了但主题里没有定义的 token（导出会变成空值） */
  const themeMissing = computed<string[]>(() => missingTokenRefs(activePage.value, doc.value.theme))

  /**
   * 文档级提交：主题 / 回滚 / 分享载入都会整份换掉文档，走 `commitDocEntry` 才能撤销
   * （`setDoc()` 默认会清空历史，那是「新建 / 载入模板」这类一次性动作的语义）。
   */
  function commitDoc(label: string, after: Doc): void {
    history.value = commitDocEntry(history.value, { label, at: Date.now(), after })
    pruneSelection()
  }

  function writeThemeToken(name: string, value: string): boolean {
    const trimmed = name.trim()
    if (trimmed === '') {
      pushToast('先写一个 token 名字（例如 color-primary）', 'error')
      return false
    }
    const next = setToken(doc.value.theme, trimmed, value.trim())
    commitDoc(`主题 token：${trimmed}`, { ...doc.value, theme: next })
    return true
  }

  function deleteThemeToken(name: string): void {
    if (doc.value.theme.tokens[name] === undefined) return
    commitDoc(`删除主题 token：${name}`, { ...doc.value, theme: removeToken(doc.value.theme, name) })
  }

  const versions = ref<VersionEntry[]>(loadVersions())
  const versionsCount = computed(() => versions.value.length)

  function describeVersion(entry: VersionEntry): string {
    return `${versionSummaryOf(entry)} · ${new Date(entry.at).toLocaleString('zh-CN')}`
  }

  function saveCurrentVersion(name: string): boolean {
    const label = name.trim() === '' ? `版本 ${versions.value.length + 1}` : name.trim()
    const list = saveVersion(doc.value, label)
    versions.value = list
    if (!list.some((item) => item.name === label)) {
      pushToast('本机存储不可用，版本没有保存', 'error')
      return false
    }
    pushToast(`已保存版本「${label}」`)
    return true
  }

  function restoreVersionById(id: string): boolean {
    const entry = versions.value.find((item) => item.id === id)
    const next = restoreVersion(id)
    if (!next) return false
    commitDoc(`回滚版本：${entry?.name ?? id}`, next)
    pushToast('已回滚到该版本（可撤销）')
    return true
  }

  function removeVersionById(id: string): void {
    versions.value = removeVersion(id)
  }

  function clearAllVersions(): void {
    versions.value = clearVersions()
  }

  /** 分享链接的基地址：去掉已有的 hash，交给 `shareUrl` 拼接 */
  function shareBase(): string {
    if (typeof location === 'undefined') return 'https://example.com/'
    return `${location.origin}${location.pathname}`
  }

  const shareLink = computed(() => shareUrl(doc.value, shareBase()))
  const shareTooLong = computed(() => shareLink.value === '')

  function shareFragment(): string {
    return encodeDoc(doc.value)
  }

  async function copyShareLink(): Promise<boolean> {
    if (shareTooLong.value) {
      pushToast('文档太大，地址栏放不下，请改用「整站」导出', 'error')
      return false
    }
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      pushToast('当前环境不支持自动复制，链接已生成', 'info')
      return true
    }
    try {
      await clipboard.writeText(shareLink.value)
      pushToast('分享链接已复制')
      return true
    } catch {
      pushToast('复制失败，请手动复制链接', 'error')
      return false
    }
  }

  function openSharedDoc(input: string): boolean {
    const next = decodeDoc(input)
    if (!next) {
      pushToast('分享链接无效或已损坏', 'error')
      return false
    }
    commitDoc('打开分享链接', next)
    pushToast('已载入分享的文档（可撤销）')
    return true
  }

  /** 启动时看地址栏有没有 `#doc=` 片段（分享链接），有就载入 */
  function loadSharedFromLocation(): boolean {
    if (typeof location === 'undefined') return false
    if (!location.hash.startsWith('#doc=')) return false
    return openSharedDoc(location.hash)
  }

  function addPageFromTemplate(templateId: string): boolean {
    const result = pageFromTemplate(doc.value, templateId)
    if (!result) {
      pushToast('模板不存在', 'error')
      return false
    }
    const page = result.doc.pages.find((item) => item.id === result.pageId)
    commitDoc(`从模板新建页面：${page?.name ?? templateId}`, result.doc)
    // M11：只切页不选根容器（原因同 aiGeneratePage）。
    selectedIds.value = []
    pushToast(`已新建页面「${page?.name ?? templateId}」，点选画布元素后可删除`)
    return true
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
    viewNodes,
    symbols,
    rootId,
    topLevel,
    selectedIds,
    selection,
    primary,
    primaryRaw,
    canRemoveSelection,
    canClearPage,
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
    generatedVue,
    siteFiles,
    layout,
    boxes,
    viewport,
    select,
    selectNext,
    selectParent,
    selectionPath,
    selectMany,
    clearSelection,
    insertComponent,
    removeSelection,
    clearPage,
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
    createComponent,
    insertInstance,
    updateSymbolNode,
    componentInstances,
    loadTemplate,
    newProject,
    importText,
    setBreakpoint,
    setViewportWidth,
    setViewportHeight,
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
    aiBusy,
    aiMessage,
    aiLogs,
    aiIssues,
    aiProviders,
    aiProviderId,
    aiSettings,
    aiGeneratePage,
    aiEditSelection,
    aiFixIssue,
    aiFixAll,
    aiSetProvider,
    aiSaveSettings,
    aiClearLogs,
    // M7
    aiTextCandidates,
    aiMaterialCandidates,
    aiComponentCandidate,
    aiDegraded,
    aiOffline,
    aiUsage,
    aiCustomTypes,
    aiTextOptions,
    aiApplyText,
    aiMaterialOptions,
    aiApplyMaterial,
    aiComponentOption,
    aiRegisterComponent,
    aiLoadCustomComponents,
    // M8
    themeTokens,
    themeMissing,
    writeThemeToken,
    deleteThemeToken,
    versions,
    versionsCount,
    describeVersion,
    saveCurrentVersion,
    restoreVersionById,
    removeVersionById,
    clearAllVersions,
    shareLink,
    shareTooLong,
    shareFragment,
    copyShareLink,
    openSharedDoc,
    loadSharedFromLocation,
    addPageFromTemplate,
  }
})

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export type EditorStore = ReturnType<typeof useEditorStore>
