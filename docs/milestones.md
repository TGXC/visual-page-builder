# 里程碑记录（M0–M23）

> 这份文件是从 README 抽出来的逐轮开发与验收记录：README 只保留项目简介、功能介绍、上手与工程信息，每一轮「用户反馈 → 根因 → 修法 → 验收数字」的完整记录放在这里。
> 里程碑计划见 [PLAN.md](../PLAN.md)，架构决策（ADR）见 [decisions.md](decisions.md)，产品级功能设计见 [功能文档-v2-可视化页面搭建器.md](功能文档-v2-可视化页面搭建器.md)。

## 开发进度

> **当前进度：M0–M23 全部完成**。PLAN.md 的 M0→M8（地基 + WebBuilder v1 迁移 / 18 项能力复刻 / 布局引擎 / 响应式断点 / 组件体系 / 代码生成 / AI 助手 / 收尾）全绿；之后按用户逐轮实测反馈补了 M9–M23 十五轮体验修订：画布网格与层级选择、删除保护、面板与主题、尺寸与缩放、拖拽手势（原生拖拽拦截 / 缩放原点 / 断点几何）、双击编辑、表格对齐、预设文字可见性、旧文档迁移、面板点选、跨断点自动适配。每轮都同时更新代码、测试与 README / PLAN / ADR 三处记录，并附验收数字。里程碑计划见 [PLAN.md](PLAN.md)，架构决策见 [docs/decisions.md](docs/decisions.md)。
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

## M2 已经做了什么：布局引擎

M1 的画布是「绝对定位 + 手动拖」，M2 把它变成真正的布局系统：同一份 `computeLayout()` 同时喂给画布、导出 HTML 与命中检测，容器模式、尺寸模式、断点约束、拖拽换父级都由它决定。

| # | 能力 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 四种容器模式 | `src/core/layout/index.ts`：`free`（用 `layout.position` + `constraints`）、`vertical` / `horizontal`（主轴堆叠 + `gap` + `justify` + `align` + `wrap` 折行）、`grid`（`columns` / 单元内偏移 / 整行 fill 均分剩余高度） | `tests/unit/layout.spec.ts`（27）、`layoutEdges.spec.ts`（14） |
| 2 | 四种尺寸模式 | `fixed` / `hug`（叶子靠测量、容器靠子节点并集）/ `fill`（主轴按 flex-grow 分剩余、交叉轴撑满）/ `ratio`（value 是 w/h） | 同上 + `tests/perf/layout.perf.spec.ts` |
| 3 | 断点约束 | `constraints.h`（left / right / left-right / center / scale）与 `constraints.v`（top / bottom / top-bottom / center / scale），按「设计盒 → 当前盒」的 delta 保边距 | `tests/unit/layoutEdges.spec.ts` |
| 4 | 拖拽换父级 | `src/core/dnd/index.ts`：`dropParentAt()` 取最深的容器（排除自身与子孙、排除隐藏）、`reparentPatches()` 把 `position` 换算到新容器内容框，**视觉不动**；画布显示落点虚线 + 插入位指示线 | `tests/unit/dnd.spec.ts`（10）、`editor.spec.ts` |
| 5 | 等距提示 | `src/core/spacing/index.ts`：拖动中显示到左右/上下邻居的间距，两侧等距时高亮（阈值 `MAX_HINT_GAP = 400`，等距判定复用磁吸的 6px） | `tests/unit/spacing.spec.ts`（4）、`editor.spec.ts` |
| 6 | 文本测量 | `src/utils/textMeasure.ts`：离屏 canvas 折行测量（jsdom / 无 Canvas 时退回字符估算并标记 `estimated`），经 `LayoutInput.measure` 注入 core | `tests/unit/textMeasure.spec.ts`（5）、`measure.spec.ts`（6） |
| 7 | 布局面板 | `src/components/editor/LayoutPanel.vue`：模式、尺寸模式、对齐 / 主轴分布 / 换行、gap、columns、四边 padding（只写 `layout`，像素值仍归属性面板） | `editor.spec.ts` |
| 8 | 性能 | 1000 节点整树布局中位数 **2.65ms**（最快 2.49ms）；`childrenOf()` 的 O(n²) 换成每趟一次的 `buildChildrenIndex()` | `npm run test:perf`（阈值 < 8ms） |

M2 的验收判据「1440↔375 宽度下 `fill` / `hug` / `constraints` 正确」由 `layoutEdges.spec.ts` 的断点约束用例（设计视口 600×400 → 当前 900×600）与 `editor.spec.ts` 的「切模式再切回 free 位置还原」用例覆盖。

## M3 已经做了什么：响应式断点

M2 的 `constraints` 只是「按当前视口等比缩放」，M3 才让**每个断点可以有自己的值**：在手机断点改的样式/布局写进 `node.overrides.mobile`（只存差异），画布显示断点有效值，导出的 HTML 带上对应的 media query。

| # | 能力 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 断点定义与继承链 | `src/core/responsive/index.ts`：`orderedBreakpoints`（按 `minWidth` 从宽到窄）、`baseBreakpointId`、`cascadeIds`（`mobile` → `['desktop','tablet','mobile']`，禁用的断点跳过） | `tests/unit/responsive.spec.ts`（17） |
| 2 | 有效节点求解 | `effectiveNode / effectiveNodes / effectivePage / effectiveDoc`：在原节点上依次叠加继承链上的 `overrides`（layout 嵌套合并、style / props 逐键、hidden / order），纯函数、不改原节点 | 同上 |
| 3 | 覆盖只存差异 | `writeOverride()`：相对「更宽一级的有效值」算 diff，改回继承值 → 覆盖自动消失（返回 `null`） | 同上 + `breakpoints.spec.ts` |
| 4 | 编辑分流 | `src/stores/editor.ts` 的 `writeEdit()` 是唯一编辑出口：基准断点写节点本身，窄断点写 `overrides[断点]`；`meta.name / locked` 不是断点维度，任何断点都写回节点 | `tests/component/breakpoints.spec.ts` |
| 5 | 覆盖标记与清除 | `PropPanel.vue`：窄断点下显示「xx 覆盖」徽标（`[data-role=override-badge]`）与「清除覆盖」按钮；没有覆盖时显示「继承自更宽的断点」 | 同上 |
| 6 | 画布渲染断点有效值 | `CanvasStage.vue` 用 `store.resolvedNodes` 渲染与命中检测，隐藏元素在编辑器里半透明保留、导出时才 `display:none` | 同上 |
| 7 | 断点感知导出 | `generateResponsiveCss()`：每个非基准断点输出 `@media (max-width: …)`，上界 = 更宽一级 `minWidth − 0.02`，声明带 `!important`，被取消的属性用 `RESET_DECLARATIONS` 复位 | `tests/unit/responsiveExport.spec.ts`（6） |
| 8 | 导出与预览解耦 | 导出永远从**基准断点**的有效文档生成（内联样式 + 全部 media query），切到手机预览不改变导出结果 | `responsiveExport.spec.ts`、`breakpoints.spec.ts` |

M3 的验收判据「桌面 3 列 → 手机 1 列，互不污染」由 `breakpoints.spec.ts` 的端到端用例覆盖：grid 容器桌面 `columns: 3`（三个子块同一行）→ 手机断点改 `columns: 1`（三个子块同一列、三行），`store.nodes[grid].layout.columns` 仍是 3，`overrides.mobile.layout.columns === 1`，`generatedCss` 含 `@media (max-width: 767.98px)`；切回桌面排版复原。

## M4 已经做了什么：组件体系

