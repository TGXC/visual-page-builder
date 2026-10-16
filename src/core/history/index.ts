/**
 * 历史栈：存「补丁 + 合并窗口」，不存整份文档快照。
 *
 * 为什么不用快照（WebBuilder 的做法，60 步上限）：
 * ①一份 200 字段的文档快照约 20KB，100 步就是 2MB，还必须砍步数；
 * ②补丁自带逆信息（core/patch），100 步实测只有几十 KB，因此可以完全去掉步数上限。
 *
 * 合并窗口解决「连续打字每一帧都进历史」：同字段同属性的连续 update（key 集合一致）在
 * MERGE_WINDOW 毫秒内合并成一条，撤销一次回到最初值。
 */
import type { Doc, NodePatchData, Patch } from '../schema/types'
import { applyPatches, invertPatches } from '../patch'

export const MERGE_WINDOW = 400

export interface HistoryEntry {
  label: string
  patches: Patch[]
  /** 只有同 mergeKey 的连续 update 才可能合并 */
  mergeKey?: string
  at: number
}

export interface HistoryState {
  base: Doc
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

export function createHistory(base: Doc): HistoryState {
  return { base, undo: [], redo: [] }
}

function sameKeys(a: NodePatchData, b: NodePatchData): boolean {
  const keysA = Object.keys(a).sort().join(',')
  const keysB = Object.keys(b).sort().join(',')
  return keysA !== '' && keysA === keysB
}

/** 合并两串补丁：只有「同页、同节点、同键集合的 update」才允许合并 */
function mergePatches(last: readonly Patch[], next: readonly Patch[]): Patch[] | null {
  if (last.length === 0 || last.length !== next.length) return null
  const merged: Patch[] = []
  for (let index = 0; index < last.length; index += 1) {
    const a = last[index]
    const b = next[index]
    if (a.op !== 'update' || b.op !== 'update') return null
    if (a.pageId !== b.pageId || a.id !== b.id) return null
    if (!sameKeys(a.after, b.after)) return null
    merged.push({ op: 'update', pageId: a.pageId, id: a.id, before: a.before, after: b.after })
  }
  return merged
}

/** 提交一条历史：能合并就合并（不新增历史条目），否则入栈并清空重做栈 */
export function commitEntry(state: HistoryState, entry: HistoryEntry): HistoryState {
  const last = state.undo[state.undo.length - 1]
  const base = applyPatches(state.base, entry.patches)

  if (
    last &&
    last.mergeKey &&
    entry.mergeKey &&
    last.mergeKey === entry.mergeKey &&
    entry.at - last.at <= MERGE_WINDOW
  ) {
    const merged = mergePatches(last.patches, entry.patches)
    if (merged) {
      return {
        base,
        undo: [...state.undo.slice(0, -1), { ...last, label: entry.label, patches: merged, at: entry.at }],
        redo: [],
      }
    }
  }

  return { base, undo: [...state.undo, entry], redo: [] }
}

export function undoEntry(state: HistoryState): HistoryState {
  const entry = state.undo[state.undo.length - 1]
  if (!entry) return state
  return {
    base: applyPatches(state.base, invertPatches(entry.patches)),
    undo: state.undo.slice(0, -1),
    redo: [entry, ...state.redo],
  }
}

export function redoEntry(state: HistoryState): HistoryState {
  const entry = state.redo[0]
  if (!entry) return state
  return {
    base: applyPatches(state.base, entry.patches),
    undo: [...state.undo, entry],
    redo: state.redo.slice(1),
  }
}

/** 跳到任意历史点（0 = 初始状态）；越界自动夹取 */
export function jumpToEntry(state: HistoryState, index: number): HistoryState {
  const total = state.undo.length + state.redo.length
  const target = Math.max(0, Math.min(Math.trunc(index), total))
  let next = state
  while (next.undo.length > target) next = undoEntry(next)
  while (next.undo.length < target) next = redoEntry(next)
  return next
}

export function historyLabels(state: HistoryState): string[] {
  return ['初始状态', ...state.undo.map((entry) => entry.label)]
}

export function historyPosition(state: HistoryState): number {
  return state.undo.length
}

export function canUndo(state: HistoryState): boolean {
  return state.undo.length > 0
}

export function canRedo(state: HistoryState): boolean {
  return state.redo.length > 0
}
