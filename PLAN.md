# PLAN v2：可视化页面搭建器（Studio）实施计划

> 需求与设计见 [docs/功能文档-v2-可视化页面搭建器.md](docs/功能文档-v2-可视化页面搭建器.md)
> v1（表单搭建器）的计划与决策已归档到 [docs/archive/PLAN-v1-表单搭建器.md](docs/archive/PLAN-v1-表单搭建器.md) 与 [docs/archive/decisions-v1-表单搭建器.md](docs/archive/decisions-v1-表单搭建器.md)

## 0. 工作模式（用户已确认）

1. 按 **M0 → M8 顺序**推进；每个里程碑做完**跑验收命令**，贴出证据，通过再进下一个。
2. **core/ 先写测试再实现**（TDD）；core 覆盖率 ≥ 90%（vite.config.ts 已设阈值）。
3. 三项已定决定：**当前仓库改造替换**、**M1 完整复刻 WebBuilder 的 18 项能力（不倒退）**、**AI 先只做 Mock + 规则助手**。
4. 每个里程碑一个提交，提交信息含里程碑编号与验收数字。

## 1. 技术栈与硬约束

| 项 | 内容 |
| --- | --- |
| 技术栈 | Vue 3.5 + TypeScript 6（strict）+ Vite 8 + Pinia + Vitest + jsdom |
| 禁止 | 不引拖拽库、不引 UI 组件库；核心逻辑不依赖 DOM 框架 |
| 分层（ESLint 强制） | `src/core/**` 不得 import `vue` / `vue-router` / `pinia` / 组件 / store |
| 统一验收命令 | `npm run test`、`npm run coverage`、`npm run lint`、`npm run build` |
| 本机沙箱 | vite/vitest/build 前需 `$env:NODE_OPTIONS='--require <repo>\.sandbox\child-process-pipe-shim.cjs'`；`npm ci` 前先停 dev/preview 服务 |

## 2. 目标目录结构

```
src/
├── core/                      纯逻辑（不 import Vue），单测覆盖率 ≥90%
│   ├── schema/                types.ts / normalize.ts / migrate.ts / index.ts
│   ├── tree/                  childrenOf / descendants / move / order 规范化
│   ├── patch/                 applyPatch / invertPatch
│   ├── history/               补丁栈 + 合并窗口 + 跳转
│   ├── layout/                computeLayout（free/vertical/horizontal/grid）+ 尺寸求解 + 约束
│   ├── responsive/            断点解析、override 合并（继承 → 有效节点）
│   ├── symbols/               Symbol 展开、实例覆盖、循环检测
│   ├── codegen/               toHtml / CSS / Vue SFC / 静态站点打包
│   └── assistant/             规则式设计检查（纯函数）、AI 结果校验
├── editor/                    画布、拖拽引擎、面板（组件库/图层/属性/布局/断点/主题/AI）
├── runtime/                   预览渲染（与画布共用组件渲染器）
├── ai/                        AiProvider（Mock / OpenAI 兼容 / Ollama）、prompt 模板、调用记录
├── stores/                    document / history / selection / ui / ai
└── styles/                    tokens.css / base.css
tests/
├── unit/                      core 纯逻辑（schema / layout / patch / history / codegen / assistant）
└── component/                 拖拽、面板、渲染、AI 面板
```

> 实际落地结构与上面这张「目标图」有出入（没有单独的 `editor/`、`runtime/` 目录，组件在 `src/components/`；store 收敛成一个 `src/stores/editor.ts`），**最终目录以 [README.md](README.md) 的「目录结构」段为准**；每个里程碑的「实现偏离」段落记录了原因。

## 3. 里程碑

### M0 地基与 v1 迁移

**交付物**
1. 仓库改造：表单搭建器 `src/`/`tests/` 替换为 Studio 骨架；工程地基（strict TS、Vitest、ESLint 分层、CI、`.npmrc`、`.sandbox`）保留复用；`package.json` 名称改为 `visual-page-builder`。
2. `src/core/schema/types.ts`：`Doc`/`Page`/`Node`/`LayoutSpec`/`StyleSpec`/`Breakpoint`/`Patch` 等 v2 类型（`version: 2`）。
3. `src/core/schema/normalize.ts`：`normalizeDoc(raw)` —— 未知类型→`rect`、坐标/尺寸数值收敛、`order` 重排、`parentId` 指向非法→挂根、断点/主题缺省补齐。
4. `src/core/schema/migrate.ts`：`migrateFromWebBuilderV1(rawV1)` —— 把 `{pages:[{id,name,elements:[{id,type,x,y,w,h,props,name}]}]}` 迁成 v2 `Doc`。
5. `src/core/tree/*`（从 v1 项目迁移已验证实现 + 测试）。
6. 最小可运行壳：`App.vue` 顶栏 + 画布占位 + 「导入 WebBuilder 项目 JSON」入口（验证迁移链路真实可用）。
7. `README.md` 改写为 v2（含当前进度表）；`docs/decisions.md` 重新起（v2 决策，附录引用 v1 归档）。

**验收命令与判据**
```powershell
npm run test      # 全绿；含迁移用例
npm run coverage  # core/ 四个指标 ≥90
npm run lint      # 0 error 0 warning
npm run build     # 通过
```
迁移验收（单测逐条断言，fixture 用真实 v1 JSON）：
- 页数与元素数与 v1 一致；`x/y/w/h/type` 逐元素相同；`props` 中 22 个白名单键全部保留、`hidden`/`locked` 转为 `meta.hidden`/`meta.locked`、`name` 保留。
- 层级：v1 扁平元素全部成为根容器的子节点，`order` 等于数组下标。
- 非法输入：`pages` 非数组 / 空数组 / 元素 `type` 非法 / `x` 为 `NaN` / 超 50 页 2000 元素 → 收敛不崩，且返回 `null` 或截断后的合法文档。