M1 的 15 类组件是写死在 `switch` 里的；M4 把它们（外加新增类型，共 **40 个**）搬进「描述符注册表」，于是组件库本身可以被插件扩展，页面上还能把一棵选区「变成组件」——改一次 master，所有实例同步。

| # | 能力 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 描述符注册表（插件式） | `src/core/components/index.ts`：`ComponentDescriptor { type, label, category, icon, container, editable, defaultSize/ Style/ Props, toHtml, toCanvasHtml, aiDoc, overridable }`；`registerComponent / unregisterComponent / getComponent / searchComponents / componentsByCategory`；core 不引 Vue，面板用 `subscribeRegistry()` 订阅 | `tests/unit/components.spec.ts`（19）、`tests/unit/componentsRender.spec.ts`（8） |
| 2 | 组件库 40 类 + 分类 + 搜索 | 布局 7（frame/group/section/container/columns/divider/spacer）、基础 8、表单 12（含 switch/slider/date/number/file/rating）、媒体 5、展示 8；`[data-role=palette-search]` 按中文名 / type / 分类 / aiDoc 过滤 | `tests/component/editor.spec.ts`「按分类列出 40 类组件…并支持搜索过滤」 |
| 3 | Group / Container | `section / container / columns` 等注册为 `container: true`；`core/dnd` 的 `isContainer()` 改为问注册表（第三方容器类型自动生效），实例排除在落点外 | `tests/unit/dnd.spec.ts`（11） |
| 4 | 把选区变成组件（master） | `captureSymbol(nodes, rootId, name, overridable)` 克隆子树成 `SymbolDef`；`store.createComponent()` 把选区替换成一个 `instance` 节点 | `tests/unit/symbols.spec.ts`（16）、`tests/component/symbols.spec.ts` |
| 5 | 实例展开与同步 | `expandInstances(page, doc)` 在渲染层克隆 master 子树（id = `${实例id}~${masterId}`），布局 / 画布 / 导出共用；改 master 三实例同步且可撤销 | `symbols.spec.ts`、`symbols.spec.ts`（组件测试） |
| 6 | 实例覆盖白名单 | 实例 props 只有落在 `def.overridable`（缺省 `text/color/fontSize/bg`）里的键才覆盖 master 根节点 | `tests/unit/symbols.spec.ts` |
| 7 | master 编辑走同一套补丁 | `core/patch` 的容器查找泛化：`patch.pageId` 可以是页面 id 或组件 id，撤销 / 合并窗口 / canonical 键序全部复用 | `symbols.spec.ts`、`decisions.md` D33 |
| 8 | 循环引用检测 | `symbolReferences()` + 展开时的 `stack`：自引用 / A↔B 互引标记 `props.cycle = true`，不会死循环；`symbolId` 缺失或组件不存在标记 `props.unknown` | `tests/unit/symbols.spec.ts` |

PLAN 验收「注册第三方假组件可拖入可导出」由组件测试覆盖：`registerComponent({ type: 'my-widget', … })` → 立刻出现在面板 → `dropOn` 拖进画布 → `store.generatedHtml` 含 `<span class="widget">挂件</span>` 与 `el--my-widget`（用例结尾 `unregisterComponent` 收尾）。

## M5 已经做了什么：代码生成

M1 的导出是「每个元素身上一坨内联样式」。M5 把导出拆成**语义化 HTML + 独立 CSS 类**，并补上 Vue 3 SFC 与整站 zip：

| # | 能力 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 类名化 HTML（无内联样式） | `classNamesOf(node)` → `el el--<type> n-<id>`，页面是 `.page-<slug>`；`generateBodyHtml()` 不再输出 `style="` | `tests/unit/codegenClass.spec.ts`（14） |
| 2 | 独立 CSS 样式表 | `generatePageCss()` = `BASE_CSS` + 每节点类规则 + 断点 media query；`declarations()` 与画布 `inlineStyle()` 共用，M1 的 ±1px 判据对导出仍然成立 | `codegenEdges.spec.ts`、`codegenClass.spec.ts` |
| 3 | 断点感知导出（无 `!important`） | 媒体查询用同优先级的 `.n-<id>`，靠顺序覆盖；被取消的属性按 `RESET_DECLARATIONS` 复位 | `tests/unit/responsiveExport.spec.ts`（6） |
| 4 | 单文件 HTML / 整站静态站点 | `generateHtml()` 把 CSS 收进一个 `<style>`（双击即开）；`buildSite()` 产出 `index.html` + `base.css` + 每页 `<slug>.html`/`<slug>.css`，顶栏「整站」下载 | `tests/unit/codegenClass.spec.ts`、`tests/smoke/export.smoke.spec.ts` |
| 5 | Vue 3 SFC 导出 | `generateVueSfc()` → `<template>` + `<script setup lang="ts">` + `<style scoped>`，代码面板新增「Vue」页签 | `codegenClass.spec.ts`（用 `@vue/compiler-sfc` 真编译一遍） |
| 6 | 自写 ZIP 打包 | `createZip()`（stored + CRC-32 + UTF-8 名标记 + 固定时间戳，字节可复现） | `codegenClass.spec.ts`；外部用 `Expand-Archive` 解压校验通过 |
| 7 | SEO / 元信息 | `Doc.seo = { title, description, lang, keywords }`，`normalizeSeo()` 截断 + `lang` 正则兜底 `zh-CN`；导出 `<title>`/description/keywords/og/canonical | `codegenClass.spec.ts`、`codegenEdges.spec.ts` |
| 8 | 快照测试 | 固定 id 的 fixture 对单文件 HTML 与 CSS 各做一次 `toMatchSnapshot()` | `tests/unit/__snapshots__/codegenClass.spec.ts.snap` |

PLAN 验收「导出 HTML 无内联样式堆叠、类名可读、能被真实 Vue 项目引用；zip 解压即可打开」的对应证据：`tests/smoke/export.smoke.spec.ts` 写出真实文件并打印 `inlineStyles 0`、`mediaQueries 2`、`zipBytes 6905`；`.sandbox/out/site.zip` 用 PowerShell `Expand-Archive` 解出四个文件（.NET 顺带校验 CRC-32）；生成的 SFC 用 `@vue/compiler-sfc` 编译零错误。

冒烟用例跑在 Node 里（`node:fs` / `process` / `Buffer`），所以它有独立的 `tsconfig.smoke.json`（`types: ["node"]`，`tsconfig.app.json` 用 `exclude` 把它挡在外面）——浏览器侧的代码依旧拿不到 Node 全局类型。冒烟配置单独一个 `vitest.smoke.config.ts` 也是必须的：Vitest 的 `mergeConfig` 会拼接 `include`，合并进主配置反而会把冒烟用例排除掉；另外它必须显式写 `pool: 'threads'`，Vitest 5 默认的 forks 会 `spawn EPERM`（见下面第 4 条沙箱限制）。

## M6 已经做了什么：AI 助手（Mock 优先 + 只产出补丁）

M6 的判据是「**不配 key 也能用规则检查与修复；AI 产出的东西一律先过本地校验，失败不污染文档**」。所以 AI 在架构上只是一条**供应商 → 结构化 JSON → 三层校验 → 补丁/文档历史**的管线，规则检查完全是 `core/assistant` 的纯函数：

