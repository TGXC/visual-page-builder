# 架构决策记录（ADR）

> 记录**为什么**这么设计，以及每个决定的代价。上一代表单搭建器的决策已随计划一起归档到 [archive/decisions-v1-表单搭建器.md](archive/decisions-v1-表单搭建器.md)。
> 功能级设计见 [功能文档-v2-可视化页面搭建器.md](功能文档-v2-可视化页面搭建器.md)，里程碑与验收见 [../PLAN.md](../PLAN.md)。

## D1：元素用树（`Record<NodeId, SceneNode>` + `parentId` + `order`），不用扁平数组

**决定**：文档里每个页面持有一张 `nodes` 表：`Record<NodeId, SceneNode>`，节点靠 `parentId` + `order` 组织成树；整页只有**一个** `parentId === null` 的根 frame（`Page.root`）。

**理由**：
- 参考实现 WebBuilder 的 `elements[]` 扁平数组让「组合 / 成组 / 容器内布局 / 层级 z-index」全都做不了（见功能文档 S2、S3）。
- 按 id 查节点 O(1)（后续 `layout`、`codegen`、AI 补丁都要频繁查节点）。
- 跨容器拖动只改两个数字（`parentId` + `order`），补丁天然最小。
- 断点覆盖挂在节点上，树形结构让「继承父级样式」可以自然上溯。

**代价**：
- 数组顺序不再是唯一真相，`order` 必须维护成同级 `0..n-1` 连续 —— 由 `normalizeNodeOrder()` 在每次写入后统一收拾，任何绕过它的代码都会让 JSON 不稳定。
- 层级深了以后「找祖先容器」要上溯（`isDescendantOf` 带 `seen` 防环，因为损坏数据里可能有环）。
- 扁平数组顺序渲染的简单性没了：渲染要按树前序（`treeOf` / `flattenTree`）。

## D2：`Doc.version = 2`，用迁移而不是就地兼容

**决定**：v2 文档必须带 `version: 2` 与 `pages` 数组；v1（WebBuilder 导出 / localStorage 存档）走 `migrateFromWebBuilderV1()` 一次性转换。

**理由**：导入、读档、分享链接、将来的 AI 产出都要先判断「这是什么东西」。有显式版本就能给出可读的错误（「不是有效的项目数据（需要 v2 文档或 WebBuilder v1 项目）」），而不是让半个文档进内存。

**代价**：旧数据不能直接用，必须迁移；迁移逻辑（`migrate.ts`）要长期维护，且它是**单向**的（v2 不再导出成 v1）。

## D3：所有外部输入一律先收敛（`normalizeSchema` / `normalizeDoc`）

**决定**：导入文件、localStorage 存档、将来的 AI 输出，都要先过收敛层才允许进 store。

**理由**：不能信任任何外部来源。收敛层保证内存里的文档永远满足不变量，下游（布局引擎、代码生成、命中测试）就不用到处写防御代码。

**收敛规则**（M0 已实现，逐条有测试）：
- 未知组件类型 → `rect`；缺 id → 生成；重复 id → 换新 id。
- `parentId` 指向不存在 / 指向自己 / 形成环 → 挂回根 frame。
- 同级 `order` 稳定排序后重排成 `0..n-1`；最后整表按树前序规范化数组摆放。
- 坐标 / 尺寸夹取（`MAX_COORD = 100_000`，`w/h ≥ 1`）；文本截断（`MAX_TEXT = 20_000`）。
- 样式只留白名单键；`props` 只留内容键；`meta.hidden/locked` 强制布尔；空 `overrides` 对象删掉。
- 页数 ≤ 50；页名 ≤ 40 字符；`viewport` 夹取 200..10000；`breakpoints` id 去重并按 `minWidth` 降序。

**代价**：收敛会**静默修正**用户数据 —— 一个越界坐标被夹取、一个未知类型被换成矩形，用户不会收到提示。所以收敛逻辑必须逐条有测试（`tests/unit/schemaNormalize.spec.ts` 31 个用例），并且将来要在导入结果里回显「修正了什么」。

