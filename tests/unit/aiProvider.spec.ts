/**
 * M6 / AI6：OpenAI 兼容供应商的测试。
 * 全部用注入的 fetch stub，不发真实网络请求；key 只出现在请求头里。
 */
import { describe, expect, it, vi } from 'vitest'
import { createOpenAIProvider, extractJson } from '@/ai/openai'
import type { AiRequest } from '@/ai/types'
import { makeDoc } from './factories'

function request(): AiRequest {
  return { kind: 'page', prompt: '做一个读书会落地页', context: { doc: makeDoc(), pageId: 'page_1' } }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

describe('M6 OpenAI 兼容供应商', () => {
  it('extractJson 能剥围栏、跳过话痨、容忍尾随文本', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('好的，这是结果：{"a":[1,2]} 还需要别的吗？')).toEqual({ a: [1, 2] })
    expect(extractJson('{"a":1}\n{"b":2}')).toEqual({ a: 1 })
    expect(extractJson('没有 JSON')).toBeUndefined()
  })

  it('没有 key 或没有 fetch 时 ready=false 且 complete 直接失败', async () => {
    const noKey = createOpenAIProvider({ apiKey: '  ' })
    expect(noKey.ready).toBe(false)
    expect(noKey.id).toBe('openai')
    expect(noKey.label).toContain('gpt-4o-mini')
    const result = await noKey.complete(request())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('API Key')

    vi.stubGlobal('fetch', undefined)
    const noFetch = createOpenAIProvider({ apiKey: 'sk-test' })
    expect(noFetch.ready).toBe(false)
    const failed = await noFetch.complete(request())
    expect(failed.ok).toBe(false)
    expect(failed.error).toContain('fetch')
    vi.unstubAllGlobals()
  })

  it('成功路径：POST 到 /chat/completions，带上 key、模型与 messages', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '```json\n{"name":"读书会"}\n```' } }] }),
    )
    const provider = createOpenAIProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1/',
      model: 'my-model',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(provider.ready).toBe(true)
    const result = await provider.complete(request())
    expect(result.ok, result.error).toBe(true)
    expect(result.json).toEqual({ name: '读书会' })
    expect(result.provider).toBe('openai')
    expect(typeof result.ms).toBe('number')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(init.body)) as { model: string; messages: { role: string; content: string }[] }
    expect(body.model).toBe('my-model')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content.length).toBeGreaterThan(0)
  })

  it('HTTP 错误 → provider 错误里带状态码与响应片段', async () => {
    const provider = createOpenAIProvider({
      apiKey: 'sk-test',
      fetchImpl: (async () => jsonResponse({ error: { message: 'bad key' } }, 401)) as unknown as typeof fetch,
    })
    const result = await provider.complete(request())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
    expect(result.error).toContain('bad key')
  })

  it('返回不是 JSON、缺 choices 都算失败（交给编排层重试）', async () => {
    const notJson = createOpenAIProvider({
      apiKey: 'sk-test',
      fetchImpl: (async () => jsonResponse({ choices: [{ message: { content: '我觉得挺好的' } }] })) as unknown as typeof fetch,
    })
    expect((await notJson.complete(request())).error).toContain('不是 JSON')

    const noChoices = createOpenAIProvider({
      apiKey: 'sk-test',
      fetchImpl: (async () => jsonResponse({ id: 'x' })) as unknown as typeof fetch,
    })
    expect((await noChoices.complete(request())).error).toContain('choices')
  })

  it('超时会被 AbortController 掐断并报成超时', async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
      })) as unknown as typeof fetch
    const provider = createOpenAIProvider({ apiKey: 'sk-test', fetchImpl: hanging, timeoutMs: 5 })
    const result = await provider.complete(request())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('超时')
  })
})
