import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { makeField, makeSchema } from './factories'
import { useRuntimeStore } from '@/stores/runtime'
import { useSchemaStore } from '@/stores/schema'
import type { FieldNode } from '@/core/types'

const name = (): FieldNode =>
  makeField({ id: 'f_name', type: 'text', name: 'name', label: '姓名', rules: [{ kind: 'required' }] })
const age = (): FieldNode => makeField({ id: 'f_age', type: 'number', name: 'age', label: '年龄' })

function setup(fields: FieldNode[]) {
  localStorage.clear()
  setActivePinia(createPinia())
  const schema = useSchemaStore()
  schema.setSchema(makeSchema(fields))
  return { schema, runtime: useRuntimeStore() }
}

describe('runtime store', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('初始为空：没有值、没有错误、没有提交结果', () => {
    const { runtime } = setup([name(), age()])
    expect(runtime.values).toEqual({})
    expect(runtime.errors).toEqual({})
    expect(runtime.submitted).toBeNull()
    expect(runtime.visible.map(f => f.name)).toEqual(['name', 'age'])
  })

  it('setValue 写入值，并且不产生错误', () => {
    const { runtime } = setup([name()])
    runtime.setValue('name', '张三')
    expect(runtime.values).toEqual({ name: '张三' })
    expect(runtime.errors).toEqual({})
  })

  it('validate：必填为空时返回 false 并给出默认文案', () => {
    const { runtime } = setup([name()])
    expect(runtime.validate()).toBe(false)
    expect(runtime.errors).toEqual({ name: ['姓名不能为空'] })
  })

  it('validate：填齐后返回 true 且错误清空', () => {
    const { runtime } = setup([name()])
    runtime.setValue('name', '张三')
    expect(runtime.validate()).toBe(true)
    expect(runtime.errors).toEqual({})
  })

  it('setValue 只清掉自己那条错误，别人的还在', () => {
    const { runtime } = setup([name(), makeField({ id: 'f_mail', type: 'text', name: 'mail', label: '邮箱', rules: [{ kind: 'required' }] })])
    runtime.validate()
    expect(Object.keys(runtime.errors).sort()).toEqual(['mail', 'name'])
    runtime.setValue('name', '张三')
    expect(Object.keys(runtime.errors)).toEqual(['mail'])
  })

  it('隐藏字段不参与校验', () => {
    const { runtime } = setup([
      makeField({ id: 'f_has', type: 'text', name: 'has', label: '有宠物吗' }),
      makeField({
        id: 'f_pet',
        type: 'text',
        name: 'pet',
        label: '宠物名',
        rules: [{ kind: 'required' }],
        visibleWhen: { field: 'has', op: 'eq', value: 'yes' },
      }),
    ])
    runtime.setValue('has', 'no')
    expect(runtime.visible.map(f => f.name)).toEqual(['has'])
    expect(runtime.validate()).toBe(true)
    expect(runtime.errors).toEqual({})
  })

  it('条件满足后字段进入可见列表并被校验', () => {
    const { runtime } = setup([
      makeField({ id: 'f_has', type: 'text', name: 'has', label: '有宠物吗' }),
      makeField({
        id: 'f_pet',
        type: 'text',
        name: 'pet',
        label: '宠物名',
        rules: [{ kind: 'required' }],
        visibleWhen: { field: 'has', op: 'eq', value: 'yes' },
      }),
    ])
    runtime.setValue('has', 'yes')
    expect(runtime.visible.map(f => f.name)).toEqual(['has', 'pet'])
    expect(runtime.validate()).toBe(false)
    expect(runtime.errors).toEqual({ pet: ['宠物名不能为空'] })
  })

  it('validate 会重建错误表：字段变隐藏后它的旧错误消失', () => {
    const { runtime } = setup([
      makeField({ id: 'f_has', type: 'text', name: 'has', label: '有宠物吗' }),
      makeField({
        id: 'f_pet',
        type: 'text',
        name: 'pet',
        label: '宠物名',
        rules: [{ kind: 'required' }],
        visibleWhen: { field: 'has', op: 'eq', value: 'yes' },
      }),
    ])
    runtime.setValue('has', 'yes')
    runtime.validate()
    expect(runtime.errors).toEqual({ pet: ['宠物名不能为空'] })
    runtime.setValue('has', 'no')
    runtime.validate()
    expect(runtime.errors).toEqual({})
  })

  it('分组容器只做布局，不进可见列表', () => {
    const { runtime } = setup([
      makeField({ id: 'f_group', type: 'group', name: 'group1', label: '分组' }),
      makeField({ id: 'f_a', type: 'text', name: 'a', label: 'A', parentId: 'f_group' }),
    ])
    expect(runtime.visible.map(f => f.name)).toEqual(['a'])
  })

  it('submit 校验不过时返回 null，且不写入 submitted', () => {
    const { runtime } = setup([name()])
    expect(runtime.submit()).toBeNull()
    expect(runtime.submitted).toBeNull()
    expect(runtime.errors).toEqual({ name: ['姓名不能为空'] })
  })

  it('submit 通过时返回 FormValues，并挂到 submitted 上', () => {
    const { runtime } = setup([name(), age()])
    runtime.setValue('name', '张三')
    runtime.setValue('age', 30)
    expect(runtime.submit()).toEqual({ name: '张三', age: 30 })
    expect(runtime.submitted).toEqual({ name: '张三', age: 30 })
  })

  it('提交结果里只有可见字段：值填过但字段已隐藏的不算', () => {
    const { runtime } = setup([
      makeField({ id: 'f_has', type: 'text', name: 'has', label: '有宠物吗' }),
      makeField({
        id: 'f_pet',
        type: 'text',
        name: 'pet',
        label: '宠物名',
        visibleWhen: { field: 'has', op: 'eq', value: 'yes' },
      }),
    ])
    runtime.setValue('has', 'yes')
    runtime.setValue('pet', '旺财')
    runtime.setValue('has', 'no')
    expect(runtime.submit()).toEqual({ has: 'no' })
  })

  it('再次提交失败会清掉上一次的 submitted', () => {
    const { runtime } = setup([name()])
    runtime.setValue('name', '张三')
    runtime.submit()
    expect(runtime.submitted).not.toBeNull()
    runtime.setValue('name', '')
    expect(runtime.submit()).toBeNull()
    expect(runtime.submitted).toBeNull()
  })

  it('firstErrorName 按可见顺序取第一个出错的字段', () => {
    const { runtime } = setup([name(), makeField({ id: 'f_mail', type: 'text', name: 'mail', label: '邮箱', rules: [{ kind: 'required' }] })])
    expect(runtime.firstErrorName).toBeNull()
    runtime.validate()
    expect(runtime.firstErrorName).toBe('name')
    runtime.setValue('name', '张三')
    runtime.validate()
    expect(runtime.firstErrorName).toBe('mail')
  })

  it('reset 清空值、错误与提交结果', () => {
    const { runtime } = setup([name()])
    runtime.setValue('name', '张三')
    runtime.submit()
    runtime.reset()
    expect(runtime.values).toEqual({})
    expect(runtime.errors).toEqual({})
    expect(runtime.submitted).toBeNull()
  })

  it('schema 变了以后 visible 跟着变（store 之间是活的）', () => {
    const { schema, runtime } = setup([name()])
    expect(runtime.visible.map(f => f.name)).toEqual(['name'])
    schema.addField('text')
    expect(runtime.visible.map(f => f.name)).toEqual(['name', 'text1'])
  })
})
