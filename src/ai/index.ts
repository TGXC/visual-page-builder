/**
 * AI 服务编排（M6 / AI0）：
 * ①只接受结构化 JSON，一律过本地校验（PageDraft 三重校验 / 选区补丁范围校验）；
 * ②失败自动重试一次，再失败就报错，**不写文档**；
 * ③调用记录留在内存里（M7 会做成成本面板）。
 */
import type { Doc, NodeId, PageId, Patch } from '../core/schema/types'
import type { Page } from '../core/schema/types'
import { buildMessages } from './catalog'
import { candidateFromJson } from './component'
import type { ComponentCandidate } from './component'
import { validateDraft } from './draft'
import { applyInstruction } from './instruction'
import { materialCandidatesFromJson } from './material'
import type { MaterialCandidate } from './material'
import { createMockProvider } from './mock'
import { candidatesFromJson } from './text'
import type { TextCandidate, TextOptions } from './text'
import type { AiKind, AiProblem, AiProvider, AiRequest, AiResponse } from './types'
import { PRICING_MODEL, usageOf } from './usage'
import type { UsageSummary } from './usage'

export interface AiCallLogEntry {
  at: number
  provider: string
  kind: AiKind
  prompt: string
  ok: boolean
  ms: number
  error?: string
  /** 一句话结果摘要，给「调用记录」面板显示 */
  summary: string
  /** 本地估算的 token（M7 成本面板；真实供应商返回 usage 时优先用它） */
  tokens: number
  /** 本地估算的费用（USD，未知型号按 0 计） */
  costUsd: number
  model: string
}

export interface AiOutcome<T> {
  ok: boolean
  value?: T
  errors: AiProblem[]
  response: AiResponse
}

export interface AiService {
  /** 当前供应商；默认内置 Mock */
  provider(): AiProvider
  setProvider(provider: AiProvider): void
  generatePage(doc: Doc, prompt: string, pageId?: PageId): Promise<AiOutcome<{ doc: Doc; page: Page; warnings: string[] }>>
  editSelection(
    doc: Doc,
    pageId: PageId,
    selectionIds: readonly NodeId[],
    prompt: string,
  ): Promise<AiOutcome<{ doc: Doc; patches: Patch[] }>>
  writeText(prompt: string): Promise<AiOutcome<{ text: string }>>
  /** M7 文案候选（不落库，用户挑一个再由 store 提交补丁） */
  textOptions(doc: Doc, pageId: PageId, prompt: string, options?: TextOptions): Promise<AiOutcome<{ candidates: TextCandidate[] }>>
  /** M7 素材候选（占位图 dataURL，带来源标记） */
  materialOptions(doc: Doc, pageId: PageId, prompt: string): Promise<AiOutcome<{ candidates: MaterialCandidate[] }>>
  /** M7 生成自定义组件的受限 DSL 候选（注册由 store 在用户确认后做） */
  componentOption(prompt: string): Promise<AiOutcome<{ candidate: ComponentCandidate }>>
  logs(): AiCallLogEntry[]
  clearLogs(): void
  /** 调用记录的成本汇总（M7 成本面板） */
  usageSummary(): UsageSummary
}

type Accepted<T> = { ok: true; value: T } | { ok: false; errors: AiProblem[] }
type RunResult<T> =
  | { ok: true; value: T; response: AiResponse }
  | { ok: false; errors: AiProblem[]; response: AiResponse }

/** 最多两次尝试：第一次失败（形状或本地校验不过）就带一句提示重试一次 */
async function runWithRetry<T>(
  provider: AiProvider,
  request: AiRequest,
  accept: (response: AiResponse) => Accepted<T>,
): Promise<RunResult<T>> {
  let last: RunResult<T> | null = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const next: AiRequest =
      attempt === 1
        ? request
        : {
            ...request,
            prompt: `${request.prompt}\n\n（上一次输出不合法：${last && !last.ok ? last.errors.map((item) => item.message).join('；') : ''}。请严格只输出符合 Schema 的 JSON。）`,
            messages: buildMessages(request),
          }
    const response = await provider.complete(next)
    if (!response.ok) {
      last = { ok: false, errors: [{ code: 'provider', message: response.error ?? '供应商调用失败' }], response }
      continue
    }
    if (response.json === undefined) {
      last = { ok: false, errors: [{ code: 'shape', message: '供应商没有返回 JSON' }], response }
      continue
    }
    const accepted = accept(response)
    if (accepted.ok) return { ok: true, value: accepted.value, response }
    last = { ok: false, errors: accepted.errors, response }
  }
  return last ?? {
    ok: false,
    errors: [{ code: 'provider', message: '供应商没有响应' }],
    response: { ok: false, error: '供应商没有响应', provider: provider.id, ms: 0 },
  }
}

