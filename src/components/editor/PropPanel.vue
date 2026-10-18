<script setup lang="ts">
/**
 * 属性面板：单选时按类型渲染 22 个白名单属性 + 位置尺寸 + 图层名/隐藏/锁定；
 * 多选时只提供批量对齐与删除（与 v1 行为一致）。
 */
import { computed } from 'vue'
import { categoryLabel, componentLabel, getComponent } from '@/core/components'
import type { Constraints, SceneNode, StyleSpec } from '@/core/schema/types'
import { CONTENT_KEYS, STYLE_KEYS } from '@/core/schema/catalog'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()

/** 白名单之外的 props 也要能改，但 CONTENT_KEYS 已在上方单独渲染。 */
const CONTENT_KEY_SET = new Set<string>(CONTENT_KEYS)

const LABELS: Record<string, string> = {
  bg: '背景色',
  color: '文字颜色',
  fontSize: '字号',
  fontWeight: '字重',
  align: '水平对齐',
  radius: '圆角',
  borderWidth: '边框宽度',
  borderColor: '边框颜色',
  opacity: '不透明度',
  shadowBlur: '阴影模糊',
  shadowX: '阴影 X',
  shadowY: '阴影 Y',
  shadowColor: '阴影颜色',
  lineHeight: '行高',
  letterSpacing: '字间距',
  text: '文本',
  sub: '副标题',
  placeholder: '占位文字',
  src: '资源地址',
  link: '跳转链接',
}

const COLOR_KEYS = new Set(['bg', 'color', 'borderColor', 'shadowColor'])
const NUMBER_KEYS = new Set([
  'fontSize',
  'fontWeight',
  'radius',
  'borderWidth',
  'opacity',
  'shadowBlur',
  'shadowX',
  'shadowY',
  'lineHeight',
  'letterSpacing',
])

const node = computed<SceneNode | null>(() => (store.selectedIds.length === 1 ? store.primary : null))
/**
 * 组件面板里点中的类型（M22）：右侧先显示它的默认属性与说明，不插入画布。
 * 一旦选中了画布元素就让位给真正的属性编辑。
 */
const palette = computed(() => {
  if (!store.paletteType || store.selectedIds.length > 0) return null
  return getComponent(store.paletteType) ?? null
})
const paletteProps = computed(() => {
  const entries = Object.entries(palette.value?.defaultProps ?? {})
  return entries.filter(([, value]) => value !== '' && value !== undefined && value !== null)
})
const palettePropsText = computed(() =>
  paletteProps.value.length === 0
    ? '无（用描述符默认值）'
    : paletteProps.value.map(([key, value]) => `${LABELS[key] ?? key}：${String(value)}`).join('；'),
)
/** 屏幕上的绝对盒（`rectOf()` 给的是相对父容器的坐标，窄断点下会换算，见 M23） */
const box = computed(() => (node.value ? (store.boxes[node.value.id] ?? null) : null))
const breakpointLabel = computed(
  () => store.breakpoints.find((item) => item.id === store.breakpointId)?.label ?? store.breakpointId,
)

/** M23：当前断点生效的锚定（窄断点可能来自覆盖，所以读 viewNodes 而不是基准节点） */
const constraints = computed<Constraints>(() => {
  const current = node.value ? store.viewNodes[node.value.id] : undefined
  return current?.layout.constraints ?? { h: 'left', v: 'top' }
})
const H_CONSTRAINTS = [
  { key: 'left', label: '固定左边距' },
  { key: 'right', label: '固定右边距' },
  { key: 'left-right', label: '左右两边固定' },
  { key: 'center', label: '水平居中' },
  { key: 'scale', label: '按比例缩放' },
] as const
const V_CONSTRAINTS = [
  { key: 'top', label: '固定上边距' },
  { key: 'bottom', label: '固定下边距' },
  { key: 'top-bottom', label: '上下两边固定' },
  { key: 'center', label: '垂直居中' },
  { key: 'scale', label: '按比例缩放' },
] as const
const constraintHint = computed(() => {
  if (!node.value) return ''
  const { h, v } = constraints.value
  const horizontal = H_CONSTRAINTS.find((item) => item.key === h)?.label ?? h
  const vertical = V_CONSTRAINTS.find((item) => item.key === v)?.label ?? v
  if (!store.isBaseBreakpoint && store.activeOverrideFlags.layout) {
    return `这个断点上手动调过位置尺寸，先用你调的值；锚定：${horizontal} / ${vertical}`
  }
  if (!store.isBaseBreakpoint && !store.activeOverrideFlags.layout) {
    return `继承基准断点的锚定：${horizontal} / ${vertical}`
  }
  return `屏幕变窄/变高时：${horizontal}，${vertical}`
})

