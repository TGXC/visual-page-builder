/**
 * OpenAI 兼容供应商（M6 / AI6）：任何 `POST {base}/chat/completions` 的端点都能接
 * （OpenAI、DeepSeek、本地 Ollama 的 /v1 兼容层都算）。
 *
 * 三条工程约束：
 * ①key 只存在本机 localStorage，绝不写进文档、不写进导出产物；
 * ②`fetch` 可注入，测试里 stub 掉就能覆盖成功/失败/超时三条路径；
 * ③返回内容先按文本取，再 JSON.parse；解析失败当作失败，交给编排层重试。
 */
import { buildMessages } from './catalog'
import type { AiProvider, AiRequest, AiResponse } from './types'

export interface OpenAIProviderOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  /** 注入用（测试 stub / 自定义运行环境） */
  fetchImpl?: typeof fetch
  /** 单次请求超时，默认 30s */
  timeoutMs?: number
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_MODEL = 'gpt-4o-mini'

/** 从某个 `{`/`[` 开始，逐个闭合位置试解析（尾随文本 / JSONL 都能取到第一个完整对象） */
function parseFrom(candidate: string): unknown {
  const closes: number[] = []
  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index]
    if (char === '}' || char === ']') closes.push(index)
  }
  for (const end of closes) {
    try {
      return JSON.parse(candidate.slice(0, end + 1))
    } catch {
      // 这个闭合位置还构不成合法 JSON，继续往后试
    }
  }
  return undefined
}

/** 去掉 ```json 包裹，容忍模型话痨（前面有说明文字、后面有多余内容） */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const start = trimmed.search(/[[{]/)
  if (start < 0) return undefined
  const direct = parseFrom(trimmed.slice(start))
  if (direct !== undefined) return direct
  // 兜底：整段先按代码块剥一层再试（防止围栏里外混合的怪输出）
  const fenced = trimmed.match(/^\s*```(?:json)?\s*([\s\S]*?)```/)
  if (!fenced) return undefined
  const inner = fenced[1].trim()
  const innerStart = inner.search(/[[{]/)
  return innerStart < 0 ? undefined : parseFrom(inner.slice(innerStart))
}

export function createOpenAIProvider(options: OpenAIProviderOptions): AiProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = options.model ?? DEFAULT_MODEL
  const apiKey = options.apiKey.trim()
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 30_000

  return {
    id: 'openai',
    label: `OpenAI 兼容（${model}）`,
    ready: apiKey !== '' && typeof doFetch === 'function',
    async complete(request: AiRequest): Promise<AiResponse> {
      const started = Date.now()
      const fail = (error: string, text?: string): AiResponse => ({
        ok: false,
        error,
        ...(text ? { text } : {}),
        provider: 'openai',
        ms: Date.now() - started,
      })
      if (apiKey === '') return fail('没有配置 API Key')
      if (typeof doFetch !== 'function') return fail('当前环境没有 fetch')
      const messages = request.messages ?? buildMessages(request)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        })
        const raw = await response.text()
        if (!response.ok) return fail(`HTTP ${response.status}：${raw.slice(0, 200)}`, raw)
        const parsed = extractJson(raw) as { choices?: { message?: { content?: string } }[] } | undefined
        const content = parsed?.choices?.[0]?.message?.content
        if (typeof content !== 'string') return fail('返回里没有 choices[0].message.content', raw)
        const json = extractJson(content)
        if (json === undefined) return fail('模型返回的不是 JSON', content)
        return { ok: true, json, text: content, provider: 'openai', ms: Date.now() - started }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return fail(message.includes('abort') ? `请求超时（${timeoutMs}ms）` : message)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
