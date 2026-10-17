# Studio 可视化页面搭建器

一个**不依赖任何拖拽库、UI 组件库**的可视化页面搭建器：把 WebBuilder 那套「拖拽排版 + 图层 + 属性面板 + 代码导出」的量级，
升级成**元素树 + 布局引擎 + 断点覆盖 + 组件体系 + AI 只产出补丁**的架构。

技术栈：Vue 3.5 + TypeScript 6（strict）+ Vite 8 + Pinia + Vitest + jsdom。拖拽用原生 Pointer Events 手写。

> **当前进度：M0（地基 + WebBuilder v1 迁移）、M1（WebBuilder 18 项能力复刻）、M2（布局引擎）、M3（响应式断点）、M4（组件体系）、M5（代码生成）、M6（AI 助手：Mock provider + 规则检查 + 只产出补丁）已完成。** 里程碑 M1–M8 的完整计划、每项验收方式与砍需求优先级见 [PLAN.md](PLAN.md)；
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
npm run test:perf  # 1000 节点布局性能（阈值：整树 < 8ms）
npm run test:smoke # 导出冒烟：真实写出 studio.html / site.zip，供外部工具校验
npm run coverage   # 覆盖率（阈值：语句/分支/函数/行 ≥ 90）
npm run lint       # ESLint（含 core 分层规则）
npm run build      # vue-tsc 严格类型检查 + 生产构建
npm run preview    # 预览生产构建
```

## 目录结构

```
src/
├── core/                    # 纯逻辑，禁止 import Vue / 组件 / store（ESLint 强制）
│   ├── schema/              # 文档模型、收敛(normalize)、v1 迁移(migrate)、导入入口(parse)、catalog / v1 表
│   ├── tree/                # 元素树：childrenOf / descendantsOf / normalizeNodeOrder / canonicalNodes
│   ├── patch/               # 补丁协议：applyPatch / invertPatch（撤销靠逆补丁，不存快照）
│   ├── history/             # 补丁历史栈 + 400ms 合并窗口
│   ├── geometry/            # 命中测试、八向缩放、6px 磁吸、框选相交
│   ├── ops/                 # 编辑器动作 → 补丁（插入/移动/删除/再制/对齐/移层）
│   ├── codegen/             # HTML / CSS 生成；inlineStyle() 画布与导出共用
│   ├── templates/           # 6 套示例模板
│   ├── persistence/         # localStorage 读写 + 脏存档修正
│   ├── layout/              # computeLayout()：四种容器模式 / 四种尺寸模式 / constraints / hug 测量注入
│   ├── dnd/                 # dropParentAt() 落点 + reparentPatches() 换父级（位置换算到新容器）
│   ├── spacing/             # spacingHints()：拖动中的等距提示
│   ├── responsive/          # 断点继承链 / 有效节点求解 / writeOverride() 只存差异 / media query 上界
│   ├── components/          # 40 个组件的描述符注册表（插件式，registerComponent + subscribeRegistry）
│   ├── symbols/             # 组件定义 / 实例展开（合成 id）/ 覆盖白名单 / 循环引用检测
│   ├── assistant/           # audit()：六条规则检查 + 每条的可执行修复补丁 + 迭代式 fixAll()
│   ├── site/                # buildSite()：静态多页站点（index.html + base.css + 每页 html/css）
│   ├── zip/                 # createZip()：自写 stored ZIP + CRC-32（不引压缩库）
│   ├── html/                # escapeHtml / safeUrl（codegen 与组件描述符共用）
│   └── export/              # drawPage()：PNG 近似截图
├── utils/textMeasure.ts     # 离屏 canvas 折行测量（碰 document，所以不在 core）
├── ai/                      # AI 编排（碰 fetch / localStorage，所以不在 core）
│   ├── types.ts             # AiProvider / AiRequest / AiResponse / AiProblem
│   ├── catalog.ts           # 组件目录 + 页面大纲 + 两份 JSON Schema + buildMessages()
│   ├── draft.ts             # PageDraft 三重校验（形状 / 收敛 / 自检）
│   ├── instruction.ts       # 选区指令 → Patch[]：coercePatches / allowedIds / scopeProblems
│   ├── mock.ts              # 确定性 Mock provider（离线可用）
│   ├── openai.ts            # OpenAI 兼容端点（key 只进请求头）
│   ├── settings.ts          # apiKey / baseUrl / model → localStorage
│   └── index.ts             # createAiService()：重试一次、调用记录、失败不落库
├── stores/editor.ts         # 唯一的编辑器 store：文档 + 选中 + 视口 + 缩放 + 剪贴板 + 历史 + 布局 + AI
├── components/
│   ├── canvas/              # CanvasStage（指针交互）/ ElementView（单个元素渲染）
│   └── editor/              # EditorShell / PalettePanel / LayerPanel / PropPanel / LayoutPanel / AiPanel / CodePanel / PageTabs / StatusBar / ContextMenu
├── styles/                  # editor.css（编辑器三栏）+ tokens.css + base.css
└── main.ts
tests/
├── unit/                    # 纯逻辑单测 + fixtures/（真实 WebBuilder v1 数据夹具）+ __snapshots__/
├── component/               # 组件测试（@vue/test-utils + jsdom + helpers.ts 布局垫片）
├── perf/                    # 1000 节点布局性能（npm run test:perf，独立 config）
└── smoke/                   # 导出冒烟：真实写盘 studio.html / site.zip，用外部工具校验（npm run test:smoke）
docs/
├── 功能文档-v2-可视化页面搭建器.md
├── decisions.md             # 架构决策记录（ADR，D1–D44）
└── archive/                 # 上一代表单搭建器的 PLAN / 决策 / 蓝图
```

## 质量数据（M6）

| 项目 | 数值 |
| --- | --- |
| 测试 | 36 个文件 / **471 个用例全绿**（含 2 个导出结构快照） |
| 覆盖率 | 语句 97.12% · 分支 90.66% · 函数 97.45% · 行 99.41%（阈值 90；统计范围是 `src/core/**`，AI 编排层 `src/ai` 由单测与组件测试覆盖但不在 v8 统计里） |
| 性能 | `npm run test:perf`：1000 节点整树 `computeLayout` 中位数 **2.94ms**（阈值 8ms；同机多轮在 2.6–4.9ms 之间波动） |
| 导出冒烟 | `npm run test:smoke`：落地页导出 `inlineStyles 0`、`mediaQueries 2`、zip 6905 B，`Expand-Archive` 解压通过 |
| 构建 | 81 modules；JS 235.07 kB（**gzip 82.15 kB**）；CSS 18.11 kB（gzip 3.73 kB） |
| 类型 | `vue-tsc -b` 严格模式 0 错误；ESLint 0 error 0 warning |

AI 之所以让包体涨了约 35 kB（gzip +12 kB），是因为 `src/ai`（目录/校验/两个供应商）与 `core/assistant`、`AiPanel.vue` 都进了编辑器包；它们没有引入任何新依赖。

## 架构决策

见 [docs/decisions.md](docs/decisions.md)。M0 的关键决定：元素树而非扁平数组、`version:2` 显式版本、导入一律先收敛、
v1 迁移只做保守映射（不猜用户意图）、`SceneNode` 命名避开 DOM 的 `Node`。
M1 新增 D9–D15：`Page.nodes` 键序规范化、画布与导出共用 `inlineStyle()`、拖拽手写 Pointer Events、
Vue Boolean prop「没传即 false」、`event.target` 可能不是 Element、`NodeOverride.layout` 是 `Partial`、
store 的 `updateNode/updateSelection` 对 `style/props/meta` 浅合并。
M2 新增 D16–D25：`safeUrl()` 放行光栅 dataURL、切视口不进历史栈、`TextMeasure` 可返回 `undefined`、
折行测量在 `utils` 且不用 `ResizeObserver`、`ratio` 语义是 w/h、等距提示阈值 400、`subtreeOf()` 返回 id、
布局面板只写 `layout`、折行里「整行 fill」按容器高兜底、grid 的 `justify` 表示单元内水平偏移。
M3 新增 D26–D30：断点覆盖只存差异（相对更宽一级算）、`NodeOverride.layout` 的嵌套子对象整体替换、
导出与预览断点解耦、media query 上界 `minWidth − 0.02` + `!important` + 复位声明、断点切换用预设视口宽度。
M4 新增 D31–D33：组件库是描述符注册表（插件式 + 订阅通知）、实例在渲染层展开成合成 id（文档里只有 instance 节点）、
创建组件不入撤销栈但 master 编辑走「补丁容器泛化」。
M5 新增 D34–D38：导出改成语义化 HTML + 独立 CSS 类（画布与 CSS 共用 `declarations()`）、媒体查询不再用
`!important`（同优先级类 + 复位声明白名单）、自写 stored ZIP 不引压缩库、SEO 是文档级字段且收敛层截断不拒绝、
React JSX 与保真 PNG 按裁剪优先级推迟。
M6 新增 D39–D44：AI 只产出结构化 JSON 且落库前过「形状 → 收敛 → 引用/自检」三层（必填 props 必须在收敛前查）、
AI 新增页面走文档级历史条目（与补丁条目共用撤销栈）、AI 补丁里的 `before` 一律丢弃现取、
一键修复必须迭代（一次审计的补丁摊平会互相覆盖）、密钥只存本机浏览器且 Mock 保证离线可用、
选区指令的范围校验基于「选区 + 子树」且空选区优先报错。

## 本机开发环境的四个坑（Windows + 受限沙箱）

1. **npm 缓存越界**：默认缓存在用户目录，沙箱拒绝写入。仓库根 `.npmrc` 已把缓存重定向到 `.npm-cache`。
2. **Vite 的 `exec('net use')` 走管道会被沙箱拦成 `EPERM`**：跑 `dev / test / build / preview` 前先设垫片
   `NODE_OPTIONS=--require <仓库>\.sandbox\child-process-pipe-shim.cjs`（`.sandbox/` 已在 `.gitignore` 里，Linux CI 不受影响）。
   实测不加垫片时 `npm run build` 会在 `vue-tsc -b` **通过之后**倒在 `vite build`：`failed to load config from vite.config.ts … [plugin externalize-deps] Error: spawn EPERM`（栈顶是 `optimizeSafeRealPathSync`）。
3. **`npm ci` 会删 `node_modules`**：如果 dev/preview 服务还在跑，会报「文件已被占用」并留下半残的依赖树 —— 先停服务再装。
4. **`child_process.fork` 的管道也被沙箱拒绝**（`Error: spawn EPERM`，`errno -4048`）：`fork` 默认用管道作 stdio，而沙箱不允许开命名管道。所以 Vitest 两个配置都显式写 `pool: 'threads'`（worker_threads 不 spawn 进程）——Vitest 5 的默认 pool 是 forks，去掉这行 `npm run test:smoke` 会直接 `no tests / 1 error`。

## 已知缺口 / 未做

- **M7–M8 尚未实现**：文案/素材生成、AI 生成自定义组件、调用成本面板、性能与可访问性专项、版本历史与分享发布都在 [PLAN.md](PLAN.md) 里。M6 做完的是「离线可用的规则助手 + 只产出补丁的 AI 管线」。
- **M6 的取舍与已知缺口**：
  - **没有配真实模型时的「生成」是确定性模板**：`createMockProvider()` 按关键词出草稿/补丁，能证明整条管线（校验、落库、快照、撤销）是通的，但不代表模型质量；真实质量要配 OpenAI 兼容端点（`src/ai/openai.ts`）。
  - **只有「生成新页面」和「改选区」两条 AI 入口**，没有多轮对话、没有上下文记忆（每次请求都重发页面大纲 + 组件目录），也没有「让 AI 解释为什么这么改」。
  - 规则检查的六条规则都是**几何/样式层面**的：对比度沿 `parentId` 找最近的非空底色，拿不到真实合成背景（半透明图层会算错）；间距只对齐 `SPACING_SCALE` 这张刻度表；间距/尺寸规则只在特定条件下报（间距只看有子节点的容器，尺寸一致性要 ≥3 个同类型兄弟）。
  - **`fixAll()` 最多 8 轮**：如果一轮修复又引入新问题（例如撑满宽度后与兄弟重叠），迭代到 8 轮后仍剩问题就停下并如实回报剩余条数；它返回的是补丁序列，调用方必须自己 `commit()`。
  - 文档级历史条目存**两份完整文档**（`before` / `after`），所以「100 步历史只存补丁」的体积约束对 AI 生成的页面不成立，连续生成很多页面会让内存涨得比普通编辑快。
  - 密钥明文存在 `localStorage`（`studio.ai.settings.v1`）：同源脚本可读，清了浏览器数据就要重填；面板只做了 `type="password"` 遮蔽，没有加密。
  - `src/ai` 不在覆盖率统计范围内（`vite.config.ts` 的 `coverage.include` 只看 `src/core/**`），它的质量证据是 43 个 AI 单测 + 6 个面板组件测试。
- **M5 的取舍与已知缺口**：
  - **React JSX 与「PNG 保真截图」按 PLAN 的裁剪优先级推迟**（D38）：M5 交付 HTML（单文件/整站）、独立 CSS、Vue 3 SFC 三种产物；PNG 仍是 M1 的近似截图，要等 M7 的素材/位图管线。
  - 类名依赖节点 id（`n-<id>`），从外部导入的非法 id 会被 `slugOf()` 转成 `-`，于是 `中文` 这种 id 会变成 `--`，可读性有限；没有做「语义化缩写」或 BEM 层级名（PLAN 的 BEM/原子类选项只做到「类名可读」这一层）。
  - `BASE_CSS` 与 40 个描述符的 `toHtml` 是手写的，导出样式表不做 CSS 压缩/去重；同一份 CSS 在多页站点里每页各一份（`<slug>.css` 内容相同也不共享）。
  - **语义标签只做到 `<button type="button">` 与带链接节点的 `<a>`**，其余都是 `<div>`：`SceneNode.type` 是盒子语义，不是文档大纲语义（要出 `<header>/<nav>/<section>` 得先加 outline 字段）。
  - `Doc.seo` 只能在导入的 JSON 里手写，编辑器还没有 SEO 表单（M8 的计划里）。
  - zip 只支持 stored（不压缩），且文件名冲突会直接覆盖（`buildSite()` 用页面 slug 命名）。
- **M4 的取舍与已知缺口**：
  - 组件面板 40 类是内置的，`Doc` 里**不存**自定义组件定义（`symbols` 是文档内的组件）；跨文档复用要先做「组件库 / 素材库」（M7 计划）。
  - 没有「组件编辑态」的独立画布：改 master 目前要选中实例后由属性面板/布局面板写入，双击进组件的交互 M7 再做。
  - 实例的覆盖白名单不可视化配置（描述符里写死 `overridable`），属性面板会对白名单外的键显示「不生效」提示，但还没做。
  - `expandInstances()` 每帧随节点表重算（1000 节点实例全展开时会有额外开销），没有做展开结果缓存。
- **M3 的取舍与已知缺口**：
  - 断点表格 `Doc.breakpoints` 里的 desktop / tablet / mobile 目前**不可增删**（只有 `minWidth` 与 `enabled` 会被尊重），设置 UI 还没做。
  - `NodeOverride.layout` 的嵌套子对象是整体替换（D27），所以窄断点改 `size.w` 会连 `size.h` 一起写进覆盖。
  - 媒体查询只覆盖启用中的断点。M3 时导出靠 `!important` 硬压内联样式，M5 改成语义化类 + 顺序覆盖（D35），所以现在外部样式表能正常覆盖导出结果。
  - 覆盖标记只标「这个元素在当前断点有覆盖」，还没细分「哪几个属性被覆盖」。
- **M2 的取舍与已知缺口**：
  - `estimated`（无 Canvas 时估算出的 hug 尺寸）已经在 `computeLayout()` 里标出，但**画布还没可视化**「这是估算值」。
  - 水平折行里「整行都是 `fill` 高」的行按容器高兜底（D24），视觉上会比相邻行高很多；grid 的 `justify` 在 grid 模式下表示「单元内水平偏移」而不是主轴分布（D25）。
  - `constraints` 只在 `free` 模式生效（流式布局里位置由布局算法决定），从 free 切到流式再切回来位置会还原 —— 这是 M2 判据要求的，但也意味着流式模式下改「位置」暂时看不到效果。
  - 文本测量固定 `FONT_STACK`、缓存整体清空（D19）；字体族不可配。
- **`setBreakpoint / applyViewport` 直接改写 `history.base`，不走补丁、不进历史**（D17/D30）：切视口/切断点是「看文档的姿势」而不是内容，所以刻意不污染撤销栈，代价是切过去不能撤销回去 —— 但断点**覆盖**本身是普通补丁，可正常撤销（`breakpoints.spec.ts` 有「清除覆盖后可撤销」用例）。
- **PNG 导出是近似截图**：`drawPage()` 手绘矩形与文字，字体度量与浏览器渲染有偏差；M7 会换成真实位图。
- **真实浏览器视觉验证没有自动化证据**：本机 headless Edge 被沙箱的命名管道限制拦住（`mojo ... platform_channel.cc:187 Check failed: . : 拒绝访问 (0x5)`），拖拽与像素级对齐只能人工打开 dev 服务器确认。
- **线上链接**：本机 `git push` 走 HTTPS 到 GitHub 会报 schannel `SEC_E_NO_CREDENTIALS`，且没有托管平台账号 —— 部署这一步需要你自己的账号。
- **根目录多了一个删不掉的重复文件**：`2026-10-16-form-builder-blueprint.md`（34256 B）已复制进 `docs/archive/`，但沙箱拒绝删除根目录原件。
- **M0 的 core 是先写实现后补测试**（与「core 先测试后实现」的约定有偏差），M1 起严格先红后绿 —— M1 的 5 个真 bug（属性面板抹样式、图片 dataURL 被 URL 白名单拦掉、Boolean prop 默认值、`event.target` 非 Element、override layout 是 Partial）都是先有失败测试再修。
