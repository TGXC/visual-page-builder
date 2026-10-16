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

### M4 组件体系

**任务**：Group/Container、`core/symbols`（创建组件、实例覆盖白名单、master 编辑态、循环引用检测）、自定义组件、插件式 `ComponentDescriptor`（`toHtml`/`aiDoc`/`overridable`）、组件库扩到 30+（含并入表单字段与校验引擎）。

**验收**：单测（创建/展开/覆盖/还原/循环检测）+ 组件测试（改 master 3 实例同步、注册第三方假组件可拖入可导出）。判据：组件库 ≥30 个且分类+搜索可用。

### M5 产出

**任务**：`core/codegen`（干净 HTML+CSS、语义标签、BEM/原子类可选）、Vue 3 SFC 导出、React JSX（可延后）、静态多页 zip、PNG 保真截图、SEO/元信息。

**验收**：快照测试（HTML/CSS/SFC 关键结构）+ 手动打开导出站点。判据：导出 HTML 无内联样式堆叠、类名可读、能被真实 Vue 项目引用；zip 解压即可打开。

### M6 AI 基础（Mock + 规则助手）

**任务**：`ai/AiProvider`（Mock 必备，OpenAI 兼容端点可选）、`core/assistant` 规则式设计检查（溢出/对比度/间距/尺寸一致/alt/断点未覆盖）与一键修复、一句话生成页面（`PageDraft` + 三重校验）、选区指令编辑（产出 `Patch[]`，只影响选中子树）、AI 操作前自动快照 + 历史标签。

**验收**：Mock provider 单测（合法补丁落库、越界引用拒绝、失败不落库、快照可撤销）+ 组件测试（选区指令后未选中节点 JSON 不变）。判据：不配 key 也能用规则检查与修复；生成失败不污染文档。

### M7 AI 进阶

**任务**：文案/素材生成（候选 → 应用 → 可撤销）、AI 生成自定义组件（受限 DSL + 预览 + 注册到「我的组件」）、调用记录与成本面板、离线降级提示。

**验收**：Mock provider 单测 + 组件测试（候选应用、组件注册、断网降级文案）。注：本里程碑的**真实模型效果需用户提供 key 才能演示**，默认交付以 Mock 证据为准，README 如实标注。

### M8 收尾

**任务**：性能达标（1000 节点拖动 60fps、首屏 gzip 预算、导出耗时）、可访问性检查、主题 token/模板 6 套/版本历史/分享发布、README + decisions + 演示视频 + 部署（静态托管，链接需用户账号）。

**验收**：性能基准脚本输出留档 + `npm run test/lint/build` 全绿 + CI 配置 + 线上或本地生产预览证据。

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
