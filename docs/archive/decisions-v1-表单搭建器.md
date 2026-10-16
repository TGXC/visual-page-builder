# 架构取舍记录

按里程碑顺序追加。每条都写清「选了什么」和「为什么不选另一个」——
面试里被追问「为什么这么设计」时，答案在这里，不在代码注释里。

## D1 扁平的 `fields[]` + `parentId`，而不是嵌套树

选扁平数组：按 id 查字段 O(1)、跨容器拖动只改 `parentId` 和 `order` 两个数字、
一个补丁只影响一条记录。

代价要说清楚：层级到三四层、或者出现自由布局时，嵌套树更自然。这个项目只有
一层分组（`group`），所以扁平是划算的。

## D2 结构变更只有一种表达：`Patch`

insert / remove / update / move 四种补丁，`applyPatch` 是纯函数、`invertPatch` 直接
给出逆补丁。撤销重做因此不需要「保存整个 schema 的快照」：

- 200 个字段的快照约 100KB，一条补丁不到 500B；
- 100 步历史：快照方案约 10MB，补丁方案约 50KB（差 200 倍）。

## D3 `applyPatch` 之后统一 `normalizeFieldOrder`（M1 实测出来的缺陷）

最初按 PLAN §7 实现：insert 把新字段追加到数组末尾。结果「删除中间字段 → 撤销」
之后数组变成 `[a, c, b]`——`order` 值是对的，但**同一逻辑状态序列化成了不同的 JSON**，
逐字节快照比对直接失败。

修法：`tree.ts` 提供 `flattenTree` / `normalizeFieldOrder`（树前序 + 孤儿字段按
order、id 兜底排到末尾），`applyPatch` 在返回前统一规范化一次。

因为：同一逻辑状态必须序列化成同一份 JSON，否则撤销后的等值判断、localStorage 的
反复重写、导出文件的 diff 全都会变得不可预测。

## D4 拖拽只在「放手」时提交一个补丁，不产生中间态

PLAN §8 建议「Escape 时用逆补丁取消」。实测里更简单的做法是：拖动过程完全不碰
schema，只在 `pointerup` 时按落点提交一个 `move` / `insert`。

好处：Escape 只需要清空本地状态，天然安全；拖动时也不会往历史栈里塞几十条记录。
代价：拖动过程中画布不反映「已移动」，只有落点指示线——这正是主流编辑器的手感。

## D5 用 window 监听指针事件，而不是 `setPointerCapture`（偏离 PLAN §8）

PLAN 把 `setPointerCapture` 列为四件必做之一。实现时改成在 `pointerdown` 时给
window 挂 `pointermove / pointerup / pointercancel / keydown / blur`。

因为：①事件委托到 window 后，字段在拖动中被重渲染也不会丢监听；
②jsdom 没有 `setPointerCapture`，用它写出来的逻辑在本项目的测试环境里无法验证，
而拖拽恰恰是最需要测试的部分；③`blur` 兜底解决了「鼠标在窗口外松手」导致状态卡住
的问题（`setPointerCapture` 同样会丢）。

代价：指针移出画布仍然一路跟随（对拖拽排序来说反而是想要的行为）。

## D6 属性控件协议多一个 `options`（偏离 PLAN §5）

PLAN §5 的 `PropControl` 是 `text|textarea|number|switch|color|select`。`select`
字段的 `options` 本身是 `{label,value}[]`，用 text/textarea 都表达不了，所以加了一个
`options` 控件：面板里用「每行一条 `label=value`」的纯文本编辑，可粘贴。

因为：字段的全部知识都应该写在字段描述对象里，面板里不该出现 `if (type === 'select')`。

## D7 加字段不改组件

组件面板、属性面板、渲染器都只认注册表：面板遍历 `listDescriptors()`，属性面板遍历
`propSchema`，渲染器拿 `descriptor.component`。M7 要补到 11 类字段，验收方式就是
「加一个描述对象 + 一个哑组件」，不碰任何既有组件。