function notReady(provider: AiProvider): AiOutcome<never> {
  return {
    ok: false,
    errors: [{ code: 'provider', message: `${provider.label} 还没配置好（缺 key 或不支持）` }],
    response: { ok: false, error: 'provider-not-ready', provider: provider.id, ms: 0 },
  }
}

export function createAiService(initial?: AiProvider): AiService {
  let current = initial ?? createMockProvider()
  const entries: AiCallLogEntry[] = []

  const modelOf = (provider: AiProvider): string =>
    provider.id === 'mock' ? 'mock' : (provider.model ?? PRICING_MODEL)

  const log = (
    kind: AiKind,
    prompt: string,
    outcome: AiOutcome<unknown>,
    summary: string,
    request: AiRequest,
  ): void => {
    const usage = usageOf(request, outcome.response, modelOf(current))
    entries.push({
      at: Date.now(),
      provider: current.id,
      kind,
      prompt: prompt.slice(0, 200),
      ok: outcome.ok,
      ms: outcome.response.ms,
      ...(outcome.errors.length > 0 ? { error: outcome.errors.map((item) => item.message).join('；') } : {}),
      summary,
      tokens: usage.totalTokens,
      costUsd: usage.costUsd,
      model: modelOf(current),
    })
    if (entries.length > 50) entries.splice(0, entries.length - 50)
  }

  return {
    provider: () => current,
    setProvider: (provider: AiProvider) => {
      current = provider
    },

    async generatePage(doc, prompt, pageId) {
      const provider = current
      if (!provider.ready) return notReady(provider)
      const target = pageId ?? doc.activePageId
      const request: AiRequest = {
        kind: 'page',
        prompt,
        context: { doc, pageId: target },
        messages: buildMessages({ kind: 'page', prompt, context: { doc, pageId: target } }),
      }
      const result = await runWithRetry(provider, request, (response) => {
        const draft = validateDraft(doc, response.json)
        return draft.ok
          ? { ok: true, value: { doc: draft.doc, page: draft.page, warnings: draft.warnings } }
          : { ok: false, errors: draft.errors }
      })
      const outcome: AiOutcome<{ doc: Doc; page: Page; warnings: string[] }> = result.ok
        ? { ok: true, value: result.value, errors: [], response: result.response }
        : { ok: false, errors: result.errors, response: result.response }
      log('page', prompt, outcome, outcome.ok ? `生成页面「${outcome.value?.page.name ?? ''}」` : '生成失败', request)
      return outcome
    },

    async editSelection(doc, pageId, selectionIds, prompt) {
      const provider = current
      if (!provider.ready) return notReady(provider)
      const request: AiRequest = {
        kind: 'instruction',
        prompt,
        context: { doc, pageId, selectionIds: [...selectionIds] },
        messages: buildMessages({ kind: 'instruction', prompt, context: { doc, pageId, selectionIds: [...selectionIds] } }),
      }
      const result = await runWithRetry(provider, request, (response) => {
        const applied = applyInstruction(doc, pageId, response.json, selectionIds)
        return applied.ok ? { ok: true, value: { doc: applied.doc, patches: applied.patches } } : { ok: false, errors: applied.errors }
      })
      const outcome: AiOutcome<{ doc: Doc; patches: Patch[] }> = result.ok
        ? { ok: true, value: result.value, errors: [], response: result.response }
        : { ok: false, errors: result.errors, response: result.response }
      log('instruction', prompt, outcome, outcome.ok ? `改动 ${outcome.value?.patches.length ?? 0} 处` : '指令失败', request)
      return outcome
    },

    async writeText(prompt) {
      const provider = current
      const request: AiRequest = { kind: 'plain', prompt, messages: buildMessages({ kind: 'plain', prompt }) }
      if (!provider.ready) return notReady(provider)
      const response = await provider.complete(request)
      const outcome: AiOutcome<{ text: string }> = response.ok && typeof response.text === 'string'
        ? { ok: true, value: { text: response.text }, errors: [], response }
        : {
            ok: false,
            errors: [{ code: response.ok ? 'shape' : 'provider', message: response.error ?? '没有拿到文案' }],
            response,
          }
      log('text', prompt, outcome, outcome.ok ? '生成文案' : '文案失败', request)
      return outcome
    },

    async textOptions(doc, pageId, prompt, options = {}) {
      const provider = current
      const asked = options.tone ? `${prompt}（语气：${options.tone}）` : prompt
      const request: AiRequest = { kind: 'text', prompt: asked, context: { doc, pageId }, messages: buildMessages({ kind: 'text', prompt: asked }) }
      if (!provider.ready) {
        const blocked = notReady(provider)
        log('text', asked, blocked, '供应商未就绪', request)
        return blocked
      }
      const result = await runWithRetry(provider, request, (response) => {
        const candidates = candidatesFromJson(response.json)
        return candidates
          ? { ok: true, value: { candidates } }
          : { ok: false, errors: [{ code: 'shape', message: '供应商没有返回 candidates 数组' }] }
      })
      const outcome: AiOutcome<{ candidates: TextCandidate[] }> = result.ok
        ? { ok: true, value: result.value, errors: [], response: result.response }
        : { ok: false, errors: result.errors, response: result.response }
      log('text', prompt, outcome, outcome.ok ? `${outcome.value?.candidates.length ?? 0} 个候选` : '文案候选失败', request)
      return outcome
    },

    async materialOptions(doc, pageId, prompt) {
      const provider = current
      const request: AiRequest = { kind: 'material', prompt, context: { doc, pageId }, messages: buildMessages({ kind: 'material', prompt }) }
      if (!provider.ready) {
        const blocked = notReady(provider)
        log('material', prompt, blocked, '供应商未就绪', request)
        return blocked
      }
      const result = await runWithRetry(provider, request, (response) => {
        const candidates = materialCandidatesFromJson(response.json)
        return candidates
          ? { ok: true, value: { candidates } }
          : { ok: false, errors: [{ code: 'shape', message: '供应商没有返回可用的素材候选' }] }
      })
      const outcome: AiOutcome<{ candidates: MaterialCandidate[] }> = result.ok
        ? { ok: true, value: result.value, errors: [], response: result.response }
        : { ok: false, errors: result.errors, response: result.response }
      log('material', prompt, outcome, outcome.ok ? `${outcome.value?.candidates.length ?? 0} 张素材` : '素材候选失败', request)
      return outcome
    },

    async componentOption(prompt) {
      const provider = current
      const request: AiRequest = { kind: 'component', prompt, messages: buildMessages({ kind: 'component', prompt }) }
      if (!provider.ready) {
        const blocked = notReady(provider)
        log('component', prompt, blocked, '供应商未就绪', request)
        return blocked
      }
      const result = await runWithRetry(provider, request, (response) => {
        const parsed = candidateFromJson(response.json)
        return parsed.ok ? { ok: true, value: { candidate: parsed.candidate } } : { ok: false, errors: parsed.problems.map((item) => ({ code: 'shape' as const, message: item.message })) }
      })
      const outcome: AiOutcome<{ candidate: ComponentCandidate }> = result.ok
        ? { ok: true, value: result.value, errors: [], response: result.response }
        : { ok: false, errors: result.errors, response: result.response }
      log('component', prompt, outcome, outcome.ok ? `组件「${outcome.value?.candidate.dsl.name ?? ''}」` : '生成组件失败', request)
      return outcome
    },

    logs: () => entries.map((entry) => ({ ...entry })),
    clearLogs: () => {
      entries.length = 0
    },
    usageSummary: () => ({
      calls: entries.length,
      tokens: entries.reduce((total, entry) => total + entry.tokens, 0),
      costUsd: Math.round(entries.reduce((total, entry) => total + entry.costUsd, 0) * 1e6) / 1e6,
      model: modelOf(current),
    }),
  }
}
