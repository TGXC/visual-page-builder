import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RuleEditor from '@/components/editor/RuleEditor.vue'
import ConditionEditor from '@/components/editor/ConditionEditor.vue'
import { makeField } from '../unit/factories'
import type { FieldNode, ValidationRule } from '@/core/types'

const fieldWithRules = (rules: ValidationRule[]): FieldNode =>
  makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', rules })

/** 取最后一次 update:rules 事件的载荷 */
function lastRules(wrapper: ReturnType<typeof mount>): ValidationRule[] {
  const events = wrapper.emitted('update:rules')
  return (events?.[events.length - 1]?.[0] ?? []) as ValidationRule[]
}

function lastCondition(wrapper: ReturnType<typeof mount>): unknown {
  const events = wrapper.emitted('update:visibleWhen')
  return events?.[events.length - 1]?.[0] ?? null
}

describe('RuleEditor', () => {
  it('已有规则逐条渲染出来', () => {
    const wrapper = mount(RuleEditor, {
      props: { field: fieldWithRules([{ kind: 'required' }, { kind: 'minLength', value: 3 }]) },
    })
    const rows = wrapper.findAll('.fb-rule')
    expect(rows).toHaveLength(2)
    expect((rows[0].find('.fb-rule__kind').element as HTMLSelectElement).value).toBe('required')
    expect((rows[1].find('.fb-rule__kind').element as HTMLSelectElement).value).toBe('minLength')
    expect((rows[1].find('.fb-rule__value').element as HTMLInputElement).value).toBe('3')
  })

  it('没有规则时给出空状态', () => {
    const wrapper = mount(RuleEditor, { props: { field: fieldWithRules([]) } })
    expect(wrapper.find('.fb-rule').exists()).toBe(false)
    expect(wrapper.find('.fb-rules__empty').exists()).toBe(true)
  })

  it('添加 required 规则时不需要值', () => {
    const wrapper = mount(RuleEditor, { props: { field: fieldWithRules([{ kind: 'required' }]) } })
    expect(wrapper.find('.fb-rule').exists()).toBe(true)
    expect(wrapper.find('.fb-rule__value').exists()).toBe(false)

    const empty = mount(RuleEditor, { props: { field: fieldWithRules([]) } })
    empty.find('.fb-rule__add').setValue('required')
    expect(lastRules(empty)).toEqual([{ kind: 'required' }])
  })

  it('添加带值的规则时带上默认值，并且能改', async () => {
    const wrapper = mount(RuleEditor, { props: { field: fieldWithRules([]) } })
    await wrapper.find('.fb-rule__add').setValue('minLength')
    expect(lastRules(wrapper)).toEqual([{ kind: 'minLength', value: 1 }])

    const field = fieldWithRules(lastRules(wrapper))
    await wrapper.setProps({ field })
    await wrapper.find('.fb-rule__value').setValue('5')
    expect(lastRules(wrapper)).toEqual([{ kind: 'minLength', value: 5 }])
  })

  it('value 在面板里是数字，不是字符串', async () => {
    const wrapper = mount(RuleEditor, { props: { field: fieldWithRules([{ kind: 'max', value: 100 }]) } })
    await wrapper.find('.fb-rule__value').setValue('20')
    expect(lastRules(wrapper)[0]).toEqual({ kind: 'max', value: 20 })
  })

  it('切到 custom 会带上默认规则名，并能换成邮箱', async () => {
    const wrapper = mount(RuleEditor, { props: { field: fieldWithRules([{ kind: 'required' }]) } })
    await wrapper.find('.fb-rule__kind').setValue('custom')
    expect(lastRules(wrapper)).toEqual([{ kind: 'custom', name: 'phone' }])

    await wrapper.setProps({ field: fieldWithRules(lastRules(wrapper)) })
    await wrapper.find('.fb-rule__custom').setValue('email')
    expect(lastRules(wrapper)).toEqual([{ kind: 'custom', name: 'email' }])
  })

  it('删除规则 emits 剩下的规则', () => {
    const wrapper = mount(RuleEditor, {
      props: { field: fieldWithRules([{ kind: 'required' }, { kind: 'max', value: 3 }]) },
    })
    wrapper.findAll('.fb-rule__remove')[0].trigger('click')
    expect(lastRules(wrapper)).toEqual([{ kind: 'max', value: 3 }])
  })

  it('pattern 的值保持字符串（正则里可能有 ^ 和反斜杠）', async () => {
    const wrapper = mount(RuleEditor, { props: { field: fieldWithRules([{ kind: 'pattern', value: '^\\d+$' }]) } })
    await wrapper.find('.fb-rule__value').setValue('^[a-z]+$')
    expect(lastRules(wrapper)).toEqual([{ kind: 'pattern', value: '^[a-z]+$' }])
  })
})

