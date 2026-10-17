/**
 * M8 版本历史（功能文档 L7「版本历史」：除撤销外保留带名字的版本快照，可对比、可回滚）。
 *
 * 存的是完整 `Doc` JSON（普通对象，没有函数），走 `localStorage`；
 * 按最新在前保留 `MAX_VERSIONS` 条，存取失败一律静默降级（与 core/persistence 同策略）。
 * 回滚出来的文档仍要经 store 的 `setDoc()` 走一遍 `normalizeDoc()`，所以「逐字节一致」
 * 依赖收敛层本身的可复现性（M1 起就是这么要求的）。
 */
import type { Doc } from '../schema/types'
import { STORAGE_KEY } from '../persistence'

export const VERSIONS_KEY = 'studio.versions.v1'
export const MAX_VERSIONS = 20

export interface VersionEntry {
  id: string
  name: string
  at: number
  doc: Doc
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isEntry(value: unknown): value is VersionEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<VersionEntry>
  return typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.at === 'number' && !!entry.doc
}

/** 读全部版本（最新在前）；坏 JSON / 坏条目静默丢弃 */
export function loadVersions(): VersionEntry[] {
  const store = storage()
  if (!store) return []
  try {
    const raw = store.getItem(VERSIONS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEntry).map((entry) => ({ ...entry }))
  } catch {
    return []
  }
}

function writeVersions(list: readonly VersionEntry[]): VersionEntry[] {
  const store = storage()
  if (!store) return [...list]
  try {
    store.setItem(VERSIONS_KEY, JSON.stringify(list))
  } catch {
    // 配额满 / 隐私模式：内存里返回新列表，磁盘上保持原样
  }
  return [...list]
}

function idOf(at: number): string {
  return `ver_${at.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** 存一个新版本，返回更新后的列表（最新在前，超出上限丢最老的） */
export function saveVersion(doc: Doc, name: string, at = Date.now()): VersionEntry[] {
  const trimmed = name.trim()
  const entry: VersionEntry = { id: idOf(at), name: trimmed === '' ? '未命名版本' : trimmed, at, doc }
  return writeVersions([entry, ...loadVersions()].slice(0, MAX_VERSIONS))
}

export function removeVersion(id: string): VersionEntry[] {
  return writeVersions(loadVersions().filter((entry) => entry.id !== id))
}

export function clearVersions(): VersionEntry[] {
  const store = storage()
  try {
    store?.removeItem(VERSIONS_KEY)
  } catch {
    // 同上：失败也不抛
  }
  return []
}

/** 回滚：返回一份**副本**（调用方再走 normalizeDoc / setDoc），未知 id 返回 null */
export function restoreVersion(id: string): Doc | null {
  const entry = loadVersions().find((item) => item.id === id)
  if (!entry) return null
  return JSON.parse(JSON.stringify(entry.doc)) as Doc
}

/** 面板列表里的摘要：`3 页 · 42 个元素` */
export function versionSummaryOf(entry: VersionEntry): string {
  const nodes = entry.doc.pages.reduce((total, page) => total + Object.keys(page.nodes).length, 0)
  return `${entry.doc.pages.length} 页 · ${nodes} 个元素`
}

/** 版本存档与文档存档共用的键前缀（面板提示用；`STORAGE_KEY` 是当前文档的自动保存键） */
export const DOC_STORAGE_KEY = STORAGE_KEY
