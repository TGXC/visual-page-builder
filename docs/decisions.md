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

## D34：M5 起导出从「全内联样式」改成「语义化 HTML + 独立 CSS 类」

**决定**：每个元素带 `el el--<type> n-<id>` 三个类（`classNamesOf`），几何与样式全部落进 `generatePageCss()` 产出的规则里；页面自身是 `.page-<页面id>`。`generateHtml()` 把同一份 CSS 收进单个 `<style>` 块（双击即可打开），`buildSite()` 拆成 `index.html` + `base.css` + 每页 `<slug>.html`/`<slug>.css`。画布仍然用 `inlineStyle()`，它与 CSS 规则共用同一个 `declarations()` 函数，所以画布与导出不会各写一套映射（M1 的 ±1px 判据继续成立）。

**理由**：PLAN 的 M5 判据是「导出 HTML 无内联样式堆叠、类名可读、能被真实 Vue 项目引用」。内联样式无法被覆盖、体积随节点数线性膨胀，也没法交给 Vue 组件复用。

**代价**：M1/M3 那批断言 `style="` 与 `!important` 的旧测试必须改写（本轮改了 7 处）；类名依赖节点 id，节点 id 一旦由外部导入产生非法字符就要走 `slugOf()` 转义。

## D35：断点媒体查询不再用 `!important`

**决定**：`generateResponsiveCss()` 用与基准规则**同优先级**的类选择器（`.n-<id>`），靠「媒体查询块写在基准规则之后」这一顺序覆盖；被更窄断点取消的声明（例如基础断点有 `background`、手机断点清空）按 `RESET_DECLARATIONS` 白名单显式复位（`display:block` / `background:none` / `color:inherit` …）。

**理由**：M3 用 `!important` 是因为样式内联在元素上；M5 没有内联样式了，加权重反而让用户自己的样式再也覆盖不了导出结果。

**代价**：`RESET_DECLARATIONS` 是手写白名单，`declarations()` 新增一个属性时必须同步补一行，否则「取消某个样式」在断点间不会生效（测试里有一条落在 `background` 上作为样例）。

## D36：整站导出用自写的 stored ZIP，不引压缩库

**决定**：`src/core/zip/index.ts` 自己产 ZIP（本地文件头 `0x04034b50` + 中央目录 `0x02014b50` + EOCD `0x06054b50`，stored 不压缩，通用位标记 `0x0800` 声明 UTF-8 文件名，时间/日期固定 0）；`buildSite()` 的文件清单交给它打包，编辑器「整站」按钮下载 zip。

**理由**：目标是不引第三方依赖（PLAN 的依赖约束），而 stored ZIP 只需要 CRC-32 与三个固定结构的头部；时间戳固定 0 让同一文档的 zip 字节级可复现，便于测试。

**代价**：不压缩，产物比 gzip 大（示例落地页 6.9KB）；只支持 stored，将来要压 deflate 得自己实现或引入依赖。

## D37：SEO/元信息是文档级字段，收敛层截断而不是拒绝

**决定**：`Doc.seo = { title, description, lang, keywords }`（可选）；`normalizeSeo()` 去首尾空白、标题截 120 字/描述与关键词截 300 字，`lang` 不匹配 `^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$` 时回落 `zh-CN`，四项全空则整个字段不落盘。导出时 `title` 缺省用文档名，`<html lang>` 缺省 `zh-CN`，并输出 `og:title`/`og:description`/`canonical`。

**理由**：SEO 字段来自导入的 JSON，属于不可信输入；「截断 + 兜底」比「报错拒绝」更符合「导入永远能打开」的既有约定（D3）。

**代价**：超长标题会被静默截断（用户看不出丢了字符）；`keywords` 只做长度限制，不做逗号切分与去重。

## D38：React JSX 与「PNG 保真截图」在 M5 不做

**决定**：M5 交付 HTML（单文件/整站）、独立 CSS、Vue 3 SFC 三种产物；React JSX 与保真 PNG 按 PLAN 的裁剪优先级推迟（PNG 仍是 M1 的近似截图，待 M7 素材/生成组件到位后再换真实位图渲染）。README 的「已知缺口」明确记这一条。

**理由**：PLAN 把 React JSX 排在 M7 生成组件与素材之后；PNG 要保真必须先有真实浏览器渲染或位图管线，否则只是把近似算法换个名字。

**代价**：M5 的产物清单比 PLAN 原文少两项；`docs/decisions.md` 与 README 必须写清楚，避免被当成漏做。

## D39：AI 只能产出结构化 JSON，落库必须过「形状 → 收敛 → 引用/自检」三层

**决定**：`AiProvider.complete()` 返回的是 JSON（`PageDraft` 或 `Patch[]`），落库前一律走本地校验：`shapeProblems()`（对象形状、`root` 在 `nodes` 里、类型在注册表中、`parentId` 存在、根外必须有父、**原始草稿**里必需 props 不能缺）→ `validateDraft()`（`normalizePage()` 收敛后再比节点数，`normalizeDoc()` 收敛，返回非空且含该页）→ `selfCheckProblems()`（`computeLayout()` 后水平越界、同父兄弟重叠 > 小盒 60%）。任何一层失败都返回 `{ ok: false, errors }`，**文档一字不动**。补丁侧对应 `coercePatches()`（丢弃模型给的 `before`、`layout`/`style` 只给差异时补成完整对象）+ `scopeProblems()`（目标必须在「选区 + 子树」内、`pageId` 必须一致）。供应商输出不合法时 `runWithRetry()` 只重试一次，第二次把错误原因追加进 prompt。

**理由**：功能文档 AI0 的第一条铁律是「AI 只产出结构化 JSON，经 `normalizeDoc` + 引用完整性 + 组件白名单才落库」。把校验放在 core 的纯函数里，Mock 与真实供应商走同一条路 —— 测试可以完整覆盖「非法输出不污染文档」。必填 props 必须在**收敛前**查，因为 `normalizeNode()` 会用 `defaultPropsFor(type)` 补齐，收敛后永远查不出缺失（写测试时踩过：`button` 少了 `text` 仍然通过）。

**代价**：同一份数据要过两遍（raw 一次、收敛后一次）；`selfCheck` 只查水平越界（落地页本来就该比视口长），垂直超长不报；AI 生成的内容仍可能语义离谱，校验只能保证「结构合法」。

## D40：AI 新增页面走「文档级历史条目」，与补丁条目共用一条撤销栈

**决定**：`HistoryEntry` 拆成 `PatchHistoryEntry`（`kind?: 'patch'`，老字面量不用改）与 `DocHistoryEntry`（`kind: 'doc'`，存 `before` / `after` 两份完整文档）；`commitDocEntry(state, { label, at, after })` 自动把 `state.base` 当 `before`。`undoEntry()` 对文档级条目回到 `entry.before`，`redoEntry()` 回到 `entry.after`。文档级条目不参与 `MERGE_WINDOW` 合并（一条就是一条）。store 的 `aiGeneratePage()` 用它写入「AI 生成页面：<页面名>」，所以 undo 一步就回到原来的页面与选中项。

**理由**：`store.setDoc(next, label, keepHistory = false)` 默认会 `createHistory(next)` **清空历史**，AI 生成新页面又是一次页面级变更。若照抄 D33「直接改 base 不入栈」，AI 生成就不可撤销，违反 AI0 第二条（每次 AI 操作前存快照、历史里一条可撤销命令）。

**代价**：文档级条目存两份完整 `Doc`（内存占用远大于补丁条目，一次 AI 生成约等于一份文档副本），所以「100 步历史只存补丁」那条体积断言对文档级条目不成立；`kind` 设为可选是为了不破坏既有测试里的补丁字面量。

## D41：AI 补丁里的 `before` 一律丢弃，从当前文档现取

**决定**：`coercePatch()` 忽略模型给出的 `before`，用 `pick()` 从页面当前节点里现取；`style` / `layout` 只给差异时，合并到当前值上得到完整对象（`applyPatch` 的 `applyNodeData` 是整体替换）。AI 更新节点时也只允许 `type / layout / style / props / overrides / meta` 这几个字段。

**理由**：`before` 由模型提供等于让它同时决定「改了什么」和「改回去是什么」——一个错的 `before` 会让 undo 把文档改坏，而撤销恰恰是 AI 功能的安全网。整体替换的语义（D27 同源）要求补丁自带完整子对象，所以合并必须在服务端做。

**代价**：模型无法表达「把字段删掉」这种语义（只会写值）；补丁体积比模型输出的差异大（`style` 会写全 15 个键）。

## D42：一键修复用迭代式 `fixAll()`，不能把一次审计的补丁摊平

**决定**：`fixAll(doc, pageKey?)` 循环最多 8 轮：每轮 `auditDoc()` 取 `patches.length > 0` 的问题摊平补丁 → `applyPatches()`，`JSON.stringify` 不变就提前退出，最后返回累计的 `Patch[]`（由 store 作为**一条**普通补丁历史提交）。

**理由**：一次审计里同规则可能报多条（例如 tablet 与 mobile 两条「断点未覆盖」），它们的补丁都基于同一份文档的**同一份 before** 整份替换 `overrides`，摊平后后者会把前者的修改覆盖掉 —— 表现为「一键修复后断点问题仍然存在」（第一版就是这样，测试里 `breakpoint-uncovered` 残留）。迭代式让后一条基于前一条的结果重新审计，天然消解冲突。

