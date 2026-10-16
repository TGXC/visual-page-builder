<script setup lang="ts">
import { ref } from 'vue'
import { listDescriptors } from '@/fields'
import { DRAG_THRESHOLD } from '@/composables/useDragField'
import type { FieldType } from '@/core/types'

const emit = defineEmits<{
  add: [type: FieldType]
  dragstart: [payload: { type: FieldType; label: string; event: PointerEvent }]
}>()

/** 面板内容完全来自注册表：加一类字段只要注册，不用改这里。 */
const palette = listDescriptors()

/** 不引图标库，用一两个字符当图标。 */
const GLYPHS: Record<string, string> = { text: 'T', number: '#', select: '▾' }
const glyph = (icon: string): string => GLYPHS[icon] ?? '•'

const pressedAt = ref<{ x: number; y: number } | null>(null)

function onPointerDown(event: PointerEvent, item: { type: FieldType; label: string }): void {
  if (event.button !== 0) return
  pressedAt.value = { x: event.clientX, y: event.clientY }
  emit('dragstart', { type: item.type, label: item.label, event })
}

/** 拖过就是拖拽，没拖过才算点击（否则一次拖入会同时触发一次新增）。 */
function onClick(event: MouseEvent, type: FieldType): void {
  const start = pressedAt.value
  pressedAt.value = null
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_THRESHOLD) return
  emit('add', type)
}
</script>

<template>
  <aside class="fb-palette">
    <h2 class="fb-palette__title">组件</h2>
    <ul class="fb-palette__list">
      <li
        v-for="item in palette"
        :key="item.type"
        class="fb-palette__item"
        :data-type="item.type"
        @pointerdown="onPointerDown($event, item)"
        @click="onClick($event, item.type)"
      >
        <span class="fb-palette__icon" aria-hidden="true">{{ glyph(item.icon) }}</span>
        <span class="fb-palette__label">{{ item.label }}</span>
      </li>
    </ul>
    <p class="fb-palette__hint">点击或拖入画布</p>
  </aside>
</template>
