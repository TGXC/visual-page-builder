/**
 * M7 AI 生成自定义组件（功能文档 AI5）。
 *
 * 流程：提示词 → **受限 DSL**（`core/dsl` 白名单校验）→ 沙箱预览 HTML → 用户确认 → `registerCandidate()`
 * 注册进组件库的「我的组件」并写本机存档。
 * 安全边界：DSL 只能组合已注册组件 + 白名单样式键，没有任意 JS/CSS；预览用的也是同一套转义渲染。
 */
import { compileDsl, componentPreviewHtml, validateDsl } from '../core/dsl'
import type { ComponentDsl, DslNode, DslProblem } from '../core/dsl'
import { registerComponent } from '../core/components'
import type { ComponentDescriptor } from '../core/components'
import { loadCustomDsl, saveCustomDsl } from '../core/persistence/custom'

export interface ComponentCandidate {
  id: string
  dsl: ComponentDsl
  previewHtml: string
  nodeCount: number
}

export type CandidateResult = { ok: true; candidate: ComponentCandidate } | { ok: false; problems: DslProblem[] }

export const CUSTOM_TYPE_PREFIX = 'custom-'

export function isCustomType(type: string): boolean {
  return type.startsWith(CUSTOM_TYPE_PREFIX)
}

function countNodes(node: DslNode): number {
  return 1 + (node.children ?? []).reduce((total, child) => total + countNodes(child), 0)
}

/** 提示词里的关键词决定模板；没有关键词就用通用卡片 */
function dslFor(prompt: string): ComponentDsl {
  const text = prompt.trim()
  if (/团队|成员|头像|人物|profile|team/i.test(text)) return teamCard()
  if (/价格|套餐|定价|price|pricing/i.test(text)) return priceCard()
  return genericCard(text)
}

function teamCard(): ComponentDsl {
  return {
    name: '团队成员卡片',
    icon: '👤',
    size: { w: 320, h: 96 },
    props: [
      { key: 'title', label: '姓名', type: 'text', default: '张三' },
      { key: 'sub', label: '职位', type: 'text', default: '前端工程师' },
      { key: 'status', label: '状态', type: 'text', default: '在线' },
    ],
    root: {
      type: 'card',
      style: { bg: '#FFFFFF', radius: 12, padding: 16, display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'center' },
      children: [
        { type: 'avatar', style: { width: 48, height: 48, radius: 24, bg: '#E0E7FF' } },
        {
          type: 'container',
          style: { display: 'flex', flexDirection: 'column', gap: 4 },
          children: [
            { type: 'heading', text: '{{title}}', style: { fontSize: 16, fontWeight: 600, color: '#0F172A' } },
            { type: 'text', text: '{{sub}}', style: { fontSize: 13, color: '#64748B' } },
          ],
        },
        { type: 'badge', text: '{{status}}', style: { bg: '#DCFCE7', color: '#16A34A', radius: 999, padding: 6, fontSize: 12 } },
      ],
    },
  }
}

function priceCard(): ComponentDsl {
  return {
    name: '价格套餐卡片',
    icon: '💳',
    size: { w: 260, h: 200 },
    props: [
      { key: 'title', label: '套餐名', type: 'text', default: '标准版' },
      { key: 'price', label: '价格', type: 'text', default: '¥29 / 月' },
      { key: 'note', label: '说明', type: 'text', default: '包含全部基础功能' },
    ],
    root: {
      type: 'card',
      style: { bg: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, radius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 },
      children: [
        { type: 'heading', text: '{{title}}', style: { fontSize: 16, fontWeight: 600, color: '#0F172A' } },
        { type: 'text', text: '{{price}}', style: { fontSize: 24, fontWeight: 700, color: '#2563EB' } },
        { type: 'text', text: '{{note}}', style: { fontSize: 13, color: '#64748B' } },
        { type: 'button', text: '立即开通', style: { bg: '#2563EB', color: '#FFFFFF', radius: 8, padding: 10, fontSize: 14, align: 'center' } },
      ],
    },
  }
}

function genericCard(prompt: string): ComponentDsl {
  const title = prompt.slice(0, 20) || '卡片标题'
  return {
    name: (prompt.slice(0, 20) || '自定义卡片').replace(/\s+/g, ' '),
    icon: '✦',
    size: { w: 280, h: 140 },
    props: [
      { key: 'title', label: '标题', type: 'text', default: title },
      { key: 'sub', label: '说明', type: 'text', default: '一句话说明这个卡片' },
    ],
    root: {
      type: 'card',
      style: { bg: '#FFFFFF', borderColor: '#E2E8F0', borderWidth: 1, radius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
      children: [
        { type: 'heading', text: '{{title}}', style: { fontSize: 16, fontWeight: 600, color: '#0F172A' } },
        { type: 'text', text: '{{sub}}', style: { fontSize: 13, color: '#64748B' } },
      ],
    },
  }
}

export function buildCandidate(dsl: ComponentDsl): ComponentCandidate {
  return {
    id: `candidate-${countNodes(dsl.root)}-${dsl.name.length}`,
    dsl,
    previewHtml: componentPreviewHtml(dsl),
    nodeCount: countNodes(dsl.root),
  }
}

/** 规则式生成（离线路径，Mock 供应商直接用它） */
export function componentCandidates(prompt: string): ComponentCandidate[] {
  return [buildCandidate(dslFor(prompt))]
}

/** 供应商 JSON → 候选：先过受限 DSL 校验，任何越界内容都拒绝 */
export function candidateFromJson(raw: unknown): CandidateResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, problems: [{ code: 'shape', message: '供应商没有返回 JSON 对象' }] }
  }
  const dsl = (raw as { dsl?: unknown }).dsl
  if (dsl === undefined) {
    return { ok: false, problems: [{ code: 'shape', message: '供应商返回里没有 dsl 字段' }] }
  }
  const problems = validateDsl(dsl)
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, candidate: buildCandidate(dsl as ComponentDsl) }
}

/** 确认注册：进注册表（分类「我的组件」）+ 写本机存档；同名组件覆盖存档里的旧版本 */
export function registerCandidate(candidate: ComponentCandidate): ComponentDescriptor {
  const descriptor = compileDsl(candidate.dsl)
  registerComponent(descriptor)
  const others = loadCustomDsl().filter((item) => item.name !== candidate.dsl.name)
  saveCustomDsl([...others, candidate.dsl])
  return descriptor
}

export function describeCandidate(candidate: ComponentCandidate): string {
  const props = candidate.dsl.props?.length ?? 0
  return `${candidate.dsl.name} · ${candidate.nodeCount} 个节点 · ${props} 个可改属性`
}