| # | 能力 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 供应商抽象（Mock 必备，真实端点可选） | `AiProvider { id, label, ready, complete(request) }`；`createMockProvider()` 是确定性模板（离线可用、`ready: true`），`createOpenAIProvider()` 走 `/chat/completions` + `response_format: json_object`，key 只进请求头 | `tests/unit/aiProvider.spec.ts`（6） |
| 2 | 一句话生成页面（AI1） | `mockDraft()` → `validateDraft()` 三重校验（形状 → `normalizePage/normalizeDoc` 收敛 + 节点数不变 → 水平越界/兄弟重叠/必填 props 自检），通过后**插入为新页面**并进历史 | `tests/unit/aiDraft.spec.ts`（14） |
| 3 | 选区指令（AI2） | `applyInstruction()` 产出 `Patch[]`：模型给的 `before` 一律丢弃现取，`update/remove/move` 的目标与 `insert` 的父节点都必须在「选区 + 子树」内，空选区先报错 | `tests/unit/aiInstruction.spec.ts`（16） |
| 4 | 规则式设计检查（AI3） | `core/assistant` 六条规则：溢出、对比度（WCAG AA，黑/白自动选色）、间距不在刻度表、同类型兄弟尺寸不一致、图片缺 alt、断点整页未覆盖；每条都带可执行补丁 | `tests/unit/assistant.spec.ts`（8） |
| 5 | 一键修复（AI3） | `fixAll()` 迭代最多 8 轮（一次审计的补丁摊平会互相覆盖），返回补丁序列 → store 作为**一条**「AI 一键修复」历史提交 | `assistant.spec.ts`、`tests/unit/aiStore.spec.ts`（7） |
| 6 | 操作前快照 + 可撤销（AI0） | 新增页面走**文档级历史条目** `commitDocEntry({ label, at, after })`（`before` 自动取当前 base），与补丁条目共用一条撤销栈；指令/修复是普通补丁历史 | `tests/unit/historyDoc.spec.ts`（5） |
| 7 | 失败不落库 + 重试一次 | `runWithRetry()` 最多两次（第二次把错误原因追加进 prompt）；返回非 JSON、越界引用、未注册类型、缺必填属性都只报错，`JSON.stringify(doc)` 一字不变 | `aiDraft.spec.ts`、`aiInstruction.spec.ts`、`aiStore.spec.ts` |
| 8 | 密钥只存本机 + 调用记录 | `src/ai/settings.ts` → `localStorage['studio.ai.settings.v1']`；`aiLogs` 面板记 `kind / provider / ms / 成功与否`，上限 50 条可清空 | `aiProvider.spec.ts`、`aiStore.spec.ts` |

UI 是右侧栏的 `AiPanel.vue`：供应商下拉、接口设置折叠区、「一句话生成页面」、「选区指令」（空选区时按钮禁用）、设计检查列表（每条一个「修复」+ 一键修复）、调用记录。PLAN 验收「Mock provider 单测（合法补丁落库、越界引用拒绝、失败不落库、快照可撤销）」对应上表 2/3/6/7；「组件测试：选区指令后未选中节点 JSON 不变」对应 `tests/component/ai.spec.ts`（6 例，其中一例逐字节比较其余顶层节点）。

## M7 已经做了什么：AI 进阶（文案 / 素材 / 生成组件 / 成本 / 降级）

M7 的判据是「**AI 只出候选，用户点了才落库；不配 key 也全都能用**」。三条增强都遵循同一形状：**规则式实现（离线可用）+ Mock 供应商 + 供应商可换成真实模型 → 候选列表在面板上 → 应用时产出普通补丁走 `commit()`**：

| # | 能力 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 文案候选（AI4） | `textCandidates(prompt, { tone, maxLength })` 出 3 条互不相同的文案（plain / warm / bold，`MAX_TEXT_LENGTH = 80`）；应用走 `textPatch()` 只改 `props.text` 并带完整 `before` | `tests/unit/aiText.spec.ts`（5）、`tests/unit/aiStoreM7.spec.ts`（8） |
| 2 | 素材候选（AI4） | `materialCandidates()` 用**自写 PNG 编码器** `core/png` 现场生成 3 张渐变占位图（`createPlaceholderPng` + stored zlib + CRC32/ADLER32），`materialPatch()` 写 `props.src` + `props.source = 'generated'` + 补 `alt`；`isUsableMaterial()` 只放行光栅图 dataURL | `tests/unit/png.spec.ts`（11）、`tests/unit/aiMaterial.spec.ts`（4） |
| 3 | AI 生成自定义组件（AI5） | 受限 DSL（`DslNode` 只引用注册表类型 + 19 个白名单样式键 + `{{prop}}` 占位符，`DSL_MAX_NODES=30 / DEPTH=4 / PROPS=8`）→ `validateDsl()` → `compileDsl()` 成 `category: 'custom'` 的普通描述符 → iframe 预览 → 用户点注册才进「我的组件」 | `tests/unit/customDsl.spec.ts`（10）、`tests/unit/aiComponent.spec.ts`（5）、`tests/component/aiM7.spec.ts`（5） |
| 4 | 自定义组件存档 | `src/core/persistence/custom.ts` → `localStorage['studio.custom.components.v1']`，**只存 DSL 数据**（读回来重新编译）；坏 JSON / 校验不过的条目静默丢弃，读写被拒返回空表 / false | `customDsl.spec.ts`、`aiStoreM7.spec.ts`（新会话自动恢复） |
| 5 | 调用记录与成本（AI6） | `src/ai/usage.ts` 估算 token（CJK 一字 1 token、ASCII 4 字符 1 token）与费用（`gpt-4o-mini` 0.15/0.6 USD per 1M），**优先用供应商返回的 `usage`**；`aiUsage` 面板常显「N 次 · N tokens · $N · 模型」，日志每条带 `tokens/costUsd` | `tests/unit/aiUsage.spec.ts`（4）、`component/aiM7.spec.ts` |
| 6 | 离线 / 失败降级（AI6） | `src/ai/offline.ts` 只做判定（`navigator.onLine === false`、`provider` 类错误）；store 在 `outcome.ok === false` 时**直接调规则式实现**，`aiDegraded` 显示「已改用内置规则助手」，失败仍写一条日志 | `tests/unit/aiOffline.spec.ts`（3）、`aiStoreM7.spec.ts`、`component/aiM7.spec.ts` |
| 7 | 面板新增四个区 | `AiPanel.vue`：文案候选（语气 + 3 条可点候选）、素材候选（缩略图按钮）、生成组件（预览 iframe + 注册按钮）、成本行 + 降级提示；组件面板出现「我的组件」分组（空分组不显示） | `tests/component/aiM7.spec.ts`（5，断言候选应用后未选中节点逐字节不变） |

PLAN 验收「Mock provider 单测（候选应用、组件注册）+ 组件测试（断网降级文案）」对应上表 1/2/3/6；真实模型效果需要用户自己的 key，本仓库交付的证据全部来自 Mock / 规则助手。

## M8 已经做了什么：收尾（主题 / 版本 / 分享 / 可访问性 / 性能 / CI）

M8 的判据来自功能文档 L7 + E7 + E8：「**改主题色 → 所有引用 token 的元素同步变色；回滚到「改版前」版本 → 文档逐字节一致**」「**1000 节点导出 < 1s、整树布局 < 8ms**」「**键盘可完成选择/移动，导出 HTML 能校验对比度/alt/label**」：

