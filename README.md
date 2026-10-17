# Studio 可视化页面搭建器

一个**不依赖任何拖拽库、UI 组件库**的可视化页面搭建器：把 WebBuilder 那套「拖拽排版 + 图层 + 属性面板 + 代码导出」的量级，
升级成**元素树 + 布局引擎 + 断点覆盖 + 组件体系 + AI 只产出补丁**的架构。

技术栈：Vue 3.5 + TypeScript 6（strict）+ Vite 8 + Pinia + Vitest + jsdom。拖拽用原生 Pointer Events 手写。

> **当前进度：M0（地基 + WebBuilder v1 迁移）、M1（WebBuilder 18 项能力复刻）、M2（布局引擎）、M3（响应式断点）、M4（组件体系）、M5（代码生成）、M6（AI 助手：Mock provider + 规则检查 + 只产出补丁）、M7（AI 进阶：文案/素材候选 + 受限 DSL 生成组件 + 成本与降级）、M8（收尾：主题 token + 版本历史 + 分享发布 + 可访问性 + 性能预算 + CI）已完成 —— PLAN.md 的 M0→M8 全部走完；之后按用户对 WebBuilder 的实测反馈补了 M9（画布网格 / 层级选择 / 删除保护 / 右侧栏页签），又按第二轮反馈补了 M10（图层类型名中文化 / 删除入口显性化），最后按第三轮反馈补了 M11（定位到删除故障真因：新建模板页后自动选中根容器），又按第四轮反馈补了 M12（模板页上网格被根 frame 底色盖住 / 右键空白命中根导致删除项被置灰换文案），再按第五轮反馈补了 M13（组件面板改单列 + 分类折叠 / 主题变量中文名 / 输入框浅灰边框 / 三栏层次感），最后按第六轮反馈补了 M14（尺寸显示成 1440 × 900 并可改宽高 / 缩放下拉显示当前百分比 / 一键清空当前页面 / 组件内文字与边框间距修齐），又按第七轮反馈补了 M15（缩放百分比改成可直接输入数字），再按第八轮反馈补了 M16（缩放层改以左上角为原点，修掉缩放时组件/占位文字/多选框相对画布错位），最后按第九轮反馈补了 M17（文本/标题内容盒纵向居中修「文字偏下」、拖拽坐标改用按下时的原点与缩放快照修「不同缩放下拖组件越拖越偏」），又按第十轮反馈补了 M18（画布禁用浏览器原生拖拽与文字选区——那是「拖动时多出一个组件」和偶发不跟手的共同根因，拖入改走组件类型白名单，磁吸阈值按缩放换算，状态栏加版本角标）。** 里程碑 M1–M8 的完整计划、每项验收方式与砍需求优先级见 [PLAN.md](PLAN.md)；
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
│   ├── persistence/         # localStorage 读写 + 脏存档修正 + 自定义组件 DSL 存档（custom.ts）
│   ├── layout/              # computeLayout()：四种容器模式 / 四种尺寸模式 / constraints / hug 测量注入
│   ├── dnd/                 # dropParentAt() 落点 + reparentPatches() 换父级（位置换算到新容器）
│   ├── spacing/             # spacingHints()：拖动中的等距提示
│   ├── responsive/          # 断点继承链 / 有效节点求解 / writeOverride() 只存差异 / media query 上界
│   ├── components/          # 40 个组件的描述符注册表（插件式，registerComponent + subscribeRegistry + cssFor 作用域样式）
│   ├── symbols/             # 组件定义 / 实例展开（合成 id）/ 覆盖白名单 / 循环引用检测
│   ├── assistant/           # audit()：六条规则检查 + 每条的可执行修复补丁 + 迭代式 fixAll()
│   ├── theme/               # 主题 token：$name 引用解析、:root CSS 变量、分组与未定义提醒
│   ├── versions/            # 版本历史：带名字的快照（最多 20 条）+ 深拷贝回滚
│   ├── share/               # 分享链接：#doc= base64url 编解码 + 长度上限
│   ├── dsl/                 # 受限组件 DSL：validateDsl() 白名单校验 + compileDsl() → ComponentDescriptor + 预览 HTML
│   ├── png/                 # 自写 PNG 编码器（stored zlib + CRC-32 / ADLER-32），给素材候选出占位图
│   ├── site/                # buildSite()：静态多页站点（index.html + base.css + 每页 html/css）
│   ├── zip/                 # createZip()：自写 stored ZIP + CRC-32（不引压缩库）
│   ├── html/                # escapeHtml / safeUrl（codegen 与组件描述符共用）
│   └── export/              # drawPage()：PNG 近似截图
├── utils/textMeasure.ts     # 离屏 canvas 折行测量（碰 document，所以不在 core）
├── ai/                      # AI 编排（碰 fetch / localStorage，所以不在 core）
│   ├── types.ts             # AiProvider / AiRequest / AiResponse / AiProblem（kind 含 page/instruction/text/plain/material/component）
│   ├── catalog.ts           # 组件目录 + 页面大纲 + 各 kind 的 JSON Schema + buildMessages()
│   ├── draft.ts             # PageDraft 三重校验（形状 / 收敛 / 自检）
│   ├── instruction.ts       # 选区指令 → Patch[]：coercePatches / allowedIds / scopeProblems
│   ├── text.ts              # 文案候选（语气 / 长度）+ textPatch()
│   ├── material.ts          # 素材候选（core/png 渐变占位图）+ materialPatch() 写 src/source/alt
│   ├── component.ts         # 一句话 → 组件 DSL 候选 + 预览 + 注册入「我的组件」
│   ├── usage.ts             # token / 费用估算（优先用供应商返回的 usage）
│   ├── offline.ts           # 离线与降级判定（store 负责兜底调用）
│   ├── mock.ts              # 确定性 Mock provider（离线可用）
│   ├── openai.ts            # OpenAI 兼容端点（key 只进请求头）
│   ├── settings.ts          # apiKey / baseUrl / model → localStorage
│   └── index.ts             # createAiService()：重试一次、调用记录、失败不落库
├── stores/editor.ts         # 唯一的编辑器 store：文档 + 选中 + 视口 + 缩放 + 剪贴板 + 历史 + 布局 + AI + 主题/版本/分享
├── components/
│   ├── canvas/              # CanvasStage（指针交互）/ ElementView（单个元素渲染）
│   └── editor/              # EditorShell / PalettePanel / LayerPanel / PropPanel / LayoutPanel / ThemePanel / AiPanel / VersionPanel / SharePanel / CodePanel / PageTabs / StatusBar / ContextMenu
├── styles/                  # editor.css（编辑器三栏）+ tokens.css + base.css
└── main.ts
scripts/
└── sandbox-shim.cjs         # 可选垫片：仅当 .sandbox/child-process-pipe-shim.cjs 存在时加载（沙箱与 CI 同一条命令）
.github/workflows/ci.yml     # CI：lint → test → coverage → build → perf → smoke → 上传 dist
tests/
├── unit/                    # 纯逻辑单测 + fixtures/（真实 WebBuilder v1 数据夹具）+ __snapshots__/
├── component/               # 组件测试（@vue/test-utils + jsdom + helpers.ts 布局垫片）
├── perf/                    # 1000 节点布局 + 导出性能（npm run test:perf，独立 config）
└── smoke/                   # 导出冒烟：真实写盘 studio.html / site.zip，用外部工具校验（npm run test:smoke）
docs/
├── 功能文档-v2-可视化页面搭建器.md
├── decisions.md             # 架构决策记录（ADR，D1–D80）
└── archive/                 # 上一代表单搭建器的 PLAN / 决策 / 蓝图
```

## 质量数据（M18）

| 项目 | 数值 |
| --- | --- |
| 测试 | 52 个文件 / **598 个用例全绿**（含 2 个导出结构快照） |
| 覆盖率 | 语句 97.20% · 分支 90.61% · 函数 97.38% · 行 99.35%（阈值 90；统计范围是 `src/core/**`，AI 编排层 `src/ai` 与 Vue 组件由单测与组件测试覆盖但不在 v8 统计里） |
| 性能（布局，E7） | `npm run test:perf`：1000 节点整树 `computeLayout` 中位数 **5.44ms**（最快 4.29ms；阈值 8ms；同机多轮 3.5–6.5ms，本轮与 dev server 同时跑） |
| 性能（导出，E7） | 1000 节点真实导出链路（CSS 243848 B + HTML 305481 B + 整站 + ZIP 375581 B）中位数 **149.31ms**（最快 118.41ms；阈值 1000ms），分阶段 CSS 44.15 / HTML 44.53 / 整站 48.98 / ZIP 7.52ms（同机多轮 85–160ms） |
| 导出冒烟 | `npm run test:smoke`：落地页导出 `inlineStyles 0`、mediaQueries 2、zip 6905 B，`Expand-Archive` 解压通过 |
| 构建 | 98 modules；JS 285.13 kB（**gzip 98.53 kB**）；CSS 29.86 kB（gzip 5.77 kB） |
| 生产预览 | `npm run build` 后 `npm run preview -- --port 4173`：`/` 200、`/assets/index-*.js` 200、`/assets/index-*.css` 200 |
| 类型 | `vue-tsc -b` 严格模式 0 错误；ESLint 0 error 0 warning |
| CI | `.github/workflows/ci.yml`：lint → test → coverage → build → perf → smoke → 上传 dist |

M9 让 CSS 从 19.87 kB 涨到 22.06 kB（gzip +0.34 kB）、JS 从 275.21 kB 涨到 279.10 kB（gzip +1.16 kB）：网格层、面包屑、包围框、页签与删除保护；M10 又让 CSS 涨到 22.45 kB（+0.39 kB / gzip +0.05 kB）、JS 涨到 279.75 kB（+0.65 kB / gzip +0.18 kB）：中文类型名与两个删除入口；M11 只涨 JS 到 280.48 kB（+0.73 kB / gzip +0.29 kB）、CSS 不变：一个 `computed` 加几处条件渲染；M12 再涨 JS 到 281.01 kB（+0.53 kB / gzip +0.17 kB）、CSS 不变：根底色搬到画布容器 + 删除项 title；M13 让 CSS 涨到 25.91 kB（+3.46 kB / gzip +0.67 kB）、JS 涨到 282.38 kB（+1.37 kB / gzip +0.66 kB）：组件面板折叠、共享输入框样式、以及一整套底色/阴影/分隔线的层次感变量（CSS 是这轮的大头，JS 只多了 `tokenLabel()` 的映射表）；M14 让 CSS 涨到 29.20 kB（+3.29 kB / gzip +0.54 kB）、JS 涨到 284.23 kB（+1.85 kB / gzip +0.58 kB）：画布内容盒的居中/间距规则、此前完全没有样式的 `canvas-el__*` 内容类与 `.el__list /.el__table /.el__tabs` 的画布排版、尺寸预设与缩放下拉（CSS 仍是大头，JS 只多了 `clearPage` / `setViewportHeight` / 预设映射）；M15 让 CSS 再涨到 29.57 kB（+0.37 kB / gzip +0.08 kB）、JS 涨到 284.33 kB（+0.10 kB / gzip +0.02 kB）：把下拉换成数字输入框（`%` 后缀 + 隐藏 spinner）与一个 `Number.isFinite` 守卫；M16 让 CSS 涨到 29.60 kB（+0.03 kB / gzip +0.01 kB）、JS 涨到 284.35 kB（+0.02 kB / gzip +0.01 kB）：只是一条 `transform-origin: 0 0` 与一行注释；M17 让 CSS 涨到 29.73 kB（+0.13 kB / gzip +0.01 kB）、JS 涨到 284.51 kB（+0.16 kB / gzip +0.08 kB）：两条文本内容盒规则 + `Interaction.scale` 字段与 `dragPoint()` 换算；M18 让 CSS 涨到 29.86 kB（+0.13 kB / gzip +0.03 kB）、JS 涨到 285.13 kB（+0.62 kB / gzip +0.30 kB）：原生拖拽拦截、`onDrop` 类型白名单与去重、磁吸阈值换算、状态栏版本角标。十轮都没有引入任何新依赖。

性能这一轮没有退化：新增的只是 CSS 渐变与两个按钮，不参与布局计算（D57）；导出链路的瓶颈（`childrenOf()` 全表扫描）在 M8 已换成 `childrenIndex()`，仍然远低于 1s 阈值。M13 只改 CSS、样式变量与一个纯函数 `tokenLabel()`，布局与导出耗时都落在 M12 的抖动区间里。M14 同理：改的是画布 CSS 与顶栏按钮，`clearPage()` 只在点击时跑一次 `removePatches()`，`setViewportHeight()` 与既有的 `setViewportWidth()` 同路径且不进历史栈，两者都不参与 1000 节点布局/导出基准的计算。M17 只动了拖拽时的坐标换算（每帧多一次除法、少一次 `getBoundingClientRect()`，反而更轻）与两条文本 CSS 规则，同样不参与布局/导出基准。M18 加的是事件层拦截（`preventDefault` / `dragstart` 拦截 / `onDrop` 早退）与状态栏一个常量，都不在布局/导出热路径上；这一轮导出中位数偏高（149ms）是机器负载抖动，同机多轮区间仍是 85–160ms。


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
M7 新增 D45–D50：文案/素材/生成组件三条增强都是「先出候选、点了才落库」（落库走普通补丁历史，注册沿用 D33 不入文档历史）、
素材用自写 PNG 编码器（`safeUrl` 放行光栅 dataURL 但拦 SVG）、受限 DSL 编译成普通 `ComponentDescriptor`（category `'custom'` + `cssFor(scope)`）、
自定义组件 type 必须 ASCII（改名等于换 type）、token 与费用本地估算（优先用供应商 `usage`）、降级是 store 里的兜底调用而不是 provider 伪装。
M8 新增 D51–D56：主题 token 用 `$name` 引用、导出成 CSS 变量且只覆盖 4 个颜色字段（数字字段改动会波及全链路，所以不上）、
文本/颜色/PNG/base64 这些小工具一律自写不引依赖、性能瓶颈是「每个节点扫全表」而不是布局（`childrenIndex()` + 懒算 `children` + 复用激活页 HTML 把 1000 节点导出从 898.66ms 压到 73–80ms）、
版本历史与分享链接只落本机/地址栏（回滚与载入都走文档级历史条目因此可撤销）、分享片段要能吃完整地址（`indexOf('#doc=')`）、
perf/smoke 脚本用「存在性判断垫片」让沙箱与 CI 跑同一条命令。
M9–M18（计划外体验修订）新增 D57–D80：网格画在缩放层外（两层 8/64px）、删除保护放 `removeSelection()` 入口而不是 `core/ops`、
层级点选 + 面包屑 + Esc 退层、页面级操作全部进撤销栈（文档级条目）、右栏改页签且面板 `v-show` 常驻、
白屏回归用组件测试锁死、类型名统一走 `componentLabel()`、删除入口显性化到五个但共用一条路径、
新建页面后不再自动选中根容器（`canRemoveSelection`）、根 frame 底色画在 `.canvas-page` 上且右键根不算选中、
组件分类折叠用 `v-show` 保住 DOM（计数/搜索/测试都按 DOM 算）、
`.editor-input` 的浅灰边框收进共享 CSS 而 `tokens.css` 补齐被 fallback 的变量、
主题变量显示中文说明（`tokenLabel()`）但原始英文名保留在下面供样式引用、
视口尺寸显示成「宽 × 高」且高度可改（`setViewportHeight()`）、
一键清空作为一条可撤销的文档补丁（`clearPage()`）、
画布内容盒改 `border-box` + 单行控件垂直居中（导出侧 BASE_CSS 不动，保住快照）、
缩放百分比从固定档位下拉改成可手输任意数值的数字框（`setZoom()` 拒 `NaN`）、
画布缩放层以左上角为原点（`transform-origin: 0 0`），缩放下拖拽/框选坐标跟着修正、
拖拽几何改成「按下时快照原点与缩放比例」（`dragPoint()`，不再每帧重读容器矩形）、
文本/标题内容盒纵向居中且上下只留 2px（原来 8px 会被行高溢出吃成「上 8 下 0」）、
画布内关掉浏览器原生拖拽与文字选区（否则原生 drag 会掐断 pointer 拖拽，drop 还会被当成插组件）、
拖入只接受注册过的组件类型并对同手势重复落点去重（面板再挡「拖后补发的 click」）、
磁吸阈值按缩放换算成固定屏幕像素、状态栏显示界面版本号用于分辨「没生效」还是「缓存」。

## 本机开发环境的四个坑（Windows + 受限沙箱）

1. **npm 缓存越界**：默认缓存在用户目录，沙箱拒绝写入。仓库根 `.npmrc` 已把缓存重定向到 `.npm-cache`。
2. **Vite 的 `exec('net use')` 走管道会被沙箱拦成 `EPERM`**：跑 `dev / test / build / preview` 前先设垫片
   `NODE_OPTIONS=--require <仓库>\.sandbox\child-process-pipe-shim.cjs`（`.sandbox/` 已在 `.gitignore` 里，Linux CI 不受影响）。
   实测不加垫片时 `npm run build` 会在 `vue-tsc -b` **通过之后**倒在 `vite build`：`failed to load config from vite.config.ts … [plugin externalize-deps] Error: spawn EPERM`（栈顶是 `optimizeSafeRealPathSync`）。
3. **`npm ci` 会删 `node_modules`**：如果 dev/preview 服务还在跑，会报「文件已被占用」并留下半残的依赖树 —— 先停服务再装。
4. **`child_process.fork` 的管道也被沙箱拒绝**（`Error: spawn EPERM`，`errno -4048`）：`fork` 默认用管道作 stdio，而沙箱不允许开命名管道。所以 Vitest 两个配置都显式写 `pool: 'threads'`（worker_threads 不 spawn 进程）——Vitest 5 的默认 pool 是 forks，去掉这行 `npm run test:smoke` 会直接 `no tests / 1 error`。

## 已知缺口 / 未做

- **PLAN.md 的 M0–M8 全部完成，另有十轮计划外的体验修订（M9 / M10 / M11 / M12 / M13 / M14 / M15 / M16 / M17 / M18）**：M8 交付了主题 token、从模板新建页面、版本历史、分享链接、可访问性补充规则与键盘选择、性能基准（布局 + 导出）与 CI；M9 是用户实测后补的画布网格、删除保护、层级选择与右栏排版；M10 是用户第二轮反馈后的类型名中文化与删除入口显性化；M11 是第三轮反馈后定位到的删除故障真因——新建模板页后自动选中了页面根容器；M12 是第四轮反馈后修掉的「模板页网格被根 frame 底色盖住」与「右键空白选中根导致删除项被置灰换文案」；M13 是第五轮反馈后的界面修订——组件面板单列 + 分类折叠、主题变量中文名、输入框浅灰边框、三栏配色/阴影层次；M14 是第六轮反馈后的尺寸与间距修订——视口尺寸显示成「宽 × 高」且高度可改、缩放下拉显示当前档位、一键清空当前页面、组件内文字与边框间距修齐；M15 是第七轮反馈后的缩放修订——百分比从固定档位下拉改成可直接输入具体数值；M16 是第八轮反馈后的缩放原点修复——`transform-origin: 0 0`，缩放下组件/占位文字/多选框不再相对画布偏移；M17 是第九轮反馈后的拖拽与文本修订——拖拽几何改为按下时快照原点与缩放、文本/标题内容盒纵向居中；M18 是第十轮反馈后的手势修订——关掉画布里的原生拖拽与文字选区（那是「拖动时多出一个组件」和偶发漂移的共同根因）、拖入走组件类型白名单、磁吸阈值按缩放换算、状态栏加版本角标（见「M9 … M18 已经做了什么」）。下面按里程碑列出仍然存在的取舍与缺口（都是「知道但没做」，不是没发现）。
- **M18 的取舍与已知缺口**：
  - **画布里的文字不能再鼠标选中复制**：关选区是为了不让浏览器发起原生 drag，代价是「选中画布里的文字 → Ctrl+C」这条路没了；要改文字只能双击进输入框（那里放开了选区）。以后新增画布内的输入控件都要记得加进 `.canvas-text-editor` 豁免。
  - **拖入失败是静默的**：`text/plain` 里不是注册过的组件类型就直接忽略，用户拖错了不会看到任何提示——这是为了避免「原生 drop 被当成插组件」，但也牺牲了可发现性。
  - **同位置连续拖入同类型组件有 500ms/8px 去重窗**：极快手速下第二次会被丢弃，需要等半秒或挪开落点；这是防首手势双 drop 的兜底，属于「宁可少插一次也不多插」的权衡。
  - **版本角标要手动维护**：`src/config/build.ts` 的 `BUILD_TAG` 忘了改就会误导排查（它是界面代码版本，不是 `dist` 产物版本，生产构建仍靠文件名 hash 区分）。
  - **根因仍未在真实浏览器里复现过**：沙箱内无法启动浏览器（crashpad/mojo 拒绝访问、Edge 是提权实例），D77 的结论来自「原生 drag 会发 pointercancel + drop 的 `text/plain` 被当作类型」这两条可验证的浏览器行为与代码路径，用户实测确认之前仍属高置信推断。
- **M17 的取舍与已知缺口**：
  - **拖拽期间坐标系被冻结**：元素按「按下时的画布原点 + 按下时的缩放」算位移，所以拖到一半滚动画布（滚轮/触控板）时元素不会跟着滚动后的坐标系走；拖拽中改缩放（目前只有 Ctrl+滚轮会触发）也不会改变本次拖拽的换算比例。这是有意的（拖拽时坐标应稳定），但和「拖拽中可滚动」的直觉冲突。
  - **`localPoint()` 与 `dragPoint()` 两套坐标语义并存**：前者是「指针现在在画布的哪里」（悬停、落点提示用），后者是「相对按下点移动了多少」（拖拽几何用）；新写的交互逻辑挑错一个就会引入同类漂移。
  - **文本纵向居中只是 CSS 修正，测试锁不住**：jsdom 不算样式，组件测试只能锁拖拽数值；「文字上下间距是否真的对称」仍靠浏览器目测，而且多行文本现在是垂直居中（导出侧 `.el` 仍是顶部对齐），长段落与设计稿的预期可能不同。
  - **画布与导出的盒模型仍是两套**：画布给内容盒加内边距（文本 2px、其它 8px）与 flex 对齐，导出侧 `BASE_CSS` 仍是 `* { margin:0; padding:0 }` + 原生控件居中；M14/M17 都只在画布侧修，导出效果的微调需要另一套改动（动 `BASE_CSS` 会让两个导出快照失效）。
- **M16 的取舍与已知缺口**：
  - **缩放只解决「等比放大缩小」，没有解决「设备间自适应」**：在桌面/平板/手机之间切换时，画布纸张尺寸变了，但元素仍是 1440 布局下的绝对坐标，超出 `375` 宽的元素会跑到画布外——这块目前只能靠手动断点覆盖（M3 的 `NodeOverride`）逐个调；用户 m11226 问的「组件能否随画布尺寸与设备变化自适应」，我给的答案是三条路线：A 整页按比例 fit（成本小、不是真响应式）、B 切换断点时自动生成一版覆盖再手调（中等）、C 容器流式布局（最真、改动最大），当前未实施。
  - **正确性依赖两个约定同时成立**：外层 `.canvas-page` 尺寸 = 设计尺寸 × zoom，且缩放层原点在左上角；以后若改成 `translate`/`left` 居中或把缩放层包进别的 transform，`localPoint()`、多选框、吸附线、框选坐标都要一起复查。
  - **`transform-origin` 写了两处**（`CanvasStage.vue` 的内联样式负责让测试能断言，`editor.css` 负责样式语义），改一处容易忘另一处；jsdom 不做布局，组件测试只能断言内联样式与尺寸字符串，真实像素对齐仍靠浏览器目测。
- **M15 的取舍与已知缺口**：
  - **手输百分比没有「最近值」记忆**：输入框每次打开都是当前比例，不会像浏览器那样给历史候选；也没有做输入防抖，`@change`（回车/失焦）后立即应用。
  - **越界值静默夹取**：输 `900` 变成 `200`、输 `5` 变成 `25`，输入框回写成夹取后的值但没有任何提示，用户不知道被夹过。
  - **缩放仍只有 25%–200% 一个区间**：超宽页面（比如 2560 宽设计稿）没法缩到 10% 全览，`fitZoom` 也会被夹到 25% 下限。
- **M14 的取舍与已知缺口**：
  - **视口高度只影响画布纸张与导出 body**：`setViewportHeight()` 写的是 `Page.viewport.h`，响应式断点（`BREAKPOINT_VIEWPORTS`）仍按宽度的 `minWidth` 判定，导出媒体查询也不看高度；想要「固定 900 高的落地页」目前只能靠页面尺寸。
  - **一键清空只清当前页面的元素**：不清页面背景/主题/尺寸，也不是「清空整个项目」（那是「新建」）；清空是 `removePatches()` 的级联删除，节点上千时会在历史栈里存一条偏大的条目，撤销靠 Ctrl+Z 而不是二次确认。
  - **画布与导出仍是两套盒模型**：`border-box` + 8px 内边距 + 单行控件居中只存在于编辑期 `.canvas-el__content`；导出 HTML 的 BASE_CSS 没有这层 padding/flex，`layout.padding` 也不参与导出，所以画布里看起来对齐的内容导出后可能贴边。
  - **单行控件居中按 `data-type` 白名单维护**：新增组件类型时若忘了加进白名单，它的内容会退回纵向排列（表现为「文字还是贴顶」）；`.el__list / .el__table / .el__tabs` 也只在画布侧补了样式，导出侧仍吃浏览器默认。
- **M13 的取舍与已知缺口**：
  - **折叠是会话内状态**：组件分类展开/收起只记在组件内存里，刷新页面回到默认（表单/媒体收起），没有按用户偏好持久化；「组件过多」的另一种解法（搜索 + 置顶常用组件）没有做。
  - **主题中文名是「人的标题」不是变量本身**：`tokenLabel()` 只影响面板显示，样式里引用、导出、`themeVariablesCss()` 仍然是原始英文名；自定义 token（如 `brand`）认不出后缀，只能显示「其他·brand」。
  - **输入框样式统一在 `.editor-input` / `.prop-input`**：两个类各自一份规则，没有抽成设计系统组件；`type="color"` / `range` 这类原生控件仍吃浏览器默认样式。
  - **层次感靠 `tokens.css` + `editor.css` 的硬编码颜色**：新增的底色/阴影/分隔线是手写取值，没有做浅色/深色两套主题，也没有做「跟随系统深色」；`--studio-bg` 从 `#f3f4f6` 调到 `#eef1f6`，如果以后接主题切换要一起改。

- **M12 的取舍与已知缺口**：
  - **根 frame 的底色画布与导出走了两条路径**：画布上根 `bg` 由 `.canvas-page` 承担（D66），导出仍由 `generatePageCss()` 按节点出规则；两边结果一致，但以后改「页面背景」相关逻辑要记得改两处。
  - **根 frame 的圆角也搬到了容器上**：`.canvas-page` 没有 `overflow: hidden`，根 `radius` 很大时子元素会溢出圆角（模板根都是 0–8px，正常看不出来）。
  - **右键空白不会选根**：想改页面背景/尺寸时不能靠右键空白进属性面板，仍得从图层或代码/主题面板走；「删除页面」也不在右键菜单里（用页面标签上的 ✕）。
  - **网格颜色是固定的浅灰**：深色模板页（`#0F172A`）上网格线偏亮，没有按页面亮度自适应，也没有隐藏网格的开关。
- **M11 的取舍与已知缺口**：
  - **根容器仍然可以被程序性选中**：这轮只是不再在「新建页面 / AI 生成页面」后自动选根，`store.select(rootId)` 本身仍合法（属性面板能改页面背景、图层树不列根），所以外部调用或未来的新入口仍可能把根选进选区；兜底只有 `removeSelection()` 的边界检查与 `canRemoveSelection` 置灰。
  - **没有「页面设置」独立入口**：新建模板页后属性面板是空态（要先点一个元素）；想改页面背景尺寸仍得选中根，入口不显眼。
  - **删除故障的其他可能路径没有排查完**：`addPageFromTemplate` / AI 生成这两条已确认修复；键盘 Delete 在输入框聚焦时被 `isTyping` 拦掉、页面 ✕ 只在多页时出现，这两处是设计如此，但如果用户还有别的操作路径（比如某个遮罩层挡住点击），本地仍无法用真实浏览器复现（沙箱里 headless Edge 崩在 mojo/crashpad 层）。
- **M10 的取舍与已知缺口**：
  - **`componentLabel()` 依赖注册表**：类型名取描述符的中文 `label`，所以 `unregisterComponent()` 之后老文档里的节点会退化成英文类型名；自定义组件（`category: 'custom'`）显示的是注册时的名字，改名会连带改图层里的显示名。
  - **删除入口有五个但没有新的删除逻辑**：键盘 Delete / 右键菜单 / 属性面板危险按钮 / 图层行 🗑 / 顶栏「删除」全部落到 `removeSelection()`，所以「锁定元素要先解锁」「根节点不能删」在多选时仍然只给出「已跳过 N 个」的提示；这轮没有把 `locked` 检查下沉到 `core/ops`（仍按 D58 的入口负责制）。
  - **用户报的「删除故障」在 M11 才定位到真因**：M10 这轮只做了入口显性化；真正能把删除卡死的是「从模板新建页面 / AI 生成页面后自动选中根容器」，M11 已改（D65）。
- **M9 的取舍与已知缺口**：
  - **网格是 CSS 渐变不是真 DOM 网格**：次网格 8px、主网格 64px 两层，间距随 `zoom` 换算（`background-size` 用 `8×zoom` / `64×zoom`），所以缩放到很小（<25%）时细网格会糊成一片淡色、缩到很大时线会变粗；没有做「隐藏网格 / 只留主网格」的开关，也没有参考平台那种标尺。
  - **多选只有虚线包围框**：参考平台是每个选中元素各自描边，这里 `.canvas-multibox` 画一个 `unionOf` 的虚线大框 + 「N 个元素」标签，框内元素自身的选中描边只在单选的元素上出现（多选时用 `data-role="multi-box"` 那份表示）；没有多选属性面板（右侧仍显示单选属性）。
  - **层级点选是「点着往下钻」而不是图层树**：第一次点最外层分区、再点同一处下钻一层、点到底循环回最外层，`Alt+点击` 直达最深；面包屑只显示当前选中链、不能拖；图层树（`LayerPanel`）没有做「点击选父/子」的联动，也没有拖拽排序。
  - **删除保护在 UI 入口做，不在核心层**：`removeSelection()` 过滤 `rootId` 与 `meta.locked`、右键菜单同一份判断置灰，但 `src/core/ops` 的 `removePatches()` 本身仍不检查 locked（直接调 store/ops 的代码需要自己守规矩）；页面级操作的撤销是整份文档快照（D60），连续删多页时内存占用比补丁条目高。
  - **右栏页签是 `v-show` 全挂载**：七个面板常驻内存（为了保住 AI 候选、代码页签这些内部状态），初次渲染比按需 `v-if` 略慢；页签本身不可拖动/重排，面板宽度也不能拖拽调整。
  - **排版只对齐到参考平台的「密度与层级感」**：选中框、手柄、图层行、组件卡片间距、右栏页签是按 `visual-builder/index.html` 的取值抄的，但没有引入它的设计 token/主题系统（我们的颜色走 `src/styles/tokens.css` 的 CSS 变量），两边的深色模式表现也没有逐项比对。
- **M8 的取舍与已知缺口**：
  - **主题 token 只覆盖 4 个颜色字段**（`bg / color / borderColor / shadowColor`）：`fontSize`/`radius`/`lineHeight` 这些数字字段还是普通数字，数字 token（`space-md`）只能在面板里维护、给间距阶梯当参考；没有 token 继承/别名，也没有「改一个 token 预览差异」的对比视图。
  - **分享链接有长度上限**：`MAX_SHARE_LENGTH = 12_000`，超过就返回空串并提示改用顶栏「整站」导出（粗略对应几百个节点的文档）；链接里的文档没有压缩、没有签名，谁拿到链接谁就能读。
  - **版本历史是整份文档快照**：最多 20 条且存在本机 `localStorage`，没有 diff 视图、没有云端同步、换浏览器就没了；隐私模式下保存会静默失败（只在 toast 里提示）。
  - **可访问性是「检查 + 提示」级别**：助手能报对比度 / alt / `label` 关联 / 断点未覆盖，但导出的 HTML 仍是 `<div>` 盒子语义（只有 `button` 与带链接节点是语义标签），没有生成 `<header>/<nav>/<section>` 的大纲映射；键盘支持方向键微调与 Alt+方向键换选中项，没有完整的焦点环与读屏菜单。
  - **性能数字是本机中位数**：`test:perf` 的阈值（布局 8ms、导出 1s）留了余量，但 CI 机器更慢时仍可能抖动；拖动 60fps 只在浏览器里人工感受，没有自动化的帧率断言。
- **M7 的取舍与已知缺口**：
  - **候选不落库，刷新即丢**：文案/素材候选只活在 store 内存里（`aiTextCandidates` / `aiMaterialCandidates` / `aiComponentCandidate`），页面刷新或切换项目后要重新生成；只有「应用」与「注册」的结果进文档/存档。
  - **素材是渐变占位图**：`core/png` 按提示词哈希生成竖渐变图（320×200），不是真实配图也没有素材库检索；`MaterialSource` 里的 `'library'` 目前没有实现来源，图说文字只用来填 `alt`。
  - **自定义组件的 type 与名字不同**：`customTypeOf('团队成员卡片')` 产出 `custom-<ascii-slug 或 FNV 短哈希>`，所以改名等于换 type（旧文档里的实例会变成未注册类型）；`localStorage` 存档同样按 `name` 覆盖同名 DSL。
  - **生成组件只有三种模板**：Mock 按关键词路由到「团队成员卡片 / 价格套餐卡片 / 通用卡片」，没有多轮修改（只能重新描述再生成），也没有「在画布上编辑自定义组件内部」的入口。
  - **token 与费用是估算**：`estimateTokens()` 用「CJK 一字 1 token、ASCII 4 字符 1 token」，只在供应商返回 `usage` 时才用它；`PRICING` 只列了 `gpt-4o-mini` / `gpt-4o` 两个型号，查不到就按 0 记（不编造价钱）。
  - **降级只覆盖「供应商不可用」**：`navigator.onLine === false` 或 provider 类错误才回落规则助手；模型返回的形状错误仍只报错不改走规则助手。
  - `src/ai` 不在覆盖率统计范围内（`vite.config.ts` 的 `coverage.include` 只看 `src/core/**`），它的质量证据是 AI 单测 + 面板组件测试。
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
