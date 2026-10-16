<script setup lang="ts">
/**
 * 布局面板（M2）：容器模式、尺寸模式、间距、对齐。
 *
 * 只改 `layout`；位置/尺寸的像素值仍在属性面板里改（两个入口都能改同一份数据很容易打架）。
 * 非容器元素也能改尺寸模式与对齐 —— 这些属性是通用的，mode/padding 主要给容器用。
 */
import { computed } from 'vue'
import type { Alignment, Justify, LayoutMode, LayoutSpec, SceneNode, SizeKind } from '@/core/schema/types'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const node = computed<SceneNode | null>(() => (store.selectedIds.length === 1 ? store.primary : null))
const layout = computed<LayoutSpec | null>(() => node.value?.layout ?? null)
const isContainer = computed(() => node.value?.type === 'frame' || node.value?.type === 'group')

const MODES: { key: LayoutMode; label: string }[] = [
  { key: 'free', label: '自由' },
  { key: 'vertical', label: '纵向' },
  { key: 'horizontal', label: '横向' },
  { key: 'grid', label: '网格' },
]

const SIZE_KINDS: { key: SizeKind; label: string }[] = [
  { key: 'fixed', label: '固定' },
  { key: 'hug', label: '包裹' },
  { key: 'fill', label: '填满' },
  { key: 'ratio', label: '比例' },
]

const ALIGNS: { key: Alignment; label: string }[] = [
  { key: 'start', label: '起点' },
  { key: 'center', label: '居中' },
  { key: 'end', label: '终点' },
  { key: 'stretch', label: '拉伸' },
]

const JUSTIFIES: { key: Justify; label: string }[] = [
  { key: 'start', label: '起点' },
  { key: 'center', label: '居中' },
  { key: 'end', label: '终点' },
  { key: 'space-between', label: '两端' },
]

const WRAPS: { key: boolean; label: string; role: string }[] = [
  { key: false, label: '不换行', role: 'layout-wrap-nowrap' },
  { key: true, label: '换行', role: 'layout-wrap-wrap' },
]

const SIDES: { key: 'top' | 'right' | 'bottom' | 'left'; label: string }[] = [
  { key: 'top', label: '上' },
  { key: 'right', label: '右' },
  { key: 'bottom', label: '下' },
  { key: 'left', label: '左' },
]

function setMode(mode: LayoutMode): void {
  if (!node.value) return
  store.updateLayout(node.value.id, { mode }, `布局：${MODES.find((item) => item.key === mode)?.label ?? mode}`)
}

function setSizeKind(axis: 'w' | 'h', kind: SizeKind): void {
  const current = layout.value
  if (!node.value || !current) return
  const size =
    axis === 'w' ? { ...current.size, w: { ...current.size.w, kind } } : { ...current.size, h: { ...current.size.h, kind } }
  store.updateLayout(node.value.id, { size }, axis === 'w' ? '宽度模式' : '高度模式')
}

function setNumber(key: 'gap' | 'columns', event: Event): void {
  if (!node.value) return
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') return
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  store.updateLayout(node.value.id, { [key]: Math.max(0, Math.round(value)) }, key === 'gap' ? '间距' : '列数')
}

function setPadding(side: 'top' | 'right' | 'bottom' | 'left', event: Event): void {
  const current = layout.value
  if (!node.value || !current) return
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') return
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  store.updateLayout(
    node.value.id,
    { padding: { ...current.padding, [side]: Math.max(0, Math.round(value)) } },
    '内边距',
  )
}

function setAlign(align: Alignment): void {
  if (node.value) store.updateLayout(node.value.id, { align }, '交叉轴对齐')
}

function setJustify(justify: Justify): void {
  if (node.value) store.updateLayout(node.value.id, { justify }, '主轴对齐')
}

function setWrap(wrap: boolean): void {
  if (node.value) store.updateLayout(node.value.id, { wrap }, '换行方式')
}
</script>