| # | 能力 | 实现 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 主题 token（L7） | `src/core/theme`：样式里写 `$color-primary`，导出成 `var(--color-primary)` + `:root{}`（只在页面真的用到 token 时注入），画布用 `inlineStyle(…, tokens)` 解析成具体颜色；面板可增删改 token，未定义的引用会提示 | `tests/unit/theme.spec.ts`（10）、`tests/component/m8.spec.ts`（改 token 值 → 同一份 CSS 变量一起变） |
| 2 | 从模板新建页面（L6） | `pageFromTemplate(doc, id)`：把 6 套模板之一的第一页并进当前文档，节点 id 加页面前缀防撞、重名自动加序号；页面标签栏里选模板 + 「模板＋」按钮 | `tests/unit/templates.spec.ts`（11）、`component/m8.spec.ts` |
| 3 | 版本历史（L6） | `src/core/versions`：带名字的快照存本机（最多 20 条），`restoreVersion()` 返回深拷贝；回滚走**文档级历史条目**（D40），所以回滚本身也能撤销 | `tests/unit/versions.spec.ts`（7）、`component/m8.spec.ts`（回滚后 JSON 逐字节一致 + undo） |
| 4 | 分享 / 发布（L6） | `src/core/share`：整份文档编码进 `#doc=`（自写 base64url，中文/emoji 不依赖 `btoa`），`shareUrl()` 超 12000 字符返回空串并提示改用整站导出；`EditorShell.onMounted` 检测 `#doc=` 自动载入；发布路径仍是顶栏「整站」导出的静态站点 zip | `tests/unit/share.spec.ts`（5）、`component/m8.spec.ts`（能载入完整地址、坏链接不改文档） |
| 5 | 可访问性（E8） | 助手加第六条规则 `missing-label`（表单类组件既无 `label` 也无文案才报，修复补丁补 `props.label`）；已有对比度 / alt / 断点规则覆盖导出校验；键盘：方向键微调（Shift 10px）+ **Alt + 方向键在整棵树里换选中项** | `tests/unit/assistant.spec.ts`（9）、`component/m8.spec.ts`（Alt+方向键） |
| 6 | 性能预算（E7） | `tests/perf/export.perf.spec.ts`：1000 节点真实导出链路（CSS + HTML + 整站 + ZIP）取中位数，打印分阶段耗时；优化见 D53（`childrenIndex()` + 懒算 `children` + 复用激活页 HTML） | 见「质量数据」段：导出中位数 **73.31ms**（优化前 898.66ms），布局 2.79ms |
| 7 | CI 与本地生产预览 | `.github/workflows/ci.yml`：`npm ci` → lint → test → coverage → build → perf → smoke → 上传 dist；`scripts/sandbox-shim.cjs` 让本机沙箱与 CI 跑同一条命令 | `gh` 之外的证据：本地 `npm run build` + `npm run preview` 200 响应（见下） |

M8 的本地生产预览证据：`npm run build` 成功后 `npm run preview -- --port 4173`（见验收日志），用 `Invoke-WebRequest` 取 `/`、`/assets/*.js`、`/assets/*.css` 全部 200。

## M9 已经做了什么：画布与选择体验（按用户实测反馈修订）

触发这次修订的是用户对 WebBuilder 的实测反馈：**画布没有格子、删除要么删不掉要么删不完、选择相关的 UI 与排版看着不舒服**。逐条对齐后：

| # | 反馈 | 根因 / 做法 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 画布没有格子 | 加 `.canvas-page__grid` 双层网格：次网格 8px + 主网格 64px，**画在缩放层外面**、间距按 `store.zoom` 换算（参考实现是单层 8px 且在缩放层内，25% 下线距只剩 2px 看着像噪点，见 D57） | `tests/component/selection.spec.ts`「画布上有页面网格层」 |
| 2 | 删除「删不掉」 | 真 bug：选中根节点后 Delete 会连根删掉 → `ElementView` 读空节点 → **整片画布白屏**（探针报文 `TypeError: Cannot read properties of undefined (reading 'id')`）。修法见 D58：`removeSelection()` 过滤根节点与 `meta.locked`，全被保护就按原因提示；右键菜单同一份判断置灰并换文案；单选属性面板补危险按钮 | `selection.spec.ts`「锁定元素按 Delete 不删」「根节点按 Delete 不删」「单选时属性面板有删除按钮」 |
| 3 | 删除「删不完」 | 页面级操作（新建 / 重命名 / 删除页 / 载入模板）原来走 `setDoc()` 会 `createHistory` **清空撤销栈**，删错只能刷新。改成 `commitDoc()` 文档级历史条目（D60），撤销/重做能跨页面操作 | `selection.spec.ts`「从模板新建页面与删除页面都可撤销」「删容器连子孙一起删，撤销后逐字节还原」 |
| 4 | 选择点不到 / 选不准 | 树形文档里子节点铺满容器，点哪都选不到外层分区。加**层级点选**（第一次选最外层分区，再点下钻，到底循环）、`Alt+点击` 直达最深层、画布左上角**面包屑**（点任一层选中）、`Esc` 退一层（D59）；多选时画整体虚线包围框（`[data-role="multi-box"]`）；框选改为「命中祖先就只选祖先」，容器内部的元素也能框到（原来只框根级节点） | `selection.spec.ts`「点嵌套元素先选中最外层分区，再点一次下钻」「Alt + 点击直接选中」「面包屑路径」 |
| 5 | 排版不舒服 | 右侧栏从「七块面板竖着堆」改成 **页签**（属性 / 布局 / 主题 / AI / 历史 / 分享 / 代码，全部 `v-show` 保持挂载，见 D61）；选中框改 `outline: 2px + offset -2px`、手柄改蓝底白圈、磁吸辅助线改红色虚线、图层行按参考平台加大行高与选中描边、组件卡片 hover 加浅底 | 既有 50 个测试文件全绿；选择相关断言见 `selection.spec.ts`（11 例） |

M9 没有新依赖、没有新 npm 脚本；改动集中在 `src/components/canvas/CanvasStage.vue`、`src/components/editor/{EditorShell,PropPanel,ContextMenu}.vue`、`src/stores/editor.ts`、`src/styles/editor.css`，测试新增 `tests/component/selection.spec.ts`（11 例）。

## M10 已经做了什么：类型名中文化与删除入口（M9 之后用户再次实测）

M9 交付后用户又提了两条：**图层里的类型名还是英文**、**删除功能还是不行**。这一轮：

| # | 反馈 | 做法 | 测试证据 |
| --- | --- | --- | --- |
| 1 | 图层里的英文换成中文 | `core/components` 新增 `componentLabel(type)`（取描述符的中文 `label`，未注册类型原样返回），图层行、属性面板 `prop-type`、画布单选角标、层级面包屑四处统一改用它（D63）。`text`/`section`/`frame` 现在显示「文本 / 区块 / 容器」，与左侧组件面板一致 | `tests/component/layers.spec.ts` 6 例 |
| 2 | 删除功能故障 | 代码层逐条复查（`removeSelection` → `removePatches` 级联 → 历史不合并删除条目 → 自动保存）没发现新的逻辑错误，组件测试也复现不出；能确定的是**删除入口不明确**：原来只有键盘 Delete、右键菜单、属性面板底部三处，图层行只能显隐/锁定/上下移层，用户会去图层里找删除（D64）。这一轮把入口做显眼：图层每行 🗑（`data-role="layer-delete"`）、顶栏撤销旁「🗑 删除」（`data-role="toolbar-delete"`，无选中时禁用），两者与 Delete 键共用同一条 `removeSelection()` 保护与提示 | `layers.spec.ts`「图层行的删除按钮删掉元素，容器连子孙一起删」「图层行删除按钮对锁定元素给提示、不删除」「顶栏删除按钮：没选中时禁用，选中后能删」 |

M10 同样没有新依赖；改动 `src/core/components/index.ts`（+`componentLabel`）、`src/components/editor/{LayerPanel,PropPanel,EditorShell}.vue`、`src/components/canvas/{CanvasStage,ElementView}.vue`、`src/styles/editor.css`，测试新增 `tests/component/layers.spec.ts`（6 例）。

## M11 已经做了什么：删除故障的真因（第三次实测后定位）

