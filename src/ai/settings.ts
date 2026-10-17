/**
 * AI 供应商设置（M6 / AI6）：key 只存在本机 localStorage，绝不进文档与导出产物。
 * 没有 localStorage（单测、SSR）时回落默认值，存取都不抛错。
 */
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from './openai'

export const AI_SETTINGS_KEY = 'studio.ai.settings.v1'

export interface AiSettings {
  /** OpenAI 兼容端点的 API Key（只写本机） */
  apiKey: string
  baseUrl: string
  model: string
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function textOf(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : fallback
}

export function loadAiSettings(): AiSettings {
  const store = storage()
  if (!store) return { ...DEFAULT_AI_SETTINGS }
  try {
    const raw = store.getItem(AI_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_AI_SETTINGS }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_AI_SETTINGS }
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
      baseUrl: textOf(parsed.baseUrl, DEFAULT_BASE_URL),
      model: textOf(parsed.model, DEFAULT_MODEL),
    }
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export function saveAiSettings(settings: AiSettings): AiSettings {
  const next: AiSettings = {
    apiKey: settings.apiKey.trim(),
    baseUrl: textOf(settings.baseUrl, DEFAULT_BASE_URL),
    model: textOf(settings.model, DEFAULT_MODEL),
  }
  const store = storage()
  if (store) {
    try {
      store.setItem(AI_SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // 隐私模式写不进去也不该让编辑器崩
    }
  }
  return next
}