**代价**：最坏 8 轮 × 全页审计，大文档上比单趟慢；返回的是补丁而不是修好的文档，调用方必须自己 `commit()`（我第一版把它当 `Doc` 用，运行时 `TypeError: Cannot read properties of undefined (reading 'find')`）。

## D43：密钥只存本机浏览器，Mock 供应商保证不配 key 也能用

**决定**：`src/ai/settings.ts` 把 `{ apiKey, baseUrl, model }` 存在 `localStorage['studio.ai.settings.v1']`，`loadAiSettings()` 对坏 JSON/无 localStorage 一律回落默认值；`createOpenAIProvider()` 的 key 只进请求头，`JSON.stringify(doc)` 与导出物里永远没有 key。默认供应商是 `createMockProvider()`（`ready: true`），`ready: false` 的供应商根本不会被调用（`notReady()` 直接返回 provider 错误）。

**理由**：AI6 要求「密钥只存本地」；Mock 必备是 AI0 第三条（离线可用）。把 `ready` 判断放在编排层而不是组件里，保证「点生成但没配 key」也走同一条失败路径（报错、日志留痕、文档不动）。

**代价**：key 明文存在 `localStorage`（同源脚本可读，XSS 风险由前端整体承担）；换浏览器/清缓存就要重填；Mock 的「生成」是确定性模板，用户容易把它当成模型的真实能力。

## D44：选区指令的范围校验基于「选区 + 子树」，空选区优先报错

**决定**：`allowedIds(doc, pageId, selectionIds)` = 选中节点 + `subtreeIds()`；`applyInstruction()` 的顺序是「先判空选区（报 `scope`，文案『请先选中要修改的元素』）→ 形状 → 范围 → `applyPatches`」。`update`/`remove`/`move` 的目标与 `insert` 的父节点都必须在 `allowedIds` 里，`remove` 不许删根，`insert` 的父节点必须是容器类型。

**理由**：AI2 的验收判据是「只影响选中子树」，所以范围校验必须是**结构性**的，而不是靠提示词里说「只改选中的」。空选区排在形状之前，是因为「没选东西」比「模型输出不合法」更早、更可能是用户操作问题。

**代价**：`allowedIds` 每轮重新计算（O(子树)）；用户想「把选中的卡片移到另一个容器」时，目标父节点若不在选区内就会被拒（当前实现只允许在选区内移动）。

## D45：文案 / 素材 / 组件三条 AI 增强都先出候选，落库仍走普通补丁历史

**决定**：`src/ai/text.ts` 的 `textCandidates()` 给 3 条文案候选、`src/ai/material.ts` 的 `materialCandidates()` 给 3 张占位图、`src/ai/component.ts` 的 `componentCandidates()` 给 1 个受限 DSL 候选，**生成不写文档**；用户点某条候选后，store 用 `textPatch()` / `materialPatch()` 生成普通 `update` 补丁再 `commit()`（标签分别是 `AI 文案：<前 16 字>`、`AI 素材：应用配图`）。注册自定义组件同理：`registerCandidate()` 只进注册表 + 本机存档，不进文档历史（沿用 D33）。

**理由**：AI4 的验收就是「3 个候选 → 应用其一 → 可撤销」；候选不落库保证「AI 猜错也不污染文档」，而落库走普通补丁历史复用了 M5/M6 已有的撤销与导出链路（不需要第三种历史条目）。

**代价**：候选列表是面板本地状态，刷新页面就没了（只有应用后的结果进文档）；素材是规则生成的渐变占位图，不是真图片。

## D46：素材用自写 PNG 编码器（core/png）而不是引图片库或塞 SVG

**决定**：`src/core/png/index.ts` 自写最小 PNG 编码器（IHDR 位深 8 / 颜色类型 2、IDAT 用 zlib stored 块、ADLER32 + CRC32 手写、`toBase64` 自写以避开 `btoa`/`Buffer`），`createPlaceholderPng()` 出竖向渐变；`crc32` 直接复用 `src/core/zip/index.ts:39`。

**理由**：`safeUrl()`（`src/core/html/index.ts:19`）放行光栅图 dataURL 但**一律拦掉 SVG**，所以占位图必须是真 PNG 才可能被导出与画布同时接受；引 `pngjs`/`canvas` 这类依赖违反「不引拖拽库与 UI 组件库」的同类约束（能不加就不加），而在 `src/core` 里塞 SVG 又过不了 `safeUrl`。

**代价**：stored 块不压缩，320×200 的渐变图约 192 KB base64（写进 `props.src` 会让文档变大）；只支持 RGB、无隔行、无缩放。

## D47：受限 DSL 白名单 + `compileDsl()` 编译成普通 ComponentDescriptor

**决定**：AI 生成组件只接受 `ComponentDsl { name, icon?, size?, props?, root }`（`DslNode` 只能引用注册表里已有的 `type` + 19 个白名单样式键 + `{{prop}}` 占位符），校验项有 `DSL_MAX_NODES=30 / DSL_MAX_DEPTH=4 / DSL_MAX_PROPS=8 / DSL_MAX_TEXT=120`、颜色正则、枚举表；通过后 `compileDsl()` 产出 category 为 `'custom'` 的 `ComponentDescriptor`（`toHtml` 与 `toCanvasHtml` 共用同一个 `renderNode`，`cssFor(scope)` 输出以 `.` + 外层类名开头的全部规则）。

**理由**：AI5 要求「不允许任意 JS/CSS，只能进我的组件」。把 DSL 编译成**普通描述符**而不另建一套渲染路径，意味着自定义组件能自动获得导出（`codegen` 的 `cssFor` 段）、拖拽、属性面板、AI 目录注入（`componentCatalogText()` 遍历注册表）——一套机制而不是两套。

**代价**：`customTypeOf(name)` 必须转成 ASCII（非 ASCII 名用 FNV-1a 短哈希，见 D48），用户看到的是「团队成员卡片」而 type 是 `custom-oyosit`；DSL 表达力有限（无嵌套样式、无伪类、无动画）。

## D48：自定义组件的类型名必须是 ASCII（FNV-1a 短哈希兜底）

**决定**：`customTypeOf(name)` = `custom-` + ASCII slug；名字里没有 ASCII 字母数字时用 FNV-1a 哈希取 6 位 36 进制（`hash ^= codePoint; hash = Math.imul(hash, 16777619)`，`(hash>>>0).toString(36).slice(0,6)`）。

**理由**：type 会进 CSS 类名（`el--<type>`）、HTML 属性、导出文件名与 `componentCatalogText()`；中文 type 在导出站点的类名里虽然合法，但会在第三方工具链、URL、正则匹配里变成隐患。可读名字留在 `label`（面板显示）与 `aiDoc`（进 AI 目录）里。

**代价**：同名不同字的组件可能哈希相同（6 位 36 进制 ≈ 2×10⁹，冲突概率可忽略但非零）；存档里存的是 DSL（含原始名字），读回来重新 `compileDsl()` 时 type 会重算，所以「改名」等于换了一个 type（旧文档里的实例会变成未注册类型）。

## D49：token 与成本按本地估算，调用记录带 tokens/cost/model

**决定**：`src/ai/usage.ts` 的 `estimateTokens()`（CJK 一字 1 token、ASCII 4 字符 1 token）与 `PRICING`（`gpt-4o-mini` 0.15/0.6、`gpt-4o` 2.5/10 USD per 1M tokens）；`usageOf()` **优先用供应商返回的 `response.usage`**，拿不到才本地估算；`AiCallLogEntry` 增加 `tokens / costUsd / model`，面板底部常显「N 次调用 · N tokens · $N · 模型」。

**理由**：AI6 要求调用记录显示 prompt 摘要 / 耗时 / token。Mock 供应商没有 usage 字段，本地估算让「不配 key 也能看到成本面板」；查不到的型号按 0 计而不是猜价格。

**代价**：估算是字节/字符启发式，中文文案偏保守；Mock 的 `model` 显示为 `'mock'`，价格恒为 0（面板里能看到 0 不代表免费，而是没有真实调用）。

## D50：降级是 store 里的兜底调用，不是 provider 的伪装

**决定**：`src/ai/offline.ts` 只做判定（`isOffline()` 认显式 `onLine === false`、`shouldFallback(codes, offline)` 认 `provider` 类错误）；真正的降级在 store：`aiTextOptions / aiMaterialOptions / aiComponentOption` 在 `outcome.ok === false` 时直接调用规则式实现（`textCandidates / materialCandidates / componentCandidates`），把 `aiDegraded` 设为 `OFFLINE_HINT` 或 `PROVIDER_FALLBACK_HINT` 并保留失败日志；三个 M7 方法的**未就绪路径也写一条日志**（summary `供应商未就绪`）。

**理由**：如果让 Mock 假装是 OpenAI，调用记录里就看不出「这次是降级」；把判定与兜底分开，用户能同时看到「失败原因」和「我拿到了什么」。验收要求「断网降级文案」，`aiDegraded` 会渲染成面板顶部的 `[data-role="ai-degraded"]`。

**代价**：降级结果与真实模型结果混在同一个候选列表里，只能靠文案与 `aiMessage` 的前缀区分；`isOffline()` 只看 `navigator.onLine`，代理层断网（onLine 仍为 true）会走 provider 失败分支（结果一致，但提示文案是「供应商不可用」）。

## D51：主题 token 用 `$name` 引用、导出成 CSS 变量，只覆盖 4 个颜色字段