### M1 自由画布 MVP（完整复刻 18 项能力，不倒退）

逐项对照表（每项都要有对应测试或手动验收记录）：

| # | 能力 | 验收方式 |
| --- | --- | --- |
| 1 | 15 类组件拖入画布 | 组件测试：拖入后文档节点数 +1、类型/默认尺寸/默认 props 正确 |
| 2 | 移动 + 8 向缩放 + Shift 等比 | 纯函数单测（命中手柄/尺寸计算）+ 组件测试（合成指针事件） |
| 3 | 6px 磁吸参考线 | 纯函数单测：阈值内对齐、超出不动、参考线数据正确 |
| 4 | 框选多选 + 六向对齐 | 单测（矩形相交）+ 组件测试（对齐后坐标一致） |
| 5 | 图层面板：选中/改名/显隐/锁定/上下移层 | 组件测试逐项断言 |
| 6 | 属性面板按类型渲染（22 个白名单属性） | 描述符驱动 + 组件测试（改 props 落到文档） |
| 7 | 多页面标签（新建/切换/删除/改名） | 组件测试 + store 单测 |
| 8 | 视口切换 + 画布缩放 0.25–2 | 单测（zoom 夹取）+ 组件测试 |
| 9 | 60 步以上撤销重做（改为命令式，无 60 步上限） | core/history 单测：往返逐字节一致、合并窗口、跳转 |
| 10 | 3 套内置模板（升级到 6 套） | 单测：模板可加载且规范化后合法 |
| 11 | localStorage 自动保存 + JSON 导入导出 | 单测（防抖/脏数据收敛/往返一致） |
| 12 | HTML 代码生成（M1 先内联，M5 升级为干净 CSS） | 快照测试：结构/文本/样式关键行 |
| 13 | 新窗口预览 / 下载 .html / 复制 | 组件测试：Blob 内容与下载触发 |
| 14 | PNG 截图导出 | 组件测试：调用导出函数且 Blob 非空（Canvas 2D 在 jsdom 用桩） |
| 15 | 图片三通道（本地/URL/清除） | 组件测试：emit 的 props 正确 |
| 16 | 右键菜单 + 格式刷（复制/粘贴样式） | 组件测试：右键项渲染、样式复制后逐键相等 |
| 17 | 快捷键（Ctrl+Z/Y、Ctrl+±/0、Ctrl+滚轮、Delete、方向键） | 组件测试：合成键盘事件后文档/缩放变化 |
| 18 | 状态栏实时坐标 + toast 提示 | 组件测试：拖动中坐标文本变化 |

**验收命令**
```powershell
npm run test      # 含 M1 全部组件测试
npm run lint
npm run build
npm run dev       # 手动：做出一个完整落地页（拖 15 类组件、对齐、多页面、导出 HTML 能打开）
```
**判据**：18 项全部有对应测试或手动记录；导出的 HTML 在浏览器打开与画布一致（±1px 级别）。

### M2 布局引擎

**任务**：`core/layout`（`computeLayout` 纯函数、free/vertical/horizontal/grid、`SizeSpec` fixed/hug/fill/ratio、padding/gap/align/justify/wrap、constraints）、拖拽换父级（几何取最深容器 + 排除自身子孙）、布局面板、插入位指示线与等距提示、`hug` 文本测量（**实现改为离屏 canvas 测量 + 注入，不用 `ResizeObserver`，见 `docs/decisions.md` D19**；无浏览器时估算并标记 `estimated`）。

**验收**
```powershell
npm run test        # 布局引擎表驱动单测；容器 4 种模式；fill/hug/ratio/constraints；换父级
npm run test:perf   # （新增脚本）1000 节点整树 computeLayout < 8ms
npm run build
```
**判据**：1440↔375 宽度下 `fill`/`hug`/`constraints` 行为正确；容器切换布局不丢数据（切回 free 位置还原）。

### M3 响应式断点

**任务**：`core/responsive`（断点定义、`overrides` 继承合并、有效节点求解）、断点切换 UI、覆盖标记与「清除覆盖」、断点感知导出（media query）。

**验收**：单测（继承/覆盖/清除/多断点叠加）+ 组件测试（切断点改属性只写 override）+ 导出断言（HTML 含 media query）。判据：桌面 3 列 → 手机 1 列，互不污染。

**实现偏离（已完成）**：覆盖差异相对「更宽一级的有效值」计算（D26），嵌套 `layout` 子对象整体替换（D27）；导出与预览断点解耦、永远从基准断点导出（D28）；media query 上界取 `minWidth − 0.02` 并用 `!important` + 复位声明（D29）；断点切换用预设视口宽度（D30）。断点目前只有内置 desktop/tablet/mobile，**增删与自定义断点的设置 UI 未做**。

### M4 组件体系

**任务**：Group/Container、`core/symbols`（创建组件、实例覆盖白名单、master 编辑态、循环引用检测）、自定义组件、插件式 `ComponentDescriptor`（`toHtml`/`aiDoc`/`overridable`）、组件库扩到 30+（含并入表单字段与校验引擎）。

**验收**：单测（创建/展开/覆盖/还原/循环检测）+ 组件测试（改 master 3 实例同步、注册第三方假组件可拖入可导出）。判据：组件库 ≥30 个且分类+搜索可用。

**实现偏离（已完成）**：组件库实际 **40 个**（布局 7 / 基础 8 / 表单 12 / 媒体 5 / 展示 8），比计划的 30+ 多出的部分来自「并入表单字段与校验引擎」——校验引擎本身（规则校验、错误提示）未做，只落了字段控件。`ComponentDescriptor` 除了 `toHtml` 还加了 `toCanvasHtml`（画布渲染与导出分开，见 `src/core/components/index.ts`；注册表用 `subscribeRegistry()` 通知面板，D31）。组件与实例：`Doc.symbols` 存定义、页面只存 `instance` 节点，渲染时 `expandInstances()` 展开成合成 id（D32）；master 编辑复用补丁管线（`patch.pageId` 可以是组件 id，D33），创建组件这一步不入撤销栈。**未做**：组件编辑态独立画布（双击进组件的交互）、跨文档组件库、`overridable` 白名单的可视化配置。

