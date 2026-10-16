/**
 * 真实数据夹具：元素取自 WebBuilder 的「产品落地页」模板
 * （参考实现 index.html:1231-1240），形状与导出文件一致。
 */

export interface LegacyElement {
  id?: string
  type?: unknown
  x?: unknown
  y?: unknown
  w?: unknown
  h?: unknown
  name?: unknown
  props?: Record<string, unknown>
}

export interface LegacyPage {
  id?: unknown
  name?: unknown
  elements?: unknown
}

export interface LegacyProject {
  app?: string
  version?: number
  name?: string
  activePageId?: string
  viewport?: { w?: unknown; h?: unknown }
  curW?: unknown
  curH?: unknown
  pages: LegacyPage[]
}

const productLandingElements: LegacyElement[] = [
  {
    id: 'el1',
    type: 'nav',
    x: 0,
    y: 0,
    w: 1440,
    h: 60,
    props: { text: 'Product 功能 价格 关于', fontSize: 14, color: '#FFFFFF', bg: '#1A1A2E' },
  },
  {
    id: 'el2',
    type: 'header',
    x: 0,
    y: 60,
    w: 1440,
    h: 200,
    props: {
      text: '让 AI 帮你写出更好的代码',
      sub: '新一代 AI 编程助手，支持 30+ 语言',
      fontSize: 34,
      color: '#1E293B',
      bg: '#F0F4FF',
    },
  },
  {
    id: 'el3',
    type: 'button',
    x: 620,
    y: 180,
    w: 200,
    h: 46,
    name: '主视觉按钮',
    props: {
      text: '免费开始',
      fontSize: 15,
      color: '#FFFFFF',
      bg: '#3B82F6',
      radius: 8,
      align: 'center',
      fontWeight: 700,
      shadowBlur: 12,
      shadowColor: 'rgba(59,130,246,0.4)',
    },
  },
  {
    id: 'el4',
    type: 'card',
    x: 90,
    y: 320,
    w: 400,
    h: 220,
    props: {
      text: '智能补全',
      sub: '基于大模型的代码补全，理解你的项目上下文',
      fontSize: 17,
      color: '#1E293B',
      bg: '#FFFFFF',
      radius: 14,
      shadowBlur: 16,
      shadowColor: 'rgba(0,0,0,0.08)',
    },
  },
  {
    id: 'el5',
    type: 'card',
    x: 520,
    y: 320,
    w: 400,
    h: 220,
    props: {
      text: '错误修复',
      sub: '自动识别 bug 并给出修复建议',
      fontSize: 17,
      color: '#1E293B',
      bg: '#FFFFFF',
      radius: 14,
      shadowBlur: 16,
      shadowColor: 'rgba(0,0,0,0.08)',
    },
  },
  {
    id: 'el6',
    type: 'card',
    x: 950,
    y: 320,
    w: 400,
    h: 220,
    props: {
      text: '一键部署',
      sub: '从代码到上线只需一条命令',
      fontSize: 17,
      color: '#1E293B',
      bg: '#FFFFFF',
      radius: 14,
      shadowBlur: 16,
      shadowColor: 'rgba(0,0,0,0.08)',
    },
  },
  {
    id: 'el7',
    type: 'divider',
    x: 120,
    y: 620,
    w: 1200,
    h: 2,
    props: { bg: '#E2E8F0' },
  },
  {
    id: 'el8',
    type: 'text',
    x: 620,
    y: 660,
    w: 200,
    h: 20,
    name: '页脚版权',
    props: { text: '© 2024 Product Inc.', fontSize: 12, color: '#94A3B8', align: 'center' },
  },
]

/** 导出文件形状：{app, version, pages}（index.html:1267） */
export const legacyProductLanding: LegacyProject = {
  app: 'visual-builder',
  version: 1,
  pages: [
    {
      id: 'p1',
      name: '产品落地页',
      elements: productLandingElements.map((element) => ({ ...element })),
    },
  ],
}

/** 带隐藏/锁定与超长页面名的第二页，验证 meta 迁移 */
export const legacyDirtyPage: LegacyProject = {
  app: 'visual-builder',
  version: 1,
  pages: [
    {
      id: 'p1',
      name: '这是一个特别特别长的页面名字需要被截断到四十个字符以内否则数据结构就不一致了真的',
      elements: [
        {
          id: 'el1',
          type: 'rect',
          x: 10,
          y: 20,
          w: 100,
          h: 50,
          props: { bg: '#FFFFFF', hidden: 'yes', locked: 1 },
        },
        {
          id: 'el1',
          type: 'not-a-real-type',
          x: 'abc',
          y: -5,
          w: 0,
          h: Number.NaN,
          props: { fontSize: '100', align: 'middle', unknownKey: 'drop-me', text: 123 },
        },
      ],
    },
  ],
}

/** localStorage 存档形状：{pages, activePageId}（index.html:1196） */
export const legacyStorageShape: LegacyProject = {
  pages: [
    {
      id: 'p1',
      name: '首页',
      elements: productLandingElements.slice(0, 3).map((element) => ({ ...element })),
    },
    {
      id: 'p2',
      name: '关于我们',
      elements: [
        { id: 'el9', type: 'text', x: 100, y: 100, w: 300, h: 40, props: { text: '关于', fontSize: 28 } },
      ],
    },
  ],
  activePageId: 'p2',
}

export function legacyManyPages(pageCount: number, elementsPerPage: number): LegacyProject {
  return {
    app: 'visual-builder',
    version: 1,
    pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
      id: `p${pageIndex + 1}`,
      name: `页面 ${pageIndex + 1}`,
      elements: Array.from({ length: elementsPerPage }, (_, elementIndex) => ({
        id: `p${pageIndex + 1}_el${elementIndex + 1}`,
        type: 'rect',
        x: elementIndex,
        y: elementIndex,
        w: 10,
        h: 10,
        props: { bg: '#FFFFFF' },
      })),
    })),
  }
}
