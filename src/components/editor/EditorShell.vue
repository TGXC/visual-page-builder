<script setup lang="ts">
import { computed, ref } from 'vue'
import Canvas from './Canvas.vue'
import ComponentPalette from './ComponentPalette.vue'
import HistoryPanel from './HistoryPanel.vue'
import PropPanel from './PropPanel.vue'
import SchemaActions from './SchemaActions.vue'
import { useDragField } from '@/composables/useDragField'
import { useKeyboard } from '@/composables/useKeyboard'
import { useSortable } from '@/composables/useSortable'
import { useHistoryStore } from '@/stores/history'
import { useSchemaStore } from '@/stores/schema'
import type { DragPayload, DragTarget } from '@/composables/useDragField'
import type { FieldType } from '@/core/types'

/** 编辑器外壳：唯一把 store、拖拽、快捷键接在一起的地方。 */
const store = useSchemaStore()
const history = useHistoryStore()
const { drop } = useSortable()
const canvasRef = ref<HTMLElement | null>(null)

const { drag, ghost, startDrag } = useDragField({
  canvas: () => canvasRef.value,
  fields: () => store.schema.fields,
  onDrop: (payload: DragPayload, target: DragTarget) => drop(payload, target),
})

useKeyboard({
  onDelete: () => {
    if (store.selectedId) store.removeField(store.selectedId)
  },
  onDuplicate: () => {
    if (store.selectedId) store.duplicateField(store.selectedId)
  },
  onUndo: () => history.undo(),
  onRedo: () => history.redo(),
})

function onPaletteDragStart(payload: { type: FieldType; label: string; event: PointerEvent }): void {
  startDrag({
    pointerId: payload.event.pointerId,
    clientX: payload.event.clientX,
    clientY: payload.event.clientY,
    fieldId: null,
    type: payload.type,
    label: payload.label,
    parentId: null,
  })
}

function onFieldDragStart(fieldId: string, event: PointerEvent): void {
  const field = store.fieldById.get(fieldId)
  if (!field) return
  startDrag({
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    fieldId: field.id,
    type: field.type,
    label: field.label,
    parentId: field.parentId,
    order: field.order,
  })
}

/** 点画布空白处取消选中（点面板/属性面板不算）。 */
function onPointerDown(event: PointerEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.fb-canvas')) return
  if (target.closest('.fb-field')) return
  store.select(null)
}

const fieldCount = computed(() => store.schema.fields.length)
</script>

<template>
  <div class="fb-editor" @pointerdown="onPointerDown">
    <ComponentPalette @add="store.addField($event)" @dragstart="onPaletteDragStart" />

    <div ref="canvasRef" class="fb-editor__canvas">
      <Canvas
        :schema="store.schema"
        :selected-ids="store.selectedIds"
        :dragging-id="drag?.fieldId ?? null"
        :active="Boolean(drag?.active)"
        :drop-parent-id="drag?.dropParentId ?? null"
        :drop-index="drag?.visualIndex ?? null"
        @select="store.select($event)"
        @drag-field="onFieldDragStart"
        @duplicate="store.duplicateField($event)"
        @remove="store.removeField($event)"
      />
      <p class="fb-editor__status">共 {{ fieldCount }} 个字段</p>
    </div>

    <div class="fb-editor__side">
      <PropPanel :field="store.selectedField" :fields="store.schema.fields" @update="store.updateField" />
      <HistoryPanel :labels="history.labels" :index="history.position" @jump="history.jumpTo" />
      <SchemaActions :schema="store.schema" @import="store.setSchema" />
    </div>

    <div v-if="ghost" class="fb-drag-ghost" :style="{ left: `${ghost.x}px`, top: `${ghost.y}px` }">
      {{ ghost.label }}
    </div>
  </div>
</template>
