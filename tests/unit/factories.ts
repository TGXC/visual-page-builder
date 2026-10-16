import type { NodeId, SceneNode } from '@/core/schema/types'

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