### M5 产出

**任务**：`core/codegen`（干净 HTML+CSS、语义标签、BEM/原子类可选）、Vue 3 SFC 导出、React JSX（可延后）、静态多页 zip、PNG 保真截图、SEO/元信息。

**验收**：快照测试（HTML/CSS/SFC 关键结构）+ 手动打开导出站点。判据：导出 HTML 无内联样式堆叠、类名可读、能被真实 Vue 项目引用；zip 解压即可打开。

**实现偏离（已完成）**：导出结构定为 `el el--<类型> n-<节点id>` 三件套类名 + 页面 `.page-<页面id>` 规则，几何与样式全部进 `generatePageCss()`（D34）；断点媒体查询**去掉了 `!important`**，改成同优先级类选择器靠顺序覆盖 + `RESET_DECLARATIONS` 显式复位（D35）；整站打包用自写的 stored ZIP（`core/zip`，CRC-32 + UTF-8 名标记 + 固定时间戳，D36）；SEO 落成可选的文档级字段 `Doc.seo`，由 `normalizeSeo()` 截断兜底（D37）。**未做（按 PLAN 的裁剪优先级推迟，D38）**：React JSX 导出；「PNG 保真截图」——M5 的 PNG 仍是 M1 的 `drawPage()` 近似绘制，要等 M7 的素材/位图管线。另：BEM/原子类只做到「类名可读」这一层，没有做语义化缩写或类名去重；**「语义标签」只落到 `<button type="button">` 与被设了链接的节点外那层 `<a>`**（`src/core/codegen/index.ts:274` 写死这两条），其余节点仍是 `<div>`——`SceneNode.type` 是盒子语义（frame / section / container…）而不是文档大纲语义，要真出 `<header>/<nav>/<section>/<h1>` 得先给描述符或文档加一层 outline 字段，M5 不做；`Doc.seo` 只能从导入的 JSON 手写，编辑器还没有 SEO 表单。

### M6 AI 基础（Mock + 规则助手）

**任务**：`ai/AiProvider`（Mock 必备，OpenAI 兼容端点可选）、`core/assistant` 规则式设计检查（溢出/对比度/间距/尺寸一致/alt/断点未覆盖）与一键修复、一句话生成页面（`PageDraft` + 三重校验）、选区指令编辑（产出 `Patch[]`，只影响选中子树）、AI 操作前自动快照 + 历史标签。

**验收**：Mock provider 单测（合法补丁落库、越界引用拒绝、失败不落库、快照可撤销）+ 组件测试（选区指令后未选中节点 JSON 不变）。判据：不配 key 也能用规则检查与修复；生成失败不污染文档。

**实现偏离（已完成）**：`AiProvider` 定为 `{ id, label, ready, complete(request) }`，Mock 是默认供应商且 `ready: true`（离线可用），OpenAI 兼容端点走 `/chat/completions` + `response_format: json_object`，key 只进请求头、设置存 `localStorage['studio.ai.settings.v1']`（D43）。AI 产出的落库路径是「形状 → `normalizePage`/`normalizeDoc` 收敛（节点数必须不变）→ 自检（水平越界/兄弟重叠/必填 props）」，**必填 props 必须在收敛前查**（`normalizeNode()` 会用 `defaultPropsFor()` 补齐，收敛后永远查不出缺失，D39）；补丁侧 `coercePatches()` 丢弃模型给的 `before` 并从当前文档现取，`scopeProblems()` 把 `update/remove/move` 的目标与 `insert` 的父节点限制在「选区 + 子树」内，空选区优先报 `scope`（D41/D44）。**计划外的改动**：`HistoryEntry` 拆成补丁条目与**文档级条目**（`commitDocEntry()`），否则 AI 新增页面会被 `setDoc()` 的 `createHistory()` 清空历史、无法撤销（D40）；`fixAll()` 改成最多 8 轮迭代，因为一次审计里同规则多条的补丁基于同一份 before，摊平会互相覆盖（D42）。规则检查六条全部落地（溢出/对比度/间距/尺寸一致/alt/断点未覆盖），每条都带可执行补丁。**未做**：多轮对话与上下文记忆、AI 生成自定义组件（M7）、成本面板（M7）、真实模型效果演示（需要用户提供 key，见 M7 注）。

### M7 AI 进阶

**任务**：文案/素材生成（候选 → 应用 → 可撤销）、AI 生成自定义组件（受限 DSL + 预览 + 注册到「我的组件」）、调用记录与成本面板、离线降级提示。

**验收**：Mock provider 单测 + 组件测试（候选应用、组件注册、断网降级文案）。注：本里程碑的**真实模型效果需用户提供 key 才能演示**，默认交付以 Mock 证据为准，README 如实标注。