用户第三轮反馈很关键：**「显示根节点不能删除，但那也不是网格画布，而是一个矩形」**——他以为自己选中的是一个矩形元素，实际选中的是页面的根 frame（在画布上就是一片大矩形选中框）。组件测试探针把路径固定下来了：

| # | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | 从模板新建页面后，画布上留着一片被选中的大矩形，按 Delete 只提示「根节点不能删除」，怎么按都删不掉 | `addPageFromTemplate()`（`src/stores/editor.ts`）与 AI 生成页面（`aiGeneratePage()`）提交文档后都执行 `selectedIds.value = [page.root]`，把新页面的根容器塞进了选区；根 frame 的选中框就是一个大矩形，所以「看起来像选中了矩形但删不掉」 | 两处都改成清空选区（D65） |
| 2 | 就算选中根，也看不出「画布本身不能删」和「按钮坏了」的区别 | 顶栏/属性面板/右键菜单的删除按钮只看「有没有选中」，选中根时按钮可点但只会报错 | store 新增 `canRemoveSelection`（排除根与 `meta.locked`），三处按钮按它置灰；`removeSelection()` 的提示改成「这是页面画布本身（根容器），删不掉；要删的是画布里的元素」 |
| 3 | 属性面板选中根时仍显示「删除这个元素」 | 同上 | 根被选中时属性面板改显示一行提示 `data-role="root-hint"` |

M11 没有新依赖；改动 `src/stores/editor.ts`（两处清空选区 + `canRemoveSelection` + 文案）、`src/components/editor/{EditorShell,PropPanel,ContextMenu}.vue`，测试在 `tests/component/selection.spec.ts` 增 3 例（全量 51 文件 / 577 例）。

## M12 已经做了什么：模板页上的网格与右键删除（M11 之后用户第四次实测）

M11 交付后用户又说：**「但此时画布的方格没了，而且右键为什么没有删除选项了」**。两条症状其实是同一类「只在模板页上出现」的问题：

| # | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | 模板页上看不到画布网格（空白项目里网格是好的） | 模板的根 frame 带不透明底色（`#FFFFFF` / `#0F172A` / `#F8FAFC`），它铺满整页、渲染在网格层之上，把网格整个盖住了 | 根 frame 的 `bg` 不再画在元素上，改由 `.canvas-page` 承担（D66），网格层因此回到页面底色与元素之间 |
| 2 | 右键菜单里找不到「删除」 | 右键页面空白处命中的是根 frame，`onStageContextMenu` 把根塞进选区，删除项于是被置灰并把文案换成「这是页面画布，删不掉」 | 右键命中根 frame 不再改选区（保持原选中的元素）；删除项文案固定为「删除」，不可用原因写进按钮 `title` |

M12 没有新依赖；改动 `src/components/canvas/{CanvasStage,ElementView}.vue`、`src/components/editor/ContextMenu.vue`，测试新增 `tests/component/contextmenu.spec.ts`（5 例）并在 `tests/component/selection.spec.ts` 增 2 例（全量 52 文件 / 584 例）。

## M13 已经做了什么：组件面板单列 + 中文主题名 + 输入框与层次感（M12 之后用户第五轮实测）

M12 交付后用户说：**「我们的平台组件似乎过多了，且一行两个组件选项会导致组件名称显示不全，建议改成一行一个，主题方面英文太多了，而且平台几乎所有的输入框边框太黑了，弄成浅灰色，且整个平台一眼望去白茫茫一片，我希望有点层次感」**。这一轮是纯界面修订，不动文档模型与业务逻辑：

| # | 反馈 | 修法 |
| --- | --- | --- |
| 1 | 组件太多，一行两个名字被截断 | 组件面板改单列（`grid-template-columns: minmax(0, 1fr)`），左栏 176px → 200px；分类标题变成可点开的横条（▾/▸ + 名字 + 个数），默认收起表单（12 个）与媒体（5 个），布局 / 基础 / 展示保持展开；搜索时自动全部展开（D67） |
| 2 | 主题面板英文太多 | `core/theme` 新增 `tokenLabel()`：`color-primary` → 主色、`radius-sm` → 小圆角、`space-lg` → 大间距，认不出的后缀回落「颜色·brand」；面板主标题显示中文，原始英文名仍以灰色小字留在下面（样式里要写 `$color-primary`）（D69） |
| 3 | 几乎所有输入框边框太黑 | `.editor-input` 这个类在 CSS 里**从来没有规则**，一直吃浏览器默认的深灰 2px 边框；这轮补上共享样式：1px 浅灰 `#dbe2ea`、聚焦主色 + 光晕、hover 加深、`select` 自绘箭头（D68） |
| 4 | 一眼望去白茫茫、没有层次感 | 补 `tokens.css` 里被当作 fallback 用的 `--studio-text-muted` / `--studio-surface-2` 等变量；顶栏白底加投影、左右侧栏改浅灰、面板变白卡片（细边 + 轻投影 + 标题分隔线）、画布区加内阴影与更深的纸张投影、状态栏浅灰、选中页签白底 + 主色下划线（D68） |

M13 没有新依赖；改动 `src/components/editor/{PalettePanel,ThemePanel}.vue`、`src/core/theme/index.ts`、`src/styles/{tokens,editor}.css`，测试在 `tests/component/editor.spec.ts` 增 1 例（分类折叠 + 搜索展开）、`tests/component/m8.spec.ts` 增 1 例（主题变量中文名）、`tests/unit/theme.spec.ts` 增 1 例（`tokenLabel` 全量映射），全量 52 文件 / 587 例。

## M14 已经做了什么：尺寸显示 / 缩放下拉 / 一键清空 / 内容盒间距（M13 之后用户第六轮实测）

M13 交付后用户说：**「我们的平台的尺寸选择应是类似于1440*900之类的展示形式，且关于缩放设置那只有100%，+-我都不知道加减到多少%，加上一键清除功能，部分组件内的文字或提示字体与上下边框的距离并不一致」**。四条里两条是「看不出状态」、两条是「盒模型不对」：

| # | 反馈 | 修法 |
| --- | --- | --- |
| 1 | 尺寸选择要像 `1440*900` 这样显示 | 预设按钮改两行（名字 + `1440 × 900`），顶栏再加可直接编辑的「宽 × 高」两个输入框，`[data-role="viewport-label"]` 显示当前完整尺寸；store 新增 `setViewportHeight()`（与宽度同样夹取 200–10000 后复用 `applyViewport()`）（D70） |
| 2 | 缩放只有 `100%`，不知道 ± 加减到多少 | 中间固定写死的 `100%` 按钮换成 `[data-role="zoom-select"]` 下拉：25 / 50 / 75 / 100 / 125 / 150 / 175 / 200%，始终显示当前档位（`适应` 算出的 113% 这种非整档也会插进候选）；`－` / `＋` 加 `title` 写明「范围 25%–200%，每次 25%」，状态栏百分比保留（D70） |
| 3 | 加一键清除 | store 新增 `canClearPage`（根下有元素）与 `clearPage()`：级联删掉根容器下所有子树、作为**一条**文档补丁进撤销栈、清空选区、toast 提示可 Ctrl+Z 撤销；顶栏 `[data-role="toolbar-clear"]`，空页面自动置灰（D71） |
| 4 | 组件内文字/提示与上下边框距离不一致 | 真因两条：`.canvas-el__content` 没有 `box-sizing`，`height:100%` + 8px 上下 padding 在 content-box 下被 `overflow` 裁掉，上边距 8px、下边距 0；以及画布里的 `canvas-el__title / __muted / __sub / __caret / __box / __dot / __switch / __play` 等类**一个规则都没有**（导出侧却有 `.el__title` 等）。修法：内容盒改 `border-box`，单行控件内容盒横向 + 垂直居中，补齐上面这些类的样式与画布里 `.el__list / .el__table / .el__tabs` 的基础排版（D72） |

