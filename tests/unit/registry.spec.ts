import { describe, expect, it } from 'vitest'
import { getDescriptor, listDescriptors, registerComponent } from '@/fields/registry'
import '@/fields'
import type { FieldType } from '@/core/types'

describe('字段注册表', () => {
  it('内置三个字段（M2 只做 text / number / select）', () => {
    expect(listDescriptors().map(d => d.type)).toEqual(['text', 'number', 'select'])
  })

  it('getDescriptor 拿到描述对象，含控件与属性协议', () => {
    const d = getDescriptor('text')

    expect(d.label).toBe('单行文本')
    expect(d.component).toBeTruthy()
    expect(d.propSchema.map(p => p.key)).toContain('placeholder')
  })

  it('未注册的类型会抛错，而不是静默渲染空白', () => {
    expect(() => getDescriptor('date' as FieldType)).toThrow(/未注册/)
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

  it('新字段只要符合协议就能注册，属性面板与渲染器无需改动', () => {
    registerComponent({
      type: 'switch' as FieldType,
      label: '开关',
      icon: 'switch',
      defaultProps: { onText: '开' },
      propSchema: [{ key: 'onText', label: '开启文案', control: 'text' }],
      component: { name: 'FakeSwitch', render: () => null } as never,
    })

    expect(getDescriptor('switch' as FieldType).label).toBe('开关')
    expect(listDescriptors()).toHaveLength(4)
  })
})
