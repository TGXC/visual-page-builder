import { normalizeFieldOrder } from './tree'
import type { Condition, CustomRuleName, ErrorMap, FieldNode, FormSchema, FormValues } from './types'

/** 规则名 → 校验函数。规则里不放函数，函数集中在这张表里。 */
export const CUSTOM_RULES: Record<CustomRuleName, { test: (v: unknown) => boolean; defaultMessage: string }> = {
  phone: { test: v => /^1[3-9]\d{9}$/.test(String(v ?? '')), defaultMessage: '请输入正确的手机号' },
  email: { test: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '')), defaultMessage: '请输入正确的邮箱' },
  idcard: { test: v => /^\d{17}[\dXx]$/.test(String(v ?? '')), defaultMessage: '请输入正确的身份证号' },
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

/** 显隐条件：没有条件就是一直可见；in 的 value 不是数组时判为 false。 */
export function evaluateCondition(cond: Condition | null, values: FormValues): boolean {
  if (!cond) return true
  const actual = values[cond.field]
  switch (cond.op) {
    case 'eq':     return actual === cond.value
    case 'neq':    return actual !== cond.value
    case 'in':     return Array.isArray(cond.value) && cond.value.includes(actual)
    case 'gt':     return Number(actual) > Number(cond.value)
    case 'lt':     return Number(actual) < Number(cond.value)
    case 'truthy': return Boolean(actual)
  }
}

/**
 * 参与填写的字段：分组容器只是布局，条件不满足的字段直接不进校验。
 * 分组的条件会连带子孙：外层分组隐藏时，组里的字段也不该出现（D15）。
 * 返回顺序是**显示顺序**（树前序），所以调用方直接渲染即可，不必自己排 order。
 */
export function visibleFields(schema: FormSchema, values: FormValues): FieldNode[] {
  const displayOrder = new Map(normalizeFieldOrder(schema.fields).map((f, index) => [f.id, index]))

  const hiddenGroups = new Set(
    schema.fields.filter(f => f.type === 'group' && !evaluateCondition(f.visibleWhen, values)).map(f => f.id),
  )

  const byId = new Map(schema.fields.map(f => [f.id, f]))
  const underHiddenGroup = (field: FieldNode): boolean => {
    const seen = new Set<string>([field.id])
    let parentId = field.parentId
    while (parentId !== null) {
      if (hiddenGroups.has(parentId)) return true
      // 脏数据里可能有环，撞到走过的节点就停
      if (seen.has(parentId)) return false
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
    return false
  }

  return schema.fields
    .filter(
      f =>
        f.type !== 'group' &&
        evaluateCondition(f.visibleWhen, values) &&
        (hiddenGroups.size === 0 || !underHiddenGroup(f)),
    )
    .sort((a, b) => (displayOrder.get(a.id) ?? 0) - (displayOrder.get(b.id) ?? 0))
}

/**
 * 单字段校验。三条决定：
 * 1. 空值只由 required 负责，其它规则遇到空值跳过，否则用户还没填就一片红；
 * 2. 多条规则都命中就返回多条错误；
 * 3. custom 只查规则表，表里没有的名字不报错（脏数据不炸）。
 */
export function validateField(field: FieldNode, value: unknown): string[] {
  const errors: string[] = []
  for (const rule of field.rules) {
    switch (rule.kind) {
      case 'required':
        if (isEmpty(value)) errors.push(rule.message ?? `${field.label}不能为空`)
        break
      case 'minLength':
        if (!isEmpty(value) && String(value).length < rule.value) errors.push(rule.message ?? `至少 ${rule.value} 个字符`)
        break
      case 'maxLength':
        if (!isEmpty(value) && String(value).length > rule.value) errors.push(rule.message ?? `最多 ${rule.value} 个字符`)
        break
      case 'pattern':
        if (!isEmpty(value) && !new RegExp(rule.value).test(String(value))) errors.push(rule.message ?? `${field.label}格式不正确`)
        break
      case 'min':
        if (!isEmpty(value) && Number(value) < rule.value) errors.push(rule.message ?? `不能小于 ${rule.value}`)
        break
      case 'max':
        if (!isEmpty(value) && Number(value) > rule.value) errors.push(rule.message ?? `不能大于 ${rule.value}`)
        break
      case 'custom': {
        const r = CUSTOM_RULES[rule.name]
        if (!isEmpty(value) && r && !r.test(value)) errors.push(rule.message ?? r.defaultMessage)
        break
      }
    }
  }
  return errors
}

/** 全表单校验：键是字段 name，只返回有错的字段。 */
export function validateForm(schema: FormSchema, values: FormValues): ErrorMap {
  const errors: ErrorMap = {}
  for (const field of visibleFields(schema, values)) {
    const fieldErrors = validateField(field, values[field.name])
    if (fieldErrors.length) errors[field.name] = fieldErrors
  }
  return errors
}
