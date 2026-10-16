# 可视化表单搭建器（Form Builder）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个可视化拖拽搭建表单的工具——左侧拖出字段、右侧配好校验和联动，导出一份 JSON；再由运行时渲染器把同一份 JSON 渲染成可填写的表单并输出数据。

**Architecture:** 编辑器和运行时共用同一份 `FormSchema` 和同一套字段渲染组件，区别只在包装层：编辑器包一层选中/拖拽/属性面板，运行时包一层取值/校验/错误展示。字段用扁平数组 + 父级引用存储，渲染前派生一次树；所有变更走补丁（patch），撤销重做靠补丁的逆操作。

**Tech Stack:** Vue 3.4 + TypeScript 5（strict）+ Vite 5 + Pinia + Vitest + 原生 Pointer Events（不引拖拽库、不引 UI 组件库）

---

## 0. 这个项目的定位

面试用途：证明第一份项目没能证明的东西——**数据结构设计、渲染路径拆分、撤销重做的取舍、测试与 CI**。

第一个项目（青蓝校园）证明的是「会做中后台 CRUD」。这份项目要证明的是「能设计一套自己的结构，并且说清楚为什么这么设计」。

三个必须能讲二十分钟的点：扁平存储 vs 嵌套树、补丁式撤销 vs 快照式撤销、编辑态与运行态如何共用渲染器。文档末尾第 15 节列了配套的问答准备。

## 1. 范围：做什么，不做什么

**做：**

- 11 类字段：单行文本、多行文本、数字、下拉、单选、多选、开关、日期、评分、分割线、分组容器
- 拖拽：从组件库拖入、画布内拖动排序、拖入分组容器
- 选中与属性面板：属性面板由字段协议的 `propSchema` 自动生成，不硬编码
- 校验：必填、长度、正则、数值范围、三个内置自定义规则（手机号/邮箱/身份证）
- 联动：字段可配置显隐条件，隐藏字段不参与校验
- 撤销重做：至少 100 步，支持历史面板跳转任意步
- 双渲染路径：同一份 JSON，编辑器里可编辑，预览页可填写并输出数据
- 导入导出：JSON 下载/上传，localStorage 自动保存，分享链接（结构压缩进 URL）
- 工程化：TypeScript strict、Vitest 覆盖率 90%（core 目录）、GitHub Actions

**不做（明确划掉，防止工期失控）：**

- 不做后端、不做用户系统、不做多人协作、不做主题换肤
- 不做 HTML/CSS 页面生成（那是 visual-builder 那条路，本项目产出的是表单结构）
- 不做移动端适配，只保证桌面可用 + 窄屏不崩
- 不做拖拽库、不做 UI 组件库（理由见第 2 节）

## 2. 技术选型与理由

| 选择 | 理由 | 代价 |
|---|---|---|
| Vue 3 + `<script setup>` + TS strict | 第一个项目是 Vue 2 + JS，这是唯一的增量证明 | 无 |
| Vite | 构建快，配置少 | 无 |
| Pinia | 三个 store 各管一件事，比 Vuex 扁平 | 无 |
| 原生 Pointer Events 拖拽 | 面试会问「坐标怎么算」，用库就答不了 | 多写约 150 行 |
| 不引 Element Plus 等 UI 库 | 用了就变成「会用组件库」，而且和第一个项目重复 | 要手写 11 个字段控件（都很小） |
| 校验规则不放函数 | 结构必须能序列化成 JSON 才能分享/存储，`custom` 走命名注册表 | 自定义规则要注册才能用 |

## 3. 文件结构

