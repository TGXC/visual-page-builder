/**
 * 表单搭建器的数据模型：全部是纯类型，运行时不存在（覆盖率统计里排除）。
 * 约定：字段扁平存储，靠 parentId + order 还原层级与顺序。
 */

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox'
  | 'switch' | 'date' | 'rating' | 'divider' | 'group'

export type ConditionOp = 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'truthy'

export interface Condition {
  field: string
  op: ConditionOp
  value?: unknown
}

export type CustomRuleName = 'phone' | 'email' | 'idcard'

/**
 * 规则里只存数据，不存函数：这样 FormSchema 一定能 JSON.stringify，
 * 分享链接（压缩进 URL）和导出 JSON 才成立。函数放在 CUSTOM_RULES 表里。
 */
export type ValidationRule =
  | { kind: 'required'; message?: string }
  | { kind: 'minLength'; value: number; message?: string }
  | { kind: 'maxLength'; value: number; message?: string }
  | { kind: 'pattern'; value: string; message?: string }
  | { kind: 'min'; value: number; message?: string }
  | { kind: 'max'; value: number; message?: string }
  | { kind: 'custom'; name: CustomRuleName; message?: string }

export interface FieldNode {
  id: string
  parentId: string | null      // null = 根级
  order: number                // 同级内排序，从 0 开始连续
  type: FieldType
  name: string                 // 提交时的键，同级唯一
  label: string
  props: Record<string, unknown>
  rules: ValidationRule[]
  visibleWhen: Condition | null
}

export interface FormSettings {
  labelPosition: 'top' | 'left'
  submitText: string
}

export interface FormSchema {
  version: 1
  id: string
  name: string
  description: string
  fields: FieldNode[]          // 扁平存储
  settings: FormSettings
}

export type FormValues = Record<string, unknown>
export type ErrorMap = Record<string, string[]>

export type MutableFieldKey = 'name' | 'label' | 'props' | 'rules' | 'visibleWhen'

export type Patch =
  | { op: 'insert'; field: FieldNode }
  | { op: 'remove'; field: FieldNode }
  | { op: 'update'; id: string; before: Partial<Pick<FieldNode, MutableFieldKey>>; after: Partial<Pick<FieldNode, MutableFieldKey>> }
  | { op: 'move'; id: string; before: { parentId: string | null; order: number }; after: { parentId: string | null; order: number } }
