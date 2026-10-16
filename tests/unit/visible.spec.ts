import { describe, expect, it } from 'vitest'
import { makeField, makeSchema } from './factories'
import { validateForm, visibleFields } from '@/core/validation'
import type { FieldNode } from '@/core/types'

/**
 * M5 补上的一条：分组的条件不满足时，组里的字段也不该出现。
 * M1 只看了字段自己的 visibleWhen，登记在 docs/decisions.md D15。
 */
const yesNo = (): FieldNode => makeField({ id: 'f_has', type: 'text', name: 'has', label: '有宠物吗' })
const petGroup = (): FieldNode =>
  makeField({
    id: 'f_pet_group',
    type: 'group',
    name: 'pet_group',
    label: '宠物信息',
    visibleWhen: { field: 'has', op: 'eq', value: 'yes' },
  })
const petName = (): FieldNode =>
  makeField({
    id: 'f_pet',
    type: 'text',
    name: 'pet',
    label: '宠物名',
    parentId: 'f_pet_group',
    rules: [{ kind: 'required' }],
  })
const innerGroup = (): FieldNode =>
  makeField({ id: 'f_inner', type: 'group', name: 'inner', label: '更多', parentId: 'f_pet_group' })
const innerField = (): FieldNode =>
  makeField({ id: 'f_kind', type: 'text', name: 'kind', label: '品种', parentId: 'f_inner' })

describe('visibleFields：分组的条件会连带子孙', () => {
  it('分组条件不满足时，组内字段也不可见', () => {
    const schema = makeSchema([yesNo(), petGroup(), petName()])
    expect(visibleFields(schema, { has: 'no' }).map(f => f.name)).toEqual(['has'])
  })

  it('分组条件满足时，组内字段照常可见', () => {
    const schema = makeSchema([yesNo(), petGroup(), petName()])
    expect(visibleFields(schema, { has: 'yes' }).map(f => f.name)).toEqual(['has', 'pet'])
  })

  it('隔了一层分组也连带：外层隐藏 → 内层和外层里的字段都不见', () => {
    const schema = makeSchema([yesNo(), petGroup(), innerGroup(), innerField()])
    expect(visibleFields(schema, { has: 'no' }).map(f => f.name)).toEqual(['has'])
    expect(visibleFields(schema, { has: 'yes' }).map(f => f.name)).toEqual(['has', 'kind'])
  })

  it('普通字段自己的条件为假时不影响别人', () => {
    const other = makeField({
      id: 'f_other',
      type: 'text',
      name: 'other',
      label: '其它',
      visibleWhen: { field: 'has', op: 'eq', value: 'no' },
    })
    const schema = makeSchema([yesNo(), petGroup(), petName(), other])
    expect(visibleFields(schema, { has: 'no' }).map(f => f.name)).toEqual(['has', 'other'])
  })

  it('隐藏分组里的必填字段不参与 validateForm', () => {
    const schema = makeSchema([yesNo(), petGroup(), petName()])
    expect(validateForm(schema, { has: 'no' })).toEqual({})
    expect(validateForm(schema, { has: 'yes' })).toEqual({ pet: ['宠物名不能为空'] })
  })

  it('parentId 指向不存在的字段时按没有祖先处理，不会崩', () => {
    const orphan = makeField({ id: 'f_orphan', type: 'text', name: 'orphan', label: '孤儿', parentId: 'f_missing' })
    const schema = makeSchema([orphan])
    expect(visibleFields(schema, {}).map(f => f.name)).toEqual(['orphan'])
  })
})