**实现偏离（已完成）**：三条增强都做成「规则式实现 + Mock 供应商 + 可换真实模型」的同一形状，落库仍旧只走 `commit()`：文案 `textCandidates(prompt, { tone, maxLength })` → `textPatch()` 只改 `props.text`（历史标签 `AI 文案：<前 16 字>`）；素材 `materialCandidates()` 用**新写的 `core/png`**（stored zlib + CRC-32/ADLER-32，`safeUrl()` 放行光栅 dataURL 但拦 SVG）现场生成渐变占位图，`materialPatch()` 写 `props.src` / `props.source = 'generated'` / 补 `alt`（标签 `AI 素材：应用配图`）；生成组件走新的**受限 DSL**（`core/dsl`：`DslNode` 只引用注册表里的组件类型 + 19 个白名单样式键 + `{{prop}}` 占位符，`DSL_MAX_NODES=30 / DEPTH=4 / PROPS=8`）→ `validateDsl()` → `compileDsl()` 编译成 `category: 'custom'` 的普通 `ComponentDescriptor`（新增可选 `cssFor(scope)` 让自定义组件内部结构也能类名化）→ iframe `srcdoc` 预览 → 用户点注册才 `registerComponent()` 并写入 `localStorage['studio.custom.components.v1']`（**只存 DSL 数据，读回来重新编译**，坏条目静默丢弃）。**计划外的改动**：`ComponentCategory` 加 `'custom'`、组件面板空分组不显示、`PalettePanel` 的注册表订阅改用 `registryRevision` 保证 `aiCustomTypes` 能刷新；`AiKind` 加 `'plain' | 'material' | 'component'`，`writeText()` 改走 `'plain'`（`'text'` 保留给候选）。成本做成 `src/ai/usage.ts` 本地估算（CJK 一字 1 token、ASCII 4 字符 1 token；`PRICING` 只列 `gpt-4o-mini` 0.15/0.6 与 `gpt-4o` 2.5/10 USD per 1M，查不到按 0），面板常显「N 次 · N tokens · $N · 模型」；降级是 `src/ai/offline.ts` 只做判定、由 store 在 `outcome.ok === false` 时直接调规则式实现并把 `aiDegraded` 显示出来（未就绪的供应商也会写一条失败日志）。**未做**：多轮对话、素材库检索（`MaterialSource` 的 `'library'` 没有来源）、在画布上编辑自定义组件内部、真实模型效果演示（需要用户提供 key）。

### M8 收尾

**任务**：性能达标（1000 节点拖动 60fps、首屏 gzip 预算、导出耗时）、可访问性检查、主题 token/模板 6 套/版本历史/分享发布、README + decisions + 演示视频 + 部署（静态托管，链接需用户账号）。

**验收**：性能基准脚本输出留档 + `npm run test/lint/build` 全绿 + CI 配置 + 线上或本地生产预览证据。

**实现偏离（已完成）**：主题 token 落在新的 `src/core/theme`（样式里写 `$name`，导出 `var(--name)` + 只在页面真的用到 token 时注入 `:root{}`，画布用 `inlineStyle(…, tokens)` 解析成具体颜色）—— 计划里说「颜色/字号/间距/圆角/阴影」，实际**只支持 4 个颜色字符串字段**（`bg / color / borderColor / shadowColor`），因为 `fontSize`/`radius`/`lineHeight` 是 `number`，改成联合类型会波及 layout / codegen / canvas 全链路（D51）；数字 token 仍在主题面板里维护。模板 6 套 M1 就有了，M8 补的是「从模板新建页面」`pageFromTemplate(doc, id)`（节点 id 加页面前缀防撞、重名加序号、走文档级历史条目因此可撤销）。版本历史 `src/core/versions`（本机最多 20 条、`restoreVersion()` 返回深拷贝）与分享 `src/core/share`（`#doc=` base64url、12000 字符上限、`decodeDoc()` 能吃完整地址、`EditorShell.onMounted` 自动载入）都**不做后端**（D54/D55）。可访问性：助手补第六条规则 `missing-label`（表单类组件无 `label` 也无文案才报），键盘在已有的方向键微调之外加了 **Alt + 方向键换选中项**；导出的 `<div>` 盒子语义没有改成 `<header>/<nav>/<section>` 大纲映射。性能：`tests/perf/export.perf.spec.ts` 覆盖 1000 节点导出链路并打印分阶段中位数，**首跑 898.66ms → 优化后 73–80ms**（`core/tree` 加 `childrenIndex()`、`renderContext().children` 改懒计算、`buildSite()` 复用激活页 HTML，导出字节数不变，D53）。CI 补 `.github/workflows/ci.yml`（lint → test → coverage → build → perf → smoke → 上传 dist）与 `scripts/sandbox-shim.cjs`（存在性判断垫片，沙箱与 CI 同一条命令，D56）。**未做**：演示视频、线上静态托管部署（需要用户账号）、拖动 60fps 的自动化帧率断言（只在浏览器里人工感受）、版本 diff 视图、token 别名/继承。

### M9 体验修订（计划外，用户实测反馈）

**触发**：用户拿实际产物跟参考平台（`D:\AI工作区\项目\visual-builder`）对比后给出四条反馈——「画布没有格子」「模板的删除功能有问题，要么删不掉，要么删不完」「各选择功能项的 UI 和排版看着很不舒服」。M0–M8 的计划里没有这一轮，属于上线前的体验补齐。

**做了什么**：① 画布网格（次网格 8px + 主网格 64px，画在缩放层外、间距随 zoom 换算，D57）；② 删除保护（选中根节点 Delete 会崩画布的真 bug 修掉，`removeSelection()` 统一过滤根与 `meta.locked`，右键菜单同一份判断置灰、单选属性面板补删除按钮，D58/D62）；③ 页面级操作（新建 / 重命名 / 删除页 / 载入模板）从 `setDoc()` 改成 `commitDoc()` 文档级历史条目，撤销栈不再被清空（D60）；④ 树形文档的选择难问题（层级点选：第一次选最外层分区、再点下钻、到底循环；`Alt+点击` 直达深层；面包屑；`Esc` 退层；多选包围框；框选改为「命中祖先就只选祖先」，D59）；⑤ 排版对齐参考平台（右栏七块面板竖着堆 → 页签 + `v-show` 保持挂载，D61；选中框 `outline: 2px + offset -2px`、蓝底白圈手柄、红色虚线磁吸线、图层行/组件卡片间距与 hover）。