## D8 编辑态画布的控件不接指针事件

`.fb-canvas .fb-field__body { pointer-events: none }`：画布只做结构编辑，点控件任何
位置都落到整个字段上（选中 / 拖拽）。填值在预览页。

配合「整块可按下 + 5px 阈值」的判定：按下先选中，位移超过 5px 才变成拖拽，所以不需要
额外的拖拽手柄。

## D9 自动保存：版本化 key + 300ms 防抖

key 是 `form-builder:v1:schema`，读档时 `version !== 1` 直接当没有存档。
写盘防抖 300ms，一次拖拽只写一次盘，连续输入也不会每敲一个字符写一次。

配额满或隐私模式下 `setItem` 抛错一律静默：存不下不是致命错误，不该打断编辑。

## D10 拖拽数学用假 DOM 测，不用浏览器

`toCanvasPoint` / `findDropIndex` / `edgeScrollDelta` / `visualIndexToOrder` 都是纯函数，
输入只有矩形和坐标，所以测试里用普通对象当替身（`{ getBoundingClientRect }`）就够，
不需要为了数学去搭真 DOM。

组件层再用 `vi.spyOn(Element.prototype, 'getBoundingClientRect')` 给 jsdom 里的字段
排一条竖线，就能跑完整的「按下 → 移动 → 放手」链路。

## D11 历史存「补丁 + 合并窗口」，输入不按字符记

`history` store 存的是 `{label, patch, mergeKey, at}`，`base` 只保存当前 schema。
`mergeKey + 400ms` 决定连续输入要不要合并：同一字段同一批属性的连续 `update`
合并成一条，`before` 保留最早的值、`after` 取最新的；结构类补丁（insert/remove/move）
一律不合并——把两步插字段合成一步撤销会很怪。

因为：不合并的话在属性面板里打「张三丰」三个字要按三次 Ctrl+Z，而且历史面板会被
字符级噪音塞满。测试里 100 步历史的实际内存只有几十 KB。

## D12 撤销/重做是全局快捷键，删除/复制不是

`Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`（和 `Ctrl+Y`）在焦点位于输入框时也生效——撤销是
应用级动作，用户不该先点空白处才能撤销。`Delete` 和 `Ctrl+D` 仍然被输入框保护
（在输入框里 Delete 是删字，Ctrl+D 是浏览器书签）。

## D13 撤销后失效的选中会被同步清掉

`watch(schema, ..., { flush: 'sync' })`：撤销或删除之后，如果选中的字段已经不在
schema 里就清空选中。用 `sync` 而不是默认的 `pre`，是为了让「撤销 → 断言选中为空」
这种同步逻辑不必依赖 nextTick。

## D14 真实浏览器验证的缺口（诚实记录）

拖动排序、指针捕获这些行为在本机只能用 jsdom + 合成事件验证（opencli 的浏览器桥
扩展没连上、本机也没装 Chrome/Edge），所以「真实鼠标拖拽」这一步没有自动化证据，
靠 `npm run dev` 手动确认。这一点写进 README，不假装它是测过的。

## D15 分组的显示条件会连带子孙（M5 补上的缺口）

M1 的 `visibleFields` 只看字段自己的 `visibleWhen`，于是「宠物信息」分组隐藏了、组里的
「宠物名」还在校验。M5 改成：先收集条件为假的分组，再沿 `parentId` 上溯，祖先链上有
隐藏分组就一起隐藏（`Set` 防环）。顺带把返回值排成**显示顺序**（复用 `normalizeFieldOrder`
建一个 id → 下标表），这样渲染方直接 `v-for` 就行，不用关心 `fields` 数组的摆放。

因为：隐藏分组里的字段如果继续校验，用户会因为「看不见的字段」被红色提示挡住提交——
这是最难排查的一类 bug。顺手修的排序问题在 M5 测试里当场暴露（`render.spec.ts`
「渲染顺序由 order 决定」直接红了）。

## D16 隐藏字段的值保留，但不进提交结果

