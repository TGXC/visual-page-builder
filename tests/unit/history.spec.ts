import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MERGE_WINDOW, useHistoryStore } from '@/stores/history'
import type { HistoryEntry } from '@/stores/history'
import { useSchemaStore } from '@/stores/schema'
import { childrenOf } from '@/core/tree'
import type { FieldNode } from '@/core/types'
import { makeSchema } from './factories'

function setup() {
  localStorage.clear()
  vi.useFakeTimers()
  setActivePinia(createPinia())
  const history = useHistoryStore()
  const store = useSchemaStore()

  return { history, store }
}

const names = (fields: FieldNode[]) => childrenOf(fields, null).map(field => field.name)

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('历史栈基础', () => {
  it('一开始没有历史，base 就是初始 schema', () => {
    const { history } = setup()

    expect(history.undoStack).toHaveLength(0)
    expect(history.redoStack).toHaveLength(0)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.labels).toEqual(['初始状态'])
    expect(history.position).toBe(0)
    expect(names(history.base.fields)).toEqual(['name', 'age', 'city'])
  })

  it('每种结构变更都压入一条带标签的记录，并立刻生效', () => {
    const { history, store } = setup()
    const nameId = store.schema.fields[0].id
    const ageId = store.schema.fields[1].id

    store.addField('text')
    store.updateField(nameId, { label: '真实姓名' })
    store.moveField(nameId, null, 2)
    store.removeField(ageId)
    store.duplicateField(nameId)

    expect(history.undoStack).toHaveLength(5)
    expect(history.undoStack.map(entry => entry.label)).toEqual([
      '新增单行文本',
      '修改标签',
      '移动字段',
      '删除年龄',
      '复制真实姓名',
    ])
    expect(history.undoStack.map(entry => entry.patch.op)).toEqual([
      'insert',
      'update',
      'move',
      'remove',
      'insert',
    ])
  })

  it('undo 走逆补丁回退、redo 再前进，两端都是逐字节一致', () => {
    const { history, store } = setup()
    const start = JSON.stringify(store.schema)
    const nameId = store.schema.fields[0].id

    store.updateField(nameId, { label: '真实姓名' })
    store.addField('text')
    store.moveField(nameId, null, 2)
    const changed = JSON.stringify(store.schema)
    expect(changed).not.toBe(start)

    history.undo()
    history.undo()
    history.undo()
    expect(JSON.stringify(store.schema)).toBe(start)
    expect(history.canRedo).toBe(true)

    history.redo()
    history.redo()
    history.redo()
    expect(JSON.stringify(store.schema)).toBe(changed)
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
  })

  it('撤销到底之后再撤销返回 null，且不动 schema', () => {
    const { history, store } = setup()
    store.addField('text')

    expect(history.undo()).not.toBeNull()
    const snapshot = JSON.stringify(store.schema)
    expect(history.undo()).toBeNull()
    expect(JSON.stringify(store.schema)).toBe(snapshot)
    expect(history.canUndo).toBe(false)
  })

  it('重做到顶之后再重做返回 null', () => {
    const { history, store } = setup()
    store.addField('text')
    history.undo()
    expect(history.redo()).not.toBeNull()
    expect(history.redo()).toBeNull()
    expect(history.canRedo).toBe(false)
  })

  it('产生新操作后清空 redo 栈', () => {
    const { history, store } = setup()
    store.addField('text')
    history.undo()
    expect(history.canRedo).toBe(true)

    store.addField('select')
    expect(history.canRedo).toBe(false)
    expect(history.redoStack).toHaveLength(0)
  })

  it('撤销之后已经消失的选中字段会被清掉', () => {
    const { history, store } = setup()
    store.addField('text')
    const added = store.schema.fields.find(field => field.name === 'text1')!.id
    store.select(added)
    expect(store.selectedId).toBe(added)

    history.undo()
    expect(store.selectedIds).toEqual([])
  })
})