```text
form-builder/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts              # 含 vitest 配置
├─ eslint.config.js
├─ README.md                   # 架构图 + 三条取舍 + 性能数字
├─ docs/decisions.md           # 决策记录：为什么扁平、为什么补丁、为什么规则不放函数
├─ .github/workflows/ci.yml
├─ src/
│  ├─ main.ts
│  ├─ App.vue
│  ├─ router/index.ts          # / 编辑器 · /preview 预览 · /share 分享填写
│  ├─ core/                    # 纯逻辑，不依赖 Vue，最容易被测试覆盖
│  │  ├─ types.ts              # FormSchema / FieldNode / ValidationRule / Patch
│  │  ├─ id.ts                 # nanoid 封装
│  │  ├─ tree.ts               # 扁平数组 → 树、同级排序、子孙查找
│  │  ├─ patch.ts              # applyPatch / invertPatch
│  │  ├─ validation.ts         # evaluateCondition / validateField / validateForm
│  │  └─ schema.ts             # createEmptySchema / normalizeSchema / 导入校验
│  ├─ fields/
│  │  ├─ registry.ts           # 字段协议注册表
│  │  ├─ text.ts textarea.ts number.ts select.ts radio.ts checkbox.ts
│  │  ├─ switch.ts date.ts rating.ts divider.ts group.ts
│  │  └─ index.ts              # 注册全部内置字段
│  ├─ stores/
│  │  ├─ schema.ts             # 结构 + 选中（编辑器）
│  │  ├─ history.ts            # 补丁栈、撤销重做、跳转
│  │  └─ runtime.ts            # 填写值、错误、提交（与 schema 严格隔离）
│  ├─ components/
│  │  ├─ editor/
│  │  │  ├─ EditorShell.vue        # 三栏布局
│  │  │  ├─ ComponentPalette.vue   # 左侧组件库
│  │  │  ├─ Canvas.vue             # 中间画布（滚动 + 缩放）
│  │  │  ├─ FieldWrapper.vue       # 选中框、拖拽把手、复制/删除
│  │  │  ├─ DropIndicator.vue      # 插入位置指示线
│  │  │  ├─ PropPanel.vue          # 由 propSchema 自动生成表单
│  │  │  ├─ RuleEditor.vue         # 校验规则编辑
│  │  │  ├─ ConditionEditor.vue    # 显隐条件编辑
│  │  │  └─ HistoryPanel.vue       # 历史列表，可跳转
│  │  ├─ runtime/
│  │  │  ├─ FormRenderer.vue       # 只读渲染 + 提交
│  │  │  └─ FieldRuntime.vue       # 值绑定 + 错误展示
│  │  └─ shared/fields/            # 11 个纯渲染控件（只收 value、只 emit）
│  ├─ composables/
│  │  ├─ useDragField.ts           # 组件库 → 画布 的拖拽
│  │  ├─ useSortable.ts            # 画布内排序拖拽
│  │  └─ useKeyboard.ts            # Ctrl+Z / Ctrl+Shift+Z / Delete / Ctrl+D
│  ├─ views/
│  │  ├─ EditorView.vue
│  │  ├─ PreviewView.vue
│  │  └─ ShareView.vue
│  └─ styles/tokens.css base.css
└─ tests/
   ├─ unit/patch.spec.ts
   ├─ unit/tree.spec.ts
   ├─ unit/validation.spec.ts
   ├─ unit/history.spec.ts
   └─ component/editor.spec.ts
```

分层原则：`core/` 不 import Vue，`fields/` 不 import store，`components/` 不直接改别人 store 的状态。测试主要打在 `core/`。

## 4. 数据模型

`src/core/types.ts`：

```ts
export type FieldType =
  | 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox'
  | 'switch' | 'date' | 'rating' | 'divider' | 'group'

export type ConditionOp = 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'truthy'

export interface Condition {
  field: string
  op: ConditionOp
  value?: unknown
}

export type CustomRuleName = 'phone' | 'email' | 'idcard'

export type ValidationRule =
  | { kind: 'required'; message?: string }
  | { kind: 'minLength'; value: number; message?: string }
  | { kind: 'maxLength'; value: number; message?: string }
  | { kind: 'pattern'; value: string; message?: string }
  | { kind: 'min'; value: number; message?: string }
  | { kind: 'max'; value: number; message?: string }
  | { kind: 'custom'; name: CustomRuleName; message?: string }

export interface FieldNode {
  id: string
  parentId: string | null      // null = 根级
  order: number                // 同级内排序，从 0 开始连续
  type: FieldType
  name: string                 // 提交时的键，同级唯一
  label: string
  props: Record<string, unknown>
  rules: ValidationRule[]
  visibleWhen: Condition | null
}

export interface FormSettings {
  labelPosition: 'top' | 'left'
  submitText: string
}

export interface FormSchema {
  version: 1
  id: string
  name: string
  description: string
  fields: FieldNode[]          // 扁平存储
  settings: FormSettings
}

export type FormValues = Record<string, unknown>
export type ErrorMap = Record<string, string[]>

export type MutableFieldKey = 'name' | 'label' | 'props' | 'rules' | 'visibleWhen'

export type Patch =
  | { op: 'insert'; field: FieldNode }
  | { op: 'remove'; field: FieldNode }
  | { op: 'update'; id: string; before: Partial<Pick<FieldNode, MutableFieldKey>>; after: Partial<Pick<FieldNode, MutableFieldKey>> }
  | { op: 'move'; id: string; before: { parentId: string | null; order: number }; after: { parentId: string | null; order: number } }
```

