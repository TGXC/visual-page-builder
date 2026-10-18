# Studio 可视化页面搭建器

![CI](https://github.com/TGXC/visual-page-builder/actions/workflows/ci.yml/badge.svg)

## 目录

- [项目简介](#项目简介) · [功能介绍](#功能介绍) · [快速开始](#快速开始)
- 每轮开发与验收记录（M0–M23）在 [docs/milestones.md](docs/milestones.md)；计划见 [PLAN.md](PLAN.md)，架构决策（ADR）见 [docs/decisions.md](docs/decisions.md)，工程与上线说明见 [docs/engineering.md](docs/engineering.md)。

## 项目简介

**Studio 是一个在浏览器里直接使用的可视化页面搭建器**：拖拽排版、图层树、属性面板、断点覆盖、代码导出，全部在本地完成——没有后端、没有账号，打开就能用，数据只存在浏览器 `localStorage` 里。

它从参考实现 [visual-builder](https://github.com/Noah-Deleveq/visual-builder)（单文件 `index.html`）的能力基线出发，但把数据模型整体重写成**元素树 + 布局引擎 + 断点覆盖 + 插件式组件 + AI 只产出补丁**的架构：拖拽不再是「改绝对坐标」，而是写进一棵可序列化的元素树，由布局引擎算盒、由代码生成器输出可直接部署的 HTML / CSS。适合需要快速产出响应式静态页与原型的人，也适合作为前端工程能力的完整示例。

- **技术栈**：Vue 3.5 · TypeScript 6（strict）· Vite 8 · Pinia · Vitest + jsdom。拖拽用原生 Pointer Events 手写，**零拖拽库、零 UI 组件库**；运行时除 Vue / Pinia 外只有 `nanoid`（生成节点 id）与 `lz-string`（压缩分享链接）两个小库。
- **规模**：40 类可见组件（布局 7 / 基础 8 / 表单 12 / 媒体 5 / 展示 8，另有内部 `instance`）+ AI 注册的自定义组件；3 档预设断点（1440×900 / 768×1024 / 375×812）与自定义视口；4 种导出（HTML / CSS / Vue SFC / 静态多页 ZIP），另有 JSON 文档导入导出、分享链接与 PNG 截图。
- **质量**：52 个测试文件、**620 例单测**，语句覆盖 97% / 分支 90%；`vue-tsc` strict 0 错、ESLint 0 告警；1000 节点整树布局中位数约 5ms、整站导出约 115ms；生产构建 JS 294 kB（gzip 101 kB）/ CSS 30 kB（gzip 6 kB）。
- **上手**：`npm install && npm run dev`（Node ≥ 22.12），命令见 [快速开始](#快速开始)；部署、目录结构、质量数据、架构决策与已知缺口见 [docs/engineering.md](docs/engineering.md)。

## 功能介绍

### 画布编辑

- 从左侧面板**拖入画布**，落到容器上即成为其子节点；**面板点击只是只读「看属性」**，不会插入。
- **移动 / 8 向缩放手柄**（`Shift` 等比）、**6px 磁吸参考线**、**框选多选**、六向对齐、方向键微调；双击任意组件**行内改字**（输入类改的是 `placeholder`，容器类用半透明角标显示自定义文字）。
- **撤销 / 重做**（逆补丁 + 400ms 合并窗口，可跳转历史点）、右键菜单（复制 / 粘贴 / 创建副本 / 置顶置底 / 复制与粘贴样式 / 删除）、**多页面**、画布缩放 25%–200%（百分比可直接输入）、视口宽高可改、一键清空当前页。

### 布局与响应式

- 布局引擎支持 `free / vertical / horizontal / grid` 四种排列与 `fixed / hug / fill / ratio` 四种尺寸策略，容器可嵌套，父容器 padding 参与子元素定位。
- 三档断点**继承 + 覆盖**：窄断点只存与更宽一级的差异，导出时自动生成 media query。
- **跨断点自动适配**：按几何自动推断锚定（贴左 / 贴右 / 左右拉伸 / 居中 / 等比缩放）——新插入组件即带推断，可一键「整页自动适配」，窄断点上手动拖过的元素优先生效、导出固定按设计尺寸而不是当前预览断点。

### 组件体系

- **40 类内置组件**：布局容器（frame / group / section / container / columns / divider / spacer）、基础（文本 / 标题 / 标签 / 按钮 / 链接 / 徽标 / 矩形 / 圆形）、表单 12 类（表单容器 / 输入 / 文本域 / 下拉 / 复选 / 单选 / 开关 / 滑块 / 日期 / 数字 / 文件 / 评分）、媒体（图片 / 视频 / 音频 / 图标 / 头像）、展示（导航 / 页头 / 卡片 / 列表 / 表格 / 标签页 / 提示 / 进度条）。
- **插件式组件描述符**：渲染（画布与导出两套）/ 默认属性 / 可覆盖字段 / AI 说明 / 自定义 CSS 全在一个 `ComponentDescriptor` 里，新增组件只需写一个描述符。
- **AI 生成自定义组件**：受限 DSL → 校验 → 编译成普通描述符 → 预览 → 注册进「我的组件」，只存 DSL 数据、读回重新编译。

### 主题与样式

- **主题变量**：受控样式里的颜色字段（背景 / 文字 / 边框 / 阴影色）可以写 `$color-primary`，导出成 `var(--color-primary)` + `:root{}`，改一处全站同步；面板按颜色 / 字号 / 圆角 / 阴影分组，未定义的引用会提示。
- 属性面板：22 项属性白名单（内容 + 样式 + 图层元信息）、位置与尺寸精确输入（绝对盒语义，跨断点自动换算）、样式复制与粘贴、水平对齐、图层名 / 显隐 / 锁定。

### 导出与交付

- **HTML / CSS / Vue SFC / 静态多页 ZIP** 四种导出；CSS 独立不内联、包含断点 media query；ZIP 是纯静态站，解压即可部署。
- JSON 文档导入导出、**分享链接**（`#doc=` + base64url，无需后端）、PNG 截图（自写 PNG 编码器，跑在浏览器里）。

### AI 助手

- 自然语言改稿，但助手**只产出补丁**，经确认才写进文档、全程可撤销；默认走离线 Mock（无网络也能演示），也可接 OpenAI 兼容接口；带成本估算与失败降级。

### 工程质量

- TypeScript strict + ESLint；**620 例单测**（Vitest + jsdom，含组件级指针交互测试）、覆盖率统计、性能基准（1000 节点布局 / 整站导出）与导出冒烟测试。
- CI 一条链：`npm ci → lint → test → coverage → build → perf → smoke`，并保留 `dist` 产物；发布用 GitHub Pages 工作流。

## 快速开始

```bash
npm install

npm run dev        # 开发服务器
npm run test       # Vitest 全量单测 + 组件测试
npm run test:perf  # 1000 节点布局性能（阈值：整树 < 8ms）
npm run test:smoke # 导出冒烟：真实写出 studio.html / site.zip，供外部工具校验
npm run coverage   # 覆盖率（阈值：语句/分支/函数/行 ≥ 90）
npm run lint       # ESLint（含 core 分层规则）
npm run build      # vue-tsc 严格类型检查 + 生产构建
npm run preview    # 预览生产构建
```