**决定**：`src/core/theme/index.ts` 定 `TOKEN_PREFIX = '$'`；样式里写 `$color-primary`，**导出**时 `generatePageCss` 用 `paintOf(value, { tokens, cssVars: true })` 输出 `var(--color-primary)`，并在页面真的用到 token 时把 `themeVariablesCss(doc.theme)`（`:root{--a:b;…}`，键排序）插在 `BASE_CSS` 之后；**画布**走 `inlineStyle(node, backgroundImage, box, tokens)` 解析成具体颜色（`resolveTokenValue`）。可引用的字段限 `bg / color / borderColor / shadowColor` 四个字符串字段。

**理由**：`StyleSpec` 的数字字段（`fontSize`/`radius`/`lineHeight`…）是 `number`，改成联合类型会波及 layout / codegen / canvas 全链路，而 L7 的验收判据正是「改主题色 → 所有引用 token 的元素同步变色」。只在 `pageUsesTokens(page)` 时才注入 `:root`，既有导出快照因此一个字节都不用改。

**代价**：数字 token（`space-md: 16`、`radius-lg: 16`）只能在主题面板里维护、供间距阶梯与默认值参考，元素样式里写不出来；`missingTokenRefs()` 只在面板里提醒，导出时未定义的引用会变成空值。

## D52：几个文本/颜色工具先自己写，不引依赖

**决定**：`core/png/index.ts` 自写 PNG（IHDR/RGB、IDAT 用 zlib stored 块、IEND，CRC-32 复用 `core/zip`），`core/share/index.ts` 自写 base64url 编解码，`core/theme` 自写 token 解析，`core/tree` 自加 `childrenIndex()`。

**理由**：PLAN 的硬约束是「不引拖拽库与 UI 组件库」，且这几个能力都是纯逻辑、几十行就能写完、能被单测完全覆盖；引一个 PNG 库或压缩库会让 `core/` 的纯函数边界变模糊。

**代价**：PNG 不压缩（320×200 占位图 base64 约 192KB），分享链接有 `MAX_SHARE_LENGTH = 12_000` 上限，主题 token 没有继承/别名。

## D53：性能瓶颈是「每个节点扫全表」，不是布局

**决定**：在 `core/tree` 加 `childrenIndex(nodes)` / `childrenFrom(index, parentId)`（一次性建「父→子」索引，顺序与 `childrenOf` 一致），`core/codegen` 的 `renderNode`/`generateBodyHtml` 改用它；`core/components` 的 `renderContext()` 把 `children` 从即时求值改成 **getter 懒计算**（导出路径根本不读它，只有画布的「空容器提示」会读）；`core/site` 的 `buildSite()` 复用激活页已经算好的 standalone HTML 当作 `index.html`。

**理由**：E7 首跑 1000 节点导出中位数 **898.66ms**（HTML 292.75ms、整站 568.00ms、CSS 23.34ms、ZIP 3.98ms），而 `computeLayout` 只要 2.79ms —— 慢的是 `childrenOf`/`childNodes` 在每个节点上做一次全表扫描（O(n²)）。三处改完中位数 **73.31ms**（CSS 22.53 / HTML 24.20 / 整站 23.52 / ZIP 3.84），12 倍提升，导出字节数完全不变（CSS 243848 B、HTML 305481 B、ZIP 375581 B）。

**代价**：多了一份索引对象（`generateBodyHtml` 每次调用建一次，1000 节点约几十微秒）；`ComponentRenderContext.children` 从「字段」变成「getter」，任何把它当数据快照存下来的代码会每次拿到新数组（当前没有这样的调用方）。

## D54：版本历史与分享链接都只落本机/地址栏，不设后端

**决定**：`core/versions` 把带名字的快照存 `localStorage['studio.versions.v1']`（最多 20 条，最新在前，`restoreVersion()` 返回深拷贝）；`core/share` 把整份文档编码进 `#doc=`（`shareUrl(doc, base)`，超过 12000 字符返回空串，界面提示改用整站导出）；`EditorShell.onMounted` 调 `store.loadSharedFromLocation()`，有 `#doc=` 就载入。回滚与载入都走 `commitDoc()`（**文档级历史条目**，D40），所以两者都能撤销。

**理由**：M8 要求「分享/发布 = 导出静态站点 zip 或分享链接；本地导出 + 可选上传」。不做后端就没有账号、配额、隐私问题，静态托管的 zip 仍然是最完整的发布路径；把回滚/载入做成可撤销，用户误点不会丢工作。

**代价**：分享链接只适合中小文档（链接过长会退化成「请用整站导出」）；`localStorage` 在隐私模式下无效（版本保存静默失败并提示）；没有版本 diff 视图、没有云端协作。

## D55：分享片段要能吃完整地址，不只是 `#doc=`

**决定**：`decodeDoc(input)` 先 `input.indexOf('#doc=')` 取片段（找不到才退化成「去掉开头 `#`」），因此粘贴完整地址、`#doc=…`、多个 `#`、裸 base64url 都能解。

**理由**：面板的输入框写的是「粘贴 #doc=… 或完整地址」，而组件测试里 `store.shareLink` 返回的就是完整地址 —— 第一版 `decodeDoc` 只剥开头 `#`，从完整地址里 base64 解出的是垃圾（组件测试报文：载入后文档 id 变成新生成的 `doc_BHW-…`）。修完 `shareUrl` 的产物能直接往输入框里粘。

**代价**：`indexOf` 匹配的是第一个 `#doc=`，地址里若在它之前还有别的 `#doc=`（不可能由本工具生成）会取错位置。

## D56：性能与冒烟的 npm 脚本用「可选垫片」，CI 与沙箱同一条命令

**决定**：新增 `scripts/sandbox-shim.cjs`（存在 `.sandbox/child-process-pipe-shim.cjs` 才 require 它），`test:perf` / `test:smoke` 改成 `node --require ./scripts/sandbox-shim.cjs ./node_modules/vitest/vitest.mjs run --config …`；`.github/workflows/ci.yml` 增加 `npm test`、`npm run test:perf`、`npm run test:smoke` 与 dist 产物上传。

**理由**：本机 DSH 沙箱禁止带管道的 `child_process.spawn`（Vite 在 Windows 上探测网络驱动器 → `spawn EPERM`），但 `.sandbox` 已被 gitignore，CI 上不存在这个文件。垫片做存在性判断后，两个环境跑的是同一条命令，README 里的验收命令不再分环境。

**代价**：多了一个 `scripts/` 目录与一层间接（排查 CI 失败时要记得垫片在 CI 上是空操作）。

## D57：画布网格用两层（8px 次网格 + 64px 主网格），画在缩放层外

**决定**：`CanvasStage.vue` 在 `.canvas-page` 里加一个绝对定位的 `.canvas-page__grid`（`pointer-events: none`），背景是四条 `linear-gradient`（次网格 8 设计像素、主网格 64 设计像素），间距由 `gridStyle` 按 `store.zoom` 换算成 `background-size`。网格层不在 `scale(zoom)` 的 `.canvas-page__inner` 里。

**理由**：用户反馈「画布没有格子」。参考平台是单层 8px 网格、且画在缩放容器内 —— 1440 宽时有 180 条线，25% 缩放下线距只有 2px，看起来像脏噪点而不是网格。两层 + 缩放外渲染后，任何 zoom 下级距都是整数像素，主网格给「按 64px 对齐」提供视觉锚点。

**代价**：网格间距不再是纯设计像素（随 zoom 变），截图对比时要说明这是「画布辅助线」不是页面内容。

## D58：删除保护放在 `removeSelection()` 里，入口只负责置灰

**决定**：`removeSelection()` 先过滤掉「根节点 + `meta.locked`」，全被保护时按原因 toast（`根节点不能删除` / `元素已锁定，先解锁再删除`），部分被保护时删除其余并提示跳过数；右键菜单依据同一份过滤结果把「删除」置灰并换文案，属性面板单选也给一个危险按钮。

**理由**：用户反馈「模板的删除功能有问题，要么删不掉，要么删不完」。探针复现出的真 bug 是：选中根节点后按 Delete → `removePatches` 把根也删了 → `ElementView` 读 `store.nodes[undefined]` → 画布白屏（`TypeError ... reading 'id'`）。核心层的级联删除（`subtreeIds` + 深度逆序）本身是对的，问题全在入口没有边界检查。

**代价**：锁定元素必须先解锁才能删，多了一步；「删除」的语义变成「删除可删的那部分」，提示文案需要跟着写清楚。

## D59：层级点选（第一次选外层分区，再点下钻）+ 面包屑 + Esc 退层

**决定**：`CanvasStage.pickTarget()` 按「被点节点到根的链」决定选中项：没有选中时选最外层分区，已选中链上的某一层就往下钻一层，到底后循环回分区；`Alt + 点击` 直接选被点节点。画布左上角渲染 `[data-role="selection-path"]` 面包屑（点击任一层直接选中），`Esc` 在 `EditorShell` 里先走 `store.selectParent()`、没有选中才清空。

**理由**：树形文档里「点哪选哪」会让用户永远点不到外层容器（子节点铺满），也就拖不动分区、改不了分区背景。参考实现是扁平模型没这个问题；我们保留树结构，用「层级点选 + 面包屑 + Esc」补齐可达性。

**代价**：第一次点击不再是「最精确的那个元素」，用户要连点两下才能选中文字节点（`Alt` 可绕过）；`selectionPath` 是新增的派生状态。