**为什么扁平存储 + `parentId` 而不是嵌套 `children`（面试第一问）：**

- 按 id 查字段是 O(1)，嵌套树要递归遍历。选中、改属性、加校验都是按 id 操作，这条最重要。
- 跨容器拖动只改 `parentId` 和 `order` 两个数字，嵌套树要先从原位置摘除、再插入到新父节点，补丁会变大。
- 补丁能保持「只影响一条记录」，撤销时逆操作简单。
- 代价：渲染前要派生一次树。用 `computed` 缓存，只有 `fields` 变了才重算，实测可忽略。

反向的诚实回答：如果层级会有三四层、或者要做自由布局，嵌套树更自然。这里只有一层分组，扁平更划算。

**为什么 id 不用数组下标：** 下标会在删除、排序后失效，选中态和历史记录都会错位。

## 5. 字段协议与注册表

`src/fields/registry.ts`：

```ts
import type { Component } from 'vue'
import type { FieldType, ValidationRule } from '@/core/types'

export type PropControl = 'text' | 'textarea' | 'number' | 'switch' | 'color' | 'select'

export type PropSpec =
  | { key: string; label: string; control: Exclude<PropControl, 'select'>; placeholder?: string }
  | { key: string; label: string; control: 'select'; options: Array<{ label: string; value: string }> }

export interface ComponentDescriptor<P extends Record<string, unknown> = Record<string, unknown>> {
  type: FieldType
  label: string
  icon: string
  isContainer?: boolean
  defaultProps: P
  propSchema: PropSpec[]          // 属性面板据此自动生成，不写死
  defaultRules?: ValidationRule[] // 拖入时自动带上
  component: Component            // 编辑态与运行态共用
  normalize?: (raw: unknown) => unknown
}

const registry = new Map<FieldType, ComponentDescriptor>()

export function registerComponent(d: ComponentDescriptor): void {
  if (registry.has(d.type)) throw new Error(`字段类型已注册: ${d.type}`)
  registry.set(d.type, d)
}

export function getDescriptor(type: FieldType): ComponentDescriptor {
  const d = registry.get(type)
  if (!d) throw new Error(`未注册的字段类型: ${type}`)
  return d
}

export function listDescriptors(): ComponentDescriptor[] {
  return [...registry.values()]
}
```

示例字段（`src/fields/text.ts`）：

```ts
import TextInput from '@/components/shared/fields/TextInput.vue'
import { registerComponent } from './registry'

registerComponent({
  type: 'text',
  label: '单行文本',
  icon: 'text',
  defaultProps: { placeholder: '请输入', maxlength: 50, clearable: false },
  propSchema: [
    { key: 'placeholder', label: '占位提示', control: 'text' },
    { key: 'maxlength', label: '最大长度', control: 'number' },
    { key: 'clearable', label: '可清空', control: 'switch' },
  ],
  defaultRules: [{ kind: 'maxLength', value: 50 }],
  component: TextInput,
})
```

这一步做到「插件化」的形态就够了：第三方想加字段，实现一个符合协议的描述对象并 `registerComponent`，编辑器的组件库、属性面板、渲染器都会自动支持它。这是第 15 节问答第 5 题的答案。

## 6. 状态设计

三个 store，职责严格分开：

**`stores/schema.ts`** —— 编辑器唯一的结构来源：

```ts
interface SchemaState {
  schema: FormSchema
  selectedIds: string[]
}
// getters: tree（派生树）、selectedField、fieldById
// actions: addField(type, parentId, index) / removeField(id) / updateField(id, patch)
//          moveField(id, parentId, index) / setSchema(schema) / select(ids)
```

**`stores/history.ts`** —— 只认补丁：

```ts
interface HistoryEntry { label: string; patch: Patch }

interface HistoryState {
  base: FormSchema | null      // 历史原点，用于跳转时重放
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  mergeKey: string | null      // 连续输入合并用
  mergeAt: number
}
// actions: push(entry) / tryMerge(mergeKey, patch) / undo() / redo() / jumpTo(index) / clearRedo()
```

**`stores/runtime.ts`** —— 填写态，**永远不写进 schema**：

```ts
interface RuntimeState {
  values: FormValues
  errors: ErrorMap
  submitted: FormValues | null
}
// actions: setValue(name, value) / validate() / reset() / submit()
```

**这是最容易返工的一处**：如果让编辑器用 `v-model` 直接绑到 `FieldNode.props`，那用户每敲一个字符都会进历史栈，撤销会变成逐字符回退。规则是——`props` 只在属性面板里改（走补丁）；运行态的值全部落在 `runtime.values` 里，进不了历史。