M14 没有新依赖；改动 `src/stores/editor.ts`（`setViewportHeight` / `canClearPage` / `clearPage` / 预设 label）、`src/components/editor/EditorShell.vue`、`src/styles/editor.css`，测试在 `tests/component/editor.spec.ts` 把原来的「视口切换与缩放」1 例拆成 5 例（尺寸显示 / 高度可改 / 高度夹取 / 缩放下拉 / 一键清空），全量 52 文件 / 591 例。

## M15 已经做了什么：缩放百分比可以直接输入（M14 之后用户第七轮实测）

M14 交付后用户说：**「百分比改为我能输入具体数值」**。上一轮把写死的 `100%` 按钮换成了固定档位下拉（25 / 50 / … / 200），能看见状态了，但想精确到 113% 这类中间值时无路可走。

| # | 反馈 | 修法 |
| --- | --- | --- |
| 1 | 缩放百分比要能输入具体数值 | `[data-role="zoom-select"]` 下拉换成 `[data-role="zoom-input"]` 数字输入框（`min=25 max=200 step=1`，右侧一个 `%` 后缀，去掉 number 的上下箭头）：`@change` 时 `store.setZoom(Number(raw)/100)` 并把框的值回写成夹取后的真实百分比，回车触发 blur 生效；`－`/`＋`（每次 25%）与「适应」保持不变（D73） |
| 2 | （顺手加固）输入非数字时不能污染画布缩放 | `store.setZoom()` 增加 `Number.isFinite` 守卫——之前 `NaN` 会让 `zoom` 变成 `NaN`，画布与状态栏一起坏掉（D73） |

M15 没有新依赖；改动 `src/stores/editor.ts`、`src/components/editor/EditorShell.vue`、`src/styles/editor.css`，`tests/component/editor.spec.ts` 的缩放用例改成「显示当前百分比 / 手输非整档 37% / 清空输入不改缩放 / 越界夹到 200% 与 25%」，全量 52 文件 / 591 例。

## M16 已经做了什么：缩放层以左上角为原点（M15 之后用户第八轮实测）

M15 交付后用户反馈：**「当我进行缩放时，组件与画布的相对位置会改变，会错位，且『从左侧拖入组件开始搭建』字样也会偏移，蓝色虚线框与画布并不重合」**——这是真 bug，不是能力限制。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 缩放时组件与画布相对位置改变、错位 | `.canvas-page__inner` 的 `transform: scale(zoom)` **没写 `transform-origin`**，默认从中心（`50% 50%`）缩放：zoom=50% 时内容整体偏移 `(1−0.5)×1440/2 = 360px`，而外层 `.canvas-page` 已是 `1440×0.5` 并居中。改成 `transform-origin: 0 0`（左上角），内容与外层容器左上角重合（D74） |
| 2 | 「从左侧拖入组件开始搭建」占位字样偏移 | 同一根因：占位文字在根容器内容盒里，被中心缩放一起带偏；修好原点后随画布一起对齐 |
| 3 | 蓝色虚线框与画布不重合 | 多选框（`data-role="multi-box"`）、吸附线、框选矩形、拖入提示都在缩放层内，缩放原点错误时与网格/画布边界错开；修好原点后全部重合。顺带修好非 100% 缩放下的拖拽/框选坐标（`localPoint()` 依赖「缩放原点 = 容器左上角」） |

M16 没有新依赖；改动 `src/components/canvas/CanvasStage.vue`（缩放层内联 `transformOrigin: '0 0'` + 注释）、`src/styles/editor.css`（`.canvas-page__inner { transform-origin: 0 0 }`），`tests/component/editor.spec.ts` 新增 1 例锁住「缩放原点 0 0 / 75% 时画布 1080px / 缩放层仍是 1440×900」，全量 52 文件 / 592 例。

## M17 已经做了什么：文本纵向居中 / 拖拽不再随缩放漂移（M16 之后用户第九轮实测）

M16 交付后用户反馈：**「文本组件的文本上下边框的间距依然偏下，在不同的尺寸下，当我用鼠标拖动组件时，组件与鼠标的相对位置会改变」**——两条都是真 bug。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 文本组件里文字离上下边框的间距偏下（上大下小） | 内容盒给上下各 8px 内边距，而 `line-height: 1.4` 的行盒常常比「元素高 − 16px」还高，溢出被 `overflow: hidden` **从下面**裁掉 → 上边距 8px、下边距 0。`text` / `heading` 改成纵向 `justify-content: center` + `padding: 2px 8px`，上下对称、多行也等量裁切（D76） |
| 2 | 不同缩放比例下拖组件，组件相对鼠标的位置会变 | 之前每次 `pointermove` 都重新读 `.canvas-page` 的 `getBoundingClientRect()` 再除以当前 zoom 算绝对坐标。拖拽期间只要画布容器位移（滚动条出现/消失把居中的页面挤动、窗口尺寸变化），「现在原点」和「按下原点」就不是同一个，差值里多算一份容器位移，缩放越大越明显。改成按下时快照原点与 zoom（`Interaction.scale` + `dragPoint()`），之后只累加屏幕位移（D75） |

M17 没有新依赖；改动 `src/components/canvas/CanvasStage.vue`（`Interaction.scale`、`dragPoint()` 替换移动/缩放/框选三条路径的实时坐标）、`src/styles/editor.css`（`text` / `heading` 内容盒规则），`tests/component/editor.spec.ts` 新增 2 例锁住「50% 缩放时拖 100 屏幕像素 = 200 设计像素」「拖拽中途画布被挤动 120px 元素仍跟手」，全量 52 文件 / 594 例。

## M18 已经做了什么：关掉浏览器的原生拖拽 / 拖入类型白名单 / 版本角标（M17 之后用户第十轮实测）

M17 交付后用户反馈：**「问题依旧存在，且在拖动时有概率会将该组件复制一份」**——「复制一份」这条把前两轮没定位到的根因暴露了。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 拖动时**有概率**多出一个组件 | 画布里的文字一旦被选中（或指针落在图片/链接这类浏览器默认可拖内容上），浏览器会发起一次**原生 drag**：一边显示跟随鼠标的半透明快照（看着就像复制了一份），一边给画布发 `pointercancel`。而 `onDrop` 以前写的是 `getData('text/plain') \|\| 'text'`，于是那次原生 drop 被当成「插入一个 text 组件」。修法两层：画布禁用原生拖拽与文字选区（D77）；`onDrop` 只接受注册过的组件类型 + 500ms 同落点去重，面板侧再挡掉「拖拽后补发的 click」（D78） |
| 2 | 「组件与鼠标相对位置会改变」依旧偶发 | 同一个根因：原生 drag 一启动，我们的 pointer 拖拽就被 `pointercancel` 掐断，元素停在半路、鼠标继续走，看起来就是相对位置变了。M17 的坐标快照只解决了「容器位移」那一类 |
| 3 | 磁吸在高缩放下「离得还远就吸住」 | 磁吸阈值原本是 6 **设计**像素，200% 缩放下等于 12 屏幕像素。改成 `SNAP_THRESHOLD / zoom`，任何缩放下都是 6 屏幕像素（D79） |
| 4 | 分不清「没修好」还是「看的是缓存」 | 状态栏最右侧加 `BUILD_TAG` 版本角标（当前 `M18`），和仓库最新提交标题对不上就是浏览器缓存，按 Ctrl+F5（D80） |