## D60：页面级操作全部进撤销栈（文档级历史条目）

**决定**：`addPage` / `renamePage` / `removePage` / `loadTemplate` 从 `setDoc()`（会 `createHistory` 清空历史）改成 `commitDoc(label, next)`（`commitDocEntry` 的文档级条目）。`switchPage` / `applyViewport` 仍然只换 `base`、不进历史。

**理由**：用户反馈「删不完」—— 探针确认从模板新建页面、删除页面之后 `historyLabels` 只剩 `['初始状态']`，用户删错了没有任何补救手段。页面增删是真正的文档变更，必须可撤销；切页/改视口是「看文档的姿势」，进历史只会淹没撤销栈。

**代价**：文档级条目各存一份完整 Doc（内存翻倍），连续删 20 页会占不少堆；撤销栈的粒度变粗（一次删页只算一步）。

## D61：右侧栏改成页签，面板全部 `v-show` 保持挂载

**决定**：`EditorShell.vue` 右栏改成 `.side-tabs` + `.side-body`，七块面板（属性 / 布局 / 主题 / AI / 历史 / 分享 / 代码）用 `v-show` 切换，不用 `v-if`。

**理由**：原来七块面板竖着堆，滚动条长得看不到底（用户反馈「排版让人看着很不舒服」）。用 `v-show` 是因为面板里有状态（AI 候选、代码页签、主题草稿），切走再切回不该丢；既有组件测试也都按「面板一直挂载」写的，换成 `v-if` 会连带改一堆断言。

**代价**：首屏要把七块面板都渲染一遍（组件都很轻，实测可忽略）；`v-show` 隐藏的面板仍在 DOM 里，按选择器查找时要留意「存在但不可见」。

## D62：删除后画布会白屏这条，靠组件测试锁住

**决定**：`tests/component/selection.spec.ts` 里 11 个用例覆盖网格层、空白/根点击清选、层级点选与 `Alt`、面包屑、锁定/根删除保护、删容器级联可撤销、页面操作可撤销、单选删除按钮。

**理由**：根节点删除导致的崩溃只在「画布真的挂载 + 选中根 + 按 Delete」的组合下出现，单元测试（`core/ops`）永远碰不到；而这类崩溃一旦回归，用户看到的是整片白屏，必须用组件测试锁死。

**代价**：这个文件依赖 jsdom 布局垫片与真实 pinia，跑得比单测慢（约 0.6s/11 例），并且要维护 `nestedFixture()` 这类组件级夹具。

## D63：节点类型名统一走 `componentLabel()`（中文）

**决定**：`core/components` 新增 `componentLabel(type)`，返回注册描述符的 `label`，未注册的类型原样返回。图层面板的类型列、属性面板的 `prop-type`、画布单选角标、层级面包屑全部改用它，不再直接渲染 `node.type`。

**理由**：用户 m09506 反馈「图层中的英文换成中文」。原来图层行显示 `text` / `section` / `frame`，而组件面板里同一批组件叫「文本 / 区块 / 容器」，一处中文一处英文对不上，用户根本分不清图层里哪一行是什么。描述符里本来就有中文 `label`，只是渲染时没用。

**代价**：类型名依赖注册表——`unregisterComponent()` 之后老文档里的节点会退化成英文类型名；自定义组件（「我的组件」）显示的是它注册时的 `label`，改注册名会连带改图层里的显示名。

## D64：删除入口显性化（图层行 🗑 + 顶栏「删除」），仍走同一条 `removeSelection()`

**决定**：图层每一行加 `data-role="layer-delete"` 的删除按钮（先 `select(id)` 再 `removeSelection()`），顶栏撤销/重做旁加 `data-role="toolbar-delete"`（无选中时禁用）。两者都不新写删除逻辑，与 Delete 键、右键菜单共用 `store.removeSelection()` 的保护规则。

**理由**：用户 m09506 第二次反馈「删除功能故障依然没有修复」。代码层（`removeSelection` → `removePatches` 级联 → 历史条目不合并 → 自动保存）逐条查过没有新的逻辑错误，组件测试也复现不出来；能确定的只有「用户的删除入口不明确」——原来只有键盘 Delete、右键菜单、属性面板底部按钮三处，图层行只能显隐/锁定/上下移层，用户自然会在图层里找删除。把入口做显眼、并让每个入口都落在同一条有边界检查的路径上，是这一轮能给出的确定性改进。

**代价**：同一动作有五个入口（多出来的两个需要跟着维护 `data-role` 与测试）；顶栏多占约 60px 宽度，窄屏（<1280）时要靠 `editor-bar` 换行。

## D65：新建页面后不再自动选中根容器；删除按钮按「可删性」置灰

**决定**：`addPageFromTemplate()` 与 AI 生成页面（`aiGeneratePage()`）提交文档后把 `selectedIds` 清空，不再选页面的根 frame。store 新增 `canRemoveSelection`（选区里至少一个既不是 `rootId` 也没 `meta.locked` 的节点），顶栏删除按钮、属性面板危险按钮、右键菜单删除项都按它置灰；`removeSelection()` 在只剩根时给出「这是页面画布本身（根容器），删不掉；要删的是画布里的元素」。

**理由**：用户 m09886 反馈「显示根节点不能删除，但那也不是网格画布，而是一个矩形」。组件测试探针（`addPageFromTemplate('landing')` → `selected=[新页 rootId]` → `Delete` → toast「根节点不能删除」）复现出唯一一条能把根塞进选区的路径：新建模板页后自动选中新页的根 frame。根 frame 在画布上就是一片被选中的大矩形（`outline` 只画边框），用户看到的正是「一个删不掉的矩形」，且按几次 Delete 都提示同一句——这同时解释了更早的「模板的删除功能有问题，要么删不掉，要么删不完」。

**代价**：新建模板页后属性面板是空态，要先点一下画布元素；如果将来想「新建后聚焦页面设置」，得另开一条「页面设置」入口而不是靠选根。

## D66：页面根 frame 的底色画在 `.canvas-page` 上，右键根 frame 不算选中根

**决定**：`ElementView` 对页面根节点（`parentId === null`）渲染时把 `style.bg` 摘掉（用节点副本调 `inlineStyle`），根底色改由 `CanvasStage` 的 `pageStyle`（`resolveStyle(root.style, doc.theme)` 后取 `bg` / `radius`）写到 `.canvas-page` 的行内样式上。右键命中根 frame 时不再 `select(rootId)`，保持原有选区不变。`ContextMenu` 的删除项文案固定为「删除」，不可用原因（未选中 / 锁定 / 页面画布本身）写进按钮的 `title`。

**理由**：用户 m10165 反馈「画布的方格没了，而且右键为什么没有删除选项了」，两条是同一处交互的连带症状：①根 frame 铺满整页且带不透明底色（模板页 `#FFFFFF` / `#0F172A` / `#F8FAFC`），它渲染在网格层之上，把 M9 加的网格整个盖住——只有空白项目（根 `bg: ''`）看得见格子；②右键页面空白命中的是根 frame，把根塞进选区后删除项被置灰并换成一句「这是页面画布，删不掉」，菜单里就找不到「删除」二字。

**代价**：根 frame 的底色不再由元素自身的行内样式决定，画布与导出因此在「根节点背景」这一处走了两条路径（导出仍由 `generatePageCss` 按节点出规则，结果一致）；根 frame 若有非零 `radius`，圆角现在也画在容器上，容器不 `overflow: hidden`，极端圆角下子元素会溢出圆角；右键空白时「删除」保持置灰可用但不会选根，用户想删页面本身仍要用页签上的 ✕。

## D67：组件面板改单列 + 分类可折叠（默认收起表单/媒体，搜索时全展开）

**决定**：`.palette-grid` 从两列改单列（`grid-template-columns: minmax(0, 1fr)`），左栏 176px → 200px；每个分类标题变成一个按钮 `data-role="palette-toggle-<key>"`（▾/▸ + 名字 + 项数），`COLLAPSED_BY_DEFAULT = new Set(['form', 'media'])` 决定默认收起哪些分类；点标题切换 `openGroups`，搜索词非空时 `isOpen()` 恒真。展开/收起用 `v-show`，**不能改成 `v-if`**。

**理由**：用户 m10495 反馈「组件似乎过多了，且一行两个组件选项会导致组件名称显示不全，建议改成一行一个」。40 个组件平铺在 176px 的两列里，`.palette-item__label` 只能靠省略号截断；单列 + 折叠把首屏从 40 项降到 24 项（布局 8 + 基础 8 + 展示 8 展开，表单 12 / 媒体 5 收起）。`v-show` 是因为既有测试按 DOM 计数（40 个 `.palette-item`、分类数组、自定义组件、搜索过滤）断言，`v-if` 会让隐藏分类从 DOM 里消失、连带搜索与计数全坏。

**代价**：折叠状态只存在组件内存里，刷新回默认；DOM 里始终挂着 40 个组件节点（只是隐藏），跟「按需渲染」比没省内存；分类标题多了一行，左栏整体比原来长。

## D68：`.editor-input` 收进共享 CSS，`tokens.css` 补齐被 fallback 的变量，外壳加底色/阴影层次