编辑器里所有结构变更只走一个出口：

```ts
// stores/schema.ts
function commit(label: string, patch: Patch, mergeKey?: string) {
  const history = useHistoryStore()
  if (!(mergeKey && history.tryMerge(mergeKey, patch))) {
    history.push({ label, patch })
  }
  schema.value = applyPatch(schema.value, patch)
  history.clearRedo()
}
```

## 7. 撤销重做：补丁式命令

`src/core/patch.ts`：

```ts
import type { FieldNode, FormSchema, Patch } from './types'

function clone(schema: FormSchema): FormSchema {
  return { ...schema, fields: schema.fields.map(f => ({ ...f, props: { ...f.props }, rules: [...f.rules] })) }
}

/** 把一组同级字段的 order 重排为 0..n-1，顺序按传入的 id 数组 */
function orderSiblings(fields: FieldNode[], parentId: string | null, ids: string[]): FieldNode[] {
  const orderById = new Map(ids.map((id, i) => [id, i]))
  return fields.map(f =>
    f.parentId === parentId && orderById.has(f.id) ? { ...f, order: orderById.get(f.id)! } : f)
}

/** 同级按当前 order 排出的 id 列表 */
function siblingIds(fields: FieldNode[], parentId: string | null): string[] {
  return fields.filter(f => f.parentId === parentId).sort((a, b) => a.order - b.order).map(f => f.id)
}

export function applyPatch(schema: FormSchema, patch: Patch): FormSchema {
  const next = clone(schema)
  switch (patch.op) {
    case 'insert': {
      const f = patch.field
      // 目标下标及之后的同级 order 全部 +1，再放入新字段
      next.fields = [
        ...next.fields.map(x => (x.parentId === f.parentId && x.order >= f.order ? { ...x, order: x.order + 1 } : x)),
        { ...f },
      ]
      return next
    }
    case 'remove': {
      const r = patch.field
      next.fields = next.fields
        .filter(x => x.id !== r.id)
        .map(x => (x.parentId === r.parentId && x.order > r.order ? { ...x, order: x.order - 1 } : x))
      return next
    }
    case 'update':
      // 注意：after 里的 props / rules 是整体替换，不是合并
      next.fields = next.fields.map(f => (f.id === patch.id ? { ...f, ...patch.after } : f))
      return next
    case 'move': {
      const { before, after } = patch
      let fields = next.fields.map(f =>
        f.id === patch.id ? { ...f, parentId: after.parentId, order: after.order } : f)

      // 目标父级：列出同级，把移动者挪到 after.order 下标，再整体重排
      const targetIds = siblingIds(fields, after.parentId)
      targetIds.splice(targetIds.indexOf(patch.id), 1)
      targetIds.splice(Math.max(0, Math.min(after.order, targetIds.length)), 0, patch.id)
      fields = orderSiblings(fields, after.parentId, targetIds)

      // 跨容器时旧父级会留空档，压缩一次
      if (before.parentId !== after.parentId) {
        fields = orderSiblings(fields, before.parentId, siblingIds(fields, before.parentId))
      }
      next.fields = fields
      return next
    }
  }
}

export function invertPatch(patch: Patch): Patch {
  switch (patch.op) {
    case 'insert': return { op: 'remove', field: patch.field }
    case 'remove': return { op: 'insert', field: patch.field }
    case 'update': return { op: 'update', id: patch.id, before: patch.after, after: patch.before }
    case 'move':   return { op: 'move', id: patch.id, before: patch.after, after: patch.before }
  }
}
```

撤销 / 重做 / 跳转：

```ts
function undo() {
  const entry = undoStack.pop()
  if (!entry) return
  schema.schema = applyPatch(schema.schema, invertPatch(entry.patch))
  redoStack.push(entry)
}

function jumpTo(index: number) {
  if (!base) return
  let next = base
  for (const e of undoStack.slice(0, index)) next = applyPatch(next, e.patch)
  schema.schema = next
  redoStack.push(...undoStack.splice(index).reverse())
}
```

**为什么补丁不加快照（面试第二问）：**

| | 快照 | 补丁 |
|---|---|---|
| 每步成本 | 复制整个 schema（200 字段约 100KB JSON） | 一个对象，通常 < 500B |
| 100 步内存 | 约 10MB | 约 50KB |
| 连续输入 | 每字符一步 | 可按 mergeKey 合并成一步 |
| 实现复杂度 | 低 | 中，必须保证逆操作正确 |
| 跳转任意步 | 直接取快照 | 从原点重放（N ≤ 100，可忽略） |