`values` 里留着用户填过的值（条件切回来时不用重填），`submit()` 只挑**当前可见**字段
组成 FormValues。因为：提交一份包含用户看不见字段的数据，后端要么存下幽灵数据，要么
在服务端再做一遍同样的条件判断——条件判断的权威只应该在 schema 里有一份，也就是前端。

## D17 校验错误「随改随清」，但只在下次校验时重建整张表

`setValue` 清掉这个字段自己的错误（别的字段的错误留着），`validate()` 每次从可见字段
重建整张错误表。于是字段变隐藏后它的旧错误会自然消失，不需要额外的事件去清。

## D18 属性面板里规则与条件编辑也走同一条补丁出口

`RuleEditor`/`ConditionEditor` 是哑组件，整体 emit 出新的 `rules` / `visibleWhen`，
属性面板再交给 `updateField` —— 于是它们自动获得历史栈、合并窗口（`mergeKey`
`update:<id>:rules` / `update:<id>:visibleWhen`）和 localStorage 自动保存，
没有为「改规则」单独开一条写入路径。

## D19 导入与读档都先过 `normalizeSchema`

手写的 JSON、分享链接里的数据、上个版本存下的档，都可能在字段里缺 `props`、`order` 乱掉、
`parentId` 指向一个已经删掉的字段、两个字段用同一个 `name`。与其在渲染器、校验器、
拖拽逻辑里到处写防御代码，不如在**入口**收敛一次：

- 未知 `type` → `text`（不认识就降级成最普通的字段，而不是让渲染器抛「未注册的字段类型」）
- 重复 `id` → 后来者换新 id（id 是补丁定位字段的唯一依据，撞了整条历史都错）
- 重复 `name` → 后来者变成 `name1`（`name` 是提交结果的键）
- `parentId` 指向不存在的字段 → 挂回根层（孤儿字段会从画布上消失，比挪个位置糟糕得多）
- 父子成环 → 断开（否则 `buildTree` 直接死循环）
- 同级 `order` 重排成 `0..n-1`（手改过的 JSON 里可能是 5、5、9）
- 非法 `rules` / `visibleWhen` 丢掉，合法的原样保留

代价是「导入会悄悄改用户的数据」。这是有意的取舍：这些数据本来就是坏的（点不出来、
渲染不出来），而且改完在界面上是可见的，比报错拒绝导入更符合「分享链接打开就能填」。

## D20 分享链接用 lz-string，超过 2000 字符就劝人改用导出

`compressToEncodedURIComponent(JSON.stringify(schema, null, 2))` →
`/share?d=...`，解不开或解出来不是表单就显示「分享链接不完整或已损坏」。
上限定 2000：主流浏览器和聊天工具的 URL 上限在这个量级，超了就是「发出去被截断，
对方看到坏链接」，不如当场提示。所以分享是**短表单的便利通道**，长表单仍然走导出 JSON。

## D21 分享页写进 store 但 `persist: false`

分享页需要一个能填、能校验的表单，而 `runtime` store 是绑在 `schema` store 上的，
所以解出来的 schema 必须进 store。但直接 `setSchema` 会触发自动保存，
把访客自己 localStorage 里的草稿覆盖掉——打开一条别人的链接不该有这种副作用。
于是 `setSchema(next, { persist: false })` 把这家 store 的自动保存关掉，只读不写。
（测试里就是这么断言的：先存一份草稿，打开分享链接，等过防抖时间，草稿仍在。）

## D22 描述符新增 `hasValue`：分隔线/分组不是「有值的字段」

11 类字段里有两类根本不产出值：`divider`（分隔线）和 `group`（容器）。如果没有标记，
它们会以 `undefined` 的形态出现在提交结果里（`{address: '', divider1: undefined}`），
下游分不清「用户没填」和「这个字段本来就没有值」。

所以 `ComponentDescriptor` 加 `hasValue?: boolean`（缺省 `true`，只有这两类显式 `false`），
`submit()` 跳过它们。这是相对 PLAN §5 的**第二处协议扩展**（第一处是 M2 的
`PropControl: 'options'`），两处都补在这里而不是偷偷改代码。

