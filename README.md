# Studio 可视化页面搭建器

一个**不依赖任何拖拽库、UI 组件库**的可视化页面搭建器：把 WebBuilder 那套「拖拽排版 + 图层 + 属性面板 + 代码导出」的量级，
升级成**元素树 + 布局引擎 + 断点覆盖 + 组件体系 + AI 只产出补丁**的架构。

技术栈：Vue 3.5 + TypeScript 6（strict）+ Vite 8 + Pinia + Vitest + jsdom。拖拽用原生 Pointer Events 手写。

> **当前进度：M0（地基 + WebBuilder v1 迁移）与 M1（WebBuilder 18 项能力复刻）已完成。** 里程碑 M1–M8 的完整计划、每项验收方式与砍需求优先级见 [PLAN.md](PLAN.md)；
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

## M1 已经做了什么：WebBuilder 18 项能力逐条对齐

M1 的验收标准是「**相对 WebBuilder 不倒退**」：v1 能做的 18 项，M1 全部要有，且数据模型换成 v2。实现位置与验证方式：

| # | 能力 | WebBuilder（v1） | Studio M1 实现 | 测试证据 |
| --- | --- | --- | --- | --- |
| B1 | 内置组件 | 15 类写死 | 面板 17 项 = 15 类 + `frame` / `group` 容器，目录在 `src/core/schema/catalog.ts` | `tests/unit/ops.spec.ts`、`tests/component/editor.spec.ts` |
| B2 | 拖入画布 | HTML5 drag/drop | `dropOn()` 走 Pointer 事件，落点命中容器则成为其子节点 | `tests/component/editor.spec.ts`、`output.spec.ts` |
| B3 | 移动 / 缩放 | 拖 body + 右下角手柄 | 8 向手柄，`Shift` 等比（`CanvasStage.vue:249`） | `editor.spec.ts`（`canvas-handle[data-handle]`） |
| B4 | 磁吸参考线 | 6px 吸附 | `SNAP_THRESHOLD = 6` + `.canvas-guide--x/--y`（松手即清） | `editor.spec.ts`、`tests/unit/geometry.spec.ts` |
| B5 | 框选 + 对齐 | 框选 + 六向对齐 | `.canvas-marquee` 框选，多选后六向对齐按钮 | `editor.spec.ts`、`ops.spec.ts` |
| B6 | 图层面板 | 列表 + 改名/显隐/锁定/移层 | 树前序列表、双击改名、显隐、锁定、上移/下移/置顶/置底 | `editor.spec.ts` |
| B7 | 属性编辑器 | 22 属性 | `.prop-form [data-prop]` 22 键白名单 + 位置尺寸 + 图层名 | `editor.spec.ts`、`output.spec.ts` |
| B8 | 多页面 | 页签 | 页签 + 新建/改名/删除，每页独立 `nodes` 与视口 | `editor.spec.ts` |
| B9 | 响应式视口 | 1440 / 768 / 375 + 自定义宽度 | 三预设 + **自定义宽度输入框**（`data-role="viewport-width"`，夹取 200–10000）+ 画布缩放 0.25–2 | `editor.spec.ts` |
| B10 | 撤销 / 重做 | 60 步快照 | 逆补丁 + 400ms 合并窗口，`historyPosition` 可跳转 | `tests/unit/history.spec.ts`、`patch.spec.ts` |
| B11 | 示例模板 | 3 套 | 6 套（登录页 / 落地页 / 定价页 / 个人主页 / 仪表盘 / 空页） | `tests/unit/templates.spec.ts`、`output.spec.ts` |
| B12 | 自动保存 + JSON | localStorage + 导入导出 | 400ms 去抖 `localStorage`（`studio:doc:v2`）+ 文件/粘贴导入 + JSON 导出 | `tests/unit/persistence.spec.ts`、`output.spec.ts` |
| B13 | 代码生成 | 拼 HTML 字符串 | HTML + 独立 CSS 两个页签；画布与导出**共用** `inlineStyle()` | `tests/unit/codegen.spec.ts`、`output.spec.ts` |
| B14 | 预览 / 下载 / 复制 | 新窗口预览 + 下载 | 预览 + 下载 `.html` + 复制到剪贴板（含降级提示） | `output.spec.ts` |
| B15 | PNG 截图 | Canvas 手绘 | `src/core/export/index.ts` 的 `drawPage()` 手绘（M1 是近似截图，M7 换真实位图） | `tests/unit/export.spec.ts` |
| B16 | 图片三通道 | 本地文件 / URL / 清空 | URL 输入 + **本地文件 `FileReader → dataURL`**（`data-role="image-file"`）+ 清空 | `output.spec.ts`、`codegen.spec.ts`（`safeUrl` 放行光栅 dataURL） |
| B17 | 右键菜单 + 格式刷 | 上下文菜单 | 复制/粘贴/再制/置顶/置底/复制样式/粘贴样式/删除 + 画布与图层右键 | `editor.spec.ts` |
| B18 | 快捷键 | 若干 | `Ctrl+Z/Y/A/D/C/V/±/0`、`Ctrl+滚轮`缩放、`Delete`、方向键 1px / Shift 10px | `editor.spec.ts` |

