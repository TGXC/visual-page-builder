/**
 * M7 文案候选（core 之外的纯逻辑，src/ai/text.ts）。
 * 对应功能文档 AI4：选中文本块 → 3 个候选 → 应用其一 → 可撤销。
 */
import { describe, expect, it } from 'vitest'
import { candidatesFromJson, textCandidates, textPatch, truncateText } from '@/ai/text'
import { docWithNodes, makeNode } from './factories'

describe('M7 文案候选（src/ai/text.ts）', () => {
  it('同一个提示词给出 3 个互不相同的候选，且可复现', () => {
    const first = textCandidates('读书会活动')
    const second = textCandidates('读书会活动')
    expect(first).toHaveLength(3)
    expect(new Set(first.map((item) => item.text)).size).toBe(3)
    expect(first.every((item) => item.text.includes('读书会活动'))).toBe(true)
    expect(first).toEqual(second)
    expect(first.map((item) => item.tone)).toEqual(['plain', 'warm', 'bold'])
    expect(first.every((item) => item.id !== '')).toBe(true)
  })

  it('语气参数把该语气排到第一个，长度上限会截断', () => {
    const bold = textCandidates('限时优惠', { tone: 'bold' })
    expect(bold[0].tone).toBe('bold')
    const short = textCandidates('这是一句非常非常长的活动宣传文案用来测试截断行为', { maxLength: 12 })
    expect(short.every((item) => item.text.length <= 12)).toBe(true)
    expect(truncateText('abcdef', 3)).toBe('abc')
    expect(truncateText('ab', 5)).toBe('ab')
  })

  it('空提示词也给候选（不产生空文案）', () => {
    const list = textCandidates('   ')
    expect(list).toHaveLength(3)
    expect(list.every((item) => item.text.trim() !== '')).toBe(true)
  })

  it('解析供应商 JSON：合法候选可用，坏形状返回 undefined', () => {
    expect(candidatesFromJson({ candidates: [{ text: '甲' }, { text: '乙' }] })).toHaveLength(2)
    expect(candidatesFromJson({ candidates: ['甲'] })).toBeUndefined()
    expect(candidatesFromJson({ candidates: [] })).toBeUndefined()
    expect(candidatesFromJson('甲')).toBeUndefined()
    expect(candidatesFromJson({})).toBeUndefined()
    const withTones = candidatesFromJson({
      candidates: [{ text: '甲', tone: 'warm' }, { text: '乙', tone: 'nope' }],
    })
    expect(withTones?.map((item) => item.tone)).toEqual(['warm', 'plain'])
  })

  it('textPatch 只改 props.text，before 取当前值', () => {
    const node = makeNode({ id: 'txt1', type: 'text', parentId: 'root', props: { text: '旧文案', note: 'x' } })
    const doc = docWithNodes([node])
    const page = doc.pages[0]
    const patch = textPatch(page, 'txt1', '新文案')
    expect(patch).not.toBeNull()
    expect(patch?.op).toBe('update')
    if (patch?.op !== 'update') return
    expect(patch.before.props).toEqual({ text: '旧文案', note: 'x' })
    expect(patch.after.props).toEqual({ text: '新文案', note: 'x' })
    expect(patch.after.layout).toBeUndefined()
    expect(doc.pages[0].id).toBe('page_1')
    expect(textPatch(page, 'nope', '新文案')).toBeNull()
  })
})