**验收**：新增 `tests/component/selection.spec.ts`（11 例，含白屏回归、根/锁定删除保护、级联删除 + undo 逐字节还原、页面级操作可撤销、面包屑与 Alt 深选）；全量 `npm test` 50 文件 / 568 用例、覆盖率 97.18 / 90.5 / 97.37 / 99.35、`lint` 0、`build` 0 类型错误、`test:perf` 布局 3.54ms / 导出 70.92ms、`test:smoke` 通过。**未做**：拖动 60fps 的自动化帧率断言、多选统一外框只做了虚线包围框（没有做参考平台那种逐元素描边叠加）、图层树拖拽排序、面板宽度可拖拽调整。

### M10 类型名中文化与删除入口（计划外，用户第二轮反馈）

**触发**：M9 交付后用户回复「图层中的英文换成中文，删除功能故障依然没有修复」——两条都是 M9 没覆盖到的：M9 只改了选择/删除的**保护逻辑**，没改图层里的类型文案；而「删除故障」这次按 M9 的修法（键盘 Delete / 右键菜单 / 属性面板按钮）在本地复现不出来。

**做了什么**：① `core/components` 新增 `componentLabel(type)`（取描述符中文 `label`，未注册类型原样返回），图层行 / 属性面板 `prop-type` / 画布单选角标 / 层级面包屑四处统一改用它（D63）；② 删除入口显性化：图层每行加 🗑（先 `select` 再 `removeSelection()`）、顶栏撤销旁加「🗑 删除」（无选中禁用），与既有三处共用同一条有边界检查的删除路径（D64）。

**验收**：新增 `tests/component/layers.spec.ts`（6 例：中文类型名、未知类型回落、属性面板文案、图层删除级联、锁定元素给提示、顶栏按钮禁用与删除）；全量 `npm test` 51 文件 / 574 用例、覆盖率 97.18 / 90.51 / 97.37 / 99.35、`lint` 0、`build` 0 类型错误、`test:perf` 布局 5.78–6.17ms / 导出 127.02ms、`test:smoke` 通过。**未做**：没能复现用户报的那次「删除故障」（开发环境拿不到浏览器现场：headless Edge 被沙箱拦在 mojo 层、opencli 扩展未连接），因此没有定位到具体崩溃点，只做了入口显性化与组件测试锁行为；`locked` 检查仍留在 UI 入口，没有下沉到 `core/ops`。

### M11 删除故障的真因：新建页面后自动选中根容器（计划外，用户第三轮反馈）

**触发**：用户第三轮反馈「显示根节点不能删除，但那也不是网格画布，而是一个矩形」。这句话是钥匙——他看到的是一个**被选中的矩形**，却收到「根节点不能删除」的提示。

**诊断**：用组件测试探针（`tests/component/zzProbeM11.spec.ts`，跑完已删）逐个入口试：点画布矩形 + Delete 能删（D 场景）、框选 + Delete 能删（E 场景）、图层行 + Delete 能删（C 场景）、空白/根上按下不选根（B 场景）；只有「从模板新建页面」这一条会 `selected=[新页 rootId]`，再按 Delete 恒定得到 toast「根节点不能删除」，页面节点数不变（A 场景）。对应代码是 `addPageFromTemplate()` 与 `aiGeneratePage()` 里的 `selectedIds.value = [page.root]`——根 frame 的选中框在画布上就是一片大矩形，「模板的删除功能有问题 / 删不掉」从这个状态得到完整解释。

**做了什么**：① 两处改成提交后清空选区（D65）；② store 新增 `canRemoveSelection`（选区里至少有非根、非锁定节点），顶栏删除按钮、属性面板危险按钮、右键菜单删除项按它置灰；③ `removeSelection()` 根被选中时的提示改成「这是页面画布本身（根容器），删不掉；要删的是画布里的元素」；④ 属性面板选中根时显示 `data-role="root-hint"` 提示。

**验收**：`tests/component/selection.spec.ts` 增 3 例（新建模板页后不选中根且 Delete 不产生「根」提示、模板页上的真实元素 Delete 能删掉、只有根被选中时按钮禁用且出现画布提示）；全量 `npm test` 51 文件 / 577 用例、覆盖率 97.18 / 90.56 / 97.37 / 99.35、`lint` 0、`build` 0 类型错误（JS 280.48 kB / gzip 96.71，CSS 22.45 kB 不变）、`test:perf` 布局 3.92ms / 导出 98.58ms、`test:smoke` 通过。**未做**：`store.select(rootId)` 本身仍合法（改页面背景要用它），没有做独立的「页面设置」入口；键盘 Delete 在输入框聚焦时仍被 `isTyping` 拦掉、页面 ✕ 仍只在多页时出现（设计如此）。


### M12 模板页上的网格与右键删除（计划外，用户第四轮反馈）

**触发**：用户第四轮反馈「但此时画布的方格没了，而且右键为什么没有删除选项了」。这两条都只在模板页上出现，是 M11 改动之后暴露出来的。

**根因**：① 模板的根 frame 自带不透明底色（`frame()` 默认 `#FFFFFF`，landing `#FFFFFF`、login `#F8FAFC`、profile `#0F172A`），它铺满整页、渲染在网格层之上，把网格整个盖住；空白项目的根 `bg` 是空串，所以只有模板页看不见格子。② 右键页面空白处命中的是根 frame，`onStageContextMenu` 把它塞进选区，而删除项自 M11 起在不可删时会把文案换成「这是页面画布，删不掉」——用户看到的就是「右键菜单里没有删除」。探针（`zzProbeM12*.spec.ts`，跑完已删）逐项确认：右键矩形 → 删除可用；右键根 → `text="这是页面画布，删不掉" disabled=true`；模板页根元素 style 带 `background: rgb(255,255,255)`。