超出 WebBuilder 的部分（v2 数据模型自带）：显式 `order` 的树结构、`layout` 与 `style` 分离、`overrides` 断点覆盖的存储位、`Patch` 补丁协议（为 M5 的 AI 只产出补丁铺路）。

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
│   ├── tree/                # 元素树：childrenOf / descendantsOf / normalizeNodeOrder / canonicalNodes
│   ├── patch/               # 补丁协议：applyPatch / invertPatch（撤销靠逆补丁，不存快照）
│   ├── history/             # 补丁历史栈 + 400ms 合并窗口
│   ├── geometry/            # 命中测试、八向缩放、6px 磁吸、框选相交
│   ├── ops/                 # 编辑器动作 → 补丁（插入/移动/删除/再制/对齐/移层）
│   ├── codegen/             # HTML / CSS 生成；inlineStyle() 画布与导出共用
│   ├── templates/           # 6 套示例模板
│   ├── persistence/         # localStorage 读写 + 脏存档修正
│   └── export/              # drawPage()：PNG 近似截图
├── stores/editor.ts         # 唯一的编辑器 store：文档 + 选中 + 视口 + 缩放 + 剪贴板 + 历史
├── components/
│   ├── canvas/              # CanvasStage（指针交互）/ ElementView（单个元素渲染）
│   └── editor/              # EditorShell / PalettePanel / LayerPanel / PropPanel / CodePanel / PageTabs / StatusBar / ContextMenu
├── styles/                  # editor.css（编辑器三栏）+ tokens.css + base.css
└── main.ts
tests/
├── unit/                    # 纯逻辑单测 + fixtures/（真实 WebBuilder v1 数据夹具）
└── component/               # 组件测试（@vue/test-utils + jsdom + helpers.ts 布局垫片）
docs/
├── 功能文档-v2-可视化页面搭建器.md
├── decisions.md             # 架构决策记录（ADR，D1–D15）
└── archive/                 # 上一代表单搭建器的 PLAN / 决策 / 蓝图
```

## 质量数据（M1）

| 项目 | 数值 |
| --- | --- |
| 测试 | 14 个文件 / **231 个用例全绿** |
| 覆盖率 | 语句 98.27% · 分支 91.93% · 函数 100% · 行 100%（阈值 90） |
| 构建 | 58 modules；JS 150.81 kB（**gzip 54.30 kB**）；CSS 14.81 kB（gzip 3.19 kB） |
| 类型 | `vue-tsc -b` 严格模式 0 错误；ESLint 0 error 0 warning |

## 架构决策

见 [docs/decisions.md](docs/decisions.md)。M0 的关键决定：元素树而非扁平数组、`version:2` 显式版本、导入一律先收敛、
v1 迁移只做保守映射（不猜用户意图）、`SceneNode` 命名避开 DOM 的 `Node`。
M1 新增 D9–D15：`Page.nodes` 键序规范化、画布与导出共用 `inlineStyle()`、拖拽手写 Pointer Events、
Vue Boolean prop「没传即 false」、`event.target` 可能不是 Element、`NodeOverride.layout` 是 `Partial`、
store 的 `updateNode/updateSelection` 对 `style/props/meta` 浅合并。

## 本机开发环境的三个坑（Windows + 受限沙箱）

1. **npm 缓存越界**：默认缓存在用户目录，沙箱拒绝写入。仓库根 `.npmrc` 已把缓存重定向到 `.npm-cache`。
2. **Vite 的 `exec('net use')` 走管道会被沙箱拦成 `EPERM`**：跑 `dev / test / build / preview` 前先设垫片
   `NODE_OPTIONS=--require <仓库>\.sandbox\child-process-pipe-shim.cjs`（`.sandbox/` 已在 `.gitignore` 里，Linux CI 不受影响）。
3. **`npm ci` 会删 `node_modules`**：如果 dev/preview 服务还在跑，会报「文件已被占用」并留下半残的依赖树 —— 先停服务再装。

## 已知缺口 / 未做

- **M2–M8 尚未实现**：布局引擎（`free / vertical / horizontal / grid` + `fixed / hug / fill / ratio`）、真断点覆盖与 media query 导出、组件体系、Vue/React 代码生成、AI 助手都在 [PLAN.md](PLAN.md) 里。M1 做完的只是「与 WebBuilder 等价的 18 项」。
- **`setBreakpoint / applyViewport` 直接改写 `history.base`，不走补丁、不进历史**：M1 的取舍是「切视口不污染撤销栈」，代价是切视口后无法撤销回去；M3 做真正的断点编辑时要重构成可撤销的补丁。
- **PNG 导出是近似截图**：`drawPage()` 手绘矩形与文字，字体度量与浏览器渲染有偏差；M7 会换成真实位图。
- **真实浏览器视觉验证没有自动化证据**：本机 headless Edge 被沙箱的命名管道限制拦住（`mojo ... platform_channel.cc:187 Check failed: . : 拒绝访问 (0x5)`），拖拽与像素级对齐只能人工打开 dev 服务器确认。
- **线上链接**：本机 `git push` 走 HTTPS 到 GitHub 会报 schannel `SEC_E_NO_CREDENTIALS`，且没有托管平台账号 —— 部署这一步需要你自己的账号。
- **根目录多了一个删不掉的重复文件**：`2026-10-16-form-builder-blueprint.md`（34256 B）已复制进 `docs/archive/`，但沙箱拒绝删除根目录原件。
- **M0 的 core 是先写实现后补测试**（与「core 先测试后实现」的约定有偏差），M1 起严格先红后绿 —— M1 的 5 个真 bug（属性面板抹样式、图片 dataURL 被 URL 白名单拦掉、Boolean prop 默认值、`event.target` 非 Element、override layout 是 Partial）都是先有失败测试再修。