逆操作的正确性靠第 12 节的往返测试兜住：任意补丁 apply 后再 invert，必须回到初始快照。

## 8. 拖拽与坐标换算

`src/composables/useDragField.ts` 的核心：

```ts
export function toCanvasPoint(e: PointerEvent, canvasEl: HTMLElement, scale: number) {
  const rect = canvasEl.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left + canvasEl.scrollLeft) / scale,
    y: (e.clientY - rect.top + canvasEl.scrollTop) / scale,
  }
}

/** 按指针 y 与每个字段矩形中点的关系，算出插入下标 */
export function findDropIndex(pointerY: number, fieldEls: HTMLElement[]): number {
  for (let i = 0; i < fieldEls.length; i++) {
    const r = fieldEls[i].getBoundingClientRect()
    if (pointerY < r.top + r.height / 2) return i
  }
  return fieldEls.length
}
```

必须做的四件事：

1. `pointerdown` 时 `el.setPointerCapture(e.pointerId)`，否则指针移出元素就丢事件。
2. 移动距离超过 5px 才算拖拽，否则当成点击选中。
3. `pointermove` 时若指针距离画布上下边缘 40px 以内，`canvasEl.scrollTop += ±8`，实现拖拽自动滚动。
4. `Escape` 取消本次拖拽，恢复到拖拽前的 schema（用补丁的逆操作，不要手动改回去）。

顺序建议：**先把 `scale` 固定为 1 跑通拖拽，再加缩放**。缩放、滚动、拖拽三者同时参与坐标换算，是最容易崩的地方。

## 9. 编辑态与运行态：双渲染路径

同一份 `schema`，两个入口：

| | 编辑器 | 运行时 |
|---|---|---|
| 组件 | `Canvas.vue` → `FieldWrapper.vue` → 字段控件 | `FormRenderer.vue` → `FieldRuntime.vue` → 字段控件 |
| 绑定 | 不绑值、不校验，只渲染 | `v-model` 到 `runtime.values`，显示错误 |
| 交互 | 点击选中、拖拽排序、悬停显示工具条 | 只读填写 |
| 用到的字段列表 | 全部字段 | `visibleFields(schema, values)` 过滤后的 |

共用的是**字段控件本身**（`components/shared/fields/*.vue`），它们一律是「哑组件」：收 `value` 和 `props`，只 `emit('update:value')`，不知道自己在编辑器里还是运行时里。这样加字段只写一遍。

## 10. 校验引擎

`src/core/validation.ts`：

```ts
import type { Condition, CustomRuleName, ErrorMap, FieldNode, FormSchema, FormValues, ValidationRule } from './types'

export const CUSTOM_RULES: Record<CustomRuleName, { test: (v: unknown) => boolean; defaultMessage: string }> = {
  phone:  { test: v => /^1[3-9]\d{9}$/.test(String(v ?? '')),        defaultMessage: '请输入正确的手机号' },
  email:  { test: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '')), defaultMessage: '请输入正确的邮箱' },
  idcard: { test: v => /^\d{17}[\dXx]$/.test(String(v ?? '')),        defaultMessage: '请输入正确的身份证号' },
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

export function evaluateCondition(cond: Condition | null, values: FormValues): boolean {
  if (!cond) return true
  const actual = values[cond.field]
  switch (cond.op) {
    case 'eq':     return actual === cond.value
    case 'neq':    return actual !== cond.value
    case 'in':     return Array.isArray(cond.value) && cond.value.includes(actual)
    case 'gt':     return Number(actual) > Number(cond.value)
    case 'lt':     return Number(actual) < Number(cond.value)
    case 'truthy': return Boolean(actual)
  }
}

export function visibleFields(schema: FormSchema, values: FormValues): FieldNode[] {
  return schema.fields.filter(f => f.type !== 'group' && evaluateCondition(f.visibleWhen, values))
}

export function validateField(field: FieldNode, value: unknown): string[] {
  const errors: string[] = []
  for (const rule of field.rules) {
    switch (rule.kind) {
      case 'required':
        if (isEmpty(value)) errors.push(rule.message ?? `${field.label}不能为空`)
        break
      case 'minLength':
        if (!isEmpty(value) && String(value).length < rule.value) errors.push(rule.message ?? `至少 ${rule.value} 个字符`)
        break
      case 'maxLength':
        if (!isEmpty(value) && String(value).length > rule.value) errors.push(rule.message ?? `最多 ${rule.value} 个字符`)
        break
      case 'pattern':
        if (!isEmpty(value) && !new RegExp(rule.value).test(String(value))) errors.push(rule.message ?? `${field.label}格式不正确`)
        break
      case 'min':
        if (!isEmpty(value) && Number(value) < rule.value) errors.push(rule.message ?? `不能小于 ${rule.value}`)
        break
      case 'max':
        if (!isEmpty(value) && Number(value) > rule.value) errors.push(rule.message ?? `不能大于 ${rule.value}`)
        break
      case 'custom': {
        const r = CUSTOM_RULES[rule.name]
        if (!isEmpty(value) && r && !r.test(value)) errors.push(rule.message ?? r.defaultMessage)
        break
      }
    }
  }
  return errors
}

export function validateForm(schema: FormSchema, values: FormValues): ErrorMap {
  const errors: ErrorMap = {}
  for (const field of visibleFields(schema, values)) {
    const fieldErrors = validateField(field, values[field.name])
    if (fieldErrors.length) errors[field.name] = fieldErrors
  }
  return errors
}
```

