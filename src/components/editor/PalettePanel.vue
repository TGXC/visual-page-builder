<script setup lang="ts">
/**
 * 组件面板：组件清单来自 `core/components` 的描述符注册表（含第三方注册的组件），
 * 按分类分组并支持搜索；下面接 6 套模板（一键载入）。
 */
import { computed, onUnmounted, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { TEMPLATES } from '@/core/templates'
import {
  componentsByCategory,
  listComponents,
  searchComponents,
  subscribeRegistry,
} from '@/core/components'
import type { ComponentDescriptor } from '@/core/components'
import type { ComponentType } from '@/core/schema/types'

const store = useEditorStore()
const keyword = ref('')
/** 注册表版本：第三方注册组件后立刻反映到面板 */
const revision = ref(0)
const unsubscribe = subscribeRegistry(() => {
  revision.value += 1
})
onUnmounted(unsubscribe)
const total = computed(() => {
  void revision.value
  return listComponents().length
})

const groups = computed<{ key: string; label: string; items: ComponentDescriptor[] }[]>(() => {
  void revision.value
  const query = keyword.value.trim()
  if (query !== '') {
    return [{ key: 'search', label: `搜索「${query}」`, items: searchComponents(query) }]
  }
  return componentsByCategory()
    .filter((group) => group.items.length > 0)
    .map((group) => ({ key: group.category, label: group.label, items: group.items }))
})

/**
 * 分类折叠（用户 m10495：「组件似乎过于多了」+ 一行两个名字显示不全）。
 * 默认只展开布局 / 基础 / 展示，表单 12 个和媒体 5 个收起来；搜索时全部展开。
 * 注意用 v-show 而不是 v-if：搜索、编辑器测试都按 DOM 里的组件节点计数。
 */
const COLLAPSED_BY_DEFAULT = new Set(['form', 'media'])
const openGroups = ref<Record<string, boolean>>({})

function isOpen(key: string): boolean {
  if (key === 'search' || keyword.value.trim() !== '') return true
  return openGroups.value[key] ?? !COLLAPSED_BY_DEFAULT.has(key)
}

function toggle(key: string): void {
  openGroups.value = { ...openGroups.value, [key]: !isOpen(key) }
}

/**
 * 上一次 dragstart 的时间。有些浏览器（以及拖拽被中断的手势）会在 drag 结束后再补一个 click，
 * 结果是「拖进画布一个组件，面板又点了一次 → 多出一个」——用户看到的就是「拖动时复制了一份」。
 * dragstart 之后 400ms 内的 click 一律当作拖拽的尾巴忽略掉。
 */
let dragStartedAt = 0

function onDragStart(event: DragEvent, type: string): void {
  dragStartedAt = Date.now()
  event.dataTransfer?.setData('text/plain', type)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function add(type: ComponentType): void {
  if (Date.now() - dragStartedAt < 400) return
  store.insertComponent(type)
}
</script>

<template>
  <section class="panel panel--palette">
    <h2 class="panel__title">组件 <span class="panel__count">{{ total }}</span></h2>
    <input
      v-model="keyword"
      class="editor-input palette-search"
      type="search"
      placeholder="搜索组件…"
      data-role="palette-search"
    />

    <div v-for="group in groups" :key="group.key" class="palette-group" :data-category="group.key">
      <button
        type="button"
        class="palette-group__header"
        :data-role="`palette-toggle-${group.key}`"
        :aria-expanded="isOpen(group.key)"
        @click="toggle(group.key)"
      >
        <span class="palette-group__caret">{{ isOpen(group.key) ? '▾' : '▸' }}</span>
        <span class="palette-group__label">{{ group.label }}</span>
        <span class="palette-group__count">{{ group.items.length }}</span>
      </button>
      <div v-show="isOpen(group.key)" class="palette-grid">
        <button
          v-for="item in group.items"
          :key="item.type"
          type="button"
          class="palette-item"
          :data-type="item.type"
          draggable="true"
          :title="`拖入画布或点击添加：${item.label}`"
          @dragstart="onDragStart($event, item.type)"
          @click="add(item.type)"
        >
          <span class="palette-item__icon">{{ item.icon }}</span>
          <span class="palette-item__label">{{ item.label }}</span>
        </button>
      </div>
      <p v-if="group.items.length === 0" class="palette-empty">没有匹配的组件</p>
    </div>

    <h2 class="panel__title panel__title--spaced">模板</h2>
    <div class="template-list">
      <button
        v-for="template in TEMPLATES"
        :key="template.id"
        type="button"
        class="template-item"
        :data-template="template.id"
        @click="store.loadTemplate(template.id)"
      >
        <span class="template-item__label">{{ template.label }}</span>
        <span class="template-item__desc">{{ template.description }}</span>
      </button>
    </div>
  </section>
</template>
