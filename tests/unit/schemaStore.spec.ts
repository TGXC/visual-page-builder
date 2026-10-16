import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import '@/fields'
import { getDescriptor } from '@/fields/registry'
import { childrenOf } from '@/core/tree'
import { useSchemaStore } from '@/stores/schema'
import { PERSIST_DELAY, STORAGE_KEY, loadSchema } from '@/stores/persist'
import type { FormSchema } from '@/core/types'

beforeEach(() => {
  localStorage.clear()
  // 自动保存是延迟写入的：测试里用假定时器，避免上一个用例的定时器污染下一个
  vi.useFakeTimers()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
})

const store = () => useSchemaStore()
const names = (schema: FormSchema) => childrenOf(schema.fields, null).map(f => f.name)
const orders = (schema: FormSchema) => childrenOf(schema.fields, null).map(f => f.order)

describe('schema store：字段增删改移', () => {
  it('没有存档时用示例 schema 起步', () => {
    expect(names(store().schema)).toEqual(['name', 'age', 'city'])
  })

  it('addField 追加到末尾，标签与默认属性来自字段描述对象', () => {
    const s = store()
    const id = s.addField('text')
    const list = childrenOf(s.schema.fields, null)
    const added = list[list.length - 1]

    expect(list).toHaveLength(4)
    expect(added.id).toBe(id)
    expect(added.name).toBe('text1')
    expect(added.label).toBe('单行文本')
    expect(added.props).toMatchObject({ placeholder: '请输入', maxlength: 50, clearable: false })
    expect(added.rules).toEqual([{ kind: 'maxLength', value: 50 }])
    expect(orders(s.schema)).toEqual([0, 1, 2, 3])
  })

  it('addField 按 order 插到中间，后面的兄弟顺延', () => {
    const s = store()
    s.addField('select', null, 1)

    expect(names(s.schema)).toEqual(['name', 'select1', 'age', 'city'])
    expect(orders(s.schema)).toEqual([0, 1, 2, 3])
  })

  it('默认属性是深拷贝：两个字段的 options 互不影响，也不回写注册表', () => {
    const s = store()
    const first = s.addField('select')
    const second = s.addField('select')

    const a = s.schema.fields.find(f => f.id === first)
    const b = s.schema.fields.find(f => f.id === second)
    ;(a?.props.options as Array<{ label: string }>)[0].label = '被改过的选项'

    expect((b?.props.options as Array<{ label: string }>)[0].label).toBe('选项一')
    expect((getDescriptor('select').defaultProps.options as Array<{ label: string }>)[0].label).toBe('选项一')
  })

  it('字段名自动去重', () => {
    const s = store()
    s.addField('text')
    s.addField('text')

    expect(names(s.schema)).toEqual(['name', 'age', 'city', 'text1', 'text2'])
  })

  it('removeField 删掉字段并把同级 order 压缩回 0..n-1', () => {
    const s = store()
    s.removeField(childrenOf(s.schema.fields, null)[1].id)

    expect(names(s.schema)).toEqual(['name', 'city'])
    expect(orders(s.schema)).toEqual([0, 1])
  })

  it('removeField 会顺手清掉被删字段的选中状态', () => {
    const s = store()
    const id = childrenOf(s.schema.fields, null)[0].id
    s.select(id)
    s.removeField(id)

    expect(s.selectedIds).toEqual([])
    expect(s.selectedField).toBeNull()
  })

  it('updateField 改标题与属性（props 整体替换，不做合并）', () => {
    const s = store()
    const id = childrenOf(s.schema.fields, null)[0].id
    s.updateField(id, { label: '真实姓名' })
    s.updateField(id, { props: { placeholder: '只留占位符' } })

    const field = s.schema.fields.find(f => f.id === id)
    expect(field?.label).toBe('真实姓名')
    expect(field?.props).toEqual({ placeholder: '只留占位符' })
  })

  it('moveField 重排同级字段', () => {
    const s = store()
    const [name] = childrenOf(s.schema.fields, null)
    s.moveField(name.id, null, 2)

    expect(names(s.schema)).toEqual(['age', 'city', 'name'])
    expect(orders(s.schema)).toEqual([0, 1, 2])
  })

  it('moveField 落在原位时不产生新 schema（幂等，避免脏历史）', () => {
    const s = store()
    const before = s.schema
    const [name] = childrenOf(before.fields, null)
    s.moveField(name.id, null, 0)

    expect(s.schema).toBe(before)
  })

  it('duplicateField 复制一份：新 id、新名字、属性深拷贝、插在原字段后面并选中它', () => {
    const s = store()
    const source = childrenOf(s.schema.fields, null)[0]
    const copyId = s.duplicateField(source.id)

    expect(copyId).not.toBe(source.id)
    expect(names(s.schema)).toEqual(['name', 'text1', 'age', 'city'])
    expect(childrenOf(s.schema.fields, null)[1].id).toBe(copyId)
    expect(s.selectedIds).toEqual([copyId])

    const copy = s.schema.fields.find(f => f.id === copyId)
    ;(copy?.props as Record<string, unknown>).placeholder = '改副本'
    expect(s.schema.fields.find(f => f.id === source.id)?.props.placeholder).toBe('请输入真实姓名')
  })

  it('duplicateField 对不存在的 id 返回 null', () => {
    expect(store().duplicateField('nope')).toBeNull()
  })

  it('select 单选：选中 / 取消', () => {
    const s = store()
    const id = childrenOf(s.schema.fields, null)[0].id
    s.select(id)

    expect(s.selectedIds).toEqual([id])
    expect(s.selectedField?.id).toBe(id)

    s.select(null)
    expect(s.selectedIds).toEqual([])
  })

  it('每次结构变更后，同级 order 始终是连续的 0..n-1', () => {
    const s = store()
    const steps = [
      () => s.addField('text'),
      () => s.addField('number', null, 0),
      () => s.moveField(childrenOf(s.schema.fields, null)[2].id, null, 1),
      () => s.removeField(childrenOf(s.schema.fields, null)[0].id),
      () => s.duplicateField(childrenOf(s.schema.fields, null)[0].id),
    ]

    for (const step of steps) {
      step()
      expect(orders(s.schema)).toEqual(orders(s.schema).map((_, index) => index))
    }
  })
})

describe('自动保存', () => {
  it('schema 变化后延迟写入 localStorage，坏数据不会读进来', async () => {
    const s = store()
    s.addField('text')
    await nextTick()
    vi.advanceTimersByTime(PERSIST_DELAY)

    const saved = loadSchema()
    expect(saved).not.toBeNull()
    expect(saved?.fields).toHaveLength(4)
    expect(JSON.stringify(saved)).toBe(JSON.stringify(s.schema))
  })

  it('读档时拒绝 JSON 坏数据、版本不符与结构不对的存档', () => {
    localStorage.setItem(STORAGE_KEY, '{坏掉的 JSON')
    expect(loadSchema()).toBeNull()

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, fields: [] }))
    expect(loadSchema()).toBeNull()

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }))
    expect(loadSchema()).toBeNull()
  })

  it('有存档时 store 直接以存档起步（刷新后顺序保留）', () => {
    const first = store()
    const [name] = childrenOf(first.schema.fields, null)
    first.moveField(name.id, null, 2)
    const expected = first.schema

    // 模拟刷新：写入存档后换一个 pinia 重新建 store
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expected))
    setActivePinia(createPinia())
    const second = store()

    expect(JSON.stringify(second.schema)).toBe(JSON.stringify(expected))
    expect(names(second.schema)).toEqual(['age', 'city', 'name'])
  })
})