## D4：v1 迁移只做保守映射，不猜用户意图

**决定**：`migrateFromWebBuilderV1()` 把 v1 的 22 个属性按白名单分桶到 `style` / `props` / `meta`；未知类型回落 `rect`，越界值夹取，`element.name` 搬进 `meta.name`，`hidden` / `locked` 保留 v1 的 `Boolean(value)` 语义。

**理由**：迁移是用户数据的一次性入口，宁可少搬也不要把语义搬错。v1 的 `normalizeProps` 本来就把 `hidden/locked` 转成布尔、把数值夹到 `0..1000`、把 `align` 限制在 `left/center/right` —— v2 沿用同样的语义，用户看到的隐藏/锁定状态不会因为升级而变化。

**代价**：v1 的某些表达在 v2 里没有等价物（例如「只有 x/y/w/h 的绝对定位」在 v2 里是 `layout.mode = 'free'` 的一种特例），迁移后需要用户在编辑器里手动改成别的布局模式。

## D5：类型叫 `SceneNode`，不叫 `Node`

**决定**：文档节点类型名是 `SceneNode`（`src/core/schema/types.ts`）。

**理由**：`Node` 与 DOM / TypeScript 环境里的全局 `Node` 撞名，`core/` 之外的组件代码迟早会同时用到两者，重名会让类型推断和 import 都变得别扭。

**代价**：与 WebBuilder 术语、与通用「节点」叫法有一点出入，文档和代码注释里需要说明 `SceneNode` 就是页面节点。

## D6：`layout.size` 同时接受嵌套 `{w,h}` 与平铺 `w/h`

**决定**：`normalizeLayout()` 里 `const size = isRecord(source.size) ? source.size : source`，默认用 fallback 尺寸补齐。

**理由**：模型里 `size` 是 `SizeSpec`（`{kind:'fixed'|'hug'|'fill'|'ratio', value?}`），必然嵌套；但手写测试数据、脚本生成的数据、以及 AI 产出的草稿更愿意写成平铺的 `w/h`。两条都收，成本极低。

**代价**：两种写法并存会有歧义风险（`{size:{…}, w: 10}` 时以 `size` 为准）。已在注释与测试里写明。

> 这条决定的来历：M0 第一次跑测试就暴露了一个真 bug —— 原实现直接读 `source.w`，于是所有 `layout.size.w` 都被忽略、永远回落默认值。类型是嵌套的，代码却按平铺读，**只有测试能发现这种不一致**。

## D7：`core/` 禁止 import Vue / 组件 / store，用 ESLint 强制

**决定**：`eslint.config.js` 里对 `src/core/**/*.ts` 开 `no-restricted-imports`，禁止 `vue`、`vue-router`、`pinia`、`@vue/*`、`@/components/*`、`@/stores/*`、`@/composables/*`、`@/fields*`。

**理由**：`core/` 是这个项目唯一能在没有 DOM、没有 Vue 的环境里跑的层（迁移、收敛、布局引擎、代码生成都要能纯函数式测试）。口头约定会腐烂，规则要能被 CI 检查。

**代价**：想在 `core/` 里复用组件层的工具函数时会被挡住，需要先把那个函数挪进 `core/` 或在组件层重新实现。另外容器判断只能靠类型字面量（`type === 'group'`），不能问字段注册表。

## D8：每页唯一根 frame（`Page.root`）

**决定**：一页的 `nodes` 表里恰好有一个 `parentId === null` 的节点，就是 `root`（`type: 'frame'`，尺寸取自 `viewport`），所有顶层元素都是它的子节点。

**理由**：渲染、命中测试、布局计算、导出、断点都需要一个明确的「画布容器」。有唯一根之后，「哪些是顶层元素」= `childrenOf(nodes, root)`，「整棵树」= `treeOf` 从 root 展开，不必特判多根。

**代价**：用户不能在页面上放两个互不相关的根元素（想并排就得放进一个容器）。这一点与 WebBuilder 的「任意绝对定位元素并列」不同，是升级布局能力必须付的代价。