**做了什么**：① 根 frame 的底色改由 `.canvas-page` 承担（`CanvasStage` 新增 `pageStyle` computed，用 `resolveStyle()` 解析根节点样式后只取 `bg` 与 `radius`），`ElementView` 对 `parentId === null` 的根节点用摘掉 `bg` 的副本调 `inlineStyle()`，网格层因此回到页面底色与元素之间（D66）；② `onStageContextMenu` 命中根 frame 时不再改选区（视为右键空白，保不住原选中元素的删除入口也一并保住）；③ 右键菜单删除项的文案固定为「删除」，不可用的原因写进按钮 `title`（未选中 / 根容器 / 已锁定三种）。

**验收**：新增 `tests/component/contextmenu.spec.ts` 5 例（右键元素可删、右键根不改选区且置灰带 title、已选中元素后右键空白仍可删、右键锁定元素置灰、根被程序性选中时文案仍是「删除」）+ `selection.spec.ts` 增 2 例（模板页 `.canvas-page` 有 `background` 且根元素没有、网格层是 `.canvas-page` 首子元素），全量 `npm test` 52 文件 / 584 用例、覆盖率 97.18 / 90.56 / 97.37 / 99.35、`lint` 0、`build` 0 类型错误（JS 281.01 kB / gzip 96.88，CSS 22.45 kB 不变）、`test:perf` 布局 4.95ms / 导出 131.58ms、`test:smoke` 通过（`inlineStyles 0` / `mediaQueries 2` / `zipBytes 6905`）。**未做**：根 frame 的底色画布与导出仍是两条路径；根圆角搬到 `.canvas-page` 但容器没有 `overflow: hidden`（根圆角很大时子元素会溢出圆角）；右键空白不再选根，所以改页面背景仍得走图层/主题面板；网格线颜色固定浅灰，深色模板页上偏亮，也没有隐藏网格开关。


### M13 组件面板与视觉层次（计划外，用户第五轮反馈）

**触发**：用户第五轮反馈「我们的平台组件似乎过多了，且一行两个组件选项会导致组件名称显示不全，建议改成一行一个，主题方面英文太多了，而且平台几乎所有的输入框边框太黑了，弄成浅灰色，且整个平台一眼望去白茫茫一片，我希望有点层次感」。

**现状/根因**：① 左栏只有 176px 却放两列组件，`.palette-item__label` 只能靠省略号截断，40 个组件平铺又显得多；② `.editor-input` 这个类在 CSS 里**从来没有规则**，AI 面板 / 主题面板 / 历史 / 分享 / 页模板下拉 / 顶栏视口宽度全都在吃浏览器默认的深灰 2px 边框；③ 主题面板直接显示 `color-primary` 这类英文 token 名；④ 顶栏、左右侧栏、属性面板全是白底 + 1px 边框，画布区分隔又很淡，整屏白成一片，而 `tokens.css` 里还缺 `--studio-text-muted` / `--studio-surface-2`，全靠 `editor.css` 的 fallback 兜着。

**做了什么**：① 组件面板改单列（`grid-template-columns: minmax(0, 1fr)`，左栏 176px → 200px），分类标题变成可点开的横条（▾/▸ + 名字 + 个数，`data-role="palette-toggle-<key>"`），默认收起表单（12 个）与媒体（5 个），搜索时全部展开；折叠用 `v-show` 保住 DOM，40 个 `.palette-item`、搜索行为与自定义组件断言都不受影响（D67）；② `core/theme` 新增纯函数 `tokenLabel()`（后缀 → 中文再拼组名，得到「主色 / 小圆角 / 大间距」，认不出的后缀回落「圆角·huge」），主题面板主标题显示中文名、原始英文名以等宽小字留在下面供样式引用（D69）；③ 补共享 `.editor-input` 规则（1px 浅灰 `#dbe2ea`、focus 主色边 + 光晕、hover 加深、`select` 自绘 chevron、`textarea` 自适应、`.editor-input--width`），`.prop-input` 同步；④ `tokens.css` 重写并补齐 `--studio-text-muted` / `--studio-surface-2/3` / `--studio-border-soft/strong` / `--studio-input-border` / `--studio-shadow-sm`，再给外壳加层次：顶栏白底 + 投影、左右侧栏浅灰、`.panel` 变白卡片（细边 + 轻投影 + 标题分隔线）、画布区内阴影 + 更深的纸张投影、状态栏浅灰、选中页签白底 + 主色下划线（D68）。

**验收**：新增 3 例（`tests/unit/theme.spec.ts` 的 `tokenLabel` 全量映射与回落、`tests/component/editor.spec.ts` 的分类折叠/点开/搜索全开、`tests/component/m8.spec.ts` 的主题变量中文名 + 英文原名保留），全量 `npm test` 52 文件 / 587 用例、覆盖率 97.20 / 90.61 / 97.38 / 99.35、`lint` 0、`build` 0 类型错误（JS 282.38 kB / gzip 97.54，CSS 25.91 kB / gzip 5.10）、`test:perf` 布局 4.78ms / 导出 117.87ms、`test:smoke` 通过（`mediaQueries 2` / `layoutBoxes 10` / `zipBytes 6905`）。**未做**：折叠状态不持久化（刷新回默认），也没有做搜索置顶/常用组件；主题中文名只影响显示，样式引用与导出仍是英文 token；输入框样式分在 `.editor-input` / `.prop-input` 两处，`color`/`range` 这类原生控件没统一；层次感靠 tokens + `editor.css` 里的硬编码颜色，没有浅色/深色两套主题；网格线颜色仍固定浅灰。


### M14 尺寸显示、缩放档位、一键清空与内容盒间距（计划外，用户第六轮反馈）

**触发**：用户第六轮反馈「我们的平台的尺寸选择应是类似于1440*900之类的展示形式，且关于缩放设置那只有100%，+-我都不知道加减到多少%，加上一键清除功能，部分组件内的文字或提示字体与上下边框的距离并不一致」。

