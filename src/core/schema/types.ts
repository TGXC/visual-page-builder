/**
 * Studio（可视化页面搭建器）v2 数据模型。
 *
 * 与 WebBuilder v1 的关键区别（见 docs/功能文档-v2-可视化页面搭建器.md §3）：
 * ①节点存 Record<id, SceneNode> 而不是扁平数组 —— 按 id 查 O(1)、拖拽换父级只改两个字段；
 * ②parentId + order 表达树与层级，取代「数组顺序即层级」；
 * ③布局（layout）与样式（style）从原来混在一起的 props 里拆出来；
 * ④断点覆盖只存差异（overrides）。
 *
 * 命名注意：节点类型叫 SceneNode 而不是 Node —— 避免与 DOM 的 Node 类型撞名。
 */

export type NodeId = string
export type PageId = string
export type BreakpointId = string

export type ComponentType =
  | 'frame'
  | 'group'
  | 'text'
  | 'button'
  | 'input'
  | 'rect'
  | 'circle'
  | 'divider'
  | 'nav'
  | 'header'
  | 'card'
  | 'image'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'textarea'
  | 'video'

/** 尺寸模式：固定像素 / 包裹内容 / 填满父容器 / 比例 */
export type SizeKind = 'fixed' | 'hug' | 'fill' | 'ratio'

export interface SizeSpec {
  kind: SizeKind
  /** kind==='fixed' 时是像素；kind==='ratio' 时是比例（w/h 的比值） */
  value?: number
}

export type LayoutMode = 'free' | 'vertical' | 'horizontal' | 'grid'
export type Alignment = 'start' | 'center' | 'end' | 'stretch'
export type Justify = 'start' | 'center' | 'end' | 'space-between'
export type ConstraintH = 'left' | 'right' | 'left-right' | 'center' | 'scale'
export type ConstraintV = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale'

export interface Constraints {
  h: ConstraintH
  v: ConstraintV
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface LayoutSpec {
  mode: LayoutMode
  /** 仅 mode==='free' 时生效；切到自动布局时保留原值，切回来能还原 */
  position: { x: number; y: number }
  size: { w: SizeSpec; h: SizeSpec }
  padding: Insets
  gap: number
  /** mode==='grid' 时的列数 */
  columns: number
  align: Alignment
  justify: Justify
  wrap: boolean
  constraints: Constraints
}

export type TextAlign = 'left' | 'center' | 'right'

/** 受控样式：'' 与 0 表示「未设置」，渲染时回落到继承值 */
export interface StyleSpec {
  bg: string
  color: string
  fontSize: number
  fontWeight: number
  align: TextAlign
  radius: number
  borderWidth: number
  borderColor: string
  opacity: number
  shadowBlur: number
  shadowX: number
  shadowY: number
  shadowColor: string
  lineHeight: number
  letterSpacing: number
}

export interface NodeMeta {
  name?: string
  hidden: boolean
  locked: boolean
}

/** 断点覆盖：只存差异，空对象会被规范化删掉 */
export interface NodeOverride {
  layout?: Partial<LayoutSpec>
  style?: Partial<StyleSpec>
  props?: Record<string, unknown>
  order?: number
  hidden?: boolean
}

export interface SceneNode {
  id: NodeId
  type: ComponentType
  parentId: NodeId | null
  order: number
  layout: LayoutSpec
  style: StyleSpec
  props: Record<string, unknown>
  overrides: Record<BreakpointId, NodeOverride>
  meta: NodeMeta
}

export interface Page {
  id: PageId
  name: string
  /** 导出静态站点时的路由路径，如 '/about' */
  path: string
  /** 页面根容器（frame）的节点 id；它是整棵树里唯一 parentId===null 的节点 */
  root: NodeId
  nodes: Record<NodeId, SceneNode>
  viewport: { w: number; h: number }
}

export interface Breakpoint {
  id: BreakpointId
  label: string
  minWidth: number
  enabled: boolean
}

export interface Theme {
  tokens: Record<string, string>
}

export interface Doc {
  version: 2
  id: string
  name: string
  pages: Page[]
  activePageId: PageId
  breakpoints: Breakpoint[]
  theme: Theme
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 可被补丁修改的节点字段 */
export interface NodePatchData {
  type?: ComponentType
  layout?: LayoutSpec
  style?: StyleSpec
  props?: Record<string, unknown>
  overrides?: Record<BreakpointId, NodeOverride>
  meta?: NodeMeta
}

export interface MoveTarget {
  parentId: NodeId | null
  order: number
}

/**
 * 命令式撤销的地基：所有文档变更都表示为补丁（功能文档 §6 E1）。
 * patch 需要自包含逆信息，才能 O(1) 求逆。
 */
export type Patch =
  | { op: 'insert'; pageId: PageId; node: SceneNode }
  | { op: 'remove'; pageId: PageId; node: SceneNode }
  | { op: 'update'; pageId: PageId; id: NodeId; before: NodePatchData; after: NodePatchData }
  | { op: 'move'; pageId: PageId; id: NodeId; before: MoveTarget; after: MoveTarget }

export interface SceneNodeTree {
  node: SceneNode
  children: SceneNodeTree[]
}
