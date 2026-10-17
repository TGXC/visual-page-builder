import { describe, expect, it } from 'vitest'
import type { Doc } from '@/core/schema/types'
import {
  canRedo,
  canUndo,
  commitDocEntry,
  commitEntry,
  createHistory,
  historyLabels,
  historyPosition,
  jumpToEntry,
  redoEntry,
  undoEntry,
} from '@/core/history'
import type { HistoryState, PatchHistoryEntry } from '@/core/history'
import { docWithNodes, makeNode, snapshot } from './factories'

const PAGE = 'page_1'

function tree(): Doc {
  return docWithNodes([
    makeNode({ id: 'root', type: 'frame' }),
    makeNode({ id: 'a', parentId: 'root', order: 0, type: 'text' }),
  ])
}

function insertEntry(id: string, at = 0): PatchHistoryEntry {
  return {
    label: '新增矩形',
    at,
    patches: [{ op: 'insert', pageId: PAGE, node: makeNode({ id, parentId: 'root', order: 1 }) }],
  }
}

function withExtraPage(doc: Doc, pageId: string): Doc {
  return {
    ...doc,
    pages: [...doc.pages, { ...doc.pages[0], id: pageId, name: 'AI 生成的页面' }],
    activePageId: pageId,
  }
}

function names(state: HistoryState): string[] {
  return Object.keys(state.base.pages[0].nodes).sort()
}

/**
 * M6：AI 的「整份文档」级操作（预生成新页面、批量替换）没法表示成节点补丁，
 * 所以历史里加一种文档级条目：before / after 各存一份文档，撤销直接换回去。
 * 功能文档 AI0 第 2 条要求「每次 AI 操作前先存快照，历史里是一条可撤销命令」。
 */
describe('文档级历史条目（M6 AI 快照）', () => {
  it('提交后 base 立刻换掉，历史里多一条带标签的命令', () => {
    const start = tree()
    let state = createHistory(start)
    const after = withExtraPage(start, 'page_ai')

    state = commitDocEntry(state, { label: 'AI 生成页面：读书会落地页', at: 0, after })

    expect(state.base.activePageId).toBe('page_ai')
    expect(historyLabels(state)).toEqual(['初始状态', 'AI 生成页面：读书会落地页'])
    expect(historyPosition(state)).toBe(1)
    expect(canUndo(state)).toBe(true)
  })

  it('撤销回到提交前、重做回到提交后，逐字节一致', () => {
    const start = tree()
    const after = withExtraPage(start, 'page_ai')
    let state = createHistory(start)
    state = commitDocEntry(state, { label: 'AI 生成页面', at: 0, after })
    const end = snapshot(after)

    state = undoEntry(state)
    expect(snapshot(state.base)).toBe(snapshot(start))
    expect(canRedo(state)).toBe(true)

    state = redoEntry(state)
    expect(snapshot(state.base)).toBe(end)
    expect(state.base.pages).toHaveLength(2)
  })

  it('和补丁条目混用时，连续撤销能跨过两种条目', () => {
    const start = tree()
    let state = createHistory(start)
    state = commitEntry(state, insertEntry('b'))
    state = commitDocEntry(state, { label: 'AI 生成页面', at: 0, after: withExtraPage(state.base, 'page_ai') })

    state = undoEntry(state)
    expect(state.base.pages).toHaveLength(1)
    expect(names(state)).toEqual(['a', 'b', 'root'])

    state = undoEntry(state)
    expect(names(state)).toEqual(['a', 'root'])
    expect(canUndo(state)).toBe(false)

    state = redoEntry(state)
    state = redoEntry(state)
    expect(state.base.pages).toHaveLength(2)
    expect(names(state)).toEqual(['a', 'b', 'root'])
  })

  it('文档级条目不参与输入合并窗口', () => {
    const start = tree()
    let state = createHistory(start)
    state = commitDocEntry(state, { label: 'AI 生成页面', at: 0, after: withExtraPage(start, 'p1') })
    state = commitDocEntry(state, { label: 'AI 生成页面', at: 10, after: withExtraPage(state.base, 'p2') })

    expect(historyPosition(state)).toBe(2)
  })

  it('jumpToEntry 能跳到文档级条目之前', () => {
    const start = tree()
    let state = createHistory(start)
    state = commitDocEntry(state, { label: 'AI 生成页面', at: 0, after: withExtraPage(start, 'page_ai') })

    state = jumpToEntry(state, 0)
    expect(snapshot(state.base)).toBe(snapshot(start))
    expect(jumpToEntry(state, 1).base.activePageId).toBe('page_ai')
  })
})