## D23 跨容器拖拽用几何判定：取包含指针的最深容器

拖进分组最初是坏的：`measure()` 只用**源父级**（`state.parentId`）算插入位，
所以指针明明在分组框里，落点却算在根层。改法是一步纯几何判断：

1. 取画布内所有 `[data-container="true"]` 的字段元素，排除被拖字段自己与它的子孙
   （否则能把分组拖进自己里面，直接造出一个环）；
2. 用 `findContainer(指针, 命中列表)` 取**深度最大**的那个容器；
3. 再在那一层里用 `findDropIndex` 数插入位，`visualIndexToOrder` 用 `movingId` 归一化
   「自己占了一个位置」的偏移。

都不命中就返回 `null`（根层），**不回退到源父级**：把字段从分组里拖到画布空白处，
本来就该移出分组。`findContainer` 是纯函数，测试用假矩形就能覆盖「套两层时取最深」，
组件层再测一条完整的「根层字段拖进分组后 `parentId` 变了、组内顺序按落点算」。

## D24 嵌套渲染用「按文件名自引用」的递归组件

编辑器是 `FieldList → FieldWrapper → FieldList`，运行态是
`RuntimeFieldList → FieldRuntime / 自引用`，两个递归组件各管一条路径，控件仍然共用
`FieldControl` + `components/shared/fields/*`。分组能无限套，而「编辑态和运行态吃同一份
schema、同一批控件」这条 M2 的保证没有破。

这里踩到一个真实的坑：`FieldList` 一开始忘了把整棵 `fields` 传给 `FieldWrapper`，
`FieldWrapper` 的 `fields` 默认值是 `[]`，于是分组的子字段**整体消失**（画布上只剩
分组本身和根层字段）。`group.spec.ts` 第一条断言就抓到了它——这也是为什么「同一份
schema 在两条路径渲染出的标签序列一致」值得写成测试。

## D25 Vue 模板里 `$event` 只是第一个参数（真实 bug 记录）

四个转发点原来写的是 `@update:value="emit('update:value', $event[0], $event[1])"`。
Vue 模板里的 `$event` 只代表 emit 的**第一个**参数，于是多参数事件的转发变成了
「把字段名当字符串取下标」：`'name'` → `'n'`、`'age'` → `'a'`，runtime 的 `values`
里出现了 `{n: 'a', a: 'g'}` 这种键，条件字段也因此不显示。

修法：多参数事件一律用内联箭头转发（`@update:value="(name, value) => emit(...)"`）。
教训是「哑组件 + 多参数 emit」这条链路必须有一条端到端断言（运行态 spec 里
`expect(emitted()?.at(-1)).toEqual(['name', '张三'])` 就是它）。

## D26 分层用 ESLint 规则守住，而不是靠自觉

`src/core/**` 只放纯逻辑（不 import Vue、组件、store、字段注册表），这条承诺在
`eslint.config.js` 里用 `no-restricted-imports` 强制：即使以后有人图方便在
`validation.ts` 里 import 注册表，`npm run lint` 会直接失败。core 能被纯单测覆盖
（98%+）、能脱离框架跑，靠的就是这条规则。

## D27 性能数字来自 jsdom，不是浏览器（如实标注）

测量脚本临时挂在 tests 里跑完即删（PLAN §14 允许临时测量代码）：200 字段挂载
编辑态 117–215ms（首次含模块预热）、运行态 71–83ms；100 次 `addField` 合计 111ms
（每次约 1.1ms）；拖拽每次命中的数学开销 0.01ms（60fps 的预算是 16.7ms/帧）；
100 步历史的 `undoStack` JSON 仅 28.1KB。

这些数字来自 jsdom + Node 24，**不是浏览器**。所以 README 里写的是「在 jsdom 里量的」
而不是「浏览器里 60fps」，并把「真实鼠标拖拽的手感」列为没有自动化证据的缺口（D14）。
