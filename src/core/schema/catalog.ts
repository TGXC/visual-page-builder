/**
 * v2 组件目录的对外入口。
 *
 * 组件的「知识」（默认尺寸/样式/属性、内容渲染、AI 说明）都在
 * `core/components` 的描述符注册表里；这里只做两件事：
 * ①把 v1 迁移表与样式键表原样透出（`schema/v1`）②给调用方一组便捷的默认值解析函数。
 */
import type { Breakpoint, ComponentType, StyleSpec } from './types'
import {
  COMPONENT_TYPES as REGISTERED_COMPONENT_TYPES,
  REGISTERED_TYPES,
  componentProps,
  componentSize,
  componentStyle,
} from '../components'

export {
  CONTENT_KEYS,
  DEFAULT_STYLE,
  META_KEYS,
  STYLE_KEYS,
  V1_DEFAULTS,
  V1_DEF_SIZE,
  V1_PROP_KEYS,
  V1_TYPES,
} from './v1'

/** 组件类型清单（实时：第三方注册后立刻出现在这里） */
export const COMPONENT_TYPES: readonly ComponentType[] = REGISTERED_COMPONENT_TYPES

/** 组件类型集合（实时） */
export const COMPONENT_TYPE_SET: ReadonlySet<string> = REGISTERED_TYPES

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

/** 取某类型的默认样式（描述符优先，未注册类型回落到 v1 表） */
export function defaultStyleFor(type: string): StyleSpec {
  return componentStyle(type)
}

/** 取某类型的默认内容属性 */
export function defaultPropsFor(type: string): Record<string, unknown> {
  return componentProps(type)
}

/** 取某类型的默认尺寸 */
export function defaultSizeFor(type: string): { w: number; h: number } {
  return componentSize(type)
}
