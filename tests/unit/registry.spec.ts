import { describe, expect, it } from 'vitest'
import { getDescriptor, hasDescriptor, listDescriptors, registerComponent } from '@/fields/registry'
import '@/fields'
import type { FieldType } from '@/core/types'

/** 11 类字段的注册顺序 = 组件面板里的顺序（group 放最后） */
const BUILTIN_ORDER: FieldType[] = [
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

describe('字段注册表', () => {
  it('内置 11 类字段，顺序就是组件面板的顺序', () => {
    expect(listDescriptors().map(d => d.type)).toEqual(BUILTIN_ORDER)
  })

  it('getDescriptor 拿到描述对象，含控件与属性协议', () => {
    const d = getDescriptor('text')

    expect(d.label).toBe('单行文本')
    expect(d.component).toBeTruthy()
    expect(d.propSchema.map(p => p.key)).toContain('placeholder')
  })

  it('未注册的类型会抛错，而不是静默渲染空白', () => {
    expect(() => getDescriptor('slider' as FieldType)).toThrow(/未注册/)
    expect(hasDescriptor('slider' as FieldType)).toBe(false)
  })

  it('重复注册同一类型会抛错（插件协议要求 type 唯一）', () => {
    expect(() =>
      registerComponent({
        type: 'text',
        label: '重复的文本',
        icon: 'text',
        defaultProps: {},
        propSchema: [],
        component: { name: 'Dup', render: () => null } as never,
      }),
    ).toThrow(/已注册/)
  })

  it('每个字段的 defaultProps 键都能在 propSchema 里找到对应项', () => {
    for (const d of listDescriptors()) {
      for (const key of Object.keys(d.defaultProps)) {
        expect(d.propSchema.map(p => p.key), `${d.type} 的 ${key} 缺少属性面板配置`).toContain(key)
      }
    }
  })

  it('每个字段都有 label / icon / component，否则面板与画布会空一块', () => {
    for (const d of listDescriptors()) {
      expect(d.label, `${d.type} 缺 label`).toBeTruthy()
      expect(d.icon, `${d.type} 缺 icon`).toBeTruthy()
      expect(d.component, `${d.type} 缺 component`).toBeTruthy()
      expect(d.propSchema.length, `${d.type} 没有可配属性`).toBeGreaterThan(0)
    }
  })

  it('只有 group 是容器', () => {
    const containers = listDescriptors().filter(d => d.isContainer).map(d => d.type)
    expect(containers).toEqual(['group'])
  })

  it('divider 与 group 不产出值（分隔线不该出现在提交结果里）', () => {
    const noValue = listDescriptors().filter(d => d.hasValue === false).map(d => d.type)
    expect(noValue).toEqual(['divider', 'group'])
    expect(getDescriptor('text').hasValue).not.toBe(false)
  })

  it('新字段只要符合协议就能注册，属性面板与渲染器无需改动', () => {
    registerComponent({
      type: 'slider' as FieldType,
      label: '滑块',
      icon: 'slider',
      defaultProps: { onText: '开' },
      propSchema: [{ key: 'onText', label: '开启文案', control: 'text' }],
      component: { name: 'FakeSlider', render: () => null } as never,
    })

    expect(getDescriptor('slider' as FieldType).label).toBe('滑块')
    expect(listDescriptors()).toHaveLength(BUILTIN_ORDER.length + 1)
    expect(listDescriptors().map(d => d.type)).toContain('slider')
  })
})
