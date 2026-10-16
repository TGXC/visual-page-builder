import { describe, expect, it } from 'vitest'
import { CUSTOM_RULES, evaluateCondition, validateField, validateForm, visibleFields } from '@/core/validation'
import type { FieldNode, ValidationRule } from '@/core/types'
import { makeField, makeSchema } from './factories'

const withRules = (rules: ValidationRule[], label = '字段'): FieldNode => makeField({ type: 'text', label, rules })

describe('validateField · required', () => {
  const field = withRules([{ kind: 'required' }], '姓名')

  it('空字符串、null、undefined、空数组都判为未填', () => {
    expect(validateField(field, '')).toEqual(['姓名不能为空'])
    expect(validateField(field, null)).toEqual(['姓名不能为空'])
    expect(validateField(field, undefined)).toEqual(['姓名不能为空'])
    expect(validateField(field, [])).toEqual(['姓名不能为空'])
  })

  it('填了值就通过，自定义 message 优先', () => {
    expect(validateField(field, '张三')).toEqual([])
    expect(validateField(withRules([{ kind: 'required', message: '必填项' }]), '')).toEqual(['必填项'])
  })
})

describe('validateField · 长度、正则、数值', () => {
  it('非空才做长度校验：空值时 minLength 直接跳过', () => {
    const field = withRules([{ kind: 'minLength', value: 3 }])
    expect(validateField(field, '')).toEqual([])
    expect(validateField(field, 'ab')).toEqual(['至少 3 个字符'])
    expect(validateField(field, 'abc')).toEqual([])
  })

  it('maxLength 超长报错，可用自定义 message', () => {
    const field = withRules([{ kind: 'maxLength', value: 4, message: '最多 4 个字' }])
    expect(validateField(field, 'abcde')).toEqual(['最多 4 个字'])
    expect(validateField(field, 'abcd')).toEqual([])
    expect(validateField(withRules([{ kind: 'maxLength', value: 4 }]), 'abcde')).toEqual(['最多 4 个字符'])
  })

  it('pattern 生效，空值跳过', () => {
    const field = withRules([{ kind: 'pattern', value: '^[a-z]+$' }], '编号')
    expect(validateField(field, 'ABC')).toEqual(['编号格式不正确'])
    expect(validateField(field, 'abc')).toEqual([])
    expect(validateField(field, '')).toEqual([])
  })

  it('min / max 按数值比较而不是字符串', () => {
    const field = withRules([{ kind: 'min', value: 10 }, { kind: 'max', value: 20 }])
    expect(validateField(field, 9)).toEqual(['不能小于 10'])
    expect(validateField(field, 21)).toEqual(['不能大于 20'])
    expect(validateField(field, 15)).toEqual([])
    expect(validateField(field, '100')).toEqual(['不能大于 20'])
    expect(validateField(field, '')).toEqual([])
  })
})

describe('validateField · custom 自定义规则', () => {
  it('phone / email / idcard 三种规则可用', () => {
    expect(CUSTOM_RULES.phone.test('13800138000')).toBe(true)
    expect(CUSTOM_RULES.email.test('a@b.co')).toBe(true)
    expect(CUSTOM_RULES.idcard.test('11010119900307123X')).toBe(true)

    expect(validateField(withRules([{ kind: 'custom', name: 'phone' }]), '12345')).toEqual(['请输入正确的手机号'])
    expect(validateField(withRules([{ kind: 'custom', name: 'email' }]), 'nope')).toEqual(['请输入正确的邮箱'])
    expect(validateField(withRules([{ kind: 'custom', name: 'idcard' }]), '123')).toEqual(['请输入正确的身份证号'])
    expect(validateField(withRules([{ kind: 'custom', name: 'phone' }]), '13800138000')).toEqual([])
  })

  it('custom 遇到空值跳过，自定义 message 优先', () => {
    expect(validateField(withRules([{ kind: 'custom', name: 'phone' }]), '')).toEqual([])
    expect(validateField(withRules([{ kind: 'custom', name: 'phone', message: '手机号不对' }]), '12345')).toEqual([
      '手机号不对',
    ])
  })

  it('规则表里没有的名字不报错（脏数据不炸）', () => {
    const field = withRules([{ kind: 'custom', name: 'unknown' as 'phone' }])
    expect(validateField(field, 'whatever')).toEqual([])
  })

  it('多条规则同时命中会返回多条错误', () => {
    const field = withRules([{ kind: 'required' }, { kind: 'minLength', value: 6 }], '密码')
    expect(validateField(field, '')).toEqual(['密码不能为空'])
    expect(validateField(field, 'abc')).toEqual(['至少 6 个字符'])
  })
})