三个关键决定：

- **空值只由 `required` 负责**。`minLength`、`pattern` 这些遇到空值直接跳过，否则用户还没填就一片红。
- **隐藏字段不校验**，因为 `validateForm` 先过一遍 `visibleFields`。
- **规则里不放函数**。`custom` 存的是规则名，函数放在 `CUSTOM_RULES` 这张表里。这样 `FormSchema` 一定能 `JSON.stringify`，分享链接和导出才成立。

## 11. 持久化、导入导出、分享

- **localStorage**：键名带版本，如 `form-builder:v1:schema`。读出来先过 `normalizeSchema`，字段缺失或类型不对就用默认值补齐，绝不让脏数据直接进 store。
- **导出**：`JSON.stringify(schema, null, 2)` 下载为 `<表单名>.json`。
- **导入**：读文件 → `JSON.parse` → `normalizeSchema` → 失败则提示，不进 store。
- **分享链接**：用 `lz-string` 的 `compressToEncodedURIComponent` 压进 `#/share?s=...`。注意 URL 长度有限（浏览器约 2000 字符），超过就提示「表单过大，请用 JSON 导出」。
- **版本迁移**：`normalizeSchema` 里留一个 `switch (raw.version)`，v1 先直接返回。这是给以后留的口子，也是面试里「你怎么处理结构变更」的答案。

## 12. 测试计划

测试主要打 `core/`（纯函数，好测，也最值得测）。

**`tests/unit/patch.spec.ts`**

- insert 后 invert，`JSON.stringify` 与原 schema 完全相等
- remove 后同级 order 连续，invert 后 order 恢复原值
- update 的 before/after 互换后往返一致
- move 跨容器后 order 规范化，invert 后回到原 parentId 与原 order
- 往返性质测试：随机生成 100 个补丁，逐个 apply 后按逆序 invert，最终必须等于初始快照

**`tests/unit/validation.spec.ts`**

- `required` 对 `''`、`null`、`undefined`、`[]` 都判失败
- `minLength` 对空值不报错
- `pattern` 生效
- `custom: 'phone'` 通过 `13800138000`，拒绝 `12345`
- 存在 `visibleWhen` 且条件不满足时，`validateForm` 不返回该字段的错误
- `validateForm` 返回的键只包含有错的字段

**`tests/unit/tree.spec.ts`**

- 扁平数组派生树后按 order 升序
- 多级（group 套 group）派生的层级正确
- `descendantsOf` 能取到全部子孙，用于删除容器

**`tests/unit/history.spec.ts`**

- 相同 mergeKey 且间隔小于 400ms 的两次 update 合并为一条
- 连续 undo 100 次后 schema 等于初始 schema
- redo 与 undo 对称
- `jumpTo(0)` 回到初始

**`tests/component/editor.spec.ts`**

- 模拟 pointerdown/pointermove/pointerup 从组件库拖到画布，字段数 +1
- 点击字段后 `PropPanel` 渲染出该字段 `propSchema` 里的项
- 触发 Ctrl+Z 后字段数恢复

覆盖率目标：`src/core/**` 不低于 90%。

## 13. 里程碑与 14 天计划

每个里程碑都要能独立跑起来看到东西，不要憋大招。

### M0 · 脚手架（半天）

- [ ] `npm create vite@latest form-builder -- --template vue-ts`
- [ ] `npm i pinia nanoid lz-string`
- [ ] `npm i -D vitest @vue/test-utils jsdom @vitest/coverage-v8`
- [ ] `package.json` 加脚本：`"test": "vitest"`、`"test:run": "vitest run"`、`"coverage": "vitest run --coverage"`
- [ ] `vite.config.ts` 加 vitest 配置（`environment: 'jsdom'`、`globals: true`）
- [ ] **验收**：`npm run dev` 出页面；`npm run test` 跑通一个占位测试