**决定**：在 `editor.css` 补一段共享 `.editor-input` 规则（高 28、1px `--studio-input-border` #dbe2ea、白底、圆角 6、hover 加深、focus 主色边 + `--studio-ring`、`select` 自绘 chevron、`textarea` 自适应、`.editor-input--width` 66px），`.prop-input` 同步；`tokens.css` 重写并补齐 `--studio-text-muted` / `--studio-surface-2` / `--studio-surface-3` / `--studio-border-soft` / `--studio-border-strong` / `--studio-input-border` / `--studio-shadow-sm` / `--studio-warning`；再调外壳：顶栏白底 + 阴影、侧栏与状态栏浅灰 `--studio-surface-2`、`.panel` 变白卡片、`.canvas-stage` 内阴影、`.canvas-page` 双层投影、选中页签白底 + 主色下划线。

**理由**：用户 m10495 反馈「几乎所有的输入框边框太黑了，弄成浅灰色」+「一眼望去白茫茫一片，我希望有点层次感」。前者的真因是 `.editor-input` 这个类在 CSS 里**从来没有规则**——AI 面板、主题面板、历史、分享、页面模板下拉、顶栏视口宽度全在吃浏览器默认的深灰 2px 边框，只有 `.prop-input` 有样式；后者的真因是顶栏 / 侧栏 / 面板 / 画布全是同一个白底或近白底，且 `tokens.css` 缺 `--studio-text-muted` / `--studio-surface-2`，这些变量一直靠 `editor.css` 里的 fallback 生效。

**代价**：输入框样式分散在 `.editor-input` 与 `.prop-input` 两处，没抽成设计系统组件；`type="color"` / `range` 这类原生控件仍吃浏览器默认样式；层次感是手写的底色/阴影取值，没有浅色/深色两套主题，将来接主题切换要一起改；`--studio-bg` 从 `#f3f4f6` 调到 `#eef1f6`，画布区观感随之变化。

## D69：主题变量显示中文说明，原始英文名保留在下方

**决定**：`core/theme` 新增纯函数 `tokenLabel(name)`：先按 `groupOfToken()` 分组，颜色组用 `COLOR_SUFFIX_LABELS` 映射后缀（primary 主色 / text 正文颜色 / muted 弱化文字 / bg 背景色 / surface 面板底色 / border 边框色 / danger 危险色 / warning 警告色 / success 成功色 / shadow 阴影色），尺寸组用 `SIZE_SUFFIX_LABELS`（xs 微小 … xl 特大）+ `SIZE_GROUP_NOUNS`（字号 / 间距 / 圆角 / 阴影）拼成「小圆角」「特大字号」这类中文名，认不出的后缀回落「组名·后缀」。`ThemePanel` 主标题显示 `tokenLabel()`，同一行的 `<code class="theme-token__raw">` 保留原始英文名；面板标题也从「主题 token」改成「主题变量」。

**理由**：用户 m10495 反馈「主题方面英文太多了」。但英文 token 名是**要写进样式**的（`$color-primary`），直接替换成中文会让用户没法引用；所以中文只做「这行是什么意思」的说明，真正要复制的英文名留在下面同期可见。

**代价**：中文名只影响显示，样式引用 / 导出 / `themeVariablesCss()` 仍是英文；自定义 token（如 `brand`）认不出后缀，显示成「其他·brand」；store 的动作名与 toast 仍是「主题 token：xxx」（测试按这个断言，没跟着改）。

## D70：视口尺寸显示成「宽 × 高」，预设按钮两行、宽高各自可改

**决定**：`VIEWPORTS` 的 `label` 只留预设名（桌面 / 平板 / 手机），尺寸由 `viewport().w/h` 派生；顶栏尺寸组改成「三个两行按钮（名字 + `1440 × 900`）+ 宽输入 × 高输入 + `1440 × 900` 文本」，`[data-role="viewport-label"]` 显示 `${w} × ${h}`；新增 `store.setViewportHeight()`（与 `setViewportWidth()` 一样夹取 200–10000 后复用 `applyViewport()`），`data-role="viewport-height"` 改动后面板与画布同步。

**理由**：用户 m10790 反馈「尺寸选择应是类似于 1440*900 之类的展示形式」。原来顶栏只有一个宽度输入框和「桌面 1440」——高度既看不见也改不了，而 `Page.viewport` 是宽高成对的（导出 body、画布纸张都用它）。

**代价**：`viewport().label` 不再带尺寸（老测试里「label 含 375」的断言改成断言 `${w} × ${h}`）；按钮变两行后顶栏高 52 → 56px，窄窗口下尺寸组会换行；「自定义 1024」这种旧 label 没有了，改成显示完整宽高。

## D71：一键清空当前页面元素，走一次文档补丁提交

**决定**：store 新增 `canClearPage`（`topLevel.length > 0`）与 `clearPage()`：取根容器的全部直接子节点 → `removePatches()` 级联删整棵子树 → `commit('清空页面（N 个元素）', patches)` → 清空选区 → toast 提示可按 Ctrl+Z 撤销。顶栏加 `data-role="toolbar-clear"`（无元素时禁用），不做二次确认。

**理由**：用户 m10825 追加「加上一键清除功能」。删除**整页所有元素**用逐个选删太慢；因为清空是一条可撤销的历史记录，误点的代价是 Ctrl+Z，所以不需要确认弹窗（也避免在 jsdom/无 `window.confirm` 的环境里多一条分支）。

**代价**：只清当前页面，不是「清空整个项目」（新建项目仍走 `newProject()`）；清空后页面背景/尺寸/主题仍在，想连页面一起重置要用「新建」；`removePatches()` 的每元素一条补丁都进了同一个条目，节点多时历史条目体积偏大。

## D72：画布内容盒改 `border-box`，单行控件垂直居中，补齐画布内容类样式

**决定**：`.canvas-el__content` 改 `display:flex; flex-direction:column; box-sizing:border-box`（保留 8px 内边距）；按 `data-type` 把单行控件（button / badge / label / link / input / select / date / number / file / switch / alert / tabs / nav / audio / slider）的内容盒改成横向 + `align-items:center`，图标 / 头像 / 视频居中，复选 / 单选横排换行；补齐 `.canvas-el__title` / `__muted` / `__sub` / `__frame-hint` / `__caret` / `__choice` / `__box` / `__dot` / `__switch` / `__play` 的规则（此前画布 CSS 里完全没有），以及画布里复用导出 HTML 的 `.el__list` / `.el__table` / `.el__tabs` 基础排版。

**理由**：用户 m10825 反馈「部分组件内的文字或提示字体与上下边框的距离并不一致」。两个真因：①内容盒没写 `box-sizing`，`height:100%` + 8px 上下 padding 在 content-box 下多出 16px 被 `overflow:hidden` 裁掉——上边距 8px、下边距变成 0；②画布里的标题 / 弱化文字 / 副标题 / 下拉箭头 / 复选方框 / 开关 / 播放图标等 `canvas-el__*` 类**没有任何 CSS**（导出侧有 `.el__title` / `.el__muted` / `.sub` 规则），于是副标题和正文同字号、提示文字不变灰、下拉箭头紧贴文字，看起来「间距不齐」。

**代价**：画布的内容盒是「编辑期排版」，与导出 HTML 的盒模型仍不是一套（导出侧没有这层 padding / flex，节点 `layout.padding` 也不参与导出）；`.el__list` / `.el__table` / `.el__tabs` 只在画布侧补了样式，导出侧仍是浏览器默认样式；新增的居中规则按 `data-type` 白名单维护，以后注册新组件类型时要记得加进名单。

## D73：缩放百分比改成可直接输入的数字框（`<select>` → `<input type="number">`）

**决定**：顶栏缩放组中间的 `[data-role="zoom-select"]` 下拉换成 `[data-role="zoom-input"]` 数字输入框（`min=25 max=200 step=1`，右侧绝对定位一个 `%` 后缀，去掉 number 的上下箭头），`@change` 时 `store.setZoom(Number(raw)/100)`，随后把输入框的值回写成夹取后的真实百分比；回车触发 blur 让 `@change` 生效。`store.setZoom()` 增加 `if (!Number.isFinite(value)) return` 守卫。`－` / `＋`（每次 25%）与「适应」保持不变。

**理由**：用户 m11090 反馈「百分比改为我能输入具体数值」。上一轮是固定档位的下拉，只能选 25 / 50 / … / 200，想精确到 113%（例如让 1440 宽的设计稿刚好塞进画布）或复现某个特定比例时无路可走。

**代价**：手输不再受「25 的整数倍」约束，画布宽度可能出现 `532.8px` 这类非整数（本来就允许，「适应」早就会产生）；输入框比下拉多占几像素宽度；没有做输入防抖/延迟应用，`@change` 后立即缩放；越界值被静默夹取（输 `900` 变成 `200`），不会提示原因。

## D74：画布缩放层以左上角为原点（`transform-origin: 0 0`），而不是浏览器默认的中心

**决定**：`.canvas-page__inner`（宽高恒为设计尺寸 `vw × vh`，用 `transform: scale(zoom)` 缩放）显式设置 `transform-origin: 0 0`——模板里写成内联样式 `transformOrigin: '0 0'`（便于组件测试断言），`editor.css` 里同一规则再写一份并加注释。外层 `.canvas-page` 的宽高仍是 `vw × zoom` / `vh × zoom`，网格按 `8×zoom` / `64×zoom` 画在这层。