describe('evaluateCondition', () => {
  it('没有条件时一律可见', () => {
    expect(evaluateCondition(null, {})).toBe(true)
  })

  it('eq / neq / in / gt / lt / truthy 六种判断', () => {
    const values = { a: 'x', n: 5, list: ['x', 'y'], flag: 1, empty: '' }

    expect(evaluateCondition({ field: 'a', op: 'eq', value: 'x' }, values)).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'eq', value: 'y' }, values)).toBe(false)
    expect(evaluateCondition({ field: 'a', op: 'neq', value: 'y' }, values)).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'in', value: ['x', 'y'] }, values)).toBe(true)
    expect(evaluateCondition({ field: 'a', op: 'in', value: ['z'] }, values)).toBe(false)
    expect(evaluateCondition({ field: 'n', op: 'gt', value: 3 }, values)).toBe(true)
    expect(evaluateCondition({ field: 'n', op: 'gt', value: 9 }, values)).toBe(false)
    expect(evaluateCondition({ field: 'n', op: 'lt', value: 9 }, values)).toBe(true)
    expect(evaluateCondition({ field: 'n', op: 'lt', value: 1 }, values)).toBe(false)
    expect(evaluateCondition({ field: 'flag', op: 'truthy' }, values)).toBe(true)
    expect(evaluateCondition({ field: 'empty', op: 'truthy' }, values)).toBe(false)
  })

  it('in 的 value 不是数组时判为 false', () => {
    expect(evaluateCondition({ field: 'a', op: 'in', value: 'x' }, { a: 'x' })).toBe(false)
  })
})

describe('visibleFields', () => {
  it('过滤掉分组容器，只留可填写字段', () => {
    const group = makeField({ type: 'group', order: 0 })
    const text = makeField({ type: 'text', order: 1 })
    const schema = makeSchema([group, text])

    expect(visibleFields(schema, {}).map(f => f.id)).toEqual([text.id])
  })

  it('visibleWhen 不满足的字段不返回', () => {
    const trigger = makeField({ type: 'text', name: 'hasJob', order: 0 })
    const company = makeField({
      type: 'text',
      name: 'company',
      order: 1,
      visibleWhen: { field: 'hasJob', op: 'truthy' },
    })
    const schema = makeSchema([trigger, company])

    expect(visibleFields(schema, { hasJob: true }).map(f => f.name)).toEqual(['hasJob', 'company'])
    expect(visibleFields(schema, { hasJob: '' }).map(f => f.name)).toEqual(['hasJob'])
  })
})

describe('validateForm', () => {
  it('只返回有错的字段，键是字段 name', () => {
    const name = makeField({ type: 'text', name: 'name', label: '姓名', order: 0, rules: [{ kind: 'required' }] })
    const age = makeField({ type: 'number', name: 'age', label: '年龄', order: 1, rules: [{ kind: 'min', value: 0 }] })
    const schema = makeSchema([name, age])

    expect(validateForm(schema, { name: '', age: -1 })).toEqual({ name: ['姓名不能为空'], age: ['不能小于 0'] })
    expect(validateForm(schema, { name: '张三', age: 20 })).toEqual({})
  })

  it('被 visibleWhen 隐藏的字段不参与校验', () => {
    const hasJob = makeField({ type: 'text', name: 'hasJob', order: 0 })
    const company = makeField({
      type: 'text',
      name: 'company',
      label: '公司',
      order: 1,
      rules: [{ kind: 'required' }],
      visibleWhen: { field: 'hasJob', op: 'truthy' },
    })
    const schema = makeSchema([hasJob, company])

    expect(validateForm(schema, { hasJob: false })).toEqual({})
    expect(validateForm(schema, { hasJob: true })).toEqual({ company: ['公司不能为空'] })
  })

  it('空值只由 required 负责，其它规则不会把未填字段标红', () => {
    const nickname = makeField({
      type: 'text',
      name: 'nickname',
      order: 0,
      rules: [{ kind: 'minLength', value: 3 }, { kind: 'pattern', value: '^[a-z]+$' }, { kind: 'custom', name: 'email' }],
    })
    const schema = makeSchema([nickname])

    // 没填 → 三条规则全部跳过，不标红
    expect(validateForm(schema, {})).toEqual({})
    // 填了 → 不满足的规则才报错（'ab' 长度不足且不是邮箱，但符合 pattern）
    expect(validateForm(schema, { nickname: 'ab' })).toEqual({ nickname: ['至少 3 个字符', '请输入正确的邮箱'] })
  })

  it('分组字段本身不参与校验，尽管它带着规则', () => {
    const group = makeField({ type: 'group', name: 'group1', label: '分组', order: 0, rules: [{ kind: 'required' }] })
    const schema = makeSchema([group])

    expect(validateForm(schema, {})).toEqual({})
  })
})
