# Studio 可视化页面搭建器

一个**不依赖任何拖拽库、UI 组件库**的可视化页面搭建器：把 WebBuilder 那套「拖拽排版 + 图层 + 属性面板 + 代码导出」的量级，
升级成**元素树 + 布局引擎 + 断点覆盖 + 组件体系 + AI 只产出补丁**的架构。

技术栈：Vue 3.5 + TypeScript 6（strict）+ Vite 8 + Pinia + Vitest + jsdom。拖拽用原生 Pointer Events 手写。

> **当前进度：M0（地基 + WebBuilder v1 迁移）已完成。** 里程碑 M1–M8 的完整计划、每项验收方式与砍需求优先级见 [PLAN.md](PLAN.md)；
> 产品级功能设计（含 18 项能力对照与六个结构性短板）见 [docs/功能文档-v2-可视化页面搭建器.md](docs/功能文档-v2-可视化页面搭建器.md)。
> 上一代的「表单搭建器」计划与决策已归档在 [docs/archive/](docs/archive/)。

---

## 为什么不是 WebBuilder 的复制品

参考实现 [visual-builder](https://github.com/Noah-Deleveq/visual-builder)（单文件 `index.html`，1648 行）能跑通 18 项能力，但天花板来自它的数据模型：

| # | 结构性短板 | 代码证据 | Studio 的做法 |
| --- | --- | --- | --- |
| S1 | 只有绝对定位，不响应式、易溢出 | `elStyle()` 恒 `position:absolute` | 布局引擎 `computeLayout()`：`free / vertical / horizontal / grid` + `fixed / hug / fill / ratio` |
| S2 | 元素扁平、无父子关系 | `pages=[{elements:[]}]` | `Record<NodeId, SceneNode>` + `parentId` + `order`，唯一根 frame |
| S3 | 层级 = 数组顺序 | `ctxLayer()` 靠 `splice` | 显式 `order` + 树前序渲染 |
| S4 | 响应式是假的（只改画布宽高） | `handleViewport()` 只改 `curW/curH` | `Breakpoint[]` + `Node.overrides[breakpointId]` 继承/覆盖，导出 media query |
| S5 | 15 类组件写死 | `VALID_TYPES` / `normalizeProps` 硬编码 | 插件式 `ComponentDescriptor`（`toHtml` / `aiDoc` / `overridable`） |
| S6 | 导出全内联样式，CSS 页签是占位 | `buildHtml()` 拼 `style="…"` | 干净的 HTML + 独立 CSS，另有 Vue SFC 与静态多页 zip |

## M0 已经做了什么

1. **元素树与文档模型**：`Doc{version:2, pages, activePageId, breakpoints, theme}`，每页 `Page{root, nodes}`；`Patch` 只有 `insert / remove / update / move` 四种。
2. **收敛层 `normalizeSchema`**：任何来源（导入 / 读档 / AI 产出）都要先过一遍 —— 未知类型回落 `rect`、非法父级挂回根、断环、id 去重、同级 `order` 重排成 `0..n-1`。**同一逻辑状态必须序列化成同一份 JSON。**
3. **WebBuilder v1 一键迁移**：粘贴或选择一个 v1 导出文件（`{app:'visual-builder', version:1, pages:[{elements:[…]}]}`）或 localStorage 存档（`visual_builder_v1`），迁移成 v2 文档：22 个属性按白名单拆进 `style / props / meta`，`hidden` / `locked` 保留布尔语义，`name` 变成图层名，越界坐标与尺寸夹取，页数 ≤50、每页元素 ≤2000。
4. **最小可用壳**：顶栏「新建项目 / 导入 JSON 文件」、粘贴 JSON 导入、页面标签切换、元素列表（id / 类型 / 文案 / 位置 / 尺寸）。

## 快速开始

```bash
npm install

npm run dev        # 开发服务器
npm run test       # Vitest 全量单测 + 组件测试
npm run coverage   # 覆盖率（阈值：语句/分支/函数/行 ≥ 90）
npm run lint       # ESLint（含 core 分层规则）
npm run build      # vue-tsc 严格类型检查 + 生产构建
npm run preview    # 预览生产构建
```

## 目录结构

```
src/
├── core/                    # 纯逻辑，禁止 import Vue / 组件 / store（ESLint 强制）
│   ├── schema/              # 文档模型、收敛(normalize)、v1 迁移(migrate)、导入入口(parse)、字段目录(catalog)
│   └── tree/                # 元素树操作：childrenOf / descendantsOf / isDescendantOf / normalizeNodeOrder / treeOf
├── styles/                  # tokens.css（设计变量）+ base.css
├── App.vue                  # M0 的导入壳（M1 替换成编辑器三栏）
└── main.ts
tests/
├── unit/                    # 纯逻辑单测 + fixtures/（真实 WebBuilder 数据夹具）
└── component/               # 组件测试（@vue/test-utils + jsdom）
docs/
├── 功能文档-v2-可视化页面搭建器.md
├── decisions.md             # 架构决策记录（ADR）
└── archive/                 # 上一代表单搭建器的 PLAN / 决策 / 蓝图
```

## 质量数据（M0）

| 项目 | 数值 |
| --- | --- |
| 测试 | 4 个文件 / **78 个用例全绿** |
| 覆盖率 | 语句 98.31% · 分支 92.09% · 函数 100% · 行 100%（阈值 90） |
| 构建 | 21 modules；JS 81.36 kB（**gzip 31.58 kB**）；CSS 4.22 kB（gzip 1.22 kB） |
| 类型 | `vue-tsc -b` 严格模式 0 错误；ESLint 0 error 0 warning |

## 架构决策

见 [docs/decisions.md](docs/decisions.md)。M0 的关键决定：元素树而非扁平数组、`version:2` 显式版本、导入一律先收敛、
v1 迁移只做保守映射（不猜用户意图）、`SceneNode` 命名避开 DOM 的 `Node`。

## 本机开发环境的三个坑（Windows + 受限沙箱）

1. **npm 缓存越界**：默认缓存在用户目录，沙箱拒绝写入。仓库根 `.npmrc` 已把缓存重定向到 `.npm-cache`。
2. **Vite 的 `exec('net use')` 走管道会被沙箱拦成 `EPERM`**：跑 `dev / test / build / preview` 前先设垫片
   `NODE_OPTIONS=--require <仓库>\.sandbox\child-process-pipe-shim.cjs`（`.sandbox/` 已在 `.gitignore` 里，Linux CI 不受影响）。
3. **`npm ci` 会删 `node_modules`**：如果 dev/preview 服务还在跑，会报「文件已被占用」并留下半残的依赖树 —— 先停服务再装。

## 已知缺口 / 未做

- **M1–M8 尚未实现**：18 项能力的画布、布局引擎、断点、组件体系、代码生成、AI 助手都在 [PLAN.md](PLAN.md) 的计划里，当前只有 M0 的地基与导入壳。
- **真实浏览器拖拽手感没有自动化证据**：本机无 Chrome/Edge，拖拽类逻辑靠纯函数单测 + jsdom 合成事件覆盖，需要人工在浏览器里确认。
- **线上链接**：本机 `git push` 走 HTTPS 到 GitHub 会报 schannel `SEC_E_NO_CREDENTIALS`，且没有托管平台账号 —— 部署这一步需要你自己的账号。
- **根目录多了一个删不掉的重复文件**：`2026-10-16-form-builder-blueprint.md`（34256 B）已复制进 `docs/archive/`，但沙箱拒绝删除根目录原件。
- **M0 的 core 是先写实现后补测试**（与「core 先测试后实现」的约定有偏差），M1 起严格先红后绿。