const ALIGNS = [
  { key: 'left', label: '左对齐' },
  { key: 'hcenter', label: '水平居中' },
  { key: 'right', label: '右对齐' },
  { key: 'top', label: '顶对齐' },
  { key: 'vcenter', label: '垂直居中' },
  { key: 'bottom', label: '底对齐' },
] as const

function styleValue(key: string): string | number {
  const value = node.value?.style[key as keyof SceneNode['style']]
  return typeof value === 'number' || typeof value === 'string' ? value : ''
}

function contentValue(key: string): string {
  const value = node.value?.props[key]
  return typeof value === 'string' ? value : ''
}

function unknownValue(key: string): string {
  const value = node.value?.props[key]
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function setStyle(key: string, event: Event): void {
  const raw = (event.target as HTMLInputElement | HTMLSelectElement).value
  const value = NUMBER_KEYS.has(key) ? Number(raw) : raw
  // 只发差量：store 会把 style 与节点现值浅合并，不会抹掉其它样式字段。
  const patch: Partial<StyleSpec> = {}
  ;(patch as Record<string, unknown>)[key] = value
  store.updateSelection({ style: patch }, `修改${LABELS[key] ?? key}`, `style:${key}`)
}

function setContent(key: string, event: Event): void {
  const raw = (event.target as HTMLInputElement | HTMLTextAreaElement).value
  store.updateSelection({ props: { [key]: raw } }, `修改${LABELS[key] ?? key}`, `prop:${key}`)
}

/** 不在内容白名单里的 props（例如从旧文件带进来的自定义字段）。 */
const extraKeys = computed(() => Object.keys(node.value?.props ?? {}).filter((key) => !CONTENT_KEY_SET.has(key)))

function setGeometry(key: 'x' | 'y' | 'w' | 'h', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!node.value || !box.value || Number.isNaN(value)) return
  // 输入框里是屏幕上的绝对坐标，换算与钉锚定都交给 store.setAbsBox()（M23）
  store.setAbsBox(node.value.id, { ...box.value, [key]: value }, '修改位置尺寸')
}

/** M23：改锚定 = 组件在这个断点上怎么跟着父容器变。窄断点改就是该断点的覆盖。 */
function setConstraint(axis: 'h' | 'v', event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const target = node.value
  const current = target ? store.viewNodes[target.id] : undefined
  if (!target || !current) return
  const next: Constraints = { ...current.layout.constraints, [axis]: value }
  store.updateLayout(target.id, { constraints: next }, `修改${axis === 'h' ? '水平' : '垂直'}锚定`)
}

function adaptPage(): void {
  store.applyResponsiveAdapt()
}

function setName(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  if (!node.value) return
  store.updateNode(node.value.id, { meta: { ...node.value.meta, name: value.trim() || undefined } }, `rename:${node.value.id}`)
}

function toggleMeta(key: 'hidden' | 'locked', event: Event): void {
  if (!node.value) return
  const checked = (event.target as HTMLInputElement).checked
  store.updateNode(node.value.id, { meta: { ...node.value.meta, [key]: checked } })
}

/**
 * B16 的「本地文件」通道：读成 dataURL 直接写进 props.src。
 * 走 FileReader 而不是 objectURL，因为 dataURL 能随 JSON 导出/自动保存一起活下来。
 */
function onImageFile(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') store.updateSelection({ props: { src: reader.result } }, '替换图片')
    // 清空输入框，同一个文件才能被再次选中。
    input.value = ''
  }
  reader.readAsDataURL(file)
}

function copyStyle(): void {
  const primary = store.primary
  if (primary) store.copyStyleFrom(primary.id)
}
</script>