M18 没有新依赖；改动 `src/components/canvas/CanvasStage.vue`（`preventDefault` + 清选区、`@dragstart.prevent`、`onDrop` 类型白名单与去重、`snapThreshold()`）、`src/components/editor/PalettePanel.vue`（拖拽后 400ms 内忽略 click）、`src/styles/editor.css`（`.canvas-stage { user-select: none }`，输入框放开）、`src/components/editor/StatusBar.vue` + 新增 `src/config/build.ts`（版本角标）；`tests/component/editor.spec.ts` 新增 4 例：「拖入非组件类型不插入」「同一次拖拽两个 drop 只插一个」「拖动只移动不复制」「状态栏显示 M18」，全量 52 文件 / 598 例。

## M19 已经做了什么：拖拽起始盒改取当前断点的绝对几何（M18 之后用户第十一轮实测）

M18 交付后用户回「问题依旧存在」，并给了新例子：**「当我的鼠标按在组件的后半段时，一拖拽鼠标就可能跑到前半段去了」**——「一拖就跳」而不是「拖着拖着漂」，说明锚点在按下的那一刻就错了，跟手势是否被浏览器掐断无关。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 在非桌面尺寸下，按住组件后半段一拖，元素瞬间挪走半截 | `beginMove()` 用 `store.nodes[id]`（**基准断点**的几何）算起始盒，但画布渲染和 `store.boxes` 用的是当前断点的**有效几何**（`viewNodes` = 基准 + `overrides`）。元素在窄断点上被调过位置/尺寸时，两套坐标差多少，第一帧「位移 0」就把元素写回基准坐标、跳多远；按在后半段时，鼠标就落到了跳完后的前半段。改成从 `store.boxes`（绝对盒）起拖；`snapTargets()` 也从相对盒换成绝对盒（D81） |
| 2 | 容器里的元素吸附/缩放也不准 | `setBox()` 收的是**相对父容器内容框**的坐标，而位移/吸附是在页面绝对空间里算的。M19 同时快照两份：`boxes`（绝对，算位移与吸附）与 `rels`（相对，写回 `setBox()`），移动与缩放都按「绝对偏移量」换回相对坐标（D81） |

M19 没有新依赖；改动 `src/components/canvas/CanvasStage.vue`（`Interaction.rels`、`beginMove()` / 缩放起始盒改读 `store.boxes`、`snapTargets()` 用绝对盒、移动与缩放写回相对坐标、`locked` 判断改看当前断点节点）、`src/config/build.ts`（角标 `M19`）、`tests/component/helpers.ts`（`down()` 支持传 `PointerEventInit`，用来测 Alt 深选）；`tests/component/editor.spec.ts` 新增 3 例：「mobile 断点下拖动从屏幕位置继续走、尺寸不被基准断点顶掉」「mobile 断点下缩放沿屏幕上的边缘走」「容器里的元素按绝对位置参与磁吸」，并把角标断言改到 `M19`，全量 52 文件 / 601 例。

## M20 已经做了什么：双击编辑对所有组件开放 / 表格水平对齐生效（M19 之后用户第十二轮实测）

M19 交付后用户回了两条：**「有部分组件无法输入文本，如所有布局组件，表单容器，输入框，文本域，进度条等」** 和 **「表格的水平对齐基本毫无作用」**。两条都不是「功能没做」，而是「功能在，但被某处挡住/盖掉」。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 布局组件 / 表单容器 / 输入框 / 文本域 / 进度条……双击没反应，或输完看不见 | 画布行内编辑的入口一直有 `if (!editable) return`，但只有 9 类组件标了 `editable: true`；输入类虽然能弹出输入框，改的却是不可见的 `text`（画布上显示的是 `placeholder`）。改成：除 root/page/instance/symbol 四个内部类型外**全部可双击编辑**；写哪个字段由描述符新增的 `editKey` 决定（输入类写 `placeholder`，其余写 `text`）；内容里本来没有文字的 15 个组件在用户改过 `text` 后显示 `.el__caption` 半透明角标，画布与导出一致（D82） |
| 2 | 表格点「居中/右对齐」毫无反应（表头更是怎么点都不动） | 编辑器 CSS 里 `.canvas-el__content .el__table th/td { text-align: left }` 的优先级高于节点上的 `text-align`，把属性面板的输出整个盖掉；`th` 的浏览器默认又是 `center`，所以「点居中没反应」和「表头从来居左」两种错觉同时存在。改成 `text-align: inherit`，并在导出侧 `BASE_CSS` 补上同一套表格基础规则（D83） |

M20 没有新依赖；改动 `src/core/components/index.ts`（`editKey` / `caption` 描述符字段、`editKeyOf()`、`captionOf()`、40 个描述符里的 15 个 `caption: true` 与 3 个输入类的 `editKey: 'placeholder'`）、`src/components/canvas/CanvasStage.vue`（`editingKey` 状态、`startEdit()` / `commitTextEdit()` 按 `editKeyOf()` 读写、行内输入框的 `placeholder` 跟着变）、`src/styles/editor.css`（表格 `th/td` 继承对齐 + `.el__caption` 样式）、`src/core/codegen/index.ts`（`BASE_CSS` 增加 `.el__caption` 与表格规则）、`src/config/build.ts`（角标 `M20`）；`tests/component/editor.spec.ts` 新增 3 例（双击布局组件写 `text` 并显示角标且默认文字不显示、双击输入框写 `placeholder` 且画布立刻可见、表格居中时画布与导出 CSS 都真的居中且没被 `th/td` 盖掉），`tests/unit/components.spec.ts` / `componentsRender.spec.ts` 跟着更新 `editable` 语义断言，M5 的导出结构快照同步更新，全量 52 文件 / 604 例。

## M21 已经做了什么：预设文字的颜色与可删除性（M20 之后用户第十三轮实测）

M20 交付后用户回了：**「有部分组件无法输入文本……都有字体颜色过淡的问题（与预设文本都是淡灰色），且当我输入文字后，预设文本（如空容器）并不会消失，且无法删除预设文本」**。两句合起来是同一个问题：这些组件的「文字」有两套——用户改过的正文，和组件默认渲染的占位/提示——后者的颜色和存在与否都由默认值决定，用户既看不清也删不掉。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 布局组件 / 表单容器 / 输入框 / 文本域 / 进度条……文字颜色过淡，和自己输入的预设文本一样灰 | 三个来源叠在一起：①`input` / `textarea` 的描述符沿用 v1 默认字色 `#64748B`（在 v1 里那本是 placeholder 的灰），而 M20 之后画布与导出把 `placeholder` 当正文渲染；②`.canvas-el__muted` / `.canvas-el__frame-hint` 只有 `opacity: .65`、M20 加的 `.el__caption` 带 `opacity: .6`，和背景混出来就是淡灰；③输入类的默认提示文字存在 `text` 里、画布渲染的却是 `placeholder`，新建出来其实是空的。改成：输入类显式给正文色 `#1E293B` 并把默认提示写进 `placeholder`（新建就能看到）；占位提示与角标改用实色弱化（`--studio-text-weak` #475569 / 继承正文色），画布 `editor.css` 与导出 `BASE_CSS` 同步（D84） |
| 2 | 输入文字后预设文本（如「空容器」）还在，而且删不掉 | 空态提示是组件自己渲染的 HTML，只看「容器里有没有子节点」，跟用户改没改文字无关——改完文字后提示还压在上面，清空文字它也照样回来，等于永远删不掉的「预设文本」。改成给渲染上下文加 `customText`（`text` 已不等于默认值，清空也算改过），frame / group / section / container / columns / form 六个空态提示统一按 `children.length > 0 \|\| customText` 决定是否输出：输入即替换、清空即删除；v1 迁移表不动，输入类的两处覆盖在单测里显式登记（D84） |

