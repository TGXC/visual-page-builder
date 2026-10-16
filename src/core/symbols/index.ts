/**
 * 组件（master/instance）纯逻辑：
 * - `captureSymbol()` 把页面上的一棵子树抓成独立组件定义（克隆，不动原节点）；
 * - `expandInstances()` 把页面里 `type === 'instance'` 的节点按组件定义展开成
 *   「实例私有」的子树克隆（id 用 `${实例id}~${masterId}` 前缀），供布局、画布与导出共用；
 * - 循环引用（组件里嵌自己 / 两个组件互嵌）在展开时检测，标记 `props.cycle` 而不是死循环。
 *
 * 展开是纯函数：原 `Page.nodes` 与 `Doc.symbols` 都不被修改，撤销栈里存的仍是实例节点本身。
 */
import { cloneNode } from '../patch'
import { subtreeIds } from '../tree'
import type { ComponentType } from '../schema/types'
import type { Doc, NodeId, Page, SceneNode, SymbolDef, SymbolId } from '../schema/types'

/** 实例类型名（注册在 `core/components` 里，标记为 hidden，不出现在组件面板） */
export const INSTANCE_TYPE = 'instance' as ComponentType

export const DEFAULT_OVERRIDABLE: readonly string[] = ['text', 'color', 'fontSize', 'bg']

const SEPARATOR = '~'

/** 实例展开后的合成 id：`${实例id}~${master 节点 id}` */
export function syntheticId(instanceId: NodeId, masterId: NodeId): NodeId {
  return `${instanceId}${SEPARATOR}${masterId}`
}

export function isSyntheticId(id: NodeId): boolean {
  return id.includes(SEPARATOR)
}

/** 合成 id 归属的实例 id；真实 id 原样返回 */
export function instanceIdOf(id: NodeId): NodeId {
  const index = id.indexOf(SEPARATOR)
  return index === -1 ? id : id.slice(0, index)
}

/** 合成 id 里 master 侧的 id；真实 id 返回 '' */
export function masterIdOf(id: NodeId): NodeId {
  const index = id.indexOf(SEPARATOR)
  return index === -1 ? '' : id.slice(index + 1)
}

export function symbolIdOf(node: SceneNode | undefined): SymbolId | null {
  if (!node || node.type !== INSTANCE_TYPE) return null
  const raw = node.props.symbolId
  return typeof raw === 'string' && raw !== '' ? raw : null
}

function symbolIdFor(rootId: NodeId): SymbolId {
  return `sym_${rootId}`
}

/**
 * 把 `nodes` 里 `rootId` 的子树抓成组件定义。
 * 子树里的 id 保持原样（组件定义有自己的命名空间），展开时才加实例前缀。
 */
export function captureSymbol(
  nodes: Record<NodeId, SceneNode>,
  rootId: NodeId,
  name: string,
  overridable: readonly string[] = DEFAULT_OVERRIDABLE,
): SymbolDef {
  if (!nodes[rootId]) throw new Error(`节点 ${rootId} 不存在，无法创建组件`)
  const ids = subtreeIds(nodes, rootId)
  const cloned: Record<NodeId, SceneNode> = {}
  for (const id of ids) cloned[id] = cloneNode(nodes[id])
  return { id: symbolIdFor(rootId), name, root: rootId, nodes: cloned, overridable: [...overridable] }
}

function symbolsOf(doc: Doc): Record<SymbolId, SymbolDef> {
  return doc.symbols ?? {}
}

/** 实例节点里可以覆盖 master 根节点的 props（白名单由组件定义给出） */
function overridesFor(instance: SceneNode, def: SymbolDef | undefined): Record<string, unknown> {
  if (!def) return {}
  const applied: Record<string, unknown> = {}
  for (const key of def.overridable) {
    const value = instance.props[key]
    if (value !== undefined) applied[key] = value
  }
  return applied
}

interface ExpandState {
  out: Record<NodeId, SceneNode>
  doc: Doc
}

/**
 * 展开一个实例（含它内部的实例，递归）。
 * `stack` 是当前展开链上的组件 id，用于循环检测。
 */
function expandInstance(state: ExpandState, instance: SceneNode, stack: SymbolId[]): void {
  const symbolId = symbolIdOf(instance)
  if (!symbolId) {
    instance.props.unknown = true
    return
  }
  const def = symbolsOf(state.doc)[symbolId]
  if (!def) {
    instance.props.unknown = true
    return
  }
  const applied = overridesFor(instance, def)
  const masterIds = subtreeIds(def.nodes, def.root)
  for (const masterId of masterIds) {
    const master = def.nodes[masterId]
    if (!master) continue
    const copy = cloneNode(master)
    copy.id = syntheticId(instance.id, masterId)
    if (masterId === def.root) {
      copy.parentId = instance.id
      copy.props = { ...copy.props, ...applied }
    } else {
      copy.parentId = master.parentId === null ? instance.id : syntheticId(instance.id, master.parentId)
    }
    if (copy.type === INSTANCE_TYPE) {
      const nestedId = symbolIdOf(copy)
      if (nestedId && stack.includes(nestedId)) {
        copy.props = { ...copy.props, cycle: true }
      } else {
        state.out[copy.id] = copy
        expandInstance(state, copy, nestedId ? [...stack, nestedId] : stack)
        continue
      }
    }
    state.out[copy.id] = copy
  }
}

/**
 * 展开页面里全部实例。返回（可能的）新节点表；没有实例时返回原表的浅拷贝。
 */
export function expandInstances(page: Page, doc: Doc): Record<NodeId, SceneNode> {
  const out: Record<NodeId, SceneNode> = {}
  const state: ExpandState = { out, doc }
  for (const node of Object.values(page.nodes)) {
    const copy = cloneNode(node)
    out[copy.id] = copy
  }
  for (const node of Object.values(page.nodes)) {
    if (node.type !== INSTANCE_TYPE) continue
    const stack = symbolIdOf(node) ? [symbolIdOf(node) as SymbolId] : []
    expandInstance(state, out[node.id], stack)
  }
  return out
}

/** 当前文档里引用某个组件的全部实例（按页面、再按节点插入顺序） */
export function instancesOf(doc: Doc, symbolId: SymbolId): { pageId: string; nodeId: NodeId }[] {
  const found: { pageId: string; nodeId: NodeId }[] = []
  for (const page of doc.pages) {
    for (const node of Object.values(page.nodes)) {
      if (symbolIdOf(node) === symbolId) found.push({ pageId: page.id, nodeId: node.id })
    }
  }
  return found
}

/** 组件里是否（直接或间接）引用了某个组件 —— 创建组件前的循环校验 */
export function symbolReferences(doc: Doc, from: SymbolId, target: SymbolId): boolean {
  const seen = new Set<SymbolId>()
  const walk = (id: SymbolId): boolean => {
    if (id === target) return true
    if (seen.has(id)) return false
    seen.add(id)
    const def = symbolsOf(doc)[id]
    if (!def) return false
    for (const node of Object.values(def.nodes)) {
      const nested = symbolIdOf(node)
      if (nested && walk(nested)) return true
    }
    return false
  }
  return walk(from)
}