describe('ConditionEditor', () => {
  const other = makeField({ id: 'f_age', type: 'number', name: 'age', label: '年龄' })
  const withCondition = (visibleWhen: FieldNode['visibleWhen']): FieldNode =>
    makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', visibleWhen })

  it('没有条件时不渲染条件主体', () => {
    const wrapper = mount(ConditionEditor, { props: { field: fieldWithRules([]), fields: [fieldWithRules([]), other] } })
    expect(wrapper.find('.fb-condition__body').exists()).toBe(false)
    expect((wrapper.find('.fb-condition__toggle').element as HTMLInputElement).checked).toBe(false)
  })

  it('勾上开关 emits 一个默认条件，候选里排除自己', async () => {
    const self = fieldWithRules([])
    const wrapper = mount(ConditionEditor, { props: { field: self, fields: [self, other] } })
    await wrapper.find('.fb-condition__toggle').setValue(true)
    expect(lastCondition(wrapper)).toEqual({ field: 'age', op: 'eq' })
    // 哑组件不回写 props：父级（属性面板）接到事件后把新条件传回来
    await wrapper.setProps({ field: withCondition({ field: 'age', op: 'eq' }) })
    expect(wrapper.findAll('.fb-condition__field option').map(o => o.text())).toEqual(['年龄'])
  })

  it('已有条件时回显字段与运算符', () => {
    const self = makeField({
      id: 'f_name',
      type: 'text',
      name: 'name',
      label: '姓名',
      visibleWhen: { field: 'age', op: 'gt', value: 18 },
    })
    const wrapper = mount(ConditionEditor, { props: { field: self, fields: [self, other] } })
    expect((wrapper.find('.fb-condition__field').element as HTMLSelectElement).value).toBe('age')
    expect((wrapper.find('.fb-condition__op').element as HTMLSelectElement).value).toBe('gt')
    expect((wrapper.find('.fb-condition__value').element as HTMLInputElement).value).toBe('18')
  })

  it('op 选 truthy 时不再需要值', async () => {
    const self = makeField({
      id: 'f_name',
      type: 'text',
      name: 'name',
      label: '姓名',
      visibleWhen: { field: 'age', op: 'gt', value: 18 },
    })
    const wrapper = mount(ConditionEditor, { props: { field: self, fields: [self, other] } })
    await wrapper.find('.fb-condition__op').setValue('truthy')
    expect(lastCondition(wrapper)).toEqual({ field: 'age', op: 'truthy', value: undefined })
    await wrapper.setProps({ field: withCondition({ field: 'age', op: 'truthy' }) })
    expect(wrapper.find('.fb-condition__value').exists()).toBe(false)
  })

  it('改字段和改值都 emits 完整条件', async () => {
    const self = makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', visibleWhen: { field: 'age', op: 'eq' } })
    const city = makeField({ id: 'f_city', type: 'select', name: 'city', label: '城市' })
    const wrapper = mount(ConditionEditor, { props: { field: self, fields: [self, other, city] } })
    await wrapper.find('.fb-condition__field').setValue('city')
    expect(lastCondition(wrapper)).toEqual({ field: 'city', op: 'eq' })
    await wrapper.setProps({ field: withCondition({ field: 'city', op: 'eq' }) })
    await wrapper.find('.fb-condition__value').setValue('北京')
    expect(lastCondition(wrapper)).toEqual({ field: 'city', op: 'eq', value: '北京' })
  })

  it('清除条件 emits null', () => {
    const self = makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', visibleWhen: { field: 'age', op: 'eq' } })
    const wrapper = mount(ConditionEditor, { props: { field: self, fields: [self, other] } })
    wrapper.find('.fb-condition__clear').trigger('click')
    expect(wrapper.emitted('update:visibleWhen')?.[0]?.[0]).toBeNull()
  })

  it('没有其它字段可依赖时开关不生效，并给出提示', () => {
    const self = fieldWithRules([])
    const wrapper = mount(ConditionEditor, { props: { field: self, fields: [self] } })
    wrapper.find('.fb-condition__toggle').setValue(true)
    expect(wrapper.emitted('update:visibleWhen')).toBeUndefined()
    expect(wrapper.find('.fb-condition__hint').text()).toContain('先添加另一个字段')
  })
})
