import type { Doc, NodeId, Page, PageId, SceneNode } from '@/core/schema/types'
import { DEFAULT_BREAKPOINTS, DEFAULT_THEME_TOKENS } from '@/core/schema/catalog'

/** 测试夹具：造一个合法节点，只写关心的字段 */
export function makeNode(partial: Partial<SceneNode> & { id: NodeId }): SceneNode {
  return {
    type: 'rect',
    parentId: null,
    order: 0,
    layout: {
      mode: 'free',
      position: { x: 0, y: 0 },
      size: { w: { kind: 'fixed', value: 160 }, h: { kind: 'fixed', value: 100 } },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      columns: 1,
      align: 'start',
      justify: 'start',
      wrap: false,
      constraints: { h: 'left', v: 'top' },
    },
    style: {
      bg: '',
      color: '',
      fontSize: 0,
      fontWeight: 0,
      align: 'left',
      radius: 0,
      borderWidth: 0,
      borderColor: '',
      opacity: 1,
      shadowBlur: 0,
      shadowX: 0,
      shadowY: 0,
      shadowColor: '',
      lineHeight: 0,
      letterSpacing: 0,
    },
    props: {},
    overrides: {},
    meta: { hidden: false, locked: false },
    ...partial,
  }
}

export function makeNodes(list: SceneNode[]): Record<NodeId, SceneNode> {
  const nodes: Record<NodeId, SceneNode> = {}
  for (const node of list) nodes[node.id] = node
  return nodes
}

/** 某一层级的 order 序列（断言「order 连续」用） */
export function ordersOf(nodes: Record<NodeId, SceneNode>, parentId: NodeId | null): number[] {
  return Object.values(nodes)
    .filter((node) => node.parentId === parentId)
    .map((node) => node.order)
    .sort((a, b) => a - b)
}

/** 稳定快照：任何「同一逻辑状态」都该序列化成同一份 JSON */
export function snapshot(value: unknown): string {
  return JSON.stringify(value)
}

/** 造一个页面：默认一个空的根 frame */
export function makePage(partial: Partial<Page> & { id: PageId }): Page {
  const root = partial.root ?? 'root'
  return {
    name: '首页',
    path: '/',
    viewport: { w: 1440, h: 900 },
    ...partial,
    root,
    nodes: partial.nodes ?? makeNodes([makeNode({ id: root, type: 'frame' })]),
  }
}

/** 造一个最小合法文档 */
export function makeDoc(partial: Partial<Doc> = {}): Doc {
  const pages = partial.pages ?? [makePage({ id: 'page_1' })]
  return {
    version: 2,
    id: 'doc_1',
    name: '测试项目',
    breakpoints: DEFAULT_BREAKPOINTS.map((bp) => ({ ...bp })),
    theme: { tokens: { ...DEFAULT_THEME_TOKENS } },
    ...partial,
    pages,
    activePageId: partial.activePageId ?? pages[0].id,
  }
}

/** 单页文档，直接给一串节点（root 默认 'root'） */
export function docWithNodes(nodes: SceneNode[], rootId = 'root'): Doc {
  return makeDoc({ pages: [makePage({ id: 'page_1', root: rootId, nodes: makeNodes(nodes) })] })
}

