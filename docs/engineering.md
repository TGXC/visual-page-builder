# 工程与上线说明

> 这些内容从 README 抽出后移到这里保留备查：部署与上线、目录结构、质量数据、架构决策、本机开发环境的坑、已知缺口。
> 面向项目简介与使用的主文档仍是 [README](../README.md)；逐轮开发与验收记录见 [milestones.md](milestones.md)，计划见 [PLAN.md](../PLAN.md)，架构决策（ADR）见 [decisions.md](decisions.md)。

## 部署与上线

纯前端应用：没有后端、没有环境变量、不需要数据库——文档 / 版本历史 / 主题都存在浏览器 `localStorage`，AI 助手默认走离线 Mock。`npm run build` 产出的 `dist/` 可以放到任意静态托管；`vite.config.ts` 里的 `base: './'` 让同一份产物在**根路径、GitHub Pages 项目子路径、自定义域名**下都能直接跑，不用改配置。

- **GitHub Pages（已带工作流，推荐）**：把仓库推到 GitHub → `Settings → Pages → Source` 选 **GitHub Actions** → 之后每次 push `main`，`.github/workflows/deploy.yml` 会自动构建并发布到 `https://<用户名>.github.io/<仓库名>/`。首次需要在该仓库的 Actions 里点一次允许 Pages 部署。
- **Vercel**：导入仓库 → Framework 选 Vite → Build Command `npm run build`、Output Directory `dist`（默认就能识别，无需额外配置）。
- **Netlify**：导入仓库 → Build `npm run build`、Publish `dist`。
- **手动上传**：`npm run build` 后把 `dist/` 整个目录传到 Nginx / 对象存储 / CDN。

