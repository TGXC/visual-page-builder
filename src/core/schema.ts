import { createId } from './id'
import { normalizeFieldOrder } from './tree'
import type {
  Condition,
  ConditionOp,
  FieldNode,
  FieldType,
  FormSchema,
  FormSettings,
  ValidationRule,
} from './types'

/**
 * 导入 / 读档时的收敛层。
 * 手写的 JSON、上个版本存的档、别人发来的文件都可能缺字段、id 重复、order 乱掉，
 * 与其在渲染器里到处写防御代码，不如在入口把它们收敛成一份「规范 schema」。
 * core 不认识 fields/registry（那层 import Vue 组件），所以合法类型在这里单独列一份。
 */
export const SCHEMA_VERSION = 1

export const FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'number',
  'select',
  'radio',
  'checkbox',
  'switch',
  'date',
  'rating',
  'divider',
  'group',
]

export const CONDITION_OPS: ConditionOp[] = ['eq', 'neq', 'in', 'gt', 'lt', 'truthy']

export const DEFAULT_SETTINGS: FormSettings = { labelPosition: 'top', submitText: '提交' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

function uniqueName(base: string, taken: Set<string>): string {
  let index = 1
  let candidate = `${base}${index}`
  while (taken.has(candidate)) {
    index += 1
    candidate = `${base}${index}`
  }
  return candidate
}

function normalizeRules(raw: unknown): ValidationRule[] {
  if (!Array.isArray(raw)) return []
  const rules: ValidationRule[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const message = typeof item.message === 'string' ? item.message : undefined
    switch (item.kind) {
      case 'required':
        rules.push(message === undefined ? { kind: 'required' } : { kind: 'required', message })
        break
      case 'minLength':
      case 'maxLength':
      case 'min':
      case 'max': {
        const value = item.value
        if (typeof value !== 'number' || !Number.isFinite(value)) break
        rules.push(message === undefined ? { kind: item.kind, value } : { kind: item.kind, value, message })
        break
      }
      case 'pattern': {
        const value = item.value
        if (typeof value !== 'string') break
        rules.push(message === undefined ? { kind: 'pattern', value } : { kind: 'pattern', value, message })
        break
      }
      case 'custom': {
        const name = item.name
        if (name !== 'phone' && name !== 'email' && name !== 'idcard') break
        rules.push(message === undefined ? { kind: 'custom', name } : { kind: 'custom', name, message })
        break
      }
      default:
        break
    }
  }
  return rules
}

function normalizeCondition(raw: unknown): Condition | null {
  if (!isRecord(raw)) return null
  const field = raw.field
  const op = raw.op
  if (typeof field !== 'string' || field === '') return null
  if (!CONDITION_OPS.includes(op as ConditionOp)) return null
  const condition: Condition = { field, op: op as ConditionOp }
  if (raw.value !== undefined) condition.value = raw.value
  return condition
}

function normalizeField(raw: Record<string, unknown>, id: string): FieldNode {
  const type = FIELD_TYPES.includes(raw.type as FieldType) ? (raw.type as FieldType) : 'text'
  const parentId = asString(raw.parentId)
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0
  return {
    id,
    parentId: parentId === '' || parentId === id ? null : parentId,
    order,
    type,
    name: asString(raw.name) || type,
    label: asString(raw.label) || '未命名字段',
    props: isRecord(raw.props) ? { ...raw.props } : {},
    rules: normalizeRules(raw.rules),
    visibleWhen: normalizeCondition(raw.visibleWhen),
  }
}

export function createEmptySchema(name = '未命名表单'): FormSchema {
  return {
    version: SCHEMA_VERSION,
    id: createId('form'),
    name,
    description: '',
    fields: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

/** 任意输入 → 规范 schema；不是表单文件就返回 null（调用方据此拒绝导入） */
export function normalizeSchema(raw: unknown): FormSchema | null {
  if (!isRecord(raw)) return null
  if (raw.version !== SCHEMA_VERSION) return null
  if (!Array.isArray(raw.fields)) return null

  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const fields: FieldNode[] = []
  for (const item of raw.fields) {
    if (!isRecord(item)) continue
    const rawId = asString(item.id)
    // id 重复会让「按 id 查字段」「补丁按 id 定位」全部失效，宁可直接换一个新的
    const id = rawId !== '' && !seenIds.has(rawId) ? rawId : createId()
    seenIds.add(id)
    const field = normalizeField(item, id)
    // name 是提交结果的键，重复会让两个字段写同一个键
    if (seenNames.has(field.name)) field.name = uniqueName(field.name, seenNames)
    seenNames.add(field.name)
    fields.push(field)
  }

  const byId = new Map(fields.map(f => [f.id, f]))

  // 孤儿挂回根层：parentId 指向不存在的字段，字段会在画布上消失，那比"挪个位置"糟糕得多
  for (const field of fields) {
    if (field.parentId !== null && !byId.has(field.parentId)) field.parentId = null
  }
  // 环：沿着 parentId 上溯撞到走过的节点就断开，否则 buildTree/visibleFields 会死循环
  for (const field of fields) {
    const seen = new Set<string>([field.id])
    let parentId = field.parentId
    while (parentId !== null) {
      if (seen.has(parentId)) {
        field.parentId = null
        break
      }
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }

  // 同级 order 重排成 0..n-1：手改过的 JSON 里 order 可能是 5、5、9
  const nextOrder = new Map<string, number>()
  for (const field of [...fields].sort((a, b) => a.order - b.order)) {
    const key = field.parentId ?? ''
    const next = nextOrder.get(key) ?? 0
    field.order = next
    nextOrder.set(key, next + 1)
  }

  const rawSettings = isRecord(raw.settings) ? raw.settings : {}
  const settings: FormSettings = {
    labelPosition: rawSettings.labelPosition === 'left' ? 'left' : DEFAULT_SETTINGS.labelPosition,
    submitText: asString(rawSettings.submitText) || DEFAULT_SETTINGS.submitText,
  }

  return {
    version: SCHEMA_VERSION,
    id: asString(raw.id) || createId('form'),
    name: asString(raw.name) || '未命名表单',
    description: asString(raw.description),
    fields: normalizeFieldOrder(fields),
    settings,
  }
}

export type ParseResult = { ok: true; schema: FormSchema } | { ok: false; error: string }

/** 导入入口：文本 → 结果对象。调用方拿 `ok` 决定「进 store」还是「显示错误」 */
export function parseSchemaJson(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' }
  }
  const schema = normalizeSchema(raw)
  if (!schema) return { ok: false, error: '不是有效的表单文件（version 必须是 1，且要有 fields 数组）' }
  return { ok: true, schema }
}

/** 导出用的文本：缩进 2 空格，方便直接看 diff / 手工改 */
export function toJsonText(schema: FormSchema): string {
  return JSON.stringify(schema, null, 2)
}

/** 导出的文件名：表单名里不能出现路径分隔符等字符 */
export function schemaFileName(schema: FormSchema): string {
  const base = schema.name.trim() === '' ? 'form' : schema.name.trim()
  return `${base.replace(/[\\/:*?"<>|\s]+/g, '-')}.json`
}
