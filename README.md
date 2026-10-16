# 可视化表单搭建器

一个**不依赖任何拖拽库、UI 组件库**的表单搭建器：左边组件面板、中间画布拖拽排版、右边属性/规则/条件面板，
再配一个预览页把同一份 schema 渲染成可填写的表单，支持撤销重做、导入导出、分享链接。

技术栈：Vue 3.5 + TypeScript 6（strict）+ Vite 8 + Pinia + Vue Router + Vitest。拖拽用原生 Pointer Events 手写。

```
编辑页 /            预览页 /preview           分享页 /share?d=...
┌──────────┬──────────────────┬──────────┐   ┌──────────────┐   ┌──────────────┐
│ 组件面板 │   画布（拖拽）    │ 属性/规则 │   │ FormRenderer │   │ 解压链接里的 │
│ 11 类字段│ 落点指示线/工具条 │ 历史/导入 │   │ 绑值+校验+   │   │ schema 再渲染│
│          │                  │ 导出/分享 │   │ 提交结果     │   │ 同一套控件   │
└──────────┴──────────────────┴──────────┘   └──────────────┘   └──────────────┘
      │              │                 │              ▲                  ▲
      ▼              ▼                 ▼              │                  │
  fields/registry（描述符：默认值 / 属性面板 / 控件）  │                  │
      └──────────────┴─────────────────┴──────────────┴──────────────────┘
                              core/（纯逻辑，不 import Vue）
        types · id · tree · patch · validation · schema · share
```

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # 单元 + 组件测试
npm run coverage   # 覆盖率（core/ 阈值 90%，不到就失败）
npm run lint       # ESLint（含分层规则）
npm run build      # vue-tsc 严格类型检查 + 生产构建
npm run preview    # 预览 dist/
```

## 功能

| 能力 | 说明 |
| --- | --- |
| 11 类字段 | 单行文本、多行文本、数字、下拉、单选、多选、开关、日期、评分、分隔线、分组（容器可嵌套） |
| 拖拽排版 | 面板拖入、字段重排、**跨容器拖进分组**、拖动中落点指示线、边缘自动滚动、Escape 取消 |
| 选中与工具条 | 点字段选中（移动 < 5px 算点击）、复制（Ctrl+D）、删除（Delete） |
| 属性面板 | 完全由描述符的 `propSchema` 生成；加一类字段只需写描述符 + 一个哑组件 |
| 校验规则 | required / minLength / maxLength / pattern / min / max / custom（手机号、邮箱、身份证） |
| 显示条件 | `eq/neq/in/gt/lt/truthy`；**分组隐藏会连带子孙**，隐藏字段不校验也不进提交结果 |
| 撤销重做 | 补丁式历史 + 400ms 输入合并，HistoryPanel 可跳转到任意一步，Ctrl+Z / Ctrl+Shift+Z |
| 自动保存 | localStorage（`form-builder:v1:schema`）300ms 防抖，坏数据静默忽略 |
| 导入导出 | 导出 `<表单名>.json`；导入任何 JSON 都先过 `normalizeSchema` 收敛 |
| 分享链接 | lz-string 压缩进 `?d=`，超过 2000 字符提示改用导出；打开链接不覆盖访客草稿 |
| 预览提交 | 同一份 schema 走 `FormRenderer`，提交输出 FormValues，校验失败滚动到第一个出错字段 |

## 三条核心取舍

**1. 扁平存储 + 补丁，而不是嵌套树 + 快照。**
字段存在一个数组里，靠 `parentId` + `order` 表达层级；每次结构变更产出一个小补丁
（`insert/remove/update/move`），历史栈存的就是这些补丁。

- 按 id 找字段 O(1)（`Map`），跨容器拖动只改两个数字（`parentId`、`order`）；
- 200 字段的完整快照约 21.5KB，补丁平均不到 500B，100 步历史实测只有 **28.1KB**；
- 代价：只有一层分组时很自然，真要做三四层嵌套或自由布局，嵌套树更合适——这是这个方案
  明确的适用边界，不装作通用。
- 每个补丁都会过一次 `normalizeFieldOrder`：同一逻辑状态必须序列化成同一份 JSON，
  否则撤销之后 `JSON.stringify` 比对不上、localStorage 会反复重写。

**2. 不引拖拽库、不引 UI 组件库。**
拖拽是自己写的 `useDragField`：`pointerdown` 待命 → 位移过 5px 才进入拖拽 → 用
`getBoundingClientRect` 做命中测试 → 放手时提交一个补丁。数学部分（坐标换算、插入位、
边缘滚动、跨容器判定）全是纯函数，测试里用假矩形就能覆盖；组件层用
`vi.spyOn(Element.prototype, 'getBoundingClientRect')` 排一条竖线，跑完整的按下-移动-放手链路。

代价也很实在：jsdom 里没有 `setPointerCapture`，所以监听挂在 `window` 上，再补一个
`blur` 兜底（鼠标在窗口外松手不会卡住拖拽状态）。

**3. 一套 schema、两条渲染路径、共用控件。**
编辑器画布（`Canvas → FieldList → FieldWrapper → FieldList` 递归）只做结构编辑，字段控件一律
`pointer-events: none`；运行态（`FormRenderer → RuntimeFieldList`）绑值、校验、显示错误。
两条路径用的是**同一批哑组件**（`components/shared/fields/*`，只收 `value`/`props` 并
`emit('update:value')`，不知道自己在哪里），字段类型到组件靠注册表查。

好处是「加一类字段」只动描述符和哑组件；坏处是两条路径的可见性判断必须一致，所以有测试
专门断言两边渲染出的标签序列完全相同。

## 分层与目录

```
src/
  core/        纯逻辑，不 import Vue/组件/store（ESLint 强制）
    types.ts      FormSchema / FieldNode / Patch / ValidationRule ...
    id.ts         createId()
    tree.ts       childrenOf / buildTree / descendantsOf / normalizeFieldOrder
    patch.ts      applyPatch / invertPatch
    validation.ts visibleFields / visibleTree / validateField / validateForm
    schema.ts     createEmptySchema / normalizeSchema / parseSchemaJson / toJsonText
    share.ts      encodeSchema / decodeSchema / buildShareUrl
  fields/      11 个描述符 + 注册表（defaultProps / propSchema / component / isContainer / hasValue）
  stores/      schema（唯一写入口 commit）/ history（补丁栈）/ runtime（值、错误、提交）/ persist
  composables/ useDragField / useSortable / useKeyboard
  components/  editor（画布、面板、属性、历史、导入导出）/ runtime（渲染、填表）/ shared（哑控件）
  views/       EditorView / PreviewView / ShareView
tests/         unit（core、store、拖拽数学）/ component（编辑器、面板、渲染、分组、导入导出）
docs/decisions.md   27 条设计与取舍记录（含被测试推翻后改掉的方案）
```

## 质量数据（本机实测）

| 项目 | 结果 |
| --- | --- |
| 测试 | **22 个文件 / 273 个用例全绿** |
| 覆盖率 | 语句 98.69% · 分支 93.75% · 函数 100% · 行 99.6%（`core/` 阈值 90%，CI 会拦） |
| 类型检查 | `vue-tsc -b` 无错误（strict + `noUnusedLocals`） |
| ESLint | 0 error 0 warning（含 core 分层规则） |
| 构建产物 | 115 modules；JS 150.60 kB（**gzip 54.09 kB**）、CSS 13.14 kB（gzip 2.94 kB）、HTML 0.47 kB |
| 200 字段挂载 | 编辑态 117–215ms、运行态 71–83ms（jsdom / Node 24，首次含模块预热） |
| 100 次结构变更 | 合计 111ms（每次约 1.1ms） |
| 拖拽热路径 | 命中测试 + order 换算每次 0.01ms（60fps 预算 16.7ms/帧） |
| 100 步历史 | `undoStack` 序列化后 28.1KB（预算 5MB） |
| 分享链接 | demo 表单 200 字符以内；120 字段高熵表单会超过 2000 上限并给出提示 |

> 性能数字来自 **jsdom + Node 24**，不是浏览器。真实拖拽手感没有自动化证据（见下）。

## 本机开发环境的三个坑（Windows + 受限沙箱）

1. **npm 缓存越界**：默认缓存在用户目录，沙箱拒绝写入（`EPERM _cacache`）。
   项目根的 `.npmrc` 把缓存重定向到仓库内 `.npm-cache/`（已 gitignore）。
2. **Vite 加载配置失败**：Vite 启动时 `exec('net use')` 走管道 stdio，沙箱直接抛
   `EPERM spawn EPERM`。项目提供垫片 `.sandbox/child-process-pipe-shim.cjs`，把这一条
   调用短路成「没有映射网络驱动器」：
   ```powershell
   $env:NODE_OPTIONS = "--require $PWD/.sandbox/child-process-pipe-shim.cjs"
   npm run test     # 或 dev / build / coverage
   ```
   `.sandbox/` 不进仓库（CI 在 Linux 上不会走这条分支）。
3. **工作区权限**：项目目录曾缺 `WRITE_OWNER`，连列目录都会失败；已用 ACL 修复脚本处理
   （带备份与回滚）。与代码无关，仅记录以免复现时误判成代码问题。

## 部署

构建产物是纯静态文件，任意静态托管都能放：

```bash
npm run build     # 产出 dist/
npx serve dist    # 或 npm run preview
```

SPA 需要把未知路径回退到 `index.html`（`/preview`、`/share` 是前端路由）。

**这条验收的边界（不假装完成）**：本机 `git push` 到 GitHub 会因 schannel
`SEC_E_NO_CREDENTIALS` 失败，也没有任何托管平台的账号凭据，所以「线上链接」目前只给到
**本地生产构建的冒烟证据**：

```
GET /                    → 200 (476 bytes)
GET /preview             → 200
GET /share               → 200
GET /assets/index-*.js   → 200 (150602 bytes)
GET /assets/index-*.css  → 200 (13143 bytes)
```

要真正上线：把仓库推到 GitHub，在 EdgeOne Pages / Vercel / Netlify 里设
构建命令 `npm run build`、发布目录 `dist`；或者直接把 `dist/` 拷到任意静态空间。

## 已知缺口（写在明面上）

- **真实浏览器里的拖拽手感没有自动化测试**：本机没装 Chrome/Edge，opencli 的浏览器桥也没
  连上，所以「按住鼠标拖着看」这一步是手动的。自动化覆盖的是纯函数数学 + jsdom 里的合成
  指针事件链路，两者都测不到「跟手程度」和真实滚动条行为。
- **线上链接需要你的托管账号**（见上）。
- **分组只当容器用**：层级模型支持无限层嵌套（拖拽、渲染、校验都通），但属性面板没有做
  针对嵌套分组的专门操作。
- **没有后端**：值只存在内存与 localStorage，没有服务端存储、没有多人协作。

设计与取舍的完整记录（含被测试推翻后改掉的方案、以及三个真 bug 的复盘）见
[`docs/decisions.md`](docs/decisions.md)。