**理由**：用户 m11226 反馈「缩放时组件与画布的相对位置会改变、会错位，占位文字『从左侧拖入组件开始搭建』也会偏移，蓝色虚线框与画布并不重合」。根因是 `transform: scale()` 没写原点：CSS 默认 `50% 50%`，zoom=50% 时内容以中心为轴收缩、整体偏移 `(1−zoom) × 尺寸 / 2`（1440 宽时 360px），而外层容器已经是缩放后的尺寸并居中，于是元素、选中框、多选框、拖入提示全部相对画布错开。`localPoint()` 用 `.canvas-page` 的 `getBoundingClientRect()` 除以 zoom 换算坐标，也需要「缩放原点 = 容器左上角」才准确，顺带修好了非 100% 缩放下拖拽/框选的偏移。

**代价**：缩放与定位的正确性现在依赖「外层容器尺寸 = 设计尺寸 × zoom」与「缩放层原点在左上角」这两个约定同时成立，以后若把页面居中改成 `translate`/`left` 偏移的方式，坐标换算（`localPoint()`、`multiBox`、吸附线）要一起改；`transform-origin` 写了两处（内联 + CSS），改的时候要同步；没有引入真正的「缩放后重排」（设备间自适应仍是手动断点覆盖，见 M14/M15 的取舍）。

## D75：拖拽位移改用「按下时的画布矩形 + 按下时的缩放比例」换算，不再每次 `pointermove` 重读矩形

**决定**：`Interaction` 增加 `scale`（按下那一刻的 `store.zoom`），并新增 `dragPoint(active, clientX, clientY)`：设计坐标 = `startLocal + (client - startClient) / scale`。移动、缩放（拉手柄）、框选三条拖拽路径全部改用它；`store.pointer`（悬停指示）仍然用实时的 `localPoint()`，因为它描述的是「指针现在在哪」，本来就该跟着滚动/位移变。

**理由**：用户 m11339 反馈「在不同的尺寸下，当我用鼠标拖动组件时，组件与鼠标的相对位置会改变」。此前每次 `pointermove` 都用 `localPoint()`（实时读 `.canvas-page` 的 `getBoundingClientRect()` 再除以当前 zoom）算绝对坐标，再和按下点的绝对坐标相减。只要画布容器在拖拽期间发生位移或宽度变化——滚动条出现/消失把居中的页面挤动、窗口尺寸变化、页面居中方式变化——「现在的原点」和「按下时的原点」就不是同一个，差值里多算了一份容器位移，表现就是元素越拖越偏，且偏移量随缩放比例放大。改成按下时取一次原点、之后只累加屏幕位移，元素相对鼠标的位置在整个拖拽期间严格不变。

**代价**：拖拽期间若用户真的滚动画布（滚轮/触控板），元素不会跟着滚动的坐标系走——这是有意的取舍（拖拽时坐标系应冻结），但意味着「拖到一半滚动再继续拖」会以按下时坐标系为准；`scale` 也是按下时快照，拖拽中改缩放（目前只有 Ctrl+滚轮会触发）不会让拖拽错乱，但落点按旧比例换算；`localPoint()` 与 `dragPoint()` 两套坐标语义并存，新写的拖拽逻辑必须用后者。

## D76：文本/标题的内容盒纵向居中、上下只留 2px 缓冲

**决定**：`.canvas-el[data-type='text'] > .canvas-el__content` 与 `heading` 两条规则改成 `justify-content: center; padding: 2px 8px`（其它组件仍是 `padding: 8px`、纵向排列）。

**理由**：用户 m11339 反馈「文本组件的文本上下边框的间距依然偏下」。内容盒默认上下各 8px 内边距，而 `line-height: 1.4` 的行盒往往比「元素高 − 16px」还高（文本默认高度就是一行多一点），溢出部分被 `overflow: hidden` 从**下面**裁掉，于是上边距 8px、下边距 0，文字整体偏下。纵向 padding 压到 2px 并把内容垂直居中后，上下间距对称；多行文本同样居中，内容超出时上下等量裁切，而不是只吃底部。

**代价**：画布上多行文本是垂直居中而不是顶部对齐（导出侧 `.el` 仍是顶部对齐，见 M14 记录的「画布与导出盒模型两套」）；标题同理，长标题换行后居中可能与设计稿预期不同；这是纯 CSS 修正，组件测试（jsdom 不算样式）锁不住，只能靠浏览器目测。

## D77：画布内禁用浏览器的原生拖拽与文字选区

**决定**：`.canvas-stage` 上三件套：①`onStagePointerDown` 里对非 `.canvas-text-editor` 的目标调 `event.preventDefault()` 并 `window.getSelection()?.removeAllRanges()`；②模板根节点加 `@dragstart.prevent`；③`editor.css` 给 `.canvas-stage` 加 `user-select: none`，只对 `.canvas-text-editor` 及其 `input` 放开 `user-select: text`。

**理由**：用户 m11566 反馈「问题依旧存在，且在拖动时有概率会将该组件复制一份」。画布里的文字一旦被选中（或指针落在图片/链接这类浏览器默认可拖的内容上），浏览器会自己发起一次**原生 drag**：显示一个跟随鼠标的半透明快照（看上去就像「复制了一份」），同时给画布发 `pointercancel`——我们的 pointer 拖拽被掐断，元素停在半路不再跟手（看上去就是「组件与鼠标的相对位置变了」）。这两条症状是同一个原因，且都「有概率」，取决于指针落在什么内容上、有没有先选中文字。把原生拖拽和选区都关掉之后，画布里的手势只走 Pointer Events 一条路。

**代价**：画布里的文字不能再用鼠标选中复制（编辑走双击后的输入框，那里放开了选区）；`pointerdown` 里 `preventDefault()` 需要显式豁免 `.canvas-text-editor`，以后新增画布内的输入控件时也要加进豁免。

## D78：拖入只接受注册过的组件类型，并对「同一次手势的重复落点」去重

**决定**：`CanvasStage.onDrop()` 先取 `event.dataTransfer.getData('text/plain')`，`getComponent(raw)` 不存在就直接 `return`（不插入任何东西）；再维护一个 `lastDrop = { type, at, x, y }`，同一个类型 + 落点相距 < 8px + 间隔 < 500ms 的第二个 `drop` 直接丢弃。`PalettePanel` 侧再补一层：`onDragStart` 记录 `dragStartedAt`，`add()` 在 `Date.now() - dragStartedAt < 400` 时直接 return。

**理由**：以前 `onDrop` 写的是 `getData('text/plain') || 'text'`，任何一次原生 drop（拖图片、拖链接、拖选中文字、从别的窗口拖东西进来）都会被当成「插入一个 text 组件」——这正是「拖动时多出一个组件」的另一条来源。类型白名单把这条路堵死；`lastDrop` 去重是给「浏览器 + 我们自己的保险各发一次 drop」留的兜底。面板那层时间窗则挡掉「拖拽结束后浏览器补发一个 click」导致的 `insertComponent` 二次执行。

**代价**：`text/plain` 里如果不是组件类型，拖入就静默失败（没有提示，用户拖错了不会知道原因）；500ms/8px 的去重窗意味着「真的想在同一位置连续拖入两个同类型组件」时，第二次要等半秒或挪开一点；面板的 400ms 时间窗在极快的手速下理论上会吞掉一次「拖完立刻点加号」的点击（实际手速远小于此）。

## D79：磁吸阈值按缩放换算成固定的屏幕像素

**决定**：`applySnap` 的阈值从固定的 `SNAP_THRESHOLD`（6 设计像素）改成 `snapThreshold(interaction) = SNAP_THRESHOLD / (interaction.scale || 1)`，移动与拉手柄两条路径都用它。

**理由**：`6 设计像素` 在 100% 缩放下等于 6 屏幕像素，但在 200% 缩放下是 12 屏幕像素——拖到离对齐线还有一段距离就被吸过去，元素和鼠标的相对位置会「跳一下」，用户会把它当成又一种漂移。改成按缩放换算后，任何缩放比例下的吸附手感都是 6 屏幕像素。

**代价**：缩放越小（25%）吸附的「设计像素」范围越大（24 设计像素），低缩放下容易误吸；磁吸强度不再与设计尺寸成正比，和「6px 网格对齐」的直觉有细微出入。

## D80：状态栏显示界面版本号（`BUILD_TAG`），用来区分「没修好」和「看的是缓存」

**决定**：新增 `src/config/build.ts` 导出 `BUILD_TAG`（当前 `'M18'`，与 README/PLAN 的里程碑号一致），`StatusBar.vue` 最右侧渲染 `[data-role="build-tag"]`，`title` 说明「和仓库最新提交对不上就是浏览器缓存，按 Ctrl+F5」。

**理由**：连续几轮用户反馈「问题依旧存在」时，最耗时的分歧是「你说修了、我看到没变」——到底是代码没生效还是浏览器用了旧模块/旧的 HMR 连接，光靠截图和描述分不清。把版本号放在状态栏，一眼就能确认页面加载的是哪一版（沙箱里无法截图、也无法用真实浏览器复现，这个角标是最便宜的对齐手段）。

**代价**：多一个每次发版要手动改的常量（忘了改就会误导排查）；状态栏多占一点宽度；它只是「界面代码的版本」，不代表 `dist` 产物版本——真正的生产构建仍靠文件名 hash 区分。

## D81：拖拽几何一律用「当前断点的绝对盒」起算，写回 `setBox()` 时换回相对盒

