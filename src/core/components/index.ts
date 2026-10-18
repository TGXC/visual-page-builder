/**
 * 组件描述符注册表（插件式）。
 *
 * 每个组件类型的所有「知识」都集中在一个 `ComponentDescriptor` 里：默认尺寸、
 * 默认样式/属性、内容 HTML（导出用 + 画布用）、AI 助手说明、实例覆盖白名单。
 * 画布与导出都从这里取内容片段，避免两边各写一套渲染逻辑然后漂移。
 *
 * 第三方组件用 `registerComponent()` 注册即可被拖入、保存、导出（M4 验收）。
 * 注册表只依赖 `schema/types`、`schema/v1` 与 `html`，不依赖 `schema/catalog`，
 * 依赖方向单向，不会出现循环导入。
 */
import type { ComponentType, NodeId, SceneNode, StyleSpec } from '../schema/types'
import { CONTENT_KEYS, DEFAULT_STYLE, STYLE_KEYS, v1PropsFor, v1SizeFor, v1StyleFor } from '../schema/v1'
import { escapeHtml, safeUrl } from '../html'

export type ComponentCategory = 'layout' | 'basic' | 'form' | 'media' | 'display' | 'custom'

export const COMPONENT_CATEGORIES: readonly { id: ComponentCategory; label: string }[] = [
  { id: 'layout', label: '布局' },
  { id: 'basic', label: '基础' },
  { id: 'form', label: '表单' },
  { id: 'media', label: '媒体' },
  { id: 'display', label: '展示' },
  { id: 'custom', label: '我的组件' },
]

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  layout: '布局',
  basic: '基础',
  form: '表单',
  media: '媒体',
  display: '展示',
  custom: '我的组件',
}

/** 渲染上下文：描述符拿到的都是已经归一化好的值（转义、URL 白名单已做） */
export interface ComponentRenderContext {
  node: SceneNode
  nodes: Record<NodeId, SceneNode>
  children: SceneNode[]
  /** props.text */
  label: string
  /** props.sub */
  sub: string
  /** props.placeholder */
  placeholder: string
  /** 已过 safeUrl 的 props.src */
  src: string
  /** 已过 safeUrl 的 props.link */
  link: string
  /** props.text 按逗号切分出的选项 */
  options: string[]
}

export interface ComponentDescriptor {
  type: ComponentType
  label: string
  category: ComponentCategory
  icon: string
  /** 能否容纳子节点 */
  container: boolean
  /** 双击能否直接编辑文字（M20 起除内部类型外都支持） */
  editable: boolean
  /**
   * 双击编辑写哪个 props 字段：输入类写在 placeholder，其余默认 text。
   * 外部自定义组件可以省略（按 text 处理）。
   */
  editKey?: string
  /**
   * 内容渲染里没有 text 的组件（布局容器/进度条/日期等）：
   * 用户自定义过 text 时，在画布与导出里用 `.el__caption` 角标把文字显示出来，
   * 否则「能双击输入但看不见」等于还是不能输入。省略即不显示角标。
   */
  caption?: boolean
  defaultSize: { w: number; h: number }
  /** 相对 DEFAULT_STYLE 的差异（解析时与 DEFAULT_STYLE 合并） */
  defaultStyle: Partial<StyleSpec>
  defaultProps: Record<string, unknown>
  /** 导出 HTML 的内容片段（不含外层 element 容器） */
  toHtml: (ctx: ComponentRenderContext) => string
  /** 画布内容片段（不含外层 element 容器与子节点） */
  toCanvasHtml: (ctx: ComponentRenderContext) => string
  /** 给 AI 助手的组件说明 */
  aiDoc: string
  /** 实例可覆盖的属性白名单（M4 组件/实例用） */
  overridable: readonly string[]
  /**
   * 组件自带的作用域 CSS（M7 自定义组件用）：入参是外层元素的选择器（如 `.n-c1`），
   * 返回的每条规则都必须以它开头。codegen 会把它追加到页面样式表末尾，
   * 这样自定义组件的内部结构也能类名化 —— 导出仍然没有内联样式。
   */
  cssFor?: (scope: string) => string
  /** 内部类型：注册进收敛层与渲染，但不进组件面板（如 `instance`） */
  hidden?: boolean
}

const registry = new Map<string, ComponentDescriptor>()
/** 实时注册类型集合（第三方注册后立即可用于收敛层） */
export const REGISTERED_TYPES: Set<string> = new Set<string>()
/** 实时组件类型清单（注册顺序） */
export const COMPONENT_TYPES: ComponentType[] = []

