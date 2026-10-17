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