describe('连续输入合并', () => {
  it(`同一字段同一属性在 ${MERGE_WINDOW}ms 内合并成一步`, () => {
    const { history, store } = setup()
    const nameId = store.schema.fields[0].id

    store.updateField(nameId, { label: '张' })
    vi.advanceTimersByTime(100)
    store.updateField(nameId, { label: '张三' })

    expect(history.undoStack).toHaveLength(1)
    expect(store.fieldById.get(nameId)!.label).toBe('张三')

    history.undo()
    expect(store.fieldById.get(nameId)!.label).toBe('姓名')
  })

  it('超过合并窗口就不再合并', () => {
    const { history, store } = setup()
    const nameId = store.schema.fields[0].id

    store.updateField(nameId, { label: '张' })
    vi.advanceTimersByTime(MERGE_WINDOW + 1)
    store.updateField(nameId, { label: '张三' })

    expect(history.undoStack).toHaveLength(2)
    history.undo()
    expect(store.fieldById.get(nameId)!.label).toBe('张')
  })

  it('不同字段、不同属性都不合并', () => {
    const { history, store } = setup()
    const nameId = store.schema.fields[0].id
    const ageId = store.schema.fields[1].id

    store.updateField(nameId, { label: '张' })
    store.updateField(ageId, { label: '年龄' })
    expect(history.undoStack).toHaveLength(2)

    store.updateField(nameId, { props: { placeholder: '请输入姓名' } })
    expect(history.undoStack).toHaveLength(3)
  })

  it('合并后的补丁 before 仍是最初的值', () => {
    const { history, store } = setup()
    const nameId = store.schema.fields[0].id

    store.updateField(nameId, { label: '张' })
    vi.advanceTimersByTime(50)
    store.updateField(nameId, { label: '张三' })
    vi.advanceTimersByTime(50)
    store.updateField(nameId, { label: '张三丰' })

    expect(history.undoStack).toHaveLength(1)
    expect(history.undoStack[0].patch).toMatchObject({
      op: 'update',
      id: nameId,
      before: { label: '姓名' },
      after: { label: '张三丰' },
    })

    history.undo()
    expect(store.fieldById.get(nameId)!.label).toBe('姓名')
  })

  it('移动这类结构补丁不参与合并（即使 mergeKey 相同）', () => {
    const { history, store } = setup()
    const id = store.schema.fields[0].id
    const entry = (before: number, after: number): HistoryEntry => ({
      label: '移动字段',
      patch: { op: 'move', id, before: { parentId: null, order: before }, after: { parentId: null, order: after } },
      mergeKey: 'move:same',
      at: Date.now(),
    })

    history.commit(entry(0, 2))
    expect(history.tryMerge(entry(2, 1))).toBe(false)
    expect(history.undoStack).toHaveLength(1)
  })
})

describe('jumpTo', () => {
  it('可以跳到时间线上的任意位置', () => {
    const { history, store } = setup()
    const start = JSON.stringify(store.schema)

    for (let index = 0; index < 4; index += 1) {
      store.addField('text')
      vi.advanceTimersByTime(MERGE_WINDOW + 1)
    }
    expect(history.labels).toHaveLength(5)
    expect(history.position).toBe(4)

    history.jumpTo(0)
    expect(JSON.stringify(store.schema)).toBe(start)
    expect(history.position).toBe(0)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)

    history.jumpTo(4)
    expect(names(history.base.fields)).toHaveLength(7)
    expect(history.position).toBe(4)

    history.jumpTo(2)
    expect(names(history.base.fields)).toHaveLength(5)
    expect(history.position).toBe(2)
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(true)
  })

  it('越界下标会被夹取到合法范围', () => {
    const { history, store } = setup()
    store.addField('text')

    history.jumpTo(-5)
    expect(history.position).toBe(0)
    expect(names(store.schema.fields)).toEqual(['name', 'age', 'city'])

    history.jumpTo(99)
    expect(history.position).toBe(1)
    expect(names(store.schema.fields)).toEqual(['name', 'age', 'city', 'text1'])
  })
})

describe('内存', () => {
  it('100 步历史的内存增量远小于 5MB（存补丁而不是快照）', () => {
    const { history, store } = setup()
    const nameId = store.schema.fields[0].id

    for (let index = 0; index < 100; index += 1) {
      store.updateField(nameId, { label: `第 ${index} 版` })
      vi.advanceTimersByTime(MERGE_WINDOW + 1)
    }

    expect(history.undoStack).toHaveLength(100)
    const historyBytes = bytes(history.undoStack)
    expect(historyBytes).toBeLessThan(5 * 1024 * 1024)
    expect(historyBytes).toBeLessThan(128 * 1024)
  })
})

describe('重置与清空', () => {
  it('setSchema 会清空历史与选中', () => {
    const { history, store } = setup()
    store.addField('text')
    store.select(store.schema.fields[0].id)

    const next = makeSchema([])
    store.setSchema(next)

    expect(history.undoStack).toHaveLength(0)
    expect(history.redoStack).toHaveLength(0)
    expect(history.canUndo).toBe(false)
    expect(store.selectedIds).toEqual([])
    expect(store.schema.fields).toEqual([])
    expect(history.base).not.toBe(next)
  })

  it('clearRedo 只清 redo 栈', () => {
    const { history, store } = setup()
    store.addField('text')
    history.undo()
    expect(history.canRedo).toBe(true)

    history.clearRedo()
    expect(history.canRedo).toBe(false)
    expect(history.undoStack).toHaveLength(0)
    expect(history.canUndo).toBe(false)
  })
})
