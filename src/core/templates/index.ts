/**
 * 模板库：M1 从 WebBuilder 的 3 套升到 6 套（登录页 / 产品落地页 / 个人主页 / 定价页 / 关于我们 / 博客列表）。
 * 全部用统一尺寸表达，落在 1440×900 的桌面基准上；与 v1 一样，模板只是「一堆节点数据」，
 * 载入后立刻变成普通的可编辑文档（没有任何模板专属逻辑）。
 */
import type { Doc, Page, SceneNode, StyleSpec } from '../schema/types'
import { createDoc, createId, normalizeDoc } from '../schema/normalize'
import { defaultPropsFor, defaultSizeFor, defaultStyleFor } from '../schema/catalog'

export interface TemplateDef {
  id: string
  label: string
  description: string
  create: () => Doc
}

interface ElementInit {
  x: number
  y: number
  w?: number
  h?: number
  props?: Record<string, unknown>
  style?: Partial<StyleSpec>
  label?: string
}

function element(type: SceneNode['type'], init: ElementInit, order: number, parentId: string): SceneNode {
  const size = { w: init.w ?? defaultSizeFor(type).w, h: init.h ?? defaultSizeFor(type).h }
  const base = defaultStyleFor(type)
  const style: StyleSpec = { ...base, ...init.style }
  return {
    id: `${type}_${order}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    parentId,
    order,
    layout: {
      mode: 'free',
      position: { x: init.x, y: init.y },
      size: { w: { kind: 'fixed', value: size.w }, h: { kind: 'fixed', value: size.h } },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      columns: 1,
      align: 'start',
      justify: 'start',
      wrap: false,
      constraints: { h: 'left', v: 'top' },
    },
    style,
    props: { ...defaultPropsFor(type), ...init.props },
    overrides: {},
    meta: { name: init.label, hidden: false, locked: false },
  }
}

function pageFrom(elements: SceneNode[], root: SceneNode, name: string): Page {
  const nodes: Record<string, SceneNode> = { [root.id]: root }
  // 按 order 写入，键顺序就是树前序 —— 与 canonicalNodes 一致，模板文档天生「同一状态同一份 JSON」
  ;[...elements]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .forEach((node) => {
      nodes[node.id] = node
    })
  return { id: 'page_1', name, path: '/', root: root.id, nodes, viewport: { w: 1440, h: 900 } }
}

function frame(style: Partial<StyleSpec> = {}): SceneNode {
  const root = element('frame', { x: 0, y: 0, w: 1440, h: 900, style: { bg: '#FFFFFF', ...style } }, 0, '')
  root.parentId = null
  root.id = 'root'
  return root
}

function docFrom(name: string, root: SceneNode, elements: SceneNode[], pageName: string): Doc {
  const doc = createDoc(name)
  doc.pages = [pageFrom(elements, root, pageName)]
  doc.activePageId = 'page_1'
  return doc
}

/** 登录页：导航 + 卡片 + 表单控件 */
function loginTemplate(): Doc {
  const root = frame({ bg: '#F8FAFC' })
  const elements = [
    element('nav', { x: 0, y: 0, w: 1440, h: 56, props: { text: 'Acme   首页   定价   文档' }, style: { bg: '#0F172A', color: '#FFFFFF' } }, 0, root.id),
    element('card', { x: 520, y: 180, w: 400, h: 420, props: { text: '欢迎回来', sub: '登录后继续你的工作' }, style: { bg: '#FFFFFF', radius: 16, shadowBlur: 24, shadowY: 8, shadowColor: 'rgba(15,23,42,.12)', fontSize: 20, fontWeight: 700, align: 'left' } }, 1, root.id),
    element('input', { x: 560, y: 300, w: 320, h: 40, props: { placeholder: '邮箱地址' }, style: { bg: '#FFFFFF', radius: 8, borderWidth: 1, borderColor: '#CBD5E1' } }, 2, root.id),
    element('input', { x: 560, y: 352, w: 320, h: 40, props: { placeholder: '密码' }, style: { bg: '#FFFFFF', radius: 8, borderWidth: 1, borderColor: '#CBD5E1' } }, 3, root.id),
    element('checkbox', { x: 560, y: 404, w: 180, h: 24, props: { text: '记住我' } }, 4, root.id),
    element('button', { x: 560, y: 444, w: 320, h: 44, props: { text: '登录' }, style: { bg: '#3B82F6', color: '#FFFFFF', radius: 8, fontWeight: 700, align: 'center', fontSize: 15 } }, 5, root.id),
    element('text', { x: 560, y: 500, w: 320, h: 24, props: { text: '还没有账号？免费注册', link: 'https://example.com/signup' }, style: { color: '#3B82F6', fontSize: 13, align: 'center' } }, 6, root.id),
  ]
  return docFrom('登录页', root, elements, '登录')
}

/** 产品落地页：页头 + 主视觉 + 三张特性卡 + 分割线 + 页脚 */
function landingTemplate(): Doc {
  const root = frame({ bg: '#FFFFFF' })
  const elements = [
    element('nav', { x: 0, y: 0, w: 1440, h: 64, props: { text: 'Product   功能   价格   关于' }, style: { bg: '#1A1A2E', color: '#FFFFFF', fontSize: 15 } }, 0, root.id),
    element('header', { x: 80, y: 140, w: 640, h: 200, props: { text: '把想法变成页面', sub: '拖拽、对齐、导出干净代码，全程不写一行样式。' }, style: { bg: '#F8FAFC', radius: 16, fontSize: 40, fontWeight: 700, color: '#0F172A', align: 'left' } }, 1, root.id),
    element('button', { x: 80, y: 372, w: 200, h: 46, props: { text: '免费开始' }, style: { bg: '#3B82F6', color: '#FFFFFF', radius: 23, fontWeight: 700, align: 'center', fontSize: 15 } }, 2, root.id),
    element('button', { x: 300, y: 372, w: 200, h: 46, props: { text: '看演示', link: 'https://example.com/demo' }, style: { bg: '#FFFFFF', color: '#3B82F6', radius: 23, borderWidth: 1, borderColor: '#3B82F6', align: 'center', fontSize: 15 } }, 3, root.id),
    element('card', { x: 80, y: 480, w: 380, h: 180, props: { text: '元素树', sub: '父子结构 + 布局引擎，导出的是语义化 HTML。' }, style: { bg: '#FFFFFF', radius: 12, borderWidth: 1, borderColor: '#E2E8F0', fontSize: 18, fontWeight: 700, align: 'left' } }, 4, root.id),
    element('card', { x: 500, y: 480, w: 380, h: 180, props: { text: '响应式', sub: '断点只存覆盖，导出成 media query。' }, style: { bg: '#FFFFFF', radius: 12, borderWidth: 1, borderColor: '#E2E8F0', fontSize: 18, fontWeight: 700, align: 'left' } }, 5, root.id),
    element('card', { x: 920, y: 480, w: 380, h: 180, props: { text: 'AI 只出补丁', sub: '每次先快照，离线也能用。' }, style: { bg: '#FFFFFF', radius: 12, borderWidth: 1, borderColor: '#E2E8F0', fontSize: 18, fontWeight: 700, align: 'left' } }, 6, root.id),
    element('divider', { x: 80, y: 710, w: 1280, h: 2, style: { bg: '#E2E8F0' } }, 7, root.id),
    element('text', { x: 80, y: 740, w: 1280, h: 24, props: { text: '© 2026 Studio · 由可视化搭建器生成' }, style: { color: '#64748B', fontSize: 13, align: 'center' } }, 8, root.id),
  ]
  return docFrom('产品落地页', root, elements, '首页')
}

/** 个人主页：头像 + 简介 + 社交链接 */
function profileTemplate(): Doc {
  const root = frame({ bg: '#0F172A' })
  const elements = [
    element('circle', { x: 660, y: 120, w: 120, h: 120, style: { bg: '#38BDF8' } }, 0, root.id),
    element('header', { x: 420, y: 280, w: 600, h: 120, props: { text: '林一', sub: '前端工程师 · 可视化与编辑器方向' }, style: { bg: '', color: '#F8FAFC', fontSize: 34, fontWeight: 700, align: 'center' } }, 1, root.id),
    element('text', { x: 420, y: 420, w: 600, h: 80, props: { text: '做过的项目：可视化搭建器、校园活动平台。喜欢把复杂交互拆成可测试的纯函数。' }, style: { color: '#CBD5E1', fontSize: 15, align: 'center', lineHeight: 1.7 } }, 2, root.id),
    element('nav', { x: 470, y: 540, w: 500, h: 44, props: { text: 'GitHub   博客   Email' }, style: { bg: '#1E293B', color: '#E2E8F0', radius: 22, fontSize: 14 } }, 3, root.id),
    element('button', { x: 620, y: 620, w: 200, h: 44, props: { text: '下载简历' }, style: { bg: '#3B82F6', color: '#FFFFFF', radius: 8, align: 'center', fontWeight: 700 } }, 4, root.id),
  ]
  return docFrom('个人主页', root, elements, '主页')
}

/** 定价页：三档套餐 */
function pricingTemplate(): Doc {
  const root = frame({ bg: '#F8FAFC' })
  const tiers = [
    { name: '个人版', price: '¥0', sub: '永久免费', x: 120, bg: '#FFFFFF', accent: '#0F172A' },
    { name: '团队版', price: '¥99', sub: '每席每月', x: 520, bg: '#3B82F6', accent: '#FFFFFF' },
    { name: '企业版', price: '定询', sub: '私有部署', x: 920, bg: '#FFFFFF', accent: '#0F172A' },
  ]
  const elements: SceneNode[] = [
    element('header', { x: 320, y: 90, w: 800, h: 120, props: { text: '选择适合你的方案', sub: '随时升级，按需付费' }, style: { bg: '', color: '#0F172A', fontSize: 34, fontWeight: 700, align: 'center' } }, 0, root.id),
  ]
  tiers.forEach((tier, index) => {
    elements.push(
      element(
        'card',
        { x: tier.x, y: 260, w: 380, h: 380, props: { text: `${tier.name}  ${tier.price}`, sub: tier.sub }, style: { bg: tier.bg, color: tier.accent, radius: 16, shadowBlur: 18, shadowY: 6, shadowColor: 'rgba(15,23,42,.08)', fontSize: 22, fontWeight: 700, align: 'center' } },
        index + 1,
        root.id,
      ),
    )
    elements.push(
      element('button', { x: tier.x + 90, y: 560, w: 200, h: 44, props: { text: '开始使用' }, style: { bg: index === 1 ? '#FFFFFF' : '#3B82F6', color: index === 1 ? '#3B82F6' : '#FFFFFF', radius: 8, align: 'center', fontWeight: 700 } }, index + 4, root.id),
    )
  })
  return docFrom('定价页', root, elements, '定价')
}

/** 关于我们：图文两栏 */
function aboutTemplate(): Doc {
  const root = frame({ bg: '#FFFFFF' })
  const elements = [
    element('nav', { x: 0, y: 0, w: 1440, h: 60, props: { text: 'Studio   关于   招聘' }, style: { bg: '#FFFFFF', color: '#0F172A', borderWidth: 1, borderColor: '#E2E8F0', fontSize: 15 } }, 0, root.id),
    element('image', { x: 80, y: 160, w: 560, h: 360, props: { text: '🖼️ 团队照片' }, style: { bg: '#E2E8F0', radius: 16 } }, 1, root.id),
    element('header', { x: 700, y: 160, w: 560, h: 140, props: { text: '我们相信工具应该消失', sub: '把注意力留给内容本身。' }, style: { bg: '', color: '#0F172A', fontSize: 30, fontWeight: 700, align: 'left' } }, 2, root.id),
    element('text', { x: 700, y: 320, w: 560, h: 160, props: { text: 'Studio 起步于一个很小的愿望：让不会写 CSS 的人也能做出像样的页面，同时让会写的人拿到干净的代码。' }, style: { color: '#475569', fontSize: 15, lineHeight: 1.8, align: 'left' } }, 3, root.id),
    element('divider', { x: 80, y: 600, w: 1280, h: 2, style: { bg: '#E2E8F0' } }, 4, root.id),
  ]
  return docFrom('关于我们', root, elements, '关于')
}

/** 博客列表：三篇文章卡片 */
function blogTemplate(): Doc {
  const root = frame({ bg: '#FFFFFF' })
  const posts = [
    { title: '为什么要用补丁而不是快照', sub: '撤销栈可以没有上限。', x: 80 },
    { title: '布局引擎是怎么算的', sub: '四种布局模式与四种尺寸语义。', x: 530 },
    { title: 'AI 生成页面时我们守什么', sub: '只出补丁、先快照、可离线。', x: 980 },
  ]
  const elements: SceneNode[] = [
    element('header', { x: 80, y: 90, w: 900, h: 110, props: { text: '博客', sub: '关于编辑器、布局与代码生成' }, style: { bg: '', color: '#0F172A', fontSize: 34, fontWeight: 700, align: 'left' } }, 0, root.id),
    element('input', { x: 1040, y: 120, w: 320, h: 40, props: { placeholder: '搜索文章' }, style: { bg: '#F8FAFC', radius: 20, borderWidth: 1, borderColor: '#E2E8F0' } }, 1, root.id),
  ]
  posts.forEach((post, index) => {
    elements.push(
      element('card', { x: post.x, y: 260, w: 380, h: 260, props: { text: post.title, sub: post.sub }, style: { bg: '#FFFFFF', radius: 12, borderWidth: 1, borderColor: '#E2E8F0', fontSize: 19, fontWeight: 700, align: 'left' } }, index + 2, root.id),
    )
    elements.push(
      element('text', { x: post.x + 24, y: 470, w: 200, h: 24, props: { text: '阅读全文 →', link: 'https://example.com/post' }, style: { color: '#3B82F6', fontSize: 14, align: 'left' } }, index + 5, root.id),
    )
  })
  return docFrom('博客列表', root, elements, '博客')
}

export const TEMPLATES: readonly TemplateDef[] = [
  { id: 'login', label: '登录页', description: '导航 + 登录卡片 + 表单控件', create: loginTemplate },
  { id: 'landing', label: '产品落地页', description: '主视觉 + 三张特性卡 + 页脚', create: landingTemplate },
  { id: 'profile', label: '个人主页', description: '头像 + 简介 + 社交入口', create: profileTemplate },
  { id: 'pricing', label: '定价页', description: '三档套餐对比', create: pricingTemplate },
  { id: 'about', label: '关于我们', description: '图文两栏 + 页脚分割线', create: aboutTemplate },
  { id: 'blog', label: '博客列表', description: '文章卡片列表 + 搜索框', create: blogTemplate },
]

export function createFromTemplate(id: string): Doc | null {
  const template = TEMPLATES.find((item) => item.id === id)
  return template ? template.create() : null
}

export interface NewPageResult {
  doc: Doc
  pageId: string
}

/**
 * 从模板新建页面（M8 / 功能文档 L6）：把模板的第一页复制进当前文档，
 * 节点 id 统一加页面前缀避免与已存在的页面撞 id，页面名重复时自动加序号。
 * 返回新文档与页面 id（`null` 表示模板不存在或收敛失败）。
 */
export function pageFromTemplate(doc: Doc, templateId: string): NewPageResult | null {
  const source = createFromTemplate(templateId)
  const page = source?.pages[0]
  if (!page) return null

  const pageId = createId('page')
  const idMap = new Map<string, string>()
  for (const id of Object.keys(page.nodes)) idMap.set(id, `${pageId}-${id}`)

  const nodes: Record<string, SceneNode> = {}
  for (const [id, node] of Object.entries(page.nodes)) {
    const nextId = idMap.get(id)
    if (!nextId) continue
    nodes[nextId] = {
      ...node,
      id: nextId,
      parentId: node.parentId === null ? null : (idMap.get(node.parentId) ?? null),
    }
  }
  const rootId = idMap.get(page.root)
  if (!rootId || !nodes[rootId]) return null

  const taken = new Set(doc.pages.map((item) => item.name))
  let name = page.name
  for (let index = 2; taken.has(name) && index < 100; index += 1) name = `${page.name} ${index}`

  const next = normalizeDoc({
    ...doc,
    pages: [...doc.pages, { ...page, id: pageId, name, root: rootId, nodes }],
    activePageId: pageId,
  })
  return next ? { doc: next, pageId } : null
}