**决定**：`Interaction` 在按下时同时快照两份盒：`boxes: Map<NodeId, Box>` 取 `store.boxes`（页面绝对坐标，用于位移、吸附、包围盒、缩放起始框），`rels: Map<NodeId, Box>` 取 `rectOf(view.value[id])`（相对父容器内容框，写回 `setBox()` 用）。`beginMove()`、缩放手柄按下、`snapTargets()`（六条边一律取 `store.boxes`）、移动写回（`startRel + shift`）、缩放写回（`startRel + (snapped - startBox)`）全部遵守这条分工；`onStagePointerDown` 里判断 `locked` 也从 `store.nodes` 改成当前断点的有效节点。`src/config/build.ts` 的 `BUILD_TAG` 改成 `'M19'`。

**理由**：用户 m12314 给了决定性线索——「鼠标按在组件的后半段时，一拖拽就可能跑到前半段」。`beginMove()` 以前从 `store.nodes[id].layout` 取起始盒，那是**基准断点**的几何；而画布渲染与 `store.boxes` 用的是 `viewNodes`（基准 + 当断点 `overrides`）。元素在窄断点上被调过位置/尺寸后，两套坐标不重合：第一帧位移为 0，`setBox()` 却把相对盒按基准坐标写回去，元素瞬间跳到基准位置，跳变量正好等于两套坐标的差——按在后半段时鼠标就落在跳完后的前半段。另外 `setBox()` 的入参是相对父容器内容框的，而位移/吸附在绝对空间算，混用时嵌套容器里的元素会多算或少算一个父级原点（吸附吸不准、缩放位置偏移）。

**代价**：每个拖拽/缩放手势多存一份 `Map`（节点数级，可忽略）；「绝对盒」与「相对盒」两套坐标同时存在于 `Interaction` 上，新写交互逻辑时必须先想清楚当前这段数在哪个坐标系（和 D75 的 `localPoint()` / `dragPoint()` 同类问题，现在共有四种坐标语义）；只有出现过断点覆盖的元素才会触发旧 bug，没有覆盖时基准几何 = 有效几何，这也解释了前几轮为什么难复现。

## D82：双击编辑对所有对外组件开放，写哪个字段由描述符的 `editKey` 决定，看不见文字时用 `.el__caption` 角标显示

**决定**：`ComponentDescriptor` 增加两个可选字段：`editKey`（双击编辑写 `props` 的哪个字段，缺省 `'text'`）与 `caption`（内容渲染里没有文字时，是否把用户自定义的 `text` 以 `.el__caption` 角标显示）。`spec()` 里 `editable` 对四个内部类型（root/page/instance/symbol）之外的组件一律为 `true`，`editKey` 缺省 `'text'`。输入类（`input` / `textarea` / `number`）的 `editKey` 是 `'placeholder'`——它们在画布上显示的本来就是提示文字。`caption: true` 加在内容里没有文字的 15 个组件上（frame / group / section / container / columns / divider / spacer / rect / circle / form / date / file / slider / rating / progress）；`captionOf()` 只在「用户改过 text」时输出角标（`text` 为空或等于默认 props 时不显示），且由 `renderContent()` / `renderCanvasContent()` 统一加前缀，画布与导出共用同一条规则。`startEdit()` 按 `editKeyOf(type)` 读/写 `props[editKey]`，行内编辑框的 `placeholder` 也跟着变（`文字内容` / `占位文字`）。

**理由**：用户 m12600 反馈「有部分组件无法输入文本，如所有布局组件，表单容器，输入框、文本域、进度条等」。根因有两层：`ElementView` 的 `@dblclick` 一直有 `if (!editable.value) return`，而只有 text/heading/button/link/badge/nav/header/card 九类标了 `editable: true`，其余组件双击直接没反应；输入类即使标了 `editable`，画布上显示的是 `placeholder` 而不是 `text`，原来的 `startEdit()` 只改 `text`——等于「能弹出输入框，但输完画布上看不见」。直接在样式层做「编辑时切开一个 input」不现实：这些组件的内容是 `v-html` 出来的语义 HTML（table/select/svg…），DOM 不可控，而统一写 `text` + 角标能用一条规则覆盖全部组件，且不改变既有 `toHtml()` 的输出（隐藏的 `text` 本来就会被忽略）。

**代价**：`editable` 语义从「描述符能力」退化成「除内部类型外全开放」，自定义组件作者不能再单独关掉某个组件的中文编辑（`editKey` 可以引导它写到别的字段）；角标是「附加在内容之上」的，不适合需要精确预览的组件——想彻底自定义的组件应显式设 `caption: false` 并自己渲染文字；角标与真实内容的相对位置（顶部 & 半透明）与设计稿可能不一致，多行 `text` 会被 `overflow: hidden` 裁掉。

## D83：表格的 `th/td` 必须 `text-align: inherit`，否则属性面板的「水平对齐」永远被浏览器默认值盖掉

**决定**：编辑器 `src/styles/editor.css` 里 `.canvas-el__content .el__table th, td` 的 `text-align: left` 改成 `inherit`；`src/core/codegen/index.ts` 的 `BASE_CSS` 补上表格基础规则（`.el__table { width:100%; border-collapse:collapse }`、`th/td { padding:4px 8px; border:1px solid #e2e8f0; text-align:inherit }`），与画布预览对齐。

**理由**：用户 m12600 反馈「表格的水平对齐基本毫无作用」。`declarations()` 会把 `style.align` 输出成节点类上的 `text-align:center/right`（左对齐不输出，靠继承），但编辑器 CSS 里一条更高优先级的 `.canvas-el__content .el__table th { text-align: left }` 把所有单元格钉死在左对齐——`th` 的浏览器默认还是 `center`，所以既有「点居中没反应」也有「表头本来居中、点左对齐也没反应」两种错觉。属于「样式层把数据层输出盖掉」，和 M16 的 `transform-origin` 同类：用户看到的错位/失效其实是 CSS 默认值/覆盖，不是交互逻辑。

**代价**：`th` 不再有「表头自动居中」的默认行为，需要用户自己选居中（这是有意的——「所见即所得」优先于浏览器默认）；`inherit` 依赖祖先链上真的有人设置 `text-align`，如果以后给 `.el__table` 自身加了对齐规则，单元格会一起变；导出侧新增两条基础规则会让 M5 的结构快照变化（已同步更新快照）。

## D84：空态提示只在「文字还是默认值」时出现（`customText`），输入类默认文字色从占位灰改正文色、默认提示搬进 `placeholder`

**决定**：渲染上下文 `ComponentRenderContext` 增加 `customText: text !== descriptor.defaultProps.text`（清空 `text` 也算改过）。frame / group / section / container / columns / form 六个容器的空态提示统一改成 `ctx.children.length > 0 || ctx.customText ? '' : muted(...)`。`input` / `textarea` 的描述符不再吃 v1 默认值，改为显式 `size` + `style: { fontSize: 13, color: '#1E293B', bg: '#FFFFFF', radius: 6, borderWidth: 1, borderColor: '#CBD5E1' }` + `props.placeholder`（`请输入…` / `请输入内容…`）；`V1_DEFAULTS` 迁移表保持原样，描述符覆盖在 `tests/unit/components.spec.ts` 里用 `M21_OVERRIDES` 显式登记。颜色侧：`editor.css` 的 `.canvas-el__muted` / `.canvas-el__frame-hint` 从 `opacity: .65` 改成实色 `color: var(--studio-text-weak, #475569)`；`.el__caption` 与 `BASE_CSS` 的同名规则去掉 `opacity`、字号 13px、颜色继承。`src/config/build.ts` 的 `BUILD_TAG` 改 `'M21'`。

**理由**：用户 m13007 反馈「除表格外，都有字体颜色过淡的问题（与预设文本都是淡灰色），且当我输入文字后，预设文本（如空容器）并不会消失，且无法删除预设文本」。三个来源分别是：①输入类沿用 v1 的 `#64748B`（在 v1 里那是 placeholder 的灰），而 M20 之后画布与导出都把 `placeholder` 当正文渲染；②空态提示的灰是 `opacity` 和背景混出来的，不是 token；③空态提示是组件渲染的 HTML、只看「有没有子节点」，和用户改没改文字无关——所以它既不会因输入而消失，也没有可删除的入口（用户能看见它、却永远改不了它）。把「是否改过文字」变成渲染上下文里的显式布尔值，一条规则就能让六个容器同时满足「输入即替换、清空即删掉」，而不用在 DOM 层做「可编辑的预设文本」（`v-html` 出来的语义 HTML 不可控，加 contenteditable 会破坏标签结构）。

**代价**：`customText` 的判定是「文字 ≠ 默认值」而不是「用户是否操作过」——把文字改回默认字面值（比如把容器文字又输回「容器」）会重新显示提示，「重置」只能重新拖一个组件；颜色只改默认值，已经被用户手改过颜色的节点不受影响；导出侧 `.el__muted` 仍是 `opacity: .65`，与编辑器的 `--studio-text-weak` 是两套弱化实现（导出页面没有编辑器 token）；输入类默认提示从 `text` 搬到 `placeholder`，与 v1 迁移表不一致，靠单测的 `M21_OVERRIDES` 锁住，以后若改 v1 表要同步删掉这层覆盖。

## D85：旧文档里停在 v1 占位灰的输入类，在收敛层一次性迁移字色与 `placeholder`

**决定**：`src/core/schema/normalize.ts` 新增 `migrateLegacyInput(node)`，在 `normalizeNode()` 返回前执行：①`input` / `textarea` 的 `style.color` 若仍是 v1 的占位灰 `#64748B`（大小写不敏感比较），换成描述符默认正文色；断点 `overrides[breakpointId].style.color` 里同样的灰也一起换；②`props.placeholder` 为空（或缺失）且 `props.text` 非空时，把 `text` 搬进 `placeholder` 并清空 `text`。除了这个字面值，其它颜色一律不动。

