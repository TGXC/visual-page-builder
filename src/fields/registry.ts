import type { Component } from 'vue'
import type { FieldType, ValidationRule } from '@/core/types'

/**
 * 属性面板支持的控件类型。
 *
 * 与 PLAN §5 相比多了一个 `options`：select 这类字段的 `options` 本身是
 * `{label,value}[]`，用 text/textarea 都表达不了，需要一个列表编辑器。
 * 协议扩展记录在 docs/decisions.md。
 */
export type PropControl = 'text' | 'textarea' | 'number' | 'switch' | 'color' | 'select' | 'options'

export interface SelectOption {
  label: string
  value: string | number
}

/** 一条属性在面板里怎么编辑（由字段自己声明，面板不认识任何具体字段）。 */
export type PropSpec =
  | { key: string; label: string; control: Exclude<PropControl, 'select'>; placeholder?: string }
  | { key: string; label: string; control: 'select'; options: SelectOption[]; placeholder?: string }

/**
 * 字段描述对象：字段的全部知识都写在这里，注册表、属性面板、
 * 渲染器都只认这份协议，所以加字段不用改任何组件。
 */
export interface ComponentDescriptor<P extends Record<string, unknown> = Record<string, unknown>> {
  type: FieldType
  /** 组件面板里显示的名字 */
  label: string
  /** 组件面板里的图标代号（用内置 SVG，不引图标库） */
  icon: string
  /** 容器字段（group）才可以接收子字段 */
  isContainer?: boolean
  /**
   * 是否产出值。divider / group 显式声明 false：
   * 它们不该进入提交结果，也不该被当成待填字段。缺省为 true。
   */
  hasValue?: boolean
  defaultProps: P
  propSchema: PropSpec[]
  /** 拖入画布时预置的校验规则 */
  defaultRules?: ValidationRule[]
  /** 真正的渲染控件（哑组件：只认 value 与 props） */
  component: Component
  /** 导入/历史恢复时把脏数据收敛成合法 props，M6 用 */
  normalize?: (raw: unknown) => unknown
}

const registry = new Map<FieldType, ComponentDescriptor>()

export function registerComponent<P extends Record<string, unknown>>(descriptor: ComponentDescriptor<P>): void {
  if (registry.has(descriptor.type)) {
    throw new Error(`字段类型已注册: ${descriptor.type}`)
  }
  // 协变赋值是安全的：注册表只读这份描述，不会写回 defaultProps。
  registry.set(descriptor.type, descriptor as ComponentDescriptor)
}

export function getDescriptor(type: FieldType): ComponentDescriptor {
  const descriptor = registry.get(type)
  if (!descriptor) {
    throw new Error(`未注册的字段类型: ${type}（先 import '@/fields' 注册内置字段）`)
  }
  return descriptor
}

export function hasDescriptor(type: FieldType): boolean {
  return registry.has(type)
}

/** 组件面板的渲染来源：顺序即注册顺序。 */
export function listDescriptors(): ComponentDescriptor[] {
  return [...registry.values()]
}
