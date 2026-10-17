import { describe, expect, it } from 'vitest'
import type { Doc, Patch } from '@/core/schema/types'
import {
  MERGE_WINDOW,
  commitEntry,
  createHistory,
  historyLabels,
  historyPosition,
  canRedo,
  canUndo,
  jumpToEntry,
  redoEntry,
  undoEntry,
} from '@/core/history'
import type { HistoryState, PatchHistoryEntry } from '@/core/history'
import { childrenOf } from '@/core/tree'
import { docWithNodes, makeNode, snapshot } from './factories'

const PAGE = 'page_1'

function tree(): Doc {
  return docWithNodes([
    makeNode({ id: 'root', type: 'frame' }),
    makeNode({ id: 'a', parentId: 'root', order: 0, type: 'text' }),
    makeNode({ id: 'b', parentId: 'root', order: 1, type: 'text' }),
  ])
}

function insertEntry(state: HistoryState, id: string, at = 0): PatchHistoryEntry {
  const siblings = childrenOf(state.base.pages[0].nodes, 'root')
  return {
    label: '新增矩形',
    at,
    patches: [{ op: 'insert', pageId: PAGE, node: makeNode({ id, parentId: 'root', order: siblings.length }) }],
  }
}

function renameEntry(state: HistoryState, id: string, name: string, at = 0): PatchHistoryEntry {
  const node = state.base.pages[0].nodes[id]
  return {
    label: '改名',
    mergeKey: `meta:${id}`,
    at,
    patches: [
      {
        op: 'update',
        pageId: PAGE,
        id,
        before: { meta: node.meta },
        after: { meta: { ...node.meta, name } },
      } satisfies Patch,
    ],
  }
}

function names(state: HistoryState): string[] {
  return childrenOf(state.base.pages[0].nodes, 'root').map((node) => node.id)
}

describe('createHistory', () => {
  it('初始只有一条「初始状态」，不能撤销也不能重做', () => {
    const state = createHistory(tree())

    expect(historyLabels(state)).toEqual(['初始状态'])
    expect(historyPosition(state)).toBe(0)
    expect(canUndo(state)).toBe(false)
    expect(canRedo(state)).toBe(false)
  })
})

describe('commitEntry / undo / redo', () => {
  it('提交后立刻落到 base 上，并长出一条历史', () => {
    let state = createHistory(tree())
    state = commitEntry(state, insertEntry(state, 'c'))

    expect(names(state)).toEqual(['a', 'b', 'c'])
    expect(historyLabels(state)).toEqual(['初始状态', '新增矩形'])
    expect(historyPosition(state)).toBe(1)
    expect(canUndo(state)).toBe(true)
  })

  it('撤销 / 重做往返后与原文档逐字节一致', () => {
    const start = tree()
    let state = createHistory(start)
    state = commitEntry(state, insertEntry(state, 'c'))
    state = commitEntry(state, renameEntry(state, 'a', '标题'))
    state = commitEntry(state, {
      label: '删除矩形',
      at: 0,
      patches: [{ op: 'remove', pageId: PAGE, node: state.base.pages[0].nodes.c }],
    })
    const end = snapshot(state.base)

    state = undoEntry(state)
    state = undoEntry(state)
    state = undoEntry(state)
    expect(snapshot(state.base)).toBe(snapshot(start))
    expect(canUndo(state)).toBe(false)

    state = redoEntry(state)
    state = redoEntry(state)
    state = redoEntry(state)
    expect(snapshot(state.base)).toBe(end)
    expect(canRedo(state)).toBe(false)
  })

  it('撤销后再提交新操作，会清空重做栈', () => {
    let state = createHistory(tree())
    state = commitEntry(state, insertEntry(state, 'c'))
    state = commitEntry(state, insertEntry(state, 'd'))
    state = undoEntry(state)
    expect(canRedo(state)).toBe(true)

    state = commitEntry(state, insertEntry(state, 'e'))

    expect(canRedo(state)).toBe(false)
    expect(names(state)).toEqual(['a', 'b', 'c', 'e'])
  })

  it('撤销到底再撤销、重做到顶再重做都不出错', () => {
    let state = createHistory(tree())
    state = commitEntry(state, insertEntry(state, 'c'))
    const once = undoEntry(state)
    expect(snapshot(undoEntry(once).base)).toBe(snapshot(once.base))
    const twice = redoEntry(state)
    expect(snapshot(redoEntry(twice).base)).toBe(snapshot(twice.base))
  })
})