**理由**：用户 m13297 接着 M21 说「问题还在」。M21 改的是描述符默认值，只对**新建节点**生效；旧文档 / 导入文件里节点自己存着 `style.color: '#64748B'` 与 `props.text: '请输入…'`，`normalizeStyle()` 会优先采用存储值，所以画布按旧灰渲染、提示也还在 `text` 里——用户看到的就是「改过但没变」。迁移放在收敛层而不是读取时特判：所有入口（本地存档、导入 JSON、v1 迁移、AI 草稿、分享链接）都必须经过 `normalizeDoc()`，一处迁移就能覆盖全部入口，且导出/序列化拿到的就是修好的文档，不需要渲染层到处判断「这是不是旧值」。

**代价**：只在加载路径执行一次——已经加载进内存的文档要刷新页面或重新导入才会迁移；迁移只认 `#64748B` 这个字面值，用户恰好手工挑了同一个灰会被当成「没改过」换成正文色，其它灰阶不受影响；把 `props.text` 搬进 `placeholder` 并清空 `text` 意味着旧节点若拿 `text` 当语义 label 用会丢 label（旧版本里输入类的 `text` 在画布/导出本来就不显示，按「不可见内容」处理）。

## D86：组件面板点击只进入「看属性」的点选态，拖拽是唯一插入通道

**决定**：Store 新增与 `selectedIds` 互斥的 `paletteType`（`ref<SceneNode['type'] | null>`）与 `selectPalette(type | null)`；`select()` / `selectMany()` / `clearSelection()` / `insertComponent()` 都会把 `paletteType` 置空。`PalettePanel` 的 `@click` 从 `store.insertComponent(type)` 改成 `store.selectPalette(store.paletteType === type ? null : type)`（再点一次取消），面板项按 `paletteType` 加 `.is-active` 高亮与 `aria-pressed`，标题文案改成「点击查看属性，拖入画布添加」；同时删掉 M18 为「拖拽后浏览器补发 click 导致多插一个」加的「400ms 内的 click 忽略」守卫（点击不再插入，这个守卫失去意义）。`PropPanel` 在 `store.selectedIds.length === 0 && palette` 时渲染只读信息块（`data-role="palette-props"`：分类 / 默认尺寸 / 默认内容 / 可覆盖字段 / `aiDoc` 说明 + 「取消选择」按钮），`core/components` 相应导出 `categoryLabel()`。

**理由**：用户 m13297 明确要求「左边组件改为点击选择（可以看到右边的属性等），但只能拖拽到画布」。旧行为是点击即插入，用户想先看看某类组件的默认属性（尺寸、默认文案、可覆盖字段）再决定拖不拖，根本没有入口；点击插入还容易在拖拽手势尾巴上多插一个（M18 的 400ms 守卫就是补丁）。把「面板选中」与「画布选中」做成互斥的两个轻量状态，右侧面板按「有节点选中 → 编辑属性；只有面板选中 → 显示该类型的只读默认信息」分支，既满足「点击看属性」，又保持「拖拽才插入」这一条唯一的写入路径。

**代价**：点选态是「轻选择」——不进撤销栈、不进图层面板，切页/新建/撤销后可能仍停着（只在画布选择或插入时清），要退出得点「取消选择」或再点一次该组件；点选态下右侧只读，不能「先改默认值再拖进画布」，必须先拖进去再在属性面板改；`paletteType` 只记类型、不记实例，本来也不该有实例概念。

## D87：把休眠的 `Constraints` 接上——编辑与导出都以「基准断点视口」为参考系，每页记 `designViewport`

**决定**：`Page` 增加可选 `designViewport: { w, h }`（基准断点下的设计尺寸，`normalizePage()` 夹取到 200–10000）；store 新增 `baseViewport`（`activePage.designViewport ?? breakpointViewport(baseBreakpoint)`），`layout` / `exportBoxes` 的 `computeLayout()` 都传 `reference: baseViewport`，`core/codegen` 的 `generateResponsiveCss()` 同样以设计视口为 `reference`；`applyViewport()` 只在基准断点写入 `designViewport`（切到平板/手机改宽高不算改设计尺寸）；`exportDoc` 每页按「自己的 `designViewport` ?? 基准断点预设」回设计尺寸，导出结果不随当前预览断点变化。

**理由**：用户 m13532 要求「完善桌面，平板，手机之间组件相互适应的功能」。`Constraints{h,v}` 与 `applyConstraints()` 从 M2 就实现了右侧/两侧拉伸/居中/等比缩放的换算，但三个开关全关着：默认锚定一律 `{left,top}`、没有 UI、`computeLayout()` 从不传 `reference`（`needsDesignPass` 永远为 false，等于只有一个参考视口）。传了 `reference` 之后，布局引擎现成的 `designBoxes → boxes` 两帧路径就被激活：窄断点下 `right` 会跟着右边贴边、`left-right` 会拉伸、`center` 会重新居中、`scale` 会等比缩放，一行引擎代码都不用改。导出侧同理——媒体查询里的坐标必须相对设计尺寸算，否则「手机上的居中」会按「已经缩过的盒子」二次换算。

**代价**：窄断点下 `computeLayout` 会多跑一遍设计帧（1000 节点 ≈ 4ms，仍在阈值内）；`designViewport` 是新增的持久字段，旧文档没有它会回落到基准断点预设，用户若改过宽高才会写进去；导出固定按设计尺寸意味着「导出的页面宽度 ≠ 当前预览宽度」，调试导出内容时要记得切回桌面断点看；参考系依赖「基准断点 = 按宽度排序的最宽一级」，如果以后允许「把手机设成基准」，要重新审视 `baseViewport` 的取值。

## D88：锚定按几何自动推断、插入即带上，手动覆盖优先

**决定**：`core/responsive` 新增 `inferConstraints(box, content)`（水平：宽占内容框比例 ≥ `SPAN_RATIO=0.85` 或两边留白都 ≤ `ANCHOR_EPSILON=2` → `left-right`、贴右（右侧留白 ≤2）→ `right`、中心偏差 ≤2 → `center`，否则 `left`；垂直同理 → `top-bottom` / `bottom` / `center` / `top`。**不推断 `scale`**：等比缩放会把窄断点里的按钮/标签缩成邮票大小，而且窄断点拖它时位移和尺寸都要乘缩放系数、手感会跟不上鼠标，需要缩放时由属性面板手动选）、`inferPageConstraints(nodes, rootId, viewport, measure?)`（按基准视口跑一次布局，逐节点按「相对父内容框」的盒推断）与 `nodesForLayout(nodes, breakpoints, breakpointId)`（先取有效节点；若该节点在断点级联链上有手动覆盖过 `layout.position`/`layout.size`，或当前断点覆盖里显式给了 `constraints`，就不再被推断值推动，钉成「手动优先」）。store 侧：`insertComponent()` 插入时按当前基准布局推断锚定；`applyResponsiveAdapt()` 把整页仍是默认 `{left,top}` 的节点批量换成推断值（一条可撤销补丁）；`inferDocConstraints()` 在读档、导入文档、载入模板时把存量默认锚定迁移成推断值；`setAbsBox()` 统一收口「绝对盒 → 写回相对坐标」（基准断点写节点、窄断点写 override 且把锚定钉成 `{left,top}`），`CanvasStage` 的拖拽/缩放与 `PropPanel` 的位置尺寸都改走它；`PropPanel` 新增「跨断点适应」区（水平/垂直锚定下拉直接写 `updateLayout()`，基准断点改节点、窄断点写该断点的覆盖，另有「此断点已手动调整」提示与重置）。`BUILD_TAG` 改 `'M23'`。

**理由**：用户选了「A：自动锚定 + 手动覆盖优先」。要「自动」，就必须在没有 UI 的年代给出初始值——存量文档和用户新拖入的组件锚定全是 `{left,top}`，如果只接引擎不推断，自动适配等于没有发生。几何推断能覆盖多数真实排版（通栏容器→两端拉伸、页脚→贴底、标题→居中），而且推断结果立刻可见、可手动改；`scale` 是唯一不自动推断的锚定，因为小控件等比缩小后既不能看、拖动时换算也容易让手感失控，留作手动选项。手动优先是这条方案的兜底：用户一旦在某个断点上拖过/缩过（或在面板里选过锚定），说明他有明确意图，自动推断不能再把它拽回去。`setAbsBox()` 收口是因为 M19 之后画布交互已经统一在绝对坐标空间算，而 `setBox()` 要的是相对父内容框的坐标，不在一处转换就会在嵌套容器里算错父级原点。

**代价**：推断只能按几何猜意图，阈值可能误判（「本想贴左、恰好居中」的元素会被判成居中）；`scale` 不自动推断，想等比缩放要逐个手动选；手动优先是「一拖就定死」——窄断点上动过一次，该节点在整条级联链上都不再自动适配，要恢复得点重置或重新执行整页自动适配；`scale` 手动选上之后是按「当前盒 / 设计盒」等比换算，容器 padding/gap 不参与插值，嵌套深时误差逐级累积；导出仍是「绝对盒 + 媒体查询」，真正的流式布局（C 路线）没做；这套适配只有组件测试锁数值，真实观感仍靠浏览器目测。





