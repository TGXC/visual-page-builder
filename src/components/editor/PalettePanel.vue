<script setup lang="ts">
/** 组件面板：15 类组件（拖入画布）+ 6 套模板（一键载入） */
import { useEditorStore } from '@/stores/editor'
import { TEMPLATES } from '@/core/templates'

const store = useEditorStore()

const ICONS: Record<string, string> = {
  text: 'T',
  button: '▭',
  input: '⌷',
  rect: '▢',
  circle: '◯',
  divider: '—',
  nav: '☰',
  header: '▤',
  card: '❏',
  image: '🖼',
  select: '▾',
  checkbox: '☑',
  radio: '◉',
  textarea: '¶',
  video: '▶',
  group: '▣',
  frame: '⬚',
}

const LABELS: Record<string, string> = {
  text: '文本',
  button: '按钮',
  input: '输入框',
  rect: '矩形',
  circle: '圆形',
  divider: '分割线',
  nav: '导航栏',
  header: '页头',
  card: '卡片',
  image: '图片',
  select: '下拉',
  checkbox: '复选',
  radio: '单选',
  textarea: '文本域',
  video: '视频',
  group: '分组',
  frame: '容器',
}

const GROUPS: { label: string; types: string[] }[] = [
  { label: '基础', types: ['text', 'button', 'input', 'rect', 'circle', 'divider'] },
  { label: '布局', types: ['frame', 'group', 'nav', 'header', 'card'] },
  { label: '表单', types: ['select', 'checkbox', 'radio', 'textarea'] },
  { label: '媒体', types: ['image', 'video'] },
]

function onDragStart(event: DragEvent, type: string): void {
  event.dataTransfer?.setData('text/plain', type)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function add(type: string): void {
  store.insertComponent(type as never)
}
</script>

<template>
  <section class="panel panel--palette">
    <h2 class="panel__title">组件</h2>
    <div v-for="group in GROUPS" :key="group.label" class="palette-group">
      <p class="palette-group__label">{{ group.label }}</p>
      <div class="palette-grid">
        <button
          v-for="type in group.types"
          :key="type"
          type="button"
          class="palette-item"
          :data-type="type"
          draggable="true"
          :title="`拖入画布或点击添加：${LABELS[type]}`"
          @dragstart="onDragStart($event, type)"
          @click="add(type)"
        >
          <span class="palette-item__icon">{{ ICONS[type] ?? '•' }}</span>
          <span class="palette-item__label">{{ LABELS[type] ?? type }}</span>
        </button>
      </div>
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
