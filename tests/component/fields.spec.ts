import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CheckboxInput from '@/components/shared/fields/CheckboxInput.vue'
import DateInput from '@/components/shared/fields/DateInput.vue'
import DividerBlock from '@/components/shared/fields/DividerBlock.vue'
import GroupBlock from '@/components/shared/fields/GroupBlock.vue'
import RadioInput from '@/components/shared/fields/RadioInput.vue'
import RatingInput from '@/components/shared/fields/RatingInput.vue'
import SwitchInput from '@/components/shared/fields/SwitchInput.vue'
import TextareaInput from '@/components/shared/fields/TextareaInput.vue'

const options = [
  { label: '北京', value: 'beijing' },
  { label: '上海', value: 'shanghai' },
]

describe('TextareaInput', () => {
  it('受控渲染并回传字符串', async () => {
    const wrapper = mount(TextareaInput, { props: { value: '第一行', placeholder: '请多写点', rows: 4 } })
    const el = wrapper.find<HTMLTextAreaElement>('textarea.fb-textarea__control')
    expect(el.element.value).toBe('第一行')
    expect(el.attributes('placeholder')).toBe('请多写点')
    expect(el.attributes('rows')).toBe('4')

    await el.setValue('改了')
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['改了'])
  })

  it('null / undefined 显示成空串', () => {
    expect(mount(TextareaInput, { props: { value: null } }).find('textarea').element.value).toBe('')
    expect(mount(TextareaInput, {}).find('textarea').element.value).toBe('')
  })
})

describe('RadioInput', () => {
  it('渲染每个选项并回传原始值', async () => {
    const wrapper = mount(RadioInput, { props: { id: 'f1', value: 'shanghai', options } })
    const inputs = wrapper.findAll<HTMLInputElement>('input.fb-radio__control')
    expect(inputs).toHaveLength(2)
    expect(inputs.map(i => i.attributes('value'))).toEqual(['beijing', 'shanghai'])
    expect(inputs[1]!.element.checked).toBe(true)

    await inputs[0]!.setValue()
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['beijing'])
  })

  it('同名分组用字段 id，避免页面上多个单选组互相干扰', () => {
    const wrapper = mount(RadioInput, { props: { id: 'f42', options } })
    expect(wrapper.findAll('input.fb-radio__control').every(i => i.attributes('name') === 'f42')).toBe(true)
  })

  it('inline 控制横排', () => {
    expect(mount(RadioInput, { props: { options } }).find('.fb-radio').classes()).not.toContain('fb-radio--inline')
    expect(
      mount(RadioInput, { props: { options, inline: true } }).find('.fb-radio').classes(),
    ).toContain('fb-radio--inline')
  })
})

describe('CheckboxInput', () => {
  it('值是数组：勾选/取消都按选项顺序回传', async () => {
    const wrapper = mount(CheckboxInput, { props: { id: 'f1', value: ['shanghai'], options } })
    const inputs = wrapper.findAll<HTMLInputElement>('input.fb-checkbox__control')
    expect(inputs[1]!.element.checked).toBe(true)

    await inputs[0]!.setValue(true)
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([['beijing', 'shanghai']])

    // 受控组件：外部把新值传回来之后，取消勾选要按“剩余选项的选项顺序”回传
    await wrapper.setProps({ value: ['beijing', 'shanghai'] })
    await inputs[1]!.setValue(false)
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([['beijing']])
  })

  it('值不是数组时当作没勾', () => {
    const wrapper = mount(CheckboxInput, { props: { value: 'beijing', options } })
    expect(
      wrapper.findAll<HTMLInputElement>('input.fb-checkbox__control').every(i => !i.element.checked),
    ).toBe(true)
  })
})

describe('SwitchInput', () => {
  it('回传布尔值', async () => {
    const wrapper = mount(SwitchInput, { props: { id: 'f1', value: false, activeText: '开' } })
    const el = wrapper.find<HTMLInputElement>('input.fb-switch__control')
    expect(el.element.checked).toBe(false)

    await el.setValue(true)
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([true])
  })

  it('非布尔真值也算打开（数据来自手写 JSON 时不至于显示错）', () => {
    expect(mount(SwitchInput, { props: { value: 1 } }).find('input').element.checked).toBe(true)
    expect(mount(SwitchInput, { props: { value: '' } }).find('input').element.checked).toBe(false)
  })
})

describe('DateInput', () => {
  it('渲染 date 输入框并回传字符串', async () => {
    const wrapper = mount(DateInput, { props: { value: '2026-01-02', min: '2026-01-01', max: '2026-12-31' } })
    const el = wrapper.find<HTMLInputElement>('input.fb-date__control')
    expect(el.attributes('type')).toBe('date')
    expect(el.element.value).toBe('2026-01-02')
    expect(el.attributes('min')).toBe('2026-01-01')

    await el.setValue('2026-02-03')
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['2026-02-03'])
  })

  it('清空时回传空串而不是 null', async () => {
    const wrapper = mount(DateInput, { props: { value: '2026-01-02' } })
    await wrapper.find('input').setValue('')
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([''])
  })
})

describe('RatingInput', () => {
  it('按 max 渲染星星，回传数字', async () => {
    const wrapper = mount(RatingInput, { props: { value: 2, max: 4 } })
    const stars = wrapper.findAll('button.fb-rating__star')
    expect(stars).toHaveLength(4)
    expect(wrapper.findAll('.fb-rating__star--on')).toHaveLength(2)

    await stars[3]!.trigger('click')
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([4])
  })

  it('点当前分数就清零（否则 1 分没法改成 0）', async () => {
    const wrapper = mount(RatingInput, { props: { value: 3, max: 5 } })
    await wrapper.findAll('button.fb-rating__star')[2]!.trigger('click')
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([0])
  })

  it('max 缺省 5，非法值按 0 算', () => {
    expect(mount(RatingInput, {}).findAll('button.fb-rating__star')).toHaveLength(5)
    expect(mount(RatingInput, { props: { value: 'abc' } }).findAll('.fb-rating__star--on')).toHaveLength(0)
  })
})

describe('DividerBlock', () => {
  it('渲染分隔线与文字，没有输入控件', () => {
    const wrapper = mount(DividerBlock, { props: { text: '以下为选填', dashed: true } })
    expect(wrapper.find('.fb-divider').classes()).toContain('fb-divider--dashed')
    expect(wrapper.find('.fb-divider__text').text()).toBe('以下为选填')
    expect(wrapper.find('input').exists()).toBe(false)
  })
})

describe('GroupBlock', () => {
  it('是一个容器：有描述和默认插槽', () => {
    const wrapper = mount(GroupBlock, {
      props: { description: '请填写联系人', bordered: true },
      slots: { default: '<span class="inside">子字段</span>' },
    })
    expect(wrapper.find('.fb-group').classes()).toContain('fb-group--bordered')
    expect(wrapper.find('.fb-group__desc').text()).toBe('请填写联系人')
    expect(wrapper.find('.inside').exists()).toBe(true)
  })

  it('没有描述时不渲染空段落', () => {
    expect(mount(GroupBlock, {}).find('.fb-group__desc').exists()).toBe(false)
  })
})
