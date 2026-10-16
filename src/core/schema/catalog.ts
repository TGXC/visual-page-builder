import type { ComponentType, StyleSpec, Breakpoint } from './types'

/**
 * WebBuilder v1 的组件目录（原样抄自参考实现 index.html:302-329）。
 * 保留它有三个用途：①v1 项目迁移时补默认值 ②M1 复刻 15 类组件时的默认样式
 * ③「不倒退」对照表里的 15 类组件清单。
 */
export const V1_DEFAULTS: Record<string, Record<string, unknown>> = {
  text: { text: '双击编辑文字', fontSize: 16, color: '#1E293B', align: 'left', fontWeight: 400 },
  button: { text: '按钮', fontSize: 14, color: '#FFFFFF', bg: '#3B82F6', radius: 8, align: 'center', fontWeight: 700 },
  input: { text: '请输入…', fontSize: 13, color: '#64748B', bg: '#FFFFFF', radius: 6, borderWidth: 1, borderColor: '#CBD5E1' },
  rect: { bg: '#DBEAFE', radius: 4, borderWidth: 1, borderColor: '#93C5FD' },
  circle: { bg: '#FDE68A' },
  divider: { bg: '#E2E8F0' },
  nav: { text: '首页  关于  服务  联系', fontSize: 14, color: '#FFFFFF', bg: '#1A1A2E' },
  header: { text: '欢迎来到我的网站', sub: '这是一个简洁的副标题', fontSize: 24, color: '#1E293B', bg: '#F8FAFC' },
  card: { text: '卡片标题', sub: '这是卡片的描述文字，可以放任意内容。', fontSize: 15, color: '#1E293B', bg: '#FFFFFF', radius: 12 },
  image: { text: '🖼️', bg: '#E2E8F0', radius: 8 },
  select: { text: '选项一,选项二,选项三', placeholder: '请选择', fontSize: 13, color: '#1E293B', bg: '#FFFFFF', radius: 6, borderWidth: 1, borderColor: '#CBD5E1' },
  checkbox: { text: '复选框', fontSize: 13, color: '#1E293B' },
  radio: { text: '选项一,选项二', fontSize: 13, color: '#1E293B' },
  textarea: { text: '请输入内容…', fontSize: 13, color: '#64748B', bg: '#FFFFFF', radius: 6, borderWidth: 1, borderColor: '#CBD5E1' },
  video: { text: '视频地址', bg: '#111827', radius: 8 },
}

/** WebBuilder v1 的默认尺寸（参考实现 index.html:319-323） */
export const V1_DEF_SIZE: Record<string, [number, number]> = {
  text: [160, 30],
  button: [120, 40],
  input: [200, 36],
  rect: [160, 100],
  circle: [100, 100],
  divider: [200, 2],
  nav: [600, 44],
  header: [600, 120],
  card: [260, 160],
  image: [200, 120],
  select: [180, 36],
  checkbox: [140, 26],
  radio: [160, 80],
  textarea: [220, 90],
  video: [320, 180],
}

/** WebBuilder v1 的 15 类组件（迁移时不在表内的类型退化为 rect） */
export const V1_TYPES: readonly string[] = Object.keys(V1_DEF_SIZE)

/**
 * v1 的 22 个属性白名单（参考实现 index.html:325-329）。
 * 迁移时按这个白名单过滤，再拆分到 style / props / meta 三个桶。
 */
export const V1_PROP_KEYS: readonly string[] = [
  'text', 'sub', 'placeholder', 'src', 'link', 'bg', 'color', 'fontSize', 'fontWeight',
  'align', 'radius', 'borderWidth', 'borderColor', 'opacity', 'shadowBlur', 'shadowX',
  'shadowY', 'shadowColor', 'lineHeight', 'letterSpacing', 'hidden', 'locked',
]

/** v2 组件类型：frame（页面根容器）+ group（逻辑分组）+ v1 的 15 类 */
export const COMPONENT_TYPES: readonly ComponentType[] = [
  'frame', 'group',
  'text', 'button', 'input', 'rect', 'circle', 'divider',
  'nav', 'header', 'card', 'image',
  'select', 'checkbox', 'radio', 'textarea', 'video',
]

export const COMPONENT_TYPE_SET: ReadonlySet<string> = new Set<string>(COMPONENT_TYPES)

/** 15 个受控样式键（v1 props 里属于「样式」的部分） */
export const STYLE_KEYS = [
  'bg', 'color', 'fontSize', 'fontWeight', 'align', 'radius', 'borderWidth',
  'borderColor', 'opacity', 'shadowBlur', 'shadowX', 'shadowY', 'shadowColor',
  'lineHeight', 'letterSpacing',
] as const satisfies readonly (keyof StyleSpec)[]

/** 5 个内容/语义属性键 */
export const CONTENT_KEYS = ['text', 'sub', 'placeholder', 'src', 'link'] as const

/** 2 个转为 meta 的键 */
export const META_KEYS = ['hidden', 'locked'] as const

/** 样式默认值：''表示未设置，0 表示未设置（M1 渲染时回落到继承值） */
export const DEFAULT_STYLE: StyleSpec = {
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
}

/** 默认断点：桌面是基准，其余只存覆盖（功能文档 §4） */
export const DEFAULT_BREAKPOINTS: readonly Breakpoint[] = [
  { id: 'desktop', label: '桌面', minWidth: 1200, enabled: true },
  { id: 'tablet', label: '平板', minWidth: 768, enabled: true },
  { id: 'mobile', label: '手机', minWidth: 0, enabled: true },
]

export const DEFAULT_THEME_TOKENS: Record<string, string> = {
  'color-primary': '#3B82F6',
  'color-text': '#1E293B',
  'color-muted': '#64748B',
  'color-bg': '#FFFFFF',
  'color-surface': '#F8FAFC',
  'radius-sm': '6',
  'radius-md': '8',
  'radius-lg': '16',
  'space-sm': '8',
  'space-md': '16',
  'space-lg': '32',
}

export const DEFAULT_VIEWPORT = { w: 1440, h: 900 }

/** 取某类型的默认样式（从 v1 默认 props 里挑出样式键） */
export function defaultStyleFor(type: string): StyleSpec {
  const source = V1_DEFAULTS[type] ?? {}
  const style: StyleSpec = { ...DEFAULT_STYLE }
  for (const key of STYLE_KEYS) {
    const value = source[key]
    if (value !== undefined) {
      Object.assign(style, { [key]: value })
    }
  }
  return style
}

/** 取某类型的默认内容属性（从 v1 默认 props 里挑出内容键） */
export function defaultPropsFor(type: string): Record<string, unknown> {
  const source = V1_DEFAULTS[type] ?? {}
  const props: Record<string, unknown> = {}
  for (const key of CONTENT_KEYS) {
    if (source[key] !== undefined) props[key] = source[key]
  }
  return props
}

/** 取某类型的默认尺寸 */
export function defaultSizeFor(type: string): { w: number; h: number } {
  const size = V1_DEF_SIZE[type] ?? [160, 60]
  return { w: size[0], h: size[1] }
}
