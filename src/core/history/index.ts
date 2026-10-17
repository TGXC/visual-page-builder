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

/** 补丁条目：绝大多数编辑（含 AI 产出的补丁组）都是这种 */
export interface PatchHistoryEntry {
  /** 缺省即补丁条目（老代码构造的字面量不用改） */
  kind?: 'patch'
  label: string
  patches: Patch[]
  /** 只有同 mergeKey 的连续 update 才可能合并 */
  mergeKey?: string
  at: number
}

/**
 * 文档级条目（M6）：AI 的「整份文档」操作（生成新页面、整份替换）没法表示成节点补丁，
 * 所以这里存 before / after 两份文档 —— 功能文档 AI0 第 2 条要求「AI 操作前先存快照」。
 */
export interface DocHistoryEntry {
  kind: 'doc'
  label: string
  at: number
  before: Doc
  after: Doc
}

export type HistoryEntry = PatchHistoryEntry | DocHistoryEntry

export function isDocEntry(entry: HistoryEntry): entry is DocHistoryEntry {
  return entry.kind === 'doc'
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
  if (isDocEntry(entry)) {
    // 文档级条目自带 before / after，不参与合并窗口
    return { base: entry.after, undo: [...state.undo, entry], redo: [] }
  }

  const last = state.undo[state.undo.length - 1]
  const base = applyPatches(state.base, entry.patches)

  if (
    last &&
    !isDocEntry(last) &&
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

/** AI 快照：把「整份文档替换」记成一条可撤销命令（before 由当前 base 自动取） */
export function commitDocEntry(
  state: HistoryState,
  entry: { label: string; at: number; after: Doc },
): HistoryState {
  return commitEntry(state, { kind: 'doc', label: entry.label, at: entry.at, before: state.base, after: entry.after })
}

export function undoEntry(state: HistoryState): HistoryState {
  const entry = state.undo[state.undo.length - 1]
  if (!entry) return state
  if (isDocEntry(entry)) {
    return { base: entry.before, undo: state.undo.slice(0, -1), redo: [entry, ...state.redo] }
  }
  return {
    base: applyPatches(state.base, invertPatches(entry.patches)),
    undo: state.undo.slice(0, -1),
    redo: [entry, ...state.redo],
  }
}

export function redoEntry(state: HistoryState): HistoryState {
  const entry = state.redo[0]
  if (!entry) return state
  if (isDocEntry(entry)) {
    return { base: entry.after, undo: [...state.undo, entry], redo: state.redo.slice(1) }
  }
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