<template>
  <section class="panel panel--props">
    <h2 class="panel__title">属性</h2>

    <p v-if="store.selectedIds.length === 0 && !palette" class="panel__empty" data-role="props-empty">选中画布上的元素以编辑属性</p>

    <div v-else-if="palette" class="prop-form palette-props" data-role="palette-props">
      <p class="prop-type" data-role="palette-type">
        <span class="palette-props__icon">{{ palette.icon }}</span>
        {{ palette.label }}
        <span class="prop-type__id">{{ palette.type }}</span>
      </p>
      <p class="panel__hint">还没插入。拖到画布上才会添加，下面是它的默认属性。</p>
      <p class="prop-section">分类</p>
      <p class="palette-props__value" data-role="palette-category">{{ categoryLabel(palette.category) }}</p>
      <p class="prop-section">默认尺寸</p>
      <p class="palette-props__value" data-role="palette-size">{{ palette.defaultSize.w }} × {{ palette.defaultSize.h }}</p>
      <p class="prop-section">默认内容</p>
      <p class="palette-props__value" data-role="palette-props-list">{{ palettePropsText }}</p>
      <p class="prop-section">可覆盖字段</p>
      <p class="palette-props__value">{{ palette.overridable.length > 0 ? palette.overridable.join('、') : '—' }}</p>
      <p class="prop-section">说明</p>
      <p class="palette-props__doc" data-role="palette-doc">{{ palette.aiDoc }}</p>
      <button type="button" class="ghost-button" data-role="palette-clear" @click="store.selectPalette(null)">取消选择</button>
    </div>

    <template v-else-if="store.selectedIds.length > 1">
      <p class="panel__hint" data-role="multi-hint">已选中 {{ store.selectedIds.length }} 个元素</p>
      <div class="align-grid">
        <button
          v-for="option in ALIGNS"
          :key="option.key"
          type="button"
          class="align-button"
          :data-role="`align-${option.key}`"
          @click="store.align(option.key)"
        >
          {{ option.label }}
        </button>
      </div>
      <button type="button" class="danger-button" data-role="delete-selection" :disabled="!store.canRemoveSelection" @click="store.removeSelection()">删除选中元素</button>
      <button type="button" class="ghost-button" data-role="copy-style" @click="copyStyle">复制样式</button>
      <button type="button" class="ghost-button" data-role="paste-style" :disabled="!store.styleClipboard" @click="store.pasteStyleToSelection()">
        粘贴样式
      </button>
    </template>

    <div v-else-if="node" class="prop-form">
      <p class="prop-type" data-role="prop-type">
        {{ componentLabel(node.type) }}
        <span class="prop-type__id">{{ node.id }}</span>
      </p>

      <div v-if="!store.isBaseBreakpoint" class="prop-override">
        <span v-if="!store.activeOverrideFlags.empty" class="prop-override__badge" data-role="override-badge">
          {{ breakpointLabel }} 覆盖
        </span>
        <span v-else class="prop-override__hint" data-role="override-hint">继承自更宽的断点</span>
        <button
          v-if="!store.activeOverrideFlags.empty"
          type="button"
          class="ghost-button"
          data-role="clear-override"
          @click="store.clearOverrides()"
        >
          清除覆盖
        </button>
      </div>

      <label class="prop-row">
        <span class="prop-row__label">图层名</span>
        <input class="prop-input" data-role="name" :value="node.meta.name ?? ''" placeholder="未命名" @input="setName">
      </label>

      <div class="prop-row prop-row--checks">
        <label class="prop-check">
          <input type="checkbox" data-role="hidden" :checked="node.meta.hidden" @change="toggleMeta('hidden', $event)">
          隐藏
        </label>
        <label class="prop-check">
          <input type="checkbox" data-role="locked" :checked="node.meta.locked" @change="toggleMeta('locked', $event)">
          锁定
        </label>
      </div>

      <template v-if="box">
        <p class="prop-section">位置与尺寸</p>
        <div class="prop-grid">
          <label class="prop-cell">
            <span class="prop-row__label">X</span>
            <input class="prop-input" type="number" data-role="pos-x" :value="Math.round(box.x)" @change="setGeometry('x', $event)">
          </label>
          <label class="prop-cell">
            <span class="prop-row__label">Y</span>
            <input class="prop-input" type="number" data-role="pos-y" :value="Math.round(box.y)" @change="setGeometry('y', $event)">
          </label>
          <label class="prop-cell">
            <span class="prop-row__label">宽</span>
            <input class="prop-input" type="number" data-role="size-w" :value="Math.round(box.w)" @change="setGeometry('w', $event)">
          </label>
          <label class="prop-cell">
            <span class="prop-row__label">高</span>
            <input class="prop-input" type="number" data-role="size-h" :value="Math.round(box.h)" @change="setGeometry('h', $event)">
          </label>
        </div>
      </template>

      <p class="prop-section">跨断点适应</p>
      <div class="prop-grid">
        <label class="prop-cell">
          <span class="prop-row__label">水平锚定</span>
          <select class="prop-input" data-role="constraint-h" :value="constraints.h" @change="setConstraint('h', $event)">
            <option v-for="option in H_CONSTRAINTS" :key="option.key" :value="option.key">{{ option.label }}</option>
          </select>
        </label>
        <label class="prop-cell">
          <span class="prop-row__label">垂直锚定</span>
          <select class="prop-input" data-role="constraint-v" :value="constraints.v" @change="setConstraint('v', $event)">
            <option v-for="option in V_CONSTRAINTS" :key="option.key" :value="option.key">{{ option.label }}</option>
          </select>
        </label>
      </div>
      <p class="prop-hint" data-role="constraint-hint">{{ constraintHint }}</p>
      <button type="button" class="ghost-button" data-role="auto-adapt" @click="adaptPage">按位置自动适配整页</button>

      <p class="prop-section">内容</p>
      <label v-for="key in CONTENT_KEYS" :key="key" class="prop-row">
        <span class="prop-row__label">{{ LABELS[key] }}</span>
        <textarea
          v-if="key === 'text' || key === 'sub'"
          class="prop-input prop-input--area"
          :data-prop="key"
          :value="contentValue(key)"
          @input="setContent(key, $event)"
        />
        <input
          v-else
          class="prop-input"
          :data-prop="key"
          :value="contentValue(key)"
          @input="setContent(key, $event)"
        >
      </label>

      <label v-if="node.type === 'image'" class="prop-row">
        <span class="prop-row__label">本地图片</span>
        <input
          class="prop-input"
          type="file"
          accept="image/*"
          data-role="image-file"
          @change="onImageFile"
        >
      </label>

      <p class="prop-section">样式</p>
      <label v-for="key in STYLE_KEYS" :key="key" class="prop-row">
        <span class="prop-row__label">{{ LABELS[key] }}</span>
        <select v-if="key === 'align'" class="prop-input" :data-prop="key" :value="styleValue(key)" @change="setStyle(key, $event)">
          <option value="left">左</option>
          <option value="center">中</option>
          <option value="right">右</option>
        </select>
        <input
          v-else-if="COLOR_KEYS.has(key)"
          class="prop-input"
          type="color"
          :data-prop="key"
          :value="styleValue(key) || '#000000'"
          @change="setStyle(key, $event)"
        >
        <input
          v-else-if="NUMBER_KEYS.has(key)"
          class="prop-input"
          type="number"
          step="any"
          :data-prop="key"
          :value="styleValue(key)"
          @change="setStyle(key, $event)"
        >
        <input v-else class="prop-input" :data-prop="key" :value="styleValue(key)" @input="setStyle(key, $event)">
      </label>

      <p class="prop-section">其它属性</p>
      <label v-for="key in extraKeys" :key="key" class="prop-row">
        <span class="prop-row__label">{{ key }}</span>
        <input class="prop-input" :data-prop="key" :value="unknownValue(key)" @input="setContent(key, $event)">
      </label>

      <p v-if="node.id === store.rootId" class="panel__hint" data-role="root-hint">
        当前选中的是页面画布本身（根容器），不能删除；要删的是画布里的元素。
      </p>
      <button
        type="button"
        class="danger-button"
        data-role="delete-selection"
        :disabled="!store.canRemoveSelection"
        @click="store.removeSelection()"
      >
        删除这个元素
      </button>
    </div>
  </section>
</template>