### M1 · 纯逻辑核心（1.5 天，全部先写测试）

- [ ] `core/types.ts`、`core/id.ts`、`core/tree.ts`、`core/patch.ts`、`core/validation.ts`
- [ ] 先写第 12 节的 patch / tree / validation 用例，再实现
- [ ] **验收**：`npm run test` 全绿；`npm run test -- --coverage` 显示 `core/**` ≥ 90%

### M2 · 静态渲染打通（2 天）

- [ ] `fields/registry.ts` + 三个字段（text / number / select）
- [ ] `components/shared/fields/*.vue` 三个哑组件
- [ ] `FormRenderer.vue` 渲染一份硬编码 schema
- [ ] `Canvas.vue` 只读渲染同一份 schema
- [ ] **验收**：同一份 JSON 在 `/` 和 `/preview` 两个页面都能正确渲染

### M3 · 拖拽 + 选中 + 属性面板（2 天）

- [ ] `useDragField.ts`（先固定 scale = 1）
- [ ] `ComponentPalette.vue`、`DropIndicator.vue`、`FieldWrapper.vue`
- [ ] 画布内排序（`useSortable.ts`）
- [ ] `PropPanel.vue` 由 `propSchema` 自动生成
- [ ] `localStorage` 自动保存
- [ ] `useKeyboard.ts`：Delete 删除、Ctrl+D 复制
- [ ] **验收**：能拖入 10 个字段并任意排序；刷新后顺序保留

### M4 · 撤销重做 + 历史面板（1.5 天）

- [ ] `stores/history.ts`、`stores/schema.ts` 的 commit 出口
- [ ] 连续输入合并（mergeKey + 400ms）
- [ ] `HistoryPanel.vue` 列表 + 跳转
- [ ] Ctrl+Z / Ctrl+Shift+Z
- [ ] **验收**：第 12 节 history 用例全绿；100 步历史内存增量 < 5MB

### M5 · 校验 + 运行态（2 天）

- [ ] `stores/runtime.ts`
- [ ] `RuleEditor.vue`、`ConditionEditor.vue`
- [ ] `FieldRuntime.vue` 值绑定与错误展示
- [ ] 提交时输出 `FormValues`，错误字段自动滚动定位
- [ ] **验收**：预览页能填能校验；被隐藏的字段不参与校验

### M6 · 导入导出 + 分享（1.5 天）

- [ ] JSON 下载 / 上传 + `normalizeSchema`
- [ ] `ShareView.vue` + lz-string 压缩链接
- [ ] 超长提示
- [ ] **验收**：导出的 JSON 重新导入后与导出前完全一致

### M7 · 收尾（1.5 天）

- [ ] 补齐 11 类字段（group 容器最后做）
- [ ] ESLint + `.github/workflows/ci.yml`（`npm ci` → test → build）
- [ ] 部署到静态托管，拿到可访问链接
- [ ] `README.md`：架构图、三条取舍、性能数字
- [ ] `docs/decisions.md`：记录三个决策与代价
- [ ] **验收**：CI 绿；线上链接能打开；README 里有具体数字

留 1 天缓冲。**如果时间不够，先砍 M6 的分享链接，再砍字段数量，最后才砍测试。**

## 14. 性能预算与测量方法

必须留下数字，没有数字的亮点只是功能清单。

| 指标 | 目标 | 怎么测 |
|---|---|---|
| 200 字段渲染耗时 | < 150ms | 预览页注入 200 字段，`performance.now()` 包住挂载 |
| 拖拽帧率 | 稳定 60fps | Chrome Performance 面板录制 5 秒连续拖拽，看 frame 是否 < 16.7ms |
| 100 步历史内存 | < 5MB | Performance → Memory → 堆快照对比 |
| 首屏 JS | < 150KB gzip | `npm run build` 看产物，配合 gzip 后大小 |
| core 覆盖率 | ≥ 90% | `npm run test -- --coverage` |

测量代码示例（临时放在视图里，测完删）：

```ts
const t0 = performance.now()
await nextTick()
console.log('200 fields:', (performance.now() - t0).toFixed(1), 'ms')
```

大表单渲染的优化顺序：先确认 `key` 稳定（用 `field.id` 而不是下标）→ 再看 Pinia 订阅是否让整棵树重渲染（每个 `FieldWrapper` 只订阅自己的字段）→ 还不够才考虑虚拟滚动。