<template>
  <section v-if="node && layout" class="layout-panel" data-role="layout-panel">
    <p class="prop-section">布局</p>

    <div class="prop-row">
      <span class="prop-row__label">容器</span>
      <div class="prop-buttons">
        <button
          v-for="mode in MODES"
          :key="mode.key"
          type="button"
          class="prop-button"
          :class="{ 'is-active': layout.mode === mode.key }"
          :data-role="`layout-mode-${mode.key}`"
          :title="isContainer ? mode.label : '非容器也可以改用流式排布'"
          @click="setMode(mode.key)"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>

    <div class="prop-row">
      <span class="prop-row__label">宽度</span>
      <div class="prop-buttons">
        <button
          v-for="kind in SIZE_KINDS"
          :key="`w-${kind.key}`"
          type="button"
          class="prop-button"
          :class="{ 'is-active': layout.size.w.kind === kind.key }"
          :data-role="`layout-size-w-${kind.key}`"
          @click="setSizeKind('w', kind.key)"
        >
          {{ kind.label }}
        </button>
      </div>
    </div>

    <div class="prop-row">
      <span class="prop-row__label">高度</span>
      <div class="prop-buttons">
        <button
          v-for="kind in SIZE_KINDS"
          :key="`h-${kind.key}`"
          type="button"
          class="prop-button"
          :class="{ 'is-active': layout.size.h.kind === kind.key }"
          :data-role="`layout-size-h-${kind.key}`"
          @click="setSizeKind('h', kind.key)"
        >
          {{ kind.label }}
        </button>
      </div>
    </div>

    <div class="prop-row">
      <span class="prop-row__label">交叉轴</span>
      <div class="prop-buttons">
        <button
          v-for="item in ALIGNS"
          :key="`align-${item.key}`"
          type="button"
          class="prop-button"
          :class="{ 'is-active': layout.align === item.key }"
          :data-role="`layout-align-${item.key}`"
          @click="setAlign(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="prop-row">
      <span class="prop-row__label">主轴</span>
      <div class="prop-buttons">
        <button
          v-for="item in JUSTIFIES"
          :key="`justify-${item.key}`"
          type="button"
          class="prop-button"
          :class="{ 'is-active': layout.justify === item.key }"
          :data-role="`layout-justify-${item.key}`"
          @click="setJustify(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="prop-row">
      <span class="prop-row__label">换行</span>
      <div class="prop-buttons">
        <button
          v-for="item in WRAPS"
          :key="item.role"
          type="button"
          class="prop-button"
          :class="{ 'is-active': layout.wrap === item.key }"
          :data-role="item.role"
          @click="setWrap(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <label class="prop-row">
      <span class="prop-row__label">间距</span>
      <input
        class="prop-input"
        type="number"
        min="0"
        step="1"
        data-role="layout-gap"
        :value="layout.gap"
        @change="setNumber('gap', $event)"
      >
    </label>

    <label class="prop-row">
      <span class="prop-row__label">列数</span>
      <input
        class="prop-input"
        type="number"
        min="1"
        step="1"
        data-role="layout-columns"
        :value="layout.columns"
        @change="setNumber('columns', $event)"
      >
    </label>

    <div class="prop-row prop-row--grid">
      <span class="prop-row__label">内边距</span>
      <input
        v-for="side in SIDES"
        :key="`pad-${side.key}`"
        class="prop-input prop-input--mini"
        type="number"
        min="0"
        step="1"
        :data-role="`layout-padding-${side.key}`"
        :title="side.label"
        :value="layout.padding[side.key]"
        @change="setPadding(side.key, $event)"
      >
    </div>

    <p v-if="layout.mode !== 'free'" class="prop-hint" data-role="layout-flow-hint">
      流式排布暂时忽略坐标；切回「自由」会还原原来的位置。
    </p>
  </section>
</template>