持续集成：`.github/workflows/ci.yml` 在每次 push 与 PR 上跑 lint → 单测 → 覆盖率（core 阈值 90%）→ 类型检查 + 构建 → 性能基准 → 导出冒烟，并保留 `dist` 产物。如果仓库名不是 `visual-page-builder`，记得把顶部的 CI badge 地址换成实际仓库。

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
├── decisions.md             # 架构决策记录（ADR，D1–D88）
└── archive/                 # 上一代表单搭建器的 PLAN / 决策 / 蓝图
```

## 质量数据（M23）

| 项目 | 数值 |
| --- | --- |
| 测试 | 52 个文件 / **620 个用例全绿**（含 2 个导出结构快照） |
| 覆盖率 | 语句 97.15% · 分支 90.90% · 函数 97.43% · 行 99.41%（阈值 90；统计范围是 `src/core/**`，AI 编排层 `src/ai` 与 Vue 组件由单测与组件测试覆盖但不在 v8 统计里） |
| 性能（布局，E7） | `npm run test:perf`：1000 节点整树 `computeLayout` 中位数 **4.39ms**（最快 2.97ms；阈值 8ms；同机多轮 2.9–6.3ms，本轮与 dev server 同时跑） |
| 性能（导出，E7） | 1000 节点真实导出链路（CSS 244054 B + HTML 305687 B + 整站 + ZIP 375993 B）中位数 **99.14ms**（最快 84.89ms；阈值 1000ms），分阶段 CSS 30.21 / HTML 33.87 / 整站 31.99 / ZIP 4.39ms（同机多轮 73–160ms） |
| 导出冒烟 | `npm run test:smoke`：落地页导出 `inlineStyles 0`、mediaQueries 2、zip 7317 B（HTML 4520 B / CSS 2950 B），`Expand-Archive` 解压通过 |
| 构建 | 99 modules；JS 294.42 kB（**gzip 101.39 kB**）；CSS 30.40 kB（gzip 5.86 kB） |
| 生产预览 | `npm run build` 后 `npm run preview -- --port 4173`：`/` 200、`/assets/index-*.js` 200、`/assets/index-*.css` 200 |
| 类型 | `vue-tsc -b` 严格模式 0 错误；ESLint 0 error 0 warning |
| CI | `.github/workflows/ci.yml`：lint → test → coverage → build → perf → smoke → 上传 dist |

M9 让 CSS 从 19.87 kB 涨到 22.06 kB（gzip +0.34 kB）、JS 从 275.21 kB 涨到 279.10 kB（gzip +1.16 kB）：网格层、面包屑、包围框、页签与删除保护；M10 又让 CSS 涨到 22.45 kB（+0.39 kB / gzip +0.05 kB）、JS 涨到 279.75 kB（+0.65 kB / gzip +0.18 kB）：中文类型名与两个删除入口；M11 只涨 JS 到 280.48 kB（+0.73 kB / gzip +0.29 kB）、CSS 不变：一个 `computed` 加几处条件渲染；M12 再涨 JS 到 281.01 kB（+0.53 kB / gzip +0.17 kB）、CSS 不变：根底色搬到画布容器 + 删除项 title；M13 让 CSS 涨到 25.91 kB（+3.46 kB / gzip +0.67 kB）、JS 涨到 282.38 kB（+1.37 kB / gzip +0.66 kB）：组件面板折叠、共享输入框样式、以及一整套底色/阴影/分隔线的层次感变量（CSS 是这轮的大头，JS 只多了 `tokenLabel()` 的映射表）；M14 让 CSS 涨到 29.20 kB（+3.29 kB / gzip +0.54 kB）、JS 涨到 284.23 kB（+1.85 kB / gzip +0.58 kB）：画布内容盒的居中/间距规则、此前完全没有样式的 `canvas-el__*` 内容类与 `.el__list /.el__table /.el__tabs` 的画布排版、尺寸预设与缩放下拉（CSS 仍是大头，JS 只多了 `clearPage` / `setViewportHeight` / 预设映射）；M15 让 CSS 再涨到 29.57 kB（+0.37 kB / gzip +0.08 kB）、JS 涨到 284.33 kB（+0.10 kB / gzip +0.02 kB）：把下拉换成数字输入框（`%` 后缀 + 隐藏 spinner）与一个 `Number.isFinite` 守卫；M16 让 CSS 涨到 29.60 kB（+0.03 kB / gzip +0.01 kB）、JS 涨到 284.35 kB（+0.02 kB / gzip +0.01 kB）：只是一条 `transform-origin: 0 0` 与一行注释；M17 让 CSS 涨到 29.73 kB（+0.13 kB / gzip +0.01 kB）、JS 涨到 284.51 kB（+0.16 kB / gzip +0.08 kB）：两条文本内容盒规则 + `Interaction.scale` 字段与 `dragPoint()` 换算；M18 让 CSS 涨到 29.86 kB（+0.13 kB / gzip +0.03 kB）、JS 涨到 285.13 kB（+0.62 kB / gzip +0.30 kB）：原生拖拽拦截、`onDrop` 类型白名单与去重、磁吸阈值换算、状态栏版本角标；M19 让 JS 涨到 285.36 kB（+0.23 kB / gzip +0.09 kB）、CSS 不变（29.86 kB）：只把拖拽起始盒改从 `store.boxes`（绝对几何）取、多存一份相对盒 `rels`；M20 让 CSS 涨到 29.94 kB（+0.08 kB / gzip +0.02 kB）、JS 涨到 286.25 kB（+0.89 kB / gzip +0.24 kB）：`editKey` / `caption` 两个描述符字段与 `captionOf()` 的字符串拼接、行内编辑框按字段读写，加两条表格/角标 CSS。M21 让 CSS 涨到 29.97 kB（+0.03 kB / gzip 持平）、JS 涨到 286.68 kB（+0.43 kB / gzip +0.07 kB）：`customText` 进渲染上下文与六个空态提示的判断、输入类两个描述符的默认值覆盖（`size` / `style` / `props.placeholder`），以及去掉两处透明度、把默认提示文字搬进 `placeholder`。M22 让 CSS 涨到 30.40 kB（+0.43 kB / gzip +0.07 kB）、JS 涨到 289.08 kB（+2.40 kB / gzip +0.82 kB）：面板点选态与右侧只读信息块（新增 `paletteType` 状态、`selectPalette()`、`categoryLabel()` 与一段信息模板）、以及读档时的旧输入类迁移函数。M23 让 JS 涨到 294.42 kB（+5.34 kB / gzip +1.64 kB）、CSS 不变（30.40 kB）：锚定推断（`inferConstraints` / `inferPageConstraints` / `nodesForLayout`）、store 里多一层「当前断点有效节点 → 布局节点」的派生与 `setAbsBox` / `setAbsConstraint` 的坐标收口、属性面板的跨断点适应区（两个下拉 + 提示 + 重置）。十五轮都没有引入任何新依赖。

性能这一轮没有退化：新增的只是 CSS 渐变与两个按钮，不参与布局计算（D57）；导出链路的瓶颈（`childrenOf()` 全表扫描）在 M8 已换成 `childrenIndex()`，仍然远低于 1s 阈值。M13 只改 CSS、样式变量与一个纯函数 `tokenLabel()`，布局与导出耗时都落在 M12 的抖动区间里。M14 同理：改的是画布 CSS 与顶栏按钮，`clearPage()` 只在点击时跑一次 `removePatches()`，`setViewportHeight()` 与既有的 `setViewportWidth()` 同路径且不进历史栈，两者都不参与 1000 节点布局/导出基准的计算。M17 只动了拖拽时的坐标换算（每帧多一次除法、少一次 `getBoundingClientRect()`，反而更轻）与两条文本 CSS 规则，同样不参与布局/导出基准。M18 加的是事件层拦截（`preventDefault` / `dragstart` 拦截 / `onDrop` 早退）与状态栏一个常量，都不在布局/导出热路径上；这一轮导出中位数偏高（149ms）是机器负载抖动，同机多轮区间仍是 85–160ms。M19 只改拖拽起点取哪份盒、多存一份相对盒，每帧 `setBox()` 的写入量不变，同样不参与布局/导出基准，数字也回到 85–160ms 区间内。M20 只改行内编辑写哪个字段、加一个字符串前缀函数与两条 CSS 规则，都不在布局/导出热路径上；导出链路里唯一的变化是 `BASE_CSS` 多了三条表格/角标规则（HTML 每个页面多 ~120 B），实测中位数 108.99ms 落在历史区间内。M21 只改渲染上下文多算一个布尔值、六个空态提示的判断与几处颜色声明，都不在布局/导出热路径上；导出侧 `BASE_CSS` 的 `.el__caption` 反而少了一个 `opacity` 属性（HTML 略小）。实测布局 5.00ms / 导出 145.49ms，落在历史 3.9–6.3ms / 133–160ms 区间内。M22 只加了一个选择态、一段只读信息渲染，以及读档时对输入类做一次线性迁移遍历，都不在布局/导出热路径上；实测布局 4.06ms / 导出 83.13ms，落在历史 2.7–6.3ms / 73–160ms 区间内。M23 只在「当前视口 ≠ 设计视口」时多跑一遍设计帧（`needsDesignPass`），基准断点下与之前完全同路径，锚定推断只在插入 / 读档 / 一键适配时按节点线性跑一次，都不在布局/导出热路径上；导出侧每个媒体查询块多算一次「设计视口布局」，实测布局 4.39ms / 导出 99.14ms，落在历史 2.9–6.3ms / 73–160ms 区间内。


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
M9–M23（计划外体验修订）新增 D57–D88：网格画在缩放层外（两层 8/64px）、删除保护放 `removeSelection()` 入口而不是 `core/ops`、
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
磁吸阈值按缩放换算成固定屏幕像素、状态栏显示界面版本号用于分辨「没生效」还是「缓存」、
拖拽/缩放的起始盒一律取当前断点的绝对盒（`store.boxes`），写回 `setBox()` 时再换回相对父容器内容框的 `rels`、
双击编辑除内部类型外全开放（写哪个字段由描述符 `editKey` 定，看不见文字时用 `.el__caption` 角标显示）、
表格 `th/td` 必须 `text-align: inherit`，否则属性面板的「水平对齐」会被默认值盖掉、
空容器的占位提示只在「文字还是默认值」时出现（`customText` 进渲染上下文，清空也算改过，所以预设文本删得掉）、
输入类的默认文字色从 v1 的占位灰改成正文色、默认提示文字从 `text` 搬到 `placeholder`，占位提示改实色弱化（不再靠 `opacity` 混灰）、
旧文档里停在 v1 灰的输入类在收敛层一次性迁移（字色与 `placeholder` 都改，含断点覆盖）、
组件面板点击只切到「看属性」的选择态（`paletteType` + `selectPalette()`，右侧渲染只读默认属性/说明），拖拽才是唯一插入通道、
断点自适应用「自动锚定 + 手动覆盖优先」（`inferConstraints()` 按几何推断、布局与导出都以基准断点视口为 `reference`、窄断点上有手动覆盖的节点钉成 left/top）、
每页记 `designViewport` 作为约束参考系，导出固定按设计尺寸而不是「当前预览断点」（否则导出会随预览断点变）。

## 本机开发环境的四个坑（Windows + 受限沙箱）

1. **npm 缓存越界**：默认缓存在用户目录，沙箱拒绝写入。仓库根 `.npmrc` 已把缓存重定向到 `.npm-cache`。
2. **Vite 的 `exec('net use')` 走管道会被沙箱拦成 `EPERM`**：跑 `dev / test / build / preview` 前先设垫片
   `NODE_OPTIONS=--require <仓库>\.sandbox\child-process-pipe-shim.cjs`（`.sandbox/` 已在 `.gitignore` 里，Linux CI 不受影响）。
   实测不加垫片时 `npm run build` 会在 `vue-tsc -b` **通过之后**倒在 `vite build`：`failed to load config from vite.config.ts … [plugin externalize-deps] Error: spawn EPERM`（栈顶是 `optimizeSafeRealPathSync`）。
3. **`npm ci` 会删 `node_modules`**：如果 dev/preview 服务还在跑，会报「文件已被占用」并留下半残的依赖树 —— 先停服务再装。
4. **`child_process.fork` 的管道也被沙箱拒绝**（`Error: spawn EPERM`，`errno -4048`）：`fork` 默认用管道作 stdio，而沙箱不允许开命名管道。所以 Vitest 两个配置都显式写 `pool: 'threads'`（worker_threads 不 spawn 进程）——Vitest 5 的默认 pool 是 forks，去掉这行 `npm run test:smoke` 会直接 `no tests / 1 error`。

## 已知缺口 / 未做

- **PLAN.md 的 M0–M8 全部完成，另有十五轮计划外的体验修订（M9 / M10 / M11 / M12 / M13 / M14 / M15 / M16 / M17 / M18 / M19 / M20 / M21 / M22 / M23）**：M8 交付了主题 token、从模板新建页面、版本历史、分享链接、可访问性补充规则与键盘选择、性能基准（布局 + 导出）与 CI；M9 是用户实测后补的画布网格、删除保护、层级选择与右栏排版；M10 是用户第二轮反馈后的类型名中文化与删除入口显性化；M11 是第三轮反馈后定位到的删除故障真因——新建模板页后自动选中了页面根容器；M12 是第四轮反馈后修掉的「模板页网格被根 frame 底色盖住」与「右键空白选中根导致删除项被置灰换文案」；M13 是第五轮反馈后的界面修订——组件面板单列 + 分类折叠、主题变量中文名、输入框浅灰边框、三栏配色/阴影层次；M14 是第六轮反馈后的尺寸与间距修订——视口尺寸显示成「宽 × 高」且高度可改、缩放下拉显示当前档位、一键清空当前页面、组件内文字与边框间距修齐；M15 是第七轮反馈后的缩放修订——百分比从固定档位下拉改成可直接输入具体数值；M16 是第八轮反馈后的缩放原点修复——`transform-origin: 0 0`，缩放下组件/占位文字/多选框不再相对画布偏移；M17 是第九轮反馈后的拖拽与文本修订——拖拽几何改为按下时快照原点与缩放、文本/标题内容盒纵向居中；M18 是第十轮反馈后的手势修订——关掉画布里的原生拖拽与文字选区（那是「拖动时多出一个组件」和偶发漂移的共同根因）、拖入走组件类型白名单、磁吸阈值按缩放换算、状态栏加版本角标；M19 是第十一轮反馈后的拖拽锚点修复——起始盒改取当前断点的绝对几何（`store.boxes`），写回 `setBox()` 时再换回相对父容器内容框的 `rels`；M20 是第十二轮反馈后的编辑与对齐修复——双击编辑对所有组件开放（写哪个字段由 `editKey` 定、看不见文字时用 `.el__caption` 角标显示）、表格 `th/td` 改成继承 `text-align`；M21 是第十三轮反馈后的颜色与预设文本修订——输入类默认文字色改成正文色、默认提示文字搬进 `placeholder`、空态提示只在没改过文字时出现（清空也算改过，所以预设文本删得掉）、占位提示改实色弱化；M22 是第十四轮反馈后的旧文档迁移与面板点选修订——收敛层把旧文档里停在 v1 灰的输入类一次性迁移（字色 + `placeholder`，含断点覆盖），组件面板点击改成只显示默认属性/说明的只读点选态、拖拽仍是唯一插入通道；M23 是第十五轮反馈后的跨断点适配——把休眠的 `Constraints` 接上（编辑器与导出都以基准断点视口为 `reference`）、按几何自动推断锚定并支持插入即带推断/整页一键适配/读档迁移、窄断点上的手动覆盖优先，每页记 `designViewport` 让导出固定按设计尺寸（每轮的用户反馈、根因与验收数字见 [docs/milestones.md](docs/milestones.md)）。下面按里程碑列出仍然存在的取舍与缺口（都是「知道但没做」，不是没发现）。
- **M23 的取舍与已知缺口**：
  - **锚定只能按几何猜意图**：宽/高占比 ≥85% 判成「两端拉伸」、贴边（差 ≤2px）判成「贴右 / 贴底」、居中对齐判成「居中」，其余一律「左上」。这些阈值能覆盖多数排版，但「本想贴左、只是数学上刚好居中」的元素会被判成居中，需要手动改回来；`scale`（等比缩放）刻意不自动推断——按钮/标签缩小后会小得没法看，要缩放得在面板里手动选。
  - **手动优先是「一拖就定死」**：在窄断点上拖过 / 缩过之后，该节点在整条断点级联链上都被钉成 `{left,top}`，之后改桌面布局它不会跟着变；要恢复自适应得点属性面板的「重置」清掉该断点覆盖，或重新执行「整页自动适配」。
  - **导出表达力仍受绝对盒限制**：导出按设计尺寸出一版，媒体查询里只写「与上一级不同」的声明；`scale` 是按「当前盒 / 设计盒」等比缩放，容器 padding / gap 不参与插值，嵌套层级深时误差会逐级累积。真正的流式布局（flex/grid 子项自适应）没有做。
  - **只对「有断点差异」的节点写媒体查询**：桌面/平板/手机都被算成同一坐标的组件不会出现在媒体查询里；如果用户想强制某个组件在手机上隐藏，仍要走 `hidden` 覆盖。
  - **适配结果只有组件测试锁数值**：jsdom 不做真实布局，媒体查询在浏览器里是否真的生效、手机上的观感仍靠目测；`BUILD_TAG` 已改 `M23`，状态栏还是旧版本号就说明是缓存。
- **M22 的取舍与已知缺口**：
  - **旧文档迁移只在收敛层做一次**：已经加载进内存的文档不会重新迁移（刷新页面 / 重新导入才走 `normalizeSchema`），运行中手工构造的补丁也不经过迁移；`#64748B` 被当成「没改过」的字面值，用户若恰好挑了同一个灰会被换成正文色，其它灰阶（如 `#9CA3AF`）保持原样。
  - **`props.text` 搬到 `placeholder` 会清空 `text`**：旧节点如果拿 `text` 当语义 label 用，迁移后 label 没了（旧版本里输入类的 `text` 本来也不在画布/导出显示，所以按「不可见内容」处理）。
  - **面板点选是「轻选择」**：不进撤销栈、不出现在图层面板，切换页面 / 新建 / 撤销后可能还停在点选态（只在画布选择或真正插入时清掉），要退出得点「取消选择」或再点一次该组件。
  - **点选态下右侧只读**：不能「先改默认值再拖进画布」，必须拖进去之后再在属性面板改——这是「点击不插入」的直接代价。
  - **面板高亮只按类型**：同一个类型点选态与画布选中互斥，但面板里没有「当前选中的是哪个实例」的概念（本来也不该有）。
- **M21 的取舍与已知缺口**：
  - **`customText` 判定的是「文字 ≠ 默认值」而不是「用户是否操作过」**：把文字改回默认字面值（比如把容器文字又输回「容器」）会重新显示空态提示，「重置」只能重新拖一个组件；清空则视为改过、提示不会回来。
  - **颜色只改默认值**：已经被用户手改过颜色的节点不受这轮影响（节点样式优先于描述符默认值）；想统一还得在属性面板逐个改，或者改主题变量。
  - **画布与导出的「弱化」是两套实现**：编辑器用实色 `--studio-text-weak`（#475569），导出侧 `.el__muted` 仍是 `opacity: .65`（导出页面没有编辑器 token），两边看上去接近但并不相同。
  - **输入类默认提示从 `text` 搬到 `placeholder`**：与 `V1_DEFAULTS` 迁移表不一致，靠 `tests/unit/components.spec.ts` 的 `M21_OVERRIDES` 锁住；以后若真去改 v1 表，要同步删掉这层覆盖，否则两处会打架。
  - **角标改正文色后更难分辨**：M20 时半透明至少一眼能看出「这是用户输入」，现在容器里的角标和真内容同色，只能靠「空态提示消失」判断自己改过没有；多行 `text` 仍会被 `overflow: hidden` 裁掉。
- **M20 的取舍与已知缺口**：
  - **`editable` 语义被放宽成「除内部类型外全开放」**：自定义组件作者不能再单独关掉某个组件的中文编辑（`editKey` 只能引导写到别的字段）；四个内部类型 `root / page / instance / symbol` 仍然不可双击。
  - **角标只是兜底可视化**：`.el__caption` 是「内容之上」附加的一行半透明小字，多行 `text` 会被 `overflow: hidden` 裁掉，也不适合需要精确预览的组件——这类组件应显式设 `caption: false` 自己渲染文字。
  - **`text` 与 `placeholder` 仍是两个字段**：输入类双击写的是 `placeholder`，想改「语义文案」还得去属性面板改 `text`（很多控件的 `text` 是 label 语义，导出时不显示）。
  - **表格对齐靠继承链**：`th/td` 是 `text-align: inherit`，如果以后给 `.el__table` 或 `tr` 加了对齐规则，单元格会跟着变；`th` 不再有浏览器默认的「表头居中」，用户要自己选。
  - **画布与导出的盒模型仍是两套**：编辑器用 `.canvas-el__content`（flex 内容盒），导出用 `.el`（绝对定位盒），表格/角标两边各维护一份规则，改样式时要同时改 `editor.css` 与 `BASE_CSS`（M5 结构快照会因此更新）。
- **M19 的取舍与已知缺口**：
  - **只有「出现过断点覆盖」的元素才会跳**：没有覆盖时基准几何 = 有效几何，旧代码看不出问题——这解释了前十轮为什么一直没复现到，也意味着这类 bug 的复现条件是「先在新断点上动过元素」。
  - **四种坐标语义并存**：`localPoint()`（指针现在在画布的哪里）、`dragPoint()`（相对按下点移动了多少）、`boxes`（页面绝对）、`rels`（相对父容器内容框）——新写交互逻辑挑错一个就会引入同类漂移；目前靠注释而不是类型/命名来区分。
  - **换父级时不沿用 `rels`**：拖进别的容器后位置由 `core/dnd` 的 `reparentPatches()` 重新换算到新容器内容框，只保证「屏幕上不动」，跨容器的吸附线不保证连续。
  - **磁吸目标仍是所有非隐藏节点**：换成绝对盒后跨容器能对齐了，但嵌套很深时参考线会很多，没有做「只吸可见容器边缘」的过滤。
  - **拖拽正确性仍靠组件测试**：jsdom 不跑真实布局，`store.boxes` 来自 `computeLayout()` 而不是浏览器量出来的矩形，所以只能断言数值（位置/尺寸），真实手感仍要靠浏览器目测；`BUILD_TAG` 已改 `M19`，状态栏若还是旧版本号就是缓存。
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
  - **缩放只解决「等比放大缩小」，没有解决「设备间自适应」**：在桌面/平板/手机之间切换时，画布纸张尺寸变了，但元素仍是 1440 布局下的绝对坐标，超出 `375` 宽的元素会跑到画布外——这块目前只能靠手动断点覆盖（M3 的 `NodeOverride`）逐个调；用户 m11226 问的「组件能否随画布尺寸与设备变化自适应」，我给的答案是三条路线：A 整页按比例 fit（成本小、不是真响应式）、B 切换断点时自动生成一版覆盖再手调（中等）、C 容器流式布局（最真、改动最大），当前未实施；**M23 已按用户选定的 A 落地**——布局/导出以基准断点视口为参考系跑 `Constraints`、几何自动推断锚定、手动覆盖优先（见「M23」与 D87/D88），仍未做的是 C 那种容器内真流式。
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
