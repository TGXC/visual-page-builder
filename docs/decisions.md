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