## 15. 面试问答准备

按这八个问题准备，每个都要有具体的取舍，不能只说「用了什么」。

1. **为什么扁平存储加 parentId，而不是嵌套树？** O(1) 查找、跨容器移动只改两个数字、补丁更小；代价是要派生树。反过来如果层级很深、要做自由布局，树更合适。
2. **撤销为什么用补丁不用快照？** 快照每步复制整个结构，100 步约 10MB；补丁每步通常不到 500B，还能合并连续输入。代价是必须保证逆操作正确，用往返测试兜住。
3. **拖拽坐标怎么算？** 画布 `rect` 加 `scrollTop` 再除 `scale`；必须 `setPointerCapture`；缩放、滚动、拖拽三者同时参与，先固定 scale = 1 跑通再加。
4. **编辑态和运行态怎么共用渲染？** 字段控件是哑组件，两种包装层不同：编辑器包选中与拖拽且不绑值，运行时包取值与错误展示。数据同源，行为分离。
5. **为什么规则里存规则名而不是函数？** JSON 必须能序列化才能存储和分享，函数进不去。自定义规则注册在表里，靠名字引用。
6. **大表单怎么优化？** 稳定 key、缩小响应式订阅范围、必要时虚拟滚动。先测量再优化，报数字。
7. **如果要做协同编辑，需要改什么？** schema 交给 CRDT（如 Yjs），补丁变成 CRDT 操作，历史栈换成协同库的 undo 管理器，`mergeKey` 合并策略要重新设计。
8. **踩过的坑。** 至少准备一个真实故事，优先准备「拖拽时滚动导致落点漂移」和「v-model 污染历史记录」这两个——第二个是本项目最容易踩的坑，也是最能体现你想过状态边界的例子。

## 16. 简历描述模板

放在简历第二项目，六行以内：

```text
可视化表单搭建器 · 个人项目
Vue 3 / TypeScript / Vite / Pinia / Vitest
- 拖拽搭建：组件库拖入、画布排序、属性面板自动生成，支持 11 类字段
- 数据结构：扁平存储加父级引用，同一份 JSON 驱动编辑与填写两条渲染路径
- 撤销重做：补丁式实现 100 步历史，内存占用相比全量快照降低九成
- 校验引擎：纯函数实现规则校验与显隐联动，隐藏字段自动跳过
- 工程化：TypeScript 严格模式、单元测试覆盖率 90%、GitHub Actions 持续集成
- 性能：200 字段渲染耗时低于 150ms（实测）
```

专业词只留通用术语，不上内部字段名。数字必须是真的，写完回去改一遍。

## 17. 交接说明：怎么在另一个对话里开工

1. 新建目录，把这份文件复制到项目根目录，改名为 `PLAN.md`。
2. 在该目录开一个新的会话（工作目录设为项目目录，否则写文件和装依赖会被沙箱拒绝）。
3. 开场指令直接给：

```text
读 PLAN.md，从 M0 开始做，按里程碑推进。
约束：
1. 不引入拖拽库，不引入 UI 组件库
2. TypeScript 严格模式
3. 每个里程碑结束必须跑通测试，并停下等我确认再继续
4. core/ 目录先写测试再实现
5. 不要一次实现 11 个字段，M2 只做 3 个
```

4. 里程碑完成时，让它把当天的验收结果贴出来，别只看它说「做完了」。

## 18. 风险与已知坑

| 风险 | 表现 | 预防 |
|---|---|---|
| 坐标系 | 缩放或滚动后落点漂移、指示线错位 | 先固定 scale = 1；坐标换算只写在一个函数里 |
| 历史被污染 | 每敲一个字符进一次历史 | `runtime.values` 与 `schema` 严格隔离，props 只在属性面板改 |
| 深拷贝 | 每步 `structuredClone` 整个 schema，卡顿 | 补丁只改一条记录，clone 只做浅层结构复制 |
| 过早抽象 | 一开始就想做插件商城、主题系统 | 字段协议够用就行，M2 只做 3 个字段 |
| 样式黑洞 | 三天都在调界面 | 用 CSS 变量加简单布局，目标是清楚不是好看 |
| 工期 | 收尾时才发现没部署、没 README | M7 的时间不能挪用，优先级见第 13 节末尾 |

**整体完成定义：** 线上有一份能打开的链接；从组件库能拖出字段并配置校验与联动；导出 JSON 再导入结果一致；预览页能填写、能校验、能提交；`npm run test` 全绿且 core 覆盖率 ≥ 90%；CI 通过；README 里有架构说明、三条取舍和实测数字。
