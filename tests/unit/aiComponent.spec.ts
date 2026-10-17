/**
 * M7 AI 生成自定义组件（src/ai/component.ts）：受限 DSL → 预览 → 注册进「我的组件」→ 存档。
 * 对应功能文档 AI5 与 PLAN 裁剪优先级第一条。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  candidateFromJson,
  componentCandidates,
  describeCandidate,
  isCustomType,
  registerCandidate,
} from '@/ai/component'
import { getComponent, hasComponent, listComponents, unregisterComponent } from '@/core/components'
import { validateDsl } from '@/core/dsl'
import { CUSTOM_DSL_KEY, loadCustomDsl } from '@/core/persistence/custom'

const registered: string[] = []

afterEach(() => {
  for (const type of registered.splice(0)) unregisterComponent(type)
  localStorage.clear()
})

describe('M7 AI 生成自定义组件（src/ai/component.ts）', () => {
  it('团队成员卡片提示词产出合法受限 DSL，可复现', () => {
    const list = componentCandidates('一个带头像和在线状态点的团队成员卡片')
    expect(list).toHaveLength(1)
    const [candidate] = list
    expect(validateDsl(candidate.dsl)).toEqual([])
    expect(candidate.dsl.root.type).toBe('card')
    expect(candidate.dsl.name.length).toBeLessThanOrEqual(24)
    expect(candidate.dsl.props?.length ?? 0).toBeGreaterThan(0)
    const types = JSON.stringify(candidate.dsl.root)
    expect(types).toContain('avatar')
    expect(candidate.nodeCount).toBeGreaterThan(2)
    expect(componentCandidates('一个带头像和在线状态点的团队成员卡片')).toEqual(list)
  })

  it('不同提示词给出不同组件（名称与类型都不同）', () => {
    const team = componentCandidates('团队成员卡片')[0]
    const price = componentCandidates('价格套餐卡片')[0]
    expect(price.dsl.name).not.toBe(team.dsl.name)
    expect(price.dsl.root).not.toEqual(team.dsl.root)
    expect(validateDsl(price.dsl)).toEqual([])
    expect(validateDsl(componentCandidates('随便一个小卡片')[0].dsl)).toEqual([])
  })

  it('预览 HTML 自带作用域样式且不含脚本 / 外链', () => {
    const [candidate] = componentCandidates('团队成员卡片')
    expect(candidate.previewHtml).toContain('cc-')
    expect(candidate.previewHtml).not.toContain('<script')
    expect(candidate.previewHtml).not.toContain('javascript:')
    expect(describeCandidate(candidate)).toContain(candidate.dsl.name)
    expect(describeCandidate(candidate)).toContain(String(candidate.nodeCount))
  })

  it('解析供应商 JSON：合法 DSL 通过，坏形状与越界 DSL 都拒绝', () => {
    const [candidate] = componentCandidates('团队成员卡片')
    const good = candidateFromJson({ dsl: candidate.dsl })
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.candidate.dsl.name).toBe(candidate.dsl.name)

    const bad = candidateFromJson({ dsl: { name: '坏组件' } })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.problems.length).toBeGreaterThan(0)

    const unknown = candidateFromJson({
      dsl: {
        name: '坏组件',
        root: { type: 'no-such-type', children: [] },
      },
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.problems.some((item) => item.code === 'unknown-type')).toBe(true)

    expect(candidateFromJson(null).ok).toBe(false)
    expect(candidateFromJson({ dsl: 'x' }).ok).toBe(false)
  })

  it('注册后进「我的组件」并写入本机存档，可卸载', () => {
    const [candidate] = componentCandidates('团队成员卡片')
    const descriptor = registerCandidate(candidate)
    registered.push(descriptor.type)
    expect(isCustomType(descriptor.type)).toBe(true)
    expect(isCustomType('card')).toBe(false)
    expect(hasComponent(descriptor.type)).toBe(true)
    expect(getComponent(descriptor.type)?.category).toBe('custom')
    expect(getComponent(descriptor.type)?.label).toBe(candidate.dsl.name)
    expect(listComponents().some((item) => item.type === descriptor.type)).toBe(true)
    expect(localStorage.getItem(CUSTOM_DSL_KEY)).not.toBeNull()
    const stored = loadCustomDsl()
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe(candidate.dsl.name)

    unregisterComponent(descriptor.type)
    registered.length = 0
    expect(hasComponent(descriptor.type)).toBe(false)
  })
})
