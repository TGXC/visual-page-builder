import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { applyPatch, invertPatch } from '@/core/patch'
import { demoSchema } from '@/data/demoSchema'
import { loadSchema } from './persist'
import type { FormSchema, Patch } from '@/core/types'

/**
 * 连续输入的合并窗口：同一个 mergeKey 在这个时间内只留一条历史。
 * 打字时每敲一个字符都会产生一个补丁，不合并的话撤销一次只退一个字符。
 */
export const MERGE_WINDOW = 400

export interface HistoryEntry {
  label: string
  patch: Patch
  mergeKey?: string
  at: number
}

/** 和历史一样：schema 必须能 JSON.stringify，所以 JSON 深拷贝就够 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 时间线是「初始 schema + 一串补丁」，不是「一串快照」。
 *
 * 200 个字段的 schema 快照约 100KB，一条补丁不到 500B：
 * 100 步历史分别是 10MB 和 50KB。撤销就是把补丁的逆补丁再贴回去。
 */
export const useHistoryStore = defineStore('history', () => {
  const base = ref<FormSchema>(clone(loadSchema() ?? demoSchema))
  const undoStack = ref<HistoryEntry[]>([])
  const redoStack = ref<HistoryEntry[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  /** 时间线文案：第 0 项永远是「初始状态」 */
  const labels = computed(() => ['初始状态', ...undoStack.value.map(entry => entry.label)])
  const position = computed(() => undoStack.value.length)

  function push(entry: HistoryEntry): void {
    undoStack.value.push(entry)
    redoStack.value = []
  }

  /**
   * 只合并「同一字段同一批属性」的连续 update：before 保留最早的值，after 取最新的。
   * 结构类补丁（insert/remove/move）一律不合并——两步插字段合成一步撤销会很怪。
   */
  function tryMerge(entry: HistoryEntry): boolean {
    if (!entry.mergeKey) return false

    const last = undoStack.value[undoStack.value.length - 1]
    if (!last || last.mergeKey !== entry.mergeKey) return false
    if (entry.at - last.at > MERGE_WINDOW) return false
    if (last.patch.op !== 'update' || entry.patch.op !== 'update') return false
    if (last.patch.id !== entry.patch.id) return false

    last.patch = { op: 'update', id: last.patch.id, before: last.patch.before, after: entry.patch.after }
    last.label = entry.label
    last.at = entry.at
    return true
  }

  /** 所有结构变更的唯一出口：先记历史，再把补丁贴到 base 上 */
  function commit(entry: HistoryEntry): void {
    if (!tryMerge(entry)) push(entry)
    base.value = applyPatch(base.value, entry.patch)
  }

  function undo(): HistoryEntry | null {
    const entry = undoStack.value.pop()
    if (!entry) return null
    redoStack.value.push(entry)
    base.value = applyPatch(base.value, invertPatch(entry.patch))
    return entry
  }

  function redo(): HistoryEntry | null {
    const entry = redoStack.value.pop()
    if (!entry) return null
    undoStack.value.push(entry)
    base.value = applyPatch(base.value, entry.patch)
    return entry
  }

  /** index 是时间线上的状态序号：0 = 初始状态，undoStack.length = 最新 */
  function jumpTo(index: number): void {
    const total = undoStack.value.length + redoStack.value.length
    const target = Math.max(0, Math.min(Math.trunc(index), total))

    while (undoStack.value.length > target) undo()
    while (undoStack.value.length < target && redoStack.value.length > 0) redo()
  }

  function clearRedo(): void {
    redoStack.value = []
  }

  /** 导入/新建 schema：换一条时间线 */
  function reset(next: FormSchema): void {
    base.value = clone(next)
    undoStack.value = []
    redoStack.value = []
  }

  return {
    base,
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    labels,
    position,
    push,
    tryMerge,
    commit,
    undo,
    redo,
    jumpTo,
    clearRedo,
    reset,
  }
})