M21 没有新依赖；改动 `src/core/components/index.ts`（`ComponentRenderContext.customText`、`renderContext()` 的 `customText` 计算、六个空态提示的判断、`input` / `textarea` 的 `size` / `style` / `props`）、`src/styles/editor.css`（`.canvas-el__muted` 与 `.canvas-el__frame-hint` 改实色弱化、`.el__caption` 去掉透明度并放大到 13px）、`src/core/codegen/index.ts`（`BASE_CSS` 的 `.el__caption` 同步去掉 `opacity`）、`src/config/build.ts`（角标 `M21`）；`tests/component/editor.spec.ts` 新增 2 例（容器双击输入后预设提示消失、清空后也不回来；输入框/文本域文字是正文色且提示可清空），`tests/unit/components.spec.ts` 更新空态提示断言并登记 `M21_OVERRIDES`、新增「容器改过文字后不再显示空态提示」，`tests/unit/customDsl.spec.ts` 三处 fixture 补 `customText`，M5 的导出结构快照同步更新，全量 52 文件 / 607 例。

## M22 已经做了什么：旧文档的输入类迁移 / 面板点选只看不插（M21 之后用户第十四轮实测）

M21 交付后用户回了：**「问题还在，另外左边组件改为点击选择（可以看到右边的属性等），但只能拖拽到画布」**。前半句是 M21 改过但只对新文档生效的那一半；后半句是交互约定变更——点组件面板不该直接往画布插东西。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 输入框 / 文本域里的文字还是淡灰（M21 明明改过默认值） | M21 改的是「新建节点」的默认值；已经存在的旧文档 / 导入文件里，节点自己存着 v1 的占位灰 `#64748B` 和 `props.text` 里的提示语，画布按存储值渲染，所以「改过但没变」。改成在收敛层 `normalizeSchema` 里做迁移：`input` / `textarea` 仍停留在 v1 灰的字色（含断点覆盖里的）换成正文色，非空 `props.text` 搬到 `placeholder` —— 读档 / 导入即自动修好旧文档，用户自己挑过的其它颜色不动（D85） |
| 2 | 点左侧组件面板就直接插进画布了；希望「点击=右侧看属性，只有拖入画布才插入」 | 面板的 `@click` 原来直接 `store.insertComponent()`。改成点击只发 `store.selectPalette(type)`：右侧属性栏渲染该组件的分类 / 默认尺寸 / 默认内容 / 可覆盖字段 / 说明（只读，不插入），面板项高亮、再点一次取消；拖拽仍是唯一插入通道，任何画布选择或真正插入都会清掉这个「面板选中」态（D86） |

M22 没有新依赖；改动 `src/core/schema/normalize.ts`（`migrateLegacyInput()`：字色与 `placeholder` 迁移，含断点覆盖）、`src/core/components/index.ts`（导出 `categoryLabel()`）、`src/stores/editor.ts`（`paletteType` 选择态与 `selectPalette()`，`select` / `selectMany` / `clearSelection` / `insertComponent` 顺手清掉它）、`src/components/editor/PalettePanel.vue`（`@click` 改点选、高亮与提示文案、去掉「拖拽后 400ms 内的 click」旧守卫）、`src/components/editor/PropPanel.vue`（点选态的只读信息分支）、`src/styles/editor.css`（`.palette-item.is-active` 与信息块排版）、`src/config/build.ts`（角标 `M22`）；`tests/unit/schemaNormalize.spec.ts` 新增 3 例（旧输入框迁移、用户自定义色不动、断点覆盖一起迁移），`tests/component/editor.spec.ts` 把原来的「点击插入」用例换成 2 例（点击只显示信息不插入、再点一次或选中画布元素就退出点选态），全量 52 文件 / 611 例。

## M23 已经做了什么：桌面/平板/手机之间的自动适配（M22 之后用户第十五轮实测）

M22 交付后用户回了：**「把之前提到的完善桌面，平板，手机之间组件相互适应的功能完善一下」**。这是 M16 时只给了 A/B/C 三条候选路线、一直没落地的那项能力，用户这次选了 **A：自动锚定 + 手动覆盖优先**。

| # | 反馈 | 根因 / 修法 |
| --- | --- | --- |
| 1 | 同一个组件换到平板/手机上不会跟着变，全按桌面绝对坐标摆着，只能手动一个个重摆 | 数据模型（`Constraints{h,v}`）和布局引擎（`applyConstraints()` 里的 `right / left-right / center / scale`）从 M2 起就写好了，但三处都断着：默认锚定一律 `{left,top}`、没有任何 UI 能改、编辑与导出调 `computeLayout()` 时都没传 `reference`（等于永远只有一个参考视口）。M23 把它接上：编辑器和导出都以**基准断点视口**为参考系跑约束换算，窄断点下「贴右 / 左右拉伸 / 居中 / 等比缩放 / 贴底 / 上下拉伸」真正生效（D87） |
| 2 | 新拖入的组件、旧文档里的组件锚定全是「左上」，自动适配从哪来的锚定值？ | 没有 UI 的年代不存在用户意图，所以按几何位置推断：宽/高占内容框 ≥85% → 两端拉伸、相差 ≤2px 的贴边 → 贴右/贴底、中心偏差 ≤2px → 居中，其余保持左/上（`scale` 不自动推断：等比缩放会把按钮标签缩成邮票大小，需要时在属性面板手动选）；插入新组件时带上推断值、整页「自动适配」一键推断（可撤销）、读档时把仍是默认 `{left,top}` 的节点迁移成推断值。手动优先：在窄断点上拖过/缩过或属性面板选过锚定的节点不再被自动推断覆盖（D88） |

M23 没有新依赖；改动 `src/core/responsive/index.ts`（`inferConstraints` / `inferPageConstraints` / `nodesForLayout()` / `ConstraintH`·`ConstraintV` 类型与锚定推断阈值）、`src/core/schema/types.ts`（`Page.designViewport`：基准断点下的设计尺寸）、`src/core/schema/normalize.ts`（`designViewport` 的收敛：夹取到合法视口范围）、`src/stores/editor.ts`（`baseViewport` / `layoutNodes`，`layout` / `exportBoxes` 传 `reference`；`inferConstraintsOf` / `applyResponsiveAdapt` / `inferDocConstraints` / `setAbsBox`；`applyViewport()` 在基准断点记录设计尺寸；`exportDoc` 每页都回设计尺寸）、`src/core/codegen/index.ts`（`generateResponsiveCss` 以设计尺寸为参考系，媒体查询里的换算跟着对）、`src/components/canvas/CanvasStage.vue`（拖拽/缩放改走 `setAbsBox`，绝对盒与写回相对坐标在 store 里收口）、`src/components/editor/PropPanel.vue`（新增「跨断点适应」区：水平/垂直锚定下拉 + 「此断点已手动调整」提示 + 重置，位置/尺寸按绝对盒显示与写入）、`src/config/build.ts`（角标 `M23`）；`tests/unit/responsive.spec.ts` 新增 4 例（满宽拉伸、居中/贴右、近满宽不误判成等比缩放、`inferPageConstraints` 与手动优先）、`tests/unit/responsiveExport.spec.ts` 新增 1 例（居中组件在手机媒体查询里按 375 宽重新居中）、`tests/component/editor.spec.ts` 新增 4 例（新插组件带推断锚定、一键自动适配含旧宿主、窄断点拖拽写 position 并定住锚定、属性面板设锚定落 override 且再拖不被改），全量 52 文件 / 620 例。