describe('输入合并窗口', () => {
  it('同字段同键、窗口内连续输入合并成一条（撤销一次回到最初值）', () => {
    let state = createHistory(tree())
    state = commitEntry(state, renameEntry(state, 'a', '张'))
    state = commitEntry(state, renameEntry(state, 'a', '张三', MERGE_WINDOW))

    expect(historyLabels(state)).toEqual(['初始状态', '改名'])
    expect(historyPosition(state)).toBe(1)

    state = undoEntry(state)
    expect(state.base.pages[0].nodes.a.meta.name).toBeUndefined()
  })

  it('超出合并窗口就不合并', () => {
    let state = createHistory(tree())
    state = commitEntry(state, renameEntry(state, 'a', '张', 0))
    state = commitEntry(state, renameEntry(state, 'a', '张三', MERGE_WINDOW + 1))

    expect(historyPosition(state)).toBe(2)
  })

  it('mergeKey 不同（不同字段或不同属性）不合并', () => {
    let state = createHistory(tree())
    state = commitEntry(state, renameEntry(state, 'a', '张', 0))
    state = commitEntry(state, renameEntry(state, 'b', '李', 10))

    expect(historyPosition(state)).toBe(2)
    expect(historyLabels(state)).toEqual(['初始状态', '改名', '改名'])
  })

  it('结构类补丁（insert / remove / move）永远不合并', () => {
    let state = createHistory(tree())
    state = commitEntry(state, { ...insertEntry(state, 'c'), mergeKey: 'same' })
    state = commitEntry(state, { ...insertEntry(state, 'd'), mergeKey: 'same' })

    expect(historyPosition(state)).toBe(2)
  })
})

describe('jumpToEntry', () => {
  it('可以跳到任意历史点，越界会被夹取', () => {
    let state = createHistory(tree())
    state = commitEntry(state, insertEntry(state, 'c'))
    state = commitEntry(state, insertEntry(state, 'd'))
    state = commitEntry(state, insertEntry(state, 'e'))
    const atThree = snapshot(state.base)

    state = jumpToEntry(state, 0)
    expect(names(state)).toEqual(['a', 'b'])
    state = jumpToEntry(state, 2)
    expect(names(state)).toEqual(['a', 'b', 'c', 'd'])
    state = jumpToEntry(state, 99)
    expect(snapshot(state.base)).toBe(atThree)
    expect(historyPosition(state)).toBe(3)
    state = jumpToEntry(state, -5)
    expect(names(state)).toEqual(['a', 'b'])
    expect(historyPosition(state)).toBe(0)
  })
})

describe('内存占用', () => {
  it('100 步历史只存补丁（不是整份文档快照）', () => {
    let state = createHistory(tree())
    for (let i = 0; i < 100; i += 1) {
      state = commitEntry(state, {
        label: '移动',
        mergeKey: `move:${i}`,
        at: i * 1000,
        patches: [{ op: 'insert', pageId: PAGE, node: makeNode({ id: `n${i}`, parentId: 'root', order: i + 2 }) }],
      })
    }

    const bytes = new TextEncoder().encode(JSON.stringify(state.undo)).length
    expect(historyPosition(state)).toBe(100)
    expect(bytes).toBeLessThan(5 * 1024 * 1024)
    expect(bytes).toBeLessThan(200 * 1024)
    // 单份文档快照就有几 KB，100 份快照远超这个量级
    expect(JSON.stringify(state.base).length).toBeGreaterThan(0)
  })
})