## D9：`Page.nodes` 的键序是规范化的（`canonicalNodes()`）

**决定**：任何重建 `Page.nodes` 的代码路径（补丁应用、收敛、迁移）最后都要过 `canonicalNodes()`：按树前序把键重新排成 `root, 子1, 子1的子…`。

**理由**：JSON 对象键序在 JS 里是「插入顺序」，于是同一份逻辑状态会因为操作历史不同而序列化成不同字符串 —— `remove` 再 `undo` 之后，被删节点会排到末尾。序列化不稳定会让 ① 自动保存反复写盘、② 导出/分享链接的 diff 全是噪声、③ 测试里的字节级断言永远飘。**同一逻辑状态必须序列化成同一份 JSON**，这是 M0 就定下的不变式，`canonicalNodes()` 是它的执行者。

**代价**：每次写入多一次 O(n) 排序；节点的 `order` 与数组摆放顺序是两套秩序，读代码时必须清楚「`order` 决定渲染顺序，键序只决定序列化形状」。

## D10：画布渲染与 HTML 导出共用同一份内联样式（`inlineStyle()`）

**决定**：`core/codegen/inlineStyle(node, backgroundImage?)` 是画布元素与导出 HTML 的唯一样式来源；两边都不再各写一套映射。

**理由**：M1 的验收标准是「导出 HTML 与画布误差 ±1px」。两套映射就是两条会漂移的真相：改一处忘一处，误差立刻出现且很难发现。共用之后，`tests/unit/codegen.spec.ts` 里对内联样式的断言同时就是画布的断言。

**代价**：`inlineStyle` 被迫同时服务两个消费者 —— 画布需要 `position:absolute` 之类的编辑期样式，导出需要干净的产物。解决办法是把它拆成「节点 → CSS 声明串」的纯函数，编辑期特有的样式（选中框、手柄、参考线）留在组件里，不进这个函数。

## D11：拖拽用原生 Pointer Events 手写，不引拖拽库

**决定**：画布交互（移动、8 向缩放、框选、磁吸参考线、从面板拖入、跨容器落点）全部自己实现，只依赖 `pointerdown/pointermove/pointerup` + `setPointerCapture`。

**理由**：用户明确要求「不引拖拽库 / UI 组件库」。而且拖拽库的抽象（draggable/droppable 描述符）和「元素树 + 补丁历史」的模型并不契合：我们需要的是「一次拖拽 = 一条 update/move 补丁，且整段拖拽只入一次历史（400ms 合并窗口）」，用库反而要写适配层去压制它自己的状态。

**代价**：命中测试、缩放方向、磁吸、跨容器判定都要自己写并自己测。已经踩到的两个坑记在 D12/D13。

## D12：Vue 的 Boolean prop 在「没传」时会变成 `false`

**决定**：`ElementView.vue` 的 `interactive` 用 `withDefaults(defineProps<{ interactive?: boolean }>(), { interactive: true })`。

**理由**：Vue 对 Boolean 类型 prop 有一套特殊规则：只要声明成 boolean，**不传就等于传 `false`**（这是为了让 `<Modal disabled>` 这类写法成立）。于是 `props.interactive !== false` 这种「默认开启」的写法永远为 false —— 选中元素时 8 个缩放手柄一个都不渲染，而单元测试查不到（手柄是模板产物），只有组件测试能发现。

**代价**：所有「默认开启的布尔开关」都必须显式写 `withDefaults`，不能靠 `!== false` 兜底。

## D13：事件目标可能不是 Element（`event.target` 上没有 `closest`）

**决定**：`CanvasStage.vue` 里所有 `closest()` 调用都先判 `typeof target?.closest === 'function'`。

**理由**：拖拽期间 `pointermove` 挂在 `window` 上，而 `window` 不是元素、没有 `closest`。原实现直接 `(event.target as HTMLElement).closest(...)`，于是拖拽一开始就抛 `TypeError: event.target?.closest is not a function`，**整段事件处理器中断** —— 拖拽、框选、磁吸全部失效，但控制台之外看不出任何异常。

