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

## D18：`TextMeasure` 允许返回 `undefined`

**决定**：`export type TextMeasure = (node: SceneNode, available: { w: number }) => { w: number; h: number } | undefined`；`hugSize()` 写成 `const measured = input.measure?.(node, { w: available.w }); if (measured) return measured`，拿不到测量值时退回 `estimateTextSize()` 并把节点 id 记进 `estimated`。

**理由**：测量依赖 Canvas，jsdom / 无 `document` 的环境拿不到上下文，`measureText` 必须能诚实地说「量不了」。原来的写法 `if (input.measure) return input.measure(...)` 把 `undefined` 当尺寸返回，`placeFree()` 一读 `.w` / `.h` 就 `TypeError: Cannot read properties of undefined (reading 'h')` —— 类型上 `measure` 返回 `{w,h}` 看不出这个问题，只有把真实测量接进 store（`npm run test` 的组件用例）才会崩。

**代价**：`LayoutResult.estimated` 变成必须消费的数据（UI 要能标出「这个是估算的」）；测量函数的调用方必须处理 `undefined`。

## D19：折行测量放在 `src/utils/textMeasure.ts`，用离屏 canvas 而不是 `ResizeObserver`

**决定**：`measureText` 每次调用现取一个离屏 `<canvas>` 的 2D 上下文（`createTextMeasurer(context)` 负责贪心折行与缓存，缓存上限 800，满则整体清空），按 `(文本, 字号, 可用宽度)` 计算尺寸；`src/core/**` 不引入它，只通过 `LayoutInput.measure` 注入。jsdom / 无 `document` 直接返回 `null`（避免 jsdom 打 `getContext` 的噪音）。

**理由**：`core/layout` 必须保持纯函数（ESLint 分层禁令），而测量要碰 `document`，所以宿主侧实现、core 侧注入。PLAN 里写的是 `ResizeObserver`，但测量本身是纯函数：可用宽度由布局趟给出，任何容器尺寸变化都会重算整棵树，不需要观察 DOM 尺寸；`ResizeObserver` 只能告诉我们「元素变了」，拿不到「文本该多宽」。没有 Canvas 时用字符估算并标记 `estimated`，符合「无浏览器时估算并标记」的判据。

**代价**：字体族固定为 `FONT_STACK`（受控样式里没有 `fontFamily`），与浏览器真实字体栈可能有细微差异；缓存整体清空是笨办法，文本量极大时会重复测量。

## D20：`ratio` 的 value 语义是 w/h

**决定**：`SizeSpec.value`（`kind === 'ratio'`）表示宽高比 w/h。已知高求宽要**乘**（`ratioTimes`），已知宽求高要**除**（`ratioOf`）；两个轴都是 ratio 时以可用宽度为基准取宽、按 h 轴的比例反算高（语义本身有歧义，取宽为准）；value 缺省 / 0 / 负数一律按 1 处理。

**理由**：原来 `resolveSize()` 对 w 轴也走 `ratioOf(sw, h)`，即 `w = h / ratio` —— 与 h 轴的公式自相矛盾（同一份 `types.ts` 注释写的是 w/h），结果是「16:9 的图设成 ratio 后变成 9:16」。这个 bug 只有「w 是 ratio、h 是 fixed」这一条分支能抓到，主干用例全是 h 轴 ratio，所以一直没暴露；补齐边角用例时 `expected { w: 200 } received { w: 50 }` 才现形。

**代价**：两个轴都写 ratio 时另一边的值被忽略（不是「取较小者」），需要产品上明确告知；`ratioValue` 的兜底让非法值静默变成 1，写错数字不会报错。

## D21：等距提示的阈值是 `MAX_HINT_GAP = 400`

**决定**：`spacingHints()` 只在邻居间距 ≤ 400px 时给出提示，且「两侧间距之差 ≤ `SNAP_THRESHOLD`（6，复用 `core/geometry`）」才标成 `equal`。提示对象是**同父级**、非隐藏、非正在拖动的节点，交叉轴必须真有重叠。

**理由**：1440 宽的页面上，任意两个元素都能量出距离，全画出来等于没有提示 —— 距离标签会盖住整个画布。400px 约等于「一屏内的相邻元素」，是这个尺度的自然分段；`equal` 复用磁吸阈值，保证「显示等距」与「拖到等距会自动吸附」是同一个判断。