**现状/根因**：① 顶栏只有一个宽度输入框 + 「桌面 1440」，高度在界面上既看不见也改不了，而 `Page.viewport` 本来就是宽高成对的（画布纸张与导出 body 都用它）；② 缩放的中间按钮是写死的 `<button data-role="zoom-reset">100%</button>`，不是当前档位，`－`/`＋` 没有 title 说明范围，用户看不出 25%–200% 的边界；③ 没有「清空当前页面」入口，删一页元素只能逐个框选或逐个删；④ 画布内容盒 `.canvas-el__content` 没有 `box-sizing`，`height: 100%` + 8px 上下 padding 在 content-box 下多出 16px 被 `overflow: hidden` 裁掉，视觉上变成「上边距 8、下边距 0」；同时画布里的 `canvas-el__title / __muted / __sub / __caret / __choice / __box / __dot / __switch / __play` 等类此前**一条 CSS 规则都没有**（导出侧反而有 `.el__title` / `.el__muted` / `.sub`），于是副标题与正文同字号、提示文字不变灰、下拉箭头紧贴文字、列表/表格/标签页用浏览器默认排版。

**做了什么**：① 尺寸区改成「三个两行预设按钮（桌面 / 平板 / 手机 + `1440 × 900`）+ 宽输入 × 高输入 + 当前尺寸文本」，`VIEWPORTS.label` 只留预设名，`[data-role="viewport-label"]` 显示 `${w} × ${h}`；store 新增 `setViewportHeight()`（夹取 200–10000 后复用 `applyViewport()`），与既有 `setViewportWidth()` 同路径（D70）；② 缩放中间换成 `[data-role="zoom-select"]` 下拉（25 / 50 / 75 / 100 / 125 / 150 / 175 / 200%，非整档如「适应」算出的 113% 会插进候选），`－`/`＋` 加 title 写明「范围 25%–200%，每次 25%」，删掉写死的 100% 按钮（D70）；③ store 新增 `canClearPage` 与 `clearPage()`：取根容器全部直接子节点 → `removePatches()` 级联删整棵子树 → 作为**一条**文档补丁 `commit('清空页面（N 个元素）', patches)` → 清空选区 → toast 提示可 Ctrl+Z 撤销；顶栏加 `[data-role="toolbar-clear"]` 按钮，空页面自动置灰（D71）；④ `.canvas-el__content` 改 `box-sizing: border-box` + flex 纵向，按 `data-type` 给单行控件（button / badge / label / link / input / select / date / number / file / switch / alert / tabs / nav / audio / slider）横向 + `align-items: center`，图标/头像/视频居中，复选/单选横排换行；补齐上面那批 `canvas-el__*` 类与画布里 `.el__list / .el__table / .el__tabs` 的基础排版（导出侧 BASE_CSS 一字未动，保住两个结构快照）（D72）。

**验收**：把原「视口切换与画布缩放互相独立」1 例拆成 5 例（尺寸显示宽 × 高、视口高度单独可改、高度越界夹取、缩放下拉切换与上下限、一键清空 + Ctrl+Z 撤销），全量 `npm test` 52 文件 / 591 用例、覆盖率 97.20 / 90.61 / 97.38 / 99.35、`lint` 0、`build` 0 类型错误（JS 284.23 kB / gzip 98.12，CSS 29.20 kB / gzip 5.64）、`test:perf` 布局 5.12ms / 导出 128.84ms（CSS 40.09 / HTML 44.17 / 整站 42.25 / ZIP 6.89ms）、`test:smoke` 通过（`mediaQueries 2` / `layoutBoxes 10` / `zipBytes 6905`）。**未做**：视口高度不参与响应式断点（断点只按 `minWidth` 判定）也不影响导出媒体查询；一键清空只清当前页面元素，不清页面背景/主题/尺寸，也不是「清空项目」；画布与导出仍是两套盒模型（导出没有那层 padding/flex，`layout.padding` 也不参与导出）；单行控件居中按 `data-type` 白名单维护，注册新组件类型时要记得加进去。


### M15 缩放百分比可输入（计划外，用户第七轮反馈）

**触发**：用户第七轮反馈「百分比改为我能输入具体数值」。上一轮只是把写死的 `100%` 换成固定档位下拉，能看见状态但选不到 113% 这类中间值。

**做了什么**：把 `[data-role="zoom-select"]` 下拉换成 `[data-role="zoom-input"]` 数字输入框（`min=25 max=200 step=1`，右侧绝对定位 `%` 后缀，隐藏 number 自带的上下箭头），`@change` 时 `store.setZoom(Number(raw)/100)` 再把框里的值回写成夹取后的真实百分比，回车触发 blur 让 `@change` 生效；`－`/`＋`（每次 25%）与「适应」保持不变；`store.setZoom()` 增加 `Number.isFinite` 守卫（此前传入 `NaN` 会把 `zoom` 污染成 `NaN`，画布宽度与状态栏一起坏掉）（D73）。

**验收**：`tests/component/editor.spec.ts` 的缩放用例改成「显示当前百分比 → 手输非整档 37% → 清空输入不改缩放 → 越界夹到 200% / 25%」，全量 `npm test` 52 文件 / 591 用例、覆盖率 97.20 / 90.61 / 97.38 / 99.35、`lint` 0、`build` 0 类型错误（JS 284.33 kB / gzip 98.14，CSS 29.57 kB / gzip 5.72）、`test:perf` 布局 4.96ms / 导出 139.99ms（CSS 41.98 / HTML 44.83 / 整站 41.71 / ZIP 2.84ms）、`test:smoke` 通过（`mediaQueries 2` / `zipBytes 6905`）。**未做**：没有历史值记忆、没有输入防抖；越界值静默夹取不提示；缩放范围仍是 25%–200%，超宽设计稿没法缩到 10% 全览。


### M16 缩放层原点修复（计划外，用户第八轮反馈）

**触发**：用户第八轮反馈「当我进行缩放时，组件与画布的相对位置会改变，会错位，且『从左侧拖入组件开始搭建』字样也会偏移，蓝色虚线框与画布并不重合」，并追问「能否让画布上的组件也适配画布的尺寸变化与电脑、手机、平板间的相互适应」——后者先只给答案不改代码。