**代价**：多一层守卫；`event.target` 的类型断言在组件层不再可信。

## D14：断点覆盖里的 `layout` 是 `Partial<LayoutSpec>`

**决定**：`NodeOverride.layout` 类型是 `Partial<LayoutSpec>`（只存与主稿不同的部分），克隆走 `clonePartialLayout()`，不允许当完整 layout 用。

**理由**：覆盖存全量就失去了「覆盖」的意义，也会让「改主稿后覆盖自动跟随」失效。但这条类型约束有个隐蔽后果：`cloneLayout()` 假设 `size`/`position` 一定存在，遇到只写了 `position` 的覆盖直接抛 `TypeError: Cannot read properties of undefined (reading 'w')`。

**代价**：所有读覆盖的地方都要处理 `undefined` 子对象（`node.overrides.mobile?.layout?.position`），M3 落断点编辑时要格外小心。

## D15：store 的 `updateNode` / `updateSelection` 对 `style` / `props` / `meta` 做浅合并

**决定**：属性面板只发「差异」（例如只发 `{ style: { fontSize: 22 } }`），store 侧用 `mergeEdit()` 把它与节点现值浅合并后再打成补丁。`layout` / `overrides` 仍视为整体替换。

**理由**：`updateNode` 原来把 `after.style` 当完整 `StyleSpec` 整体替换。面板改字号只发一个键，结果是**其它样式全部被抹掉** —— 改一次字号，背景色、圆角、阴影同时消失。这类 bug 在类型层面看不出来（`{[key]: value}` 断言成 `StyleSpec` 就能过），只有「先设两个样式、再改第三个键」的测试能抓住。

**代价**：`NodeEdit` 与 `NodePatchData` 成了两个类型：前者允许差量，后者必须是完整值。补丁里的 `before` 必须是节点**当次的完整值**，否则撤销会把节点回退成残缺状态 —— 这条由 `mergeEdit` 统一保证。

## D16：`safeUrl()` 放行光栅图 dataURL，但仍拦 `data:text/html` 与 SVG

**决定**：URL 白名单从「一律拒绝 `data:`」改成「只接受 `data:image/(png|jpe?g|gif|webp|bmp|avif);base64,…`」，其余 `data:` 协议（包括 `data:image/svg+xml`）继续返回空串。

**理由**：B16 的「本地文件」通道把用户选的图片读成 dataURL 写进 `props.src`。原来的一刀切会让通道「写入成功但画布与导出全空」—— 这是功能与安全策略打架，测试里表现为 `expected '…' to contain 'background-image'`。光栅图 dataURL 在 `<img>` / `background-image` 上下文里不能执行脚本，放行是安全的；`data:text/html` 与 `data:image/svg+xml` 能内嵌脚本，导出文件可能被别的工具当文档打开，继续拦。

**代价**：白名单里多了一条需要维护的正则；本地图片会以 base64 进文档，自动保存写 localStorage 时体积明显变大（后续 M7 若做资源库，应改成存 URL 或 IndexedDB）。

## D17：切换视口直接改写文档，但**不进历史栈**

**决定**：`applyViewport(w, h)` 深拷贝当前文档、改写 `Page.viewport` 与根 frame 的 `layout.size`，然后直接替换 `history.base`；`setBreakpoint(id)` 与「自定义宽度」`setViewportWidth(w)` 都走它。`MIN_VIEWPORT = 200` / `MAX_VIEWPORT = 10_000` 定义在 `schema/normalize.ts`，收敛层与 store 共用同一对边界。

**理由**：视口是「看文档的姿势」，不是文档内容。若每次点 768/375 都压一条补丁，用户按三次 `Ctrl+Z` 才撤得回上一次真正的编辑 —— 撤销栈会被视口切换淹没。共用边界则保证「手输 999999 → 收敛层也会夹到 10000」，两侧不会各说各话。

**代价**：切视口无法撤销回上一个宽度；且这条路径绕过了补丁合并，M3 做真正的断点编辑（把覆盖写进 `overrides`）时必须把它重构成可撤销的补丁。