**代价**：400 是拍出来的常数，超长页面（例如 2000px 高的 hero 区）里的等距关系不会被提示；同父级限制意味着跨容器（例如 section 里的 card 与 section 外的 card）看不到间距。

## D22：`subtreeOf()` 返回 id 列表，而不是节点列表

**决定**：`core/layout` 的 `subtreeOf(id)` 收集的是 `NodeId`（用 `kidsOf(id).map((child) => child.id)` 展开），用于 hug 容器长大后「清掉子树里已排好的盒子再重排」。

**理由**：原来写的是 `const stack = [...kidsOf(id)]`（`kidsOf` 返回 `SceneNode[]`），于是 `delete out[descendant]` 实际在按 `"[object Object]"` 删键 —— 等于没删，`seen.delete()` 同理。这是 `vue-tsc` 报 `Conversion of type 'SceneNode | undefined' to type 'string'` 才暴露的（vitest 只剥类型不检查，运行也不会抛错）。当前重排路径会把子树全部重排一遍，所以这个 bug 是潜伏的，但它让「清理」变成空操作，迟早会在某个只重排部分子树的优化里冒出来。

**代价**：多两次 `map()` 分配；类型上再也不能把节点对象当 id 传（这正是想要的）。

## D23：布局面板只写 `layout`，像素位置与尺寸仍在属性面板

**决定**：`LayoutPanel.vue` 只调 `store.updateLayout(id, patch)`（改 `mode` / `size.kind` / `padding` / `gap` / `align` / `justify` / `wrap` / `columns`），`layout.position` 与 `size.value` 的数值编辑仍由 `PropPanel.vue` 负责；`updateLayout` 做 `{ ...node.layout, ...patch }` 后走一条 `layout:<id>` 合并键的补丁。

**理由**：两个面板都能写同一个字段就会出现「谁最后写谁赢」的竞态，且合并键不同会让两条连续的编辑无法合并成一条撤销。切到流式布局后 `position` 只是被暂时忽略（切回 free 还原），面板不应该在切模式时偷偷改写它 —— M2 判据明确要求「切回 free 位置还原」。

**代价**：用户在流式布局下改「位置」不会立刻看到效果（要切回 free），面板文案必须解释这一点；`updateLayout` 与 `updateNode` 是两条入口，新增字段时要决定归属。

## D24：水平折行里「整行都是 fill 高」的行按容器高兜底

**决定**：`wrap` 生效时行高由本行「有内容高」的子节点决定（fill 高的算 0）；若整行都没有内容高，该行行高为 0，于是 fill 高的子节点退回「撑满容器交叉轴」。

**理由**：一行里全是 `fill` 时没有任何内在高度可依据，要么给 0（元素塌掉看不见），要么给容器高。选后者是为了「拖进去至少看得见」，代价是这一行会比相邻行高很多。等 M3 引入断点覆盖后，这种行应该由断点显式给高度。

**代价**：视觉上同一容器里可能出现一高一矮的行；语义上「行高 0」与「行高 = 容器高」是两种极端，中间态要靠用户显式设高。

## D25：grid 的 `justify` 表示单元内的**水平**偏移，`align` 表示垂直

**决定**：`mode === 'grid'` 时，单元内水平偏移取 `justify`（`end` / `center` / 其它一律 0），垂直偏移取 `align`（`center` / `end` / 其它 0），并用 `Math.min(w, cellW)` 夹住宽度防止溢出单元。

**理由**：grid 的「行内主轴对齐」在语义上对应 flex 的 justify，但轴变成了「单元内」而不再是「容器主轴」。复用这两个字段可以少两个受控键（受控样式已经有 22 个键，能不加就不加），代价是同一个字段在 grid 与 flex 下含义不同 —— 面板文案要在 grid 模式下换成「单元内对齐」。

**代价**：`stretch` 在 grid 下没有实现（宽度靠 `size.kind === 'fill'` 表达），跨模式读代码时需要留意 `justify` 的语义切换。

## D26：断点覆盖只存差异，差异相对「更宽一级的有效值」计算

**决定**：`core/responsive` 的 `writeOverride(node, breakpoints, targetId, edit)` 先在继承链上求出「目标断点以下（更宽那些断点）的有效节点」`below`，再把这次编辑作用到 `below + 已有覆盖` 上得到 `desired`，最后逐键比较 `desired` 与 `below`，只把不同的键写进 `overrides[targetId]`；结果为空对象时返回 `null`（调用方删掉该断点的覆盖）。因此「把值改回继承值」＝覆盖自动消失。