**根因**：`.canvas-page__inner`（宽高恒为设计尺寸 `vw × vh`，用 `transform: scale(zoom)` 缩放）**没有写 `transform-origin`**，CSS 默认 `50% 50%`，zoom=50% 时内容以中心为轴收缩、整体偏移 `(1−zoom) × 1440 / 2 = 360px`；而外层 `.canvas-page` 的宽高已经是 `vw × zoom` 并居中，于是元素、占位文字、多选框、吸附线、框选矩形全部相对画布边界错开。`localPoint()` 用 `.canvas-page` 的 `getBoundingClientRect()` 除以 zoom 换算坐标，同样依赖「缩放原点 = 容器左上角」。

**做了什么**：`CanvasStage.vue` 的缩放层加内联 `transformOrigin: '0 0'`（并写注释说明为什么不能吃默认的中心原点），`editor.css` 的 `.canvas-page__inner` 再补一条 `transform-origin: 0 0`；`tests/component/editor.spec.ts` 新增 1 例：断言 `transformOrigin === '0 0'`、缩到 75% 时 `.canvas-page` 宽 1080px、缩放层仍是 1440×900（D74）。

**验收**：`npm test` 52 文件 / 592 用例、覆盖率 97.20 / 90.61 / 97.38 / 99.35、`lint` 0、`build` 0 类型错误（JS 284.35 kB / gzip 98.15，CSS 29.60 kB / gzip 5.73）、`test:perf` 布局 4.25ms / 导出 116.54ms（CSS 35.47 / HTML 39.23 / 整站 37.83 / ZIP 5.58ms）、`test:smoke` 通过（`mediaQueries 2` / `zipBytes 6905`）。**未做**：设备间自适应仍未实现（现状只有手动断点覆盖；候选路线 A 整页等比 fit / B 切断点自动生成覆盖 / C 容器流式布局，尚未选型）；正确性依赖「外层尺寸 = 设计尺寸 × zoom」与「原点在左上角」两个约定；`transform-origin` 写在内联与 CSS 两处；jsdom 无布局，测试只能断言内联样式，真实像素对齐靠浏览器目测。

### M17 拖拽几何快照与文本纵向居中（计划外，用户第九轮反馈）

**触发**：用户第九轮反馈「文本组件的文本上下边框的间距依然偏下，在不同的尺寸下，当我用鼠标拖动组件时，组件与鼠标的相对位置会改变」。

**根因**：①文本/标题的内容盒上下各 8px 内边距，而 `line-height: 1.4` 的行盒常比「元素高 − 16px」高，溢出被 `overflow: hidden` 从下面裁掉 → 上边距 8px、下边距 0，文字偏下；②拖拽时每次 `pointermove` 都用 `localPoint()` 实时读 `.canvas-page` 的矩形再除以当前 zoom 算绝对坐标；拖拽期间画布容器一旦位移（滚动条出现/消失把居中的页面挤动、窗口尺寸变化），「现在原点」与「按下原点」不同，位移里多算一份容器位移，缩放越大漂移越明显。

**做了什么**：`CanvasStage.vue` 的 `Interaction` 增加 `scale`（按下时的 zoom），新增 `dragPoint(active, clientX, clientY)` = `startLocal + (client − startClient) / scale`，移动/拉手柄/框选三条路径全部改用它（`store.pointer` 悬停指示仍用实时 `localPoint()`）；`editor.css` 给 `text` / `heading` 内容盒 `justify-content: center; padding: 2px 8px`；`tests/component/editor.spec.ts` 新增 2 例：「50% 缩放时拖 100 屏幕像素 = 移动 200 设计像素」「拖到一半画布被挤动 120px，元素仍跟手」（D75 / D76）。

**验收**：`npm test` 52 文件 / 594 用例、覆盖率 97.20 / 90.61 / 97.38 / 99.35、`lint` 0、`build` 0 类型错误（JS 284.51 kB / gzip 98.23，CSS 29.73 kB / gzip 5.74）、`test:perf` 布局 6.47ms / 导出 132.17ms（CSS 40.30 / HTML 41.55 / 整站 43.02 / ZIP 6.51ms）、`test:smoke` 通过。**未做**：拖拽期间坐标系被冻结（拖到一半滚动画布不会跟着滚动后的坐标系走，这是有意的）；`localPoint()` 与 `dragPoint()` 两套坐标语义并存；文本居中只是 CSS 修正、jsdom 锁不住，仍靠浏览器目测，多行文本在画布上是垂直居中而导出侧仍是顶部对齐；画布与导出的盒模型仍是两套。


## 4. 数据模型约定（v2 关键约束）

- `Doc.version === 2`；导入任何来源（文件 / localStorage / AI / v1 迁移）都先过 `normalizeDoc`。
- 节点存 `Record<NodeId, Node>`，`parentId` + `order` 表达层级与顺序；`order` 规范化后必须连续 `0..n-1`。
- 样式与属性分离：`style`（受控样式，可引用主题 token）+ `props`（组件语义属性）。
- 断点覆盖只存差异：`Node.overrides[breakpointId]`，空对象视为无覆盖（保证「同一逻辑状态序列化成同一份 JSON」）。
- 所有文档变更走 `commit(label, patch, mergeKey?)` 单一出口。

## 5. 砍需求优先级

M7 AI 生成组件 → M7 素材生成 → M5 React JSX 导出 → M3 断点高级项（多断点叠加） → M4 自定义组件（保留 Symbol） → M1 的 PNG 截图/格式刷（最后手段）。

## 6. 提交规范

每个里程碑一个提交：`M<n>: <做什么>（<关键数字>）`，例如 `M1: 自由画布 MVP 复刻 18 项能力（xx 用例全绿）`。