/**
 * 注册表版本号 + 订阅：core 不能引 Vue，面板用订阅把「注册表变了」翻译成响应式更新
 * （插件式注册要立刻出现在组件面板里）。
 */
let revision = 0
const listeners = new Set<() => void>()

export function registryRevision(): number {
  return revision
}

export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function bumpRegistry(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function registerComponent(descriptor: ComponentDescriptor): ComponentDescriptor {
  if (!descriptor.type) throw new Error('组件描述符缺少 type')
  if (!registry.has(descriptor.type)) COMPONENT_TYPES.push(descriptor.type)
  registry.set(descriptor.type, descriptor)
  REGISTERED_TYPES.add(descriptor.type)
  bumpRegistry()
  return descriptor
}

export function unregisterComponent(type: string): boolean {
  if (!registry.has(type)) return false
  registry.delete(type)
  REGISTERED_TYPES.delete(type)
  const index = COMPONENT_TYPES.indexOf(type)
  if (index >= 0) COMPONENT_TYPES.splice(index, 1)
  bumpRegistry()
  return true
}

export function getComponent(type: string): ComponentDescriptor | undefined {
  return registry.get(type)
}

export function hasComponent(type: string): boolean {
  return registry.has(type)
}

/**
 * 类型的中文名：图层 / 属性面板 / 画布角标 / 面包屑统一走这里。
 * 用中文 label 是用户 m09506 的反馈（图层里一堆 `text`/`section` 看不懂）；
 * 没注册的类型（老文档、导入的怪数据）原样返回，总比显示空白强。
 */
export function componentLabel(type: string): string {
  return registry.get(type)?.label ?? type
}

/** 组件面板面向的清单：不含 `hidden: true` 的内部类型 */
export function listComponents(): ComponentDescriptor[] {
  return [...registry.values()].filter((item) => item.hidden !== true)
}

export function componentTypes(): string[] {
  return [...registry.keys()]
}

export function isContainerType(type: string): boolean {
  return registry.get(type)?.container === true
}

export function isEditableType(type: string): boolean {
  return registry.get(type)?.editable === true
}

/** 双击编辑写入的 props 字段；未注册类型按 text 处理 */
export function editKeyOf(type: string): string {
  return registry.get(type)?.editKey ?? 'text'
}

export interface ComponentCategoryGroup {
  category: ComponentCategory
  label: string
  items: ComponentDescriptor[]
}

export function componentsByCategory(): ComponentCategoryGroup[] {
  return COMPONENT_CATEGORIES.map(({ id, label }) => ({
    category: id,
    label,
    items: listComponents().filter((item) => item.category === id),
  }))
}

/** 搜索：按中文名、type、分类名、说明文字匹配；空查询返回全部 */
export function searchComponents(query: string): ComponentDescriptor[] {
  const keyword = query.trim().toLowerCase()
  if (keyword === '') return listComponents()
  return listComponents().filter((item) => {
    const haystack = [item.type, item.label, CATEGORY_LABELS[item.category], item.aiDoc].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
}

/* ------------------------------------------------------------------ 默认值解析 */

export function componentStyle(type: string): StyleSpec {
  const descriptor = registry.get(type)
  if (!descriptor) return v1StyleFor(type)
  return { ...DEFAULT_STYLE, ...descriptor.defaultStyle }
}

export function componentProps(type: string): Record<string, unknown> {
  const descriptor = registry.get(type)
  if (!descriptor) return v1PropsFor(type)
  return { ...descriptor.defaultProps }
}

export function componentSize(type: string): { w: number; h: number } {
  return registry.get(type)?.defaultSize ?? v1SizeFor(type)
}

/** 实例可覆盖的属性白名单；未注册类型回落到内容属性 */
export function overridableKeys(type: string): readonly string[] {
  return registry.get(type)?.overridable ?? CONTENT_KEYS
}

/* ------------------------------------------------------------------ 内容渲染 */

function raw(node: SceneNode, key: string): string {
  const value = node.props[key]
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function optionsOf(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function childNodes(node: SceneNode, nodes: Record<NodeId, SceneNode>): SceneNode[] {
  return Object.values(nodes)
    .filter((item) => item.parentId === node.id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function renderContext(node: SceneNode, nodes: Record<NodeId, SceneNode>): ComponentRenderContext {
  return {
    node,
    nodes,
    // 懒计算（M8 性能）：`childNodes` 要扫描整张节点表，导出 1000 节点时每个节点都算一次
    // 会退化成 O(n²)；导出路径根本不读 children，只有画布的「空容器提示」会读。
    get children(): SceneNode[] {
      return childNodes(node, nodes)
    },
    label: raw(node, 'text'),
    sub: raw(node, 'sub'),
    placeholder: raw(node, 'placeholder'),
    src: safeUrl(raw(node, 'src')),
    link: safeUrl(raw(node, 'link')),
    options: optionsOf(raw(node, 'text')),
  }
}

/**
 * 角标文字：给「内容里不渲染 text」的组件用（容器/进度条/日期……）。
 *
 * 只在用户把 text 改成**非默认值**时出现 —— 否则每个容器都会顶着
 * 「容器」「表单」两个字，画布立刻变成一团标签。导出用同一份，
 * 保证画布上看到的文字在导出的页面里也在。
 */
function captionOf(node: SceneNode, descriptor: ComponentDescriptor | undefined): string {
  if (!descriptor?.caption) return ''
  const text = raw(node, 'text')
  if (text === '') return ''
  const fallback = descriptor.defaultProps.text
  if (typeof fallback === 'string' && text === fallback) return ''
  return `<span class="el__caption">${escapeHtml(text)}</span>`
}

/** 导出用的内容 HTML；未注册类型回落到纯文本 */
export function renderContent(node: SceneNode, nodes: Record<NodeId, SceneNode>): string {
  const descriptor = registry.get(node.type)
  if (!descriptor) return escapeHtml(raw(node, 'text'))
  return captionOf(node, descriptor) + descriptor.toHtml(renderContext(node, nodes))
}

/** 画布用的内容 HTML */
export function renderCanvasContent(node: SceneNode, nodes: Record<NodeId, SceneNode>): string {
  const descriptor = registry.get(node.type)
  if (!descriptor) return escapeHtml(raw(node, 'text'))
  return captionOf(node, descriptor) + descriptor.toCanvasHtml(renderContext(node, nodes))
}

/* ------------------------------------------------------------------ 描述符定义 */

interface Spec {
  type: ComponentType
  label: string
  category: ComponentCategory
  icon: string
  container?: boolean
  editable?: boolean
  /** 新类型（不在 v1 表里）必须显式给默认尺寸 */
  size?: [number, number]
  style?: Partial<StyleSpec>
  props?: Record<string, unknown>
  aiDoc: string
  overridable?: readonly string[]
  /** 双击编辑的 props 字段，默认 `text`；输入类组件用 `placeholder` */
  editKey?: string
  /** 内容里不渲染 text 的组件，用角标文字展示用户输入的文字 */
  caption?: boolean
  hidden?: boolean
  html?: (ctx: ComponentRenderContext) => string
  canvas?: (ctx: ComponentRenderContext) => string
}

function styleDiff(style: StyleSpec): Partial<StyleSpec> {
  const diff: Record<string, unknown> = {}
  for (const key of STYLE_KEYS) {
    if (style[key] !== DEFAULT_STYLE[key]) diff[key] = style[key]
  }
  return diff as Partial<StyleSpec>
}

const DEFAULT_OVERRIDABLE: readonly string[] = ['text', 'color', 'fontSize', 'bg']

function spec(input: Spec): ComponentDescriptor {
  const fromV1 = input.size === undefined
  const size = fromV1 ? v1SizeFor(input.type) : { w: input.size![0], h: input.size![1] }
  const style = input.style ?? (fromV1 ? styleDiff(v1StyleFor(input.type)) : {})
  const props = input.props ?? (fromV1 ? v1PropsFor(input.type) : {})
  const html = input.html ?? ((ctx: ComponentRenderContext) => escapeHtml(ctx.label))
  const canvas = input.canvas ?? html
  return {
    type: input.type,
    label: input.label,
    category: input.category,
    icon: input.icon,
    container: input.container === true,
    // M20：双击改文字对所有对外组件开放（内部类型如 instance 仍关闭），
    // 具体写哪个字段由 editKey 决定；内容里不显示 text 的组件用 caption 角标兜底。
    editable: input.editable !== false && input.hidden !== true,
    editKey: input.editKey ?? 'text',
    caption: input.caption === true,
    defaultSize: size,
    defaultStyle: style,
    defaultProps: props,
    toHtml: html,
    toCanvasHtml: canvas,
    aiDoc: input.aiDoc,
    overridable: input.overridable ?? DEFAULT_OVERRIDABLE,
    ...(input.hidden ? { hidden: true } : {}),
  }
}

const escape = escapeHtml
const label = (ctx: ComponentRenderContext) => escape(ctx.label)
const muted = (text: string) => `<span class="canvas-el__muted">${escape(text)}</span>`
const title = (text: string) => `<div class="canvas-el__title">${escape(text)}</div>`

const SPECS: Spec[] = [
  /* ---------------- 布局 ---------------- */
  {
    type: 'frame',
    label: '容器',
    category: 'layout',
    icon: '⬚',
    container: true,
    size: [480, 320],
    style: { bg: '#FFFFFF', radius: 8 },
    props: { text: '容器' },
    caption: true,
    aiDoc: '容器（frame）：页面根节点或任意嵌套的布局盒子，可以装其它组件，支持四种排布模式。',
    overridable: ['bg', 'radius', 'padding'],
    html: () => '',
    canvas: (ctx) => (ctx.children.length > 0 ? '' : '<span class="canvas-el__frame-hint">从左侧拖入组件开始搭建</span>'),
  },
  {
    type: 'group',
    label: '分组',
    category: 'layout',
    icon: '▣',
    container: true,
    size: [240, 160],
    style: { borderWidth: 1, borderColor: '#CBD5E1', radius: 8 },
    props: { text: '分组' },
    caption: true,
    aiDoc: '分组（group）：把若干元素逻辑上归到一起，本身不带视觉样式，方便整体移动与显示隐藏。',
    overridable: ['bg', 'radius'],
    html: () => '',
    canvas: (ctx) => (ctx.children.length > 0 ? '' : muted('空分组')),
  },
  {
    type: 'section',
    label: '区块',
    category: 'layout',
    icon: '▭',
    container: true,
    size: [600, 240],
    style: { bg: '#F8FAFC', radius: 8 },
    props: { text: '区块' },
    caption: true,
    aiDoc: '区块（section）：一块有背景的页面区域，用来划分页面结构，内部可以继续放其它元素。',
    overridable: ['bg', 'radius', 'padding'],
    html: () => '',
    canvas: (ctx) => (ctx.children.length > 0 ? '' : muted('空区块')),
  },
  {
    type: 'container',
    label: '弹性盒',
    category: 'layout',
    icon: '▤',
    container: true,
    size: [480, 220],
    style: { borderWidth: 1, borderColor: '#E2E8F0', radius: 8 },
    props: { text: '弹性盒' },
    caption: true,
    aiDoc: '弹性盒（container）：默认纵向排列子元素的布局盒子，可切换纵向、横向、网格排布。',
    overridable: ['bg', 'radius', 'padding'],
    html: () => '',
    canvas: (ctx) => (ctx.children.length > 0 ? '' : muted('空容器')),
  },
  {
    type: 'columns',
    label: '分栏',
    category: 'layout',
    icon: '▥',
    container: true,
    size: [600, 200],
    style: { radius: 8 },
    props: { text: '分栏' },
    caption: true,
    aiDoc: '分栏（columns）：横向排列子元素的容器，用来做左右并排的内容。',
    overridable: ['bg', 'radius', 'padding'],
    html: () => '',
    canvas: (ctx) => (ctx.children.length > 0 ? '' : muted('空分栏')),
  },
  {
    type: 'divider',
    label: '分割线',
    category: 'layout',
    icon: '—',
    caption: true,
    aiDoc: '分割线（divider）：一条水平分隔线，用背景色控制颜色与粗细。',
    overridable: ['bg'],
    html: () => '',
    canvas: () => '',
  },
  {
    type: 'spacer',
    label: '间距',
    category: 'layout',
    icon: '⇕',
    caption: true,
    size: [200, 24],
    props: { text: '间距' },
    aiDoc: '间距（spacer）：一个占位空盒子，用来在元素之间制造空隙。',
    overridable: [],
    html: () => '',
    canvas: () => '',
  },

  /* ---------------- 基础 ---------------- */
  {
    type: 'text',
    label: '文本',
    category: 'basic',
    icon: 'T',
    editable: true,
    aiDoc: '文本（text）：最常用的文字元素，双击即可编辑内容，支持字号、颜色、对齐等样式。',
  },
  {
    type: 'heading',
    label: '标题',
    category: 'basic',
    icon: 'H',
    editable: true,
    size: [320, 44],
    style: { fontSize: 24, fontWeight: 700, color: '#1E293B' },
    props: { text: '标题' },
    aiDoc: '标题（heading）：语义化的大标题文字（导出为 h2），用于页面与区块的标题层级。',
    html: (ctx) => `<h2 class="el__heading">${label(ctx)}</h2>`,
    canvas: (ctx) => title(ctx.label),
  },
  {
    type: 'label',
    label: '标签',
    category: 'basic',
    icon: '⌗',
    editable: true,
    size: [160, 24],
    style: { fontSize: 13, color: '#475569' },
    props: { text: '标签' },
    aiDoc: '标签（label）：跟在输入控件旁边的小字说明，字号较小、颜色偏灰。',
    html: (ctx) => `<span class="el__label">${label(ctx)}</span>`,
  },
  {
    type: 'button',
    label: '按钮',
    category: 'basic',
    icon: '▭',
    editable: true,
    aiDoc: '按钮（button）：可点击的按钮，导出为原生 button 标签，可设置链接跳转。',
    overridable: ['text', 'bg', 'color', 'radius', 'fontSize'],
    canvas: (ctx) => escape(ctx.label || '按钮'),
  },
  {
    type: 'link',
    label: '链接',
    category: 'basic',
    icon: '🔗',
    editable: true,
    size: [160, 28],
    style: { color: '#2563EB', fontSize: 14 },
    props: { text: '去这里', link: '#' },
    aiDoc: '链接（link）：一段可点击的锚文本，通过 link 属性设置跳转地址。',
    overridable: ['text', 'link', 'color', 'fontSize'],
    html: (ctx) => `<a class="el__link" href="${escape(ctx.link || '#')}" target="_blank" rel="noopener">${label(ctx)}</a>`,
  },
  {
    type: 'rect',
    label: '矩形',
    category: 'basic',
    icon: '▢',
    caption: true,
    aiDoc: '矩形（rect）：纯色或描边的矩形色块，常用来做背景、占位或装饰。',
    overridable: ['bg', 'radius', 'borderWidth', 'borderColor'],
  },
  {
    type: 'circle',
    label: '圆形',
    category: 'basic',
    icon: '◯',
    caption: true,
    aiDoc: '圆形（circle）：圆形色块，把圆角设为尺寸的一半即可，常用于头像底座或装饰点。',
    overridable: ['bg'],
  },
  {
    type: 'badge',
    label: '徽章',
    category: 'basic',
    icon: '⬤',
    editable: true,
    size: [72, 24],
    style: { bg: '#DBEAFE', color: '#1D4ED8', radius: 999, fontSize: 12, align: 'center' },
    props: { text: '徽章' },
    aiDoc: '徽章（badge）：一小块圆角高亮的短文字，用来标注状态或分类。',
    html: (ctx) => `<span class="el__badge">${label(ctx)}</span>`,
  },

  /* ---------------- 表单 ---------------- */
  {
    type: 'form',
    label: '表单容器',
    category: 'form',
    icon: '☰',
    container: true,
    size: [480, 320],
    style: { bg: '#FFFFFF', radius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
    props: { text: '表单' },
    caption: true,
    aiDoc: '表单容器（form）：容纳输入控件并负责整体提交的容器，导出为原生 form 标签。',
    overridable: ['bg', 'radius', 'padding'],
    html: () => '',
    canvas: (ctx) => (ctx.children.length > 0 ? '' : muted('空表单')),
  },
  {
    type: 'input',
    label: '输入框',
    category: 'form',
    icon: '⌷',
    // 输入类的可见文字是 placeholder，双击直接改它
    editKey: 'placeholder',
    aiDoc: '输入框（input）：单行文本输入控件，用 placeholder 展示提示文字，可设置必填与校验。',
    overridable: ['placeholder', 'bg', 'color', 'radius', 'borderColor'],
    html: (ctx) => `<input type="text" placeholder="${escape(ctx.placeholder)}">`,
    canvas: (ctx) => escape(ctx.placeholder),
  },
  {
    type: 'textarea',
    label: '文本域',
    category: 'form',
    icon: '¶',
    editKey: 'placeholder',
    aiDoc: '文本域（textarea）：多行文本输入控件，适合留言、描述一类长文本。',
    overridable: ['placeholder', 'bg', 'color', 'radius', 'borderColor'],
    html: (ctx) => `<textarea placeholder="${escape(ctx.placeholder)}"></textarea>`,
    canvas: (ctx) => escape(ctx.placeholder),
  },
  {
    type: 'select',
    label: '下拉',
    category: 'form',
    icon: '▾',
    aiDoc: '下拉选择（select）：从若干选项中选一个，选项用逗号分隔写在内容里。',
    overridable: ['text', 'placeholder', 'bg', 'color', 'radius'],
    html: (ctx) => {
      const head = ctx.placeholder ? `<option value="">${escape(ctx.placeholder)}</option>` : ''
      return `<select>${head}${ctx.options.map((item) => `<option>${escape(item)}</option>`).join('')}</select>`
    },
    canvas: (ctx) =>
      `${muted(ctx.placeholder || '请选择')}<span class="canvas-el__caret">▾</span>`,
  },
  {
    type: 'checkbox',
    label: '复选',
    category: 'form',
    icon: '☑',
    aiDoc: '复选框（checkbox）：可多选的勾选项，选项用逗号分隔写在内容里。',
    overridable: ['text', 'color', 'fontSize'],
    html: (ctx) =>
      ctx.options.map((item) => `<label><input type="checkbox">${escape(item)}</label>`).join(''),
    canvas: (ctx) =>
      ctx.options
        .map((item) => `<span class="canvas-el__choice"><i class="canvas-el__box"></i>${escape(item)}</span>`)
        .join(''),
  },
  {
    type: 'radio',
    label: '单选',
    category: 'form',
    icon: '◉',
    aiDoc: '单选框（radio）：一组里只能选一个的选项，选项用逗号分隔写在内容里。',
    overridable: ['text', 'color', 'fontSize'],
    html: (ctx) => ctx.options.map((item) => `<label><input type="radio">${escape(item)}</label>`).join(''),
    canvas: (ctx) =>
      ctx.options
        .map((item) => `<span class="canvas-el__choice"><i class="canvas-el__dot"></i>${escape(item)}</span>`)
        .join(''),
  },
  {
    type: 'switch',
    label: '开关',
    category: 'form',
    icon: '⏻',
    size: [120, 32],
    style: { fontSize: 13, color: '#1E293B' },
    props: { text: '开关' },
    aiDoc: '开关（switch）：表示开/关两种状态的切换控件，导出为 role=switch 的可访问元素。',
    overridable: ['text', 'bg', 'color'],
    html: (ctx) => `<span class="el__switch" role="switch" aria-checked="false"></span>${label(ctx)}`,
    canvas: (ctx) => `<span class="canvas-el__switch" role="switch"></span>${escape(ctx.label)}`,
  },
  {
    type: 'slider',
    label: '滑块',
    category: 'form',
    icon: '⇥',
    size: [200, 32],
    props: { text: '滑块', sub: '50' },
    caption: true,
    aiDoc: '滑块（slider）：在区间里拖动取值的控件，导出为 input type=range。',
    overridable: ['sub', 'bg', 'color'],
    html: (ctx) => {
      const value = Number(ctx.sub)
      const safe = Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : 50
      return `<input type="range" min="0" max="100" value="${safe}">`
    },
  },
  {
    type: 'date',
    label: '日期',
    category: 'form',
    icon: '📅',
    size: [180, 36],
    style: { bg: '#FFFFFF', color: '#1E293B', fontSize: 13, radius: 6, borderWidth: 1, borderColor: '#CBD5E1' },
    props: { text: '日期' },
    caption: true,
    aiDoc: '日期（date）：选择年月日的输入控件，导出为 input type=date。',
    overridable: ['bg', 'color', 'radius'],
    html: (ctx) => `<input type="date" aria-label="${escape(ctx.label)}">`,
  },
  {
    type: 'number',
    label: '数字',
    category: 'form',
    icon: '#',
    size: [140, 36],
    style: { bg: '#FFFFFF', color: '#1E293B', fontSize: 13, radius: 6, borderWidth: 1, borderColor: '#CBD5E1' },
    props: { text: '数量', placeholder: '0' },
    editKey: 'placeholder',
    aiDoc: '数字输入（number）：只接受数字的输入控件，可配合最小值与最大值使用。',
    overridable: ['placeholder', 'bg', 'color'],
    html: (ctx) => `<input type="number" placeholder="${escape(ctx.placeholder)}">`,
    canvas: (ctx) => escape(ctx.placeholder || ctx.label),
  },
  {
    type: 'file',
    label: '文件',
    category: 'form',
    icon: '📎',
    size: [220, 36],
    style: { bg: '#FFFFFF', color: '#1E293B', fontSize: 13, radius: 6, borderWidth: 1, borderColor: '#CBD5E1' },
    props: { text: '选择文件' },
    caption: true,
    aiDoc: '文件上传（file）：选择本地文件的控件，导出为 input type=file。',
    overridable: ['text', 'bg', 'color'],
    html: () => '<input type="file">',
  },
  {
    type: 'rating',
    label: '评分',
    category: 'form',
    icon: '★',
    size: [160, 28],
    style: { color: '#F59E0B', fontSize: 16 },
    props: { text: '评分', sub: '5' },
    caption: true,
    aiDoc: '评分（rating）：用星星表示评价分数的控件，数量由 sub 属性决定。',
    overridable: ['sub', 'color'],
    html: (ctx) => {
      const count = Number(ctx.sub)
      const stars = Number.isFinite(count) && count > 0 ? Math.min(10, Math.round(count)) : 5
      return `<span class="el__rating" aria-label="${escape(ctx.label)}">${'★'.repeat(stars)}</span>`
    },
  },

  /* ---------------- 媒体 ---------------- */
  {
    type: 'image',
    label: '图片',
    category: 'media',
    icon: '🖼',
    aiDoc: '图片（image）：用 src 指定图片地址（URL、本地文件或 dataURL），未设置时显示占位文字。',
    overridable: ['src', 'text', 'radius'],
    html: (ctx) => (ctx.src ? '' : label(ctx)),
    canvas: (ctx) => (ctx.src ? '' : muted(ctx.label || '图片')),
  },
  {
    type: 'video',
    label: '视频',
    category: 'media',
    icon: '▶',
    aiDoc: '视频（video）：用 src 指定视频地址，导出为原生 video 播放器。',
    overridable: ['src', 'text', 'radius'],
    html: (ctx) => (ctx.src ? `<video src="${escape(ctx.src)}" controls></video>` : label(ctx)),
    canvas: () => '<span class="canvas-el__play">▶</span>',
  },
  {
    type: 'audio',
    label: '音频',
    category: 'media',
    icon: '♪',
    size: [320, 54],
    style: { bg: '#111827', color: '#F8FAFC', radius: 8 },
    props: { text: '音频地址' },
    aiDoc: '音频（audio）：用 src 指定音频地址，导出为原生 audio 播放条。',
    overridable: ['src', 'text'],
    html: (ctx) => (ctx.src ? `<audio src="${escape(ctx.src)}" controls></audio>` : label(ctx)),
    canvas: (ctx) => muted(ctx.label || '音频'),
  },
  {
    type: 'icon',
    label: '图标',
    category: 'media',
    icon: '★',
    size: [48, 48],
    style: { fontSize: 24, color: '#334155', align: 'center' },
    props: { text: '★' },
    aiDoc: '图标（icon）：单个字符或 emoji 组成的图标，尺寸与颜色可控。',
    overridable: ['text', 'color', 'fontSize'],
    html: (ctx) => `<span class="el__icon">${escape(ctx.label || '★')}</span>`,
  },
  {
    type: 'avatar',
    label: '头像',
    category: 'media',
    icon: '👤',
    size: [64, 64],
    style: { bg: '#E2E8F0', color: '#334155', radius: 999, fontSize: 20, align: 'center' },
    props: { text: 'Ada' },
    aiDoc: '头像（avatar）：圆形头像占位，没有图片时显示名字首字母。',
    overridable: ['src', 'text', 'bg'],
    html: (ctx) => `<span class="el__avatar">${escape(ctx.label.trim().charAt(0).toUpperCase() || '?')}</span>`,
  },

  /* ---------------- 展示 ---------------- */
  {
    type: 'nav',
    label: '导航栏',
    category: 'display',
    icon: '☰',
    editable: true,
    aiDoc: '导航栏（nav）：页面顶部的横向菜单条，条目用逗号或空格分隔写在内容里。',
  },
  {
    type: 'header',
    label: '页头',
    category: 'display',
    icon: '▤',
    editable: true,
    aiDoc: '页头（header）：带主标题与副标题的页头区域，适合放在页面最上方。',
    overridable: ['text', 'sub', 'bg', 'color', 'fontSize'],
    html: (ctx) => [label(ctx), ctx.sub ? `<div class="sub">${escape(ctx.sub)}</div>` : ''].join(''),
    canvas: (ctx) => title(ctx.label) + (ctx.sub ? `<div class="canvas-el__sub">${escape(ctx.sub)}</div>` : ''),
  },
  {
    type: 'card',
    label: '卡片',
    category: 'display',
    icon: '❏',
    editable: true,
    aiDoc: '卡片（card）：带标题与描述的内容卡片，可继续往里放图片、按钮等元素。',
    overridable: ['text', 'sub', 'bg', 'color', 'radius'],
    html: (ctx) => [label(ctx), ctx.sub ? `<div class="sub">${escape(ctx.sub)}</div>` : ''].join(''),
    canvas: (ctx) => title(ctx.label) + (ctx.sub ? `<div class="canvas-el__sub">${escape(ctx.sub)}</div>` : ''),
  },
  {
    type: 'list',
    label: '列表',
    category: 'display',
    icon: '≣',
    size: [260, 160],
    style: { fontSize: 14, color: '#1E293B', lineHeight: 1.8 },
    props: { text: '第一项,第二项,第三项' },
    aiDoc: '列表（list）：纵向排列的条目清单，条目用逗号分隔写在内容里。',
    overridable: ['text', 'color', 'fontSize'],
    html: (ctx) => `<ul class="el__list">${ctx.options.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`,
  },
  {
    type: 'table',
    label: '表格',
    category: 'display',
    icon: '▦',
    size: [360, 180],
    style: { fontSize: 13, color: '#1E293B', borderWidth: 1, borderColor: '#E2E8F0' },
    props: { text: '列一,列二,列三', sub: '甲,乙,丙; 丁,戊,己' },
    aiDoc: '表格（table）：带表头的简单数据表格，表头写在内容里，数据行写在副标题里（分号分行、逗号分列）。',
    overridable: ['text', 'sub', 'fontSize'],
    html: (ctx) => {
      const head = ctx.options.map((item) => `<th>${escape(item)}</th>`).join('')
      const rows = ctx.sub
        .split(';')
        .map((row) => row.trim())
        .filter((row) => row !== '')
        .map((row) => `<tr>${row.split(',').map((cell) => `<td>${escape(cell.trim())}</td>`).join('')}</tr>`)
        .join('')
      return `<table class="el__table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
    },
  },
  {
    type: 'tabs',
    label: '标签页',
    category: 'display',
    icon: '⧉',
    size: [320, 40],
    style: { fontSize: 13, color: '#1E293B', bg: '#F1F5F9', radius: 8 },
    props: { text: '首页,关于,联系' },
    aiDoc: '标签页（tabs）：一组可切换的页签，页签名称用逗号分隔写在内容里。',
    overridable: ['text', 'bg', 'color'],
    html: (ctx) =>
      `<div class="el__tabs" role="tablist">${ctx.options
        .map((item, index) => `<button role="tab" type="button"${index === 0 ? ' aria-selected="true"' : ''}>${escape(item)}</button>`)
        .join('')}</div>`,
  },
  {
    type: 'alert',
    label: '提示',
    category: 'display',
    icon: '!',
    size: [320, 48],
    style: { bg: '#FEF3C7', color: '#92400E', radius: 8, fontSize: 13 },
    props: { text: '提示信息' },
    aiDoc: '提示（alert）：带背景色的提示条，用来强调说明或警告内容。',
    overridable: ['text', 'bg', 'color'],
    html: (ctx) => `<div class="el__alert" role="alert">${label(ctx)}</div>`,
  },
  {
    type: 'progress',
    label: '进度条',
    category: 'display',
    icon: '▰',
    size: [240, 16],
    style: { bg: '#E2E8F0', radius: 999 },
    props: { text: '进度', sub: '60' },
    caption: true,
    aiDoc: '进度条（progress）：用 0 到 100 的数值表示完成度，导出为原生 progress 标签。',
    overridable: ['sub', 'bg'],
    html: (ctx) => {
      const value = Number(ctx.sub)
      const safe = Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : 60
      return `<progress max="100" value="${safe}"></progress>`
    },
  },
  /* ---------------- 内部类型 ---------------- */
  {
    type: 'instance',
    label: '组件实例',
    category: 'layout',
    icon: '◈',
    container: true,
    editable: false,
    hidden: true,
    size: [240, 120],
    aiDoc: '组件实例（instance）：引用一个组件的实例，展开后渲染组件内容，可用白名单属性覆盖。',
    props: { text: '' },
    html: () => '',
    canvas: () => '',
  },
]

for (const item of SPECS) registerComponent(spec(item))