**理由**：`PLAN.md` 明确要求断点覆盖只存差异。若存全量，导出时就得为每个断点写出全部属性（HTML 体积翻倍），而且「改回继承值」会留下一条无意义的覆盖，之后基准断点改样式它还会继续钉住旧值。

**代价**：每次编辑都要做一次继承链求解（`O(断点数)`），断点数量多时写入变慢；`below` 只按「更宽一级」算，所以断点的 `minWidth` 排序决定了继承方向，改 `minWidth` 会让已有覆盖的相对语义变化。

## D27：`NodeOverride.layout` 的嵌套子对象是整体替换，不是逐字段合并

**决定**：`layout` 这一层可以部分覆盖（只给 `mode`、不给 `size`），但 `position` / `size` / `padding` / `constraints` 这些**嵌套子对象**一旦写入就是完整对象 —— `diffLayout()` 检测到子对象有变化时输出整个子对象。类型上 `NodeOverride.layout` 是 `Partial<LayoutSpec>`，而 `LayoutSpec.size` 是必填的 `{ w, h }`，没法只写单轴。

**理由**：类型系统已经把这条路堵死，硬要支持单轴就得把 `LayoutSpec.size` 改成可选并让布局引擎到处判空。整体替换的语义也更简单：读覆盖时不需要再把「半个 size」和继承值拼起来。

**代价**：覆盖体积比理论最小值大（改 `size.w` 会连 `size.h` 一起写进去）；如果以后基准断点改 `size.h`，窄断点里那条「顺带写进去的 h」会继续钉住旧值 —— 这点在 `writeOverride` 的逐键比较里已经尽量收敛（只写与 `below` 不同的键）。

## D28：导出与「当前预览断点」解耦，永远从基准断点导出

**决定**：`store.generatedHtml` 用 `exportDoc`（基准断点的有效文档 + 基准断点宽度）与 `exportBoxes` 生成，`generatedCss = generateResponsiveCss(doc, activePage.id)` 覆盖所有启用的窄断点。切到手机断点预览**不会**改变导出的 HTML。

**理由**：导出物是一份静态站点：基准视图的内联样式 + 各窄断点的 media query 覆盖。如果跟着预览断点走，同一份文档在「看着手机」时导出会丢掉桌面规则，用户复制代码的结果取决于当时的视图状态 —— 这是不可复现的输出。

**代价**：预览断点下看到的页面与「导出的基准视图」不完全一致（前者是断点覆盖后的结果）；代码面板的 CSS 页签因此只有 media query，需要在面板里写明「基础样式内联在元素上」（`CodePanel.vue` 的 `CSS_NOTE`）。

## D29：media query 上界取「更宽一级断点的 minWidth − 0.02px」，并用 `!important` 压过内联样式

**决定**：`mediaQueryForBreakpoint()` 对非基准断点输出 `@media (max-width: <上一级 minWidth - 0.02>px)`（desktop 1200 → tablet `1199.98px`，mobile `767.98px`）；块内声明一律带 `!important`；「更宽断点有、当前断点没有」的属性用 `RESET_DECLARATIONS` 显式复位（`display:block` / `background:none` / `color:inherit` …）。

**理由**：内联样式的优先级高于普通样式表规则，不加 `!important` 媒体查询就是死代码。上界减 0.02 而不是减 1，是为了在 `minWidth` 不是整数时也能把「上一级」排除干净（CSS 的 `max-width` 与 `min-width` 在同一个像素上会同时命中）。复位声明是必需的：`display:none` 覆盖一旦被取消，如果不写 `display:block`，用户会看到「清除隐藏后元素还是不见」。

**代价**：`!important` 让导出物难以二次维护（用户想用外部样式覆盖就得再加权重）；复位表是手写白名单，将来 `declarations()` 新增属性时必须同步补进 `RESET_DECLARATIONS`，否则「取消某属性」会失效。

## D30：断点切换用预设视口宽度，而不是 `minWidth` 本身

**决定**：`BREAKPOINT_VIEWPORTS` 给出 desktop `1440×900` / tablet `768×1024` / mobile `375×812`；`breakpointViewport(breakpoint)` 优先用预设，否则用 `minWidth` 作为页面宽度（`clamp(200, 10000)`、高 900），`minWidth <= 0`（mobile）直接返回 `375×812`。

**理由**：切换编辑断点时画布必须立刻变成「那个断点代表性的宽度」，否则拖拽/磁吸/换父级算出来的坐标都不是用户将在浏览器里看到的那套。手机断点的 `minWidth` 是 0（表示「0 到 767 之间」），拿它当宽度会得到 200px 的假画布，所以必须走预设。

**代价**：断点表格与 `minWidth` 之间是隐式的两套数值，用户在设置里改 `minWidth` 不会改画布预设宽度；`setViewportWidth`（自定义宽度）不改 `breakpointId`，所以「预览 900px 宽但仍在手机断点编辑」是允许的状态。

## D31：组件库是「描述符注册表」，不是一张写死的 type 表

**决定**：M4 起组件清单由 `src/core/components/index.ts` 的注册表提供（`ComponentDescriptor { type, label, category, icon, container, editable, defaultSize, defaultStyle, defaultProps, toHtml, toCanvasHtml, aiDoc, overridable }`），内置 40 个描述符在模块加载时注册；`schema/catalog` 的 `COMPONENT_TYPES` / `defaultStyleFor` / `defaultPropsFor` / `defaultSizeFor` 全部委托给注册表。第三方 `registerComponent()` 后立刻出现在组件面板（core 不能引 Vue，所以面板用 `subscribeRegistry()` + 一个 `revision` ref 把注册表变更翻译成响应式更新）；类型上 `ComponentType = BuiltinComponentType | (string & {})`，既保留自动补全又允许自定义类型。

**理由**：PLAN 的 M4 要求「插件式 `ComponentDescriptor`，注册第三方假组件可拖入可导出」。写死的 switch 会让每加一个组件都要改 catalog、normalize、codegen、画布四处，插件化无从谈起。

**代价**：注册表是全局可变状态（测试必须 `unregisterComponent` 收尾）；`COMPONENT_TYPES` 是实时数组引用，谁缓存了旧值就会拿到过期清单。

## D32：组件实例在渲染层展开（合成 id），文档里只存一个 instance 节点

**决定**：`Doc.symbols` 存组件定义；页面上放的是 `type: 'instance'` + `props.symbolId`。`expandInstances(page, doc)` 在**渲染时**把 master 子树克隆成 `${实例id}~${master节点id}` 的合成节点（`symbols.syntheticId`），布局引擎、画布、导出共用这份展开结果。实例的选择/拖动经 `realId()` 归一到实例本身；实例的 props 只按定义里的 `overridable` 白名单覆盖 master 根节点。循环引用在展开时用 `stack` 检测，标记 `props.cycle = true` 而不是死循环。

**理由**：如果把实例「展开进文档」，改 master 就要遍历所有页面重写节点，补丁/撤销全部爆掉；白名单覆盖则保证实例不能悄悄引入 master 上没有的属性。合成 id 的 `~` 前缀让「点中实例里的子节点」能反查回实例。

**代价**：`doc.pages[].nodes` 与用户看到的画布不是一对一（合成节点没有补丁记录）；实例节点必须排除在拖拽落点之外（`isContainer()` 显式返回 false），否则拖进去的节点下一趟展开就消失。

## D33：创建组件不入撤销栈，master 编辑走「补丁容器泛化」

**决定**：`captureSymbol` + 替换成实例这一步**直接改写 `history.base`**（不进撤销栈）；而改 master 的节点编辑走正常 `updatePatch`，只是 `patch.pageId` 里放的是**组件 id**——`applyPatch`/`invertPatch` 通过 `findContainerNodes(doc, containerId)` 同时支持「页面」与「组件定义」两种容器，写入前同样过 `canonicalNodes(normalizeNodeOrder(nodes))`。

**理由**：创建组件是「重构文档结构」而不是「编辑内容」，与 M1 的 `applyViewport` 同类；但它之后的 master 编辑必须可撤销（PLAN 验收要求改 master 三实例同步、并能回退），复用补丁管线就免费得到了逆补丁、合并窗口与 canonical 键序。

**代价**：`Patch.pageId` 现在语义是「容器 id」（页面或组件），字段名有误导性；创建组件这一步不可撤销，用户误操作只能手动还原。


