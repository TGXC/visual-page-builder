<script setup lang="ts">
import { computed } from 'vue'
import FieldControl from '@/components/shared/FieldControl.vue'
import FieldList from './FieldList.vue'
import { getDescriptor } from '@/fields/registry'
import type { FieldNode } from '@/core/types'

/**
 * 编辑态单个字段的外壳：负责选中、拖拽起点与工具条。
 * 字段控件本身是哑组件，不知道自己被谁包着。
 * 容器字段（group）在这里递归渲染自己的子字段。
 */
const props = withDefaults(
  defineProps<{
    field: FieldNode
    selected?: boolean
    dragging?: boolean
    /** 预览路径可以关掉工具条 */
    controls?: boolean
    /** 递归渲染子字段时需要：整棵字段表与当前的拖拽状态 */
    fields?: FieldNode[]
    selectedIds?: string[]
    draggingId?: string | null
    active?: boolean
    dropParentId?: string | null
    dropIndex?: number | null
  }>(),
  {
    controls: true,
    fields: () => [],
    selectedIds: () => [],
    draggingId: null,
    active: false,
    dropParentId: null,
    dropIndex: null,
  },
)

const emit = defineEmits<{
  select: [id: string]
  dragStart: [event: PointerEvent]
  duplicate: [id: string]
  remove: [id: string]
  dragField: [id: string, event: PointerEvent]
}>()

const descriptor = computed(() => getDescriptor(props.field.type))
const isContainer = computed(() => descriptor.value.isContainer === true)

/**
 * 整块都能按：选中与拖拽共用同一个起点，靠 useDragField 里的 5px 阈值区分，
 * 所以这里不需要「拖拽手柄」。
 */
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  emit('select', props.field.id)
  emit('dragStart', event)
}
</script>

<template>
  <div
    class="fb-field"
    :class="{
      'fb-field--selected': selected,
      'fb-field--dragging': dragging,
      'fb-field--container': isContainer,
    }"
    :data-field-id="field.id"
    :data-parent-id="field.parentId ?? ''"
    :data-container="isContainer ? 'true' : undefined"
    @pointerdown="onPointerDown"
  >
    <div class="fb-field__head">
      <label class="fb-field__label">{{ field.label }}</label>
      <div v-if="controls" class="fb-field__actions">
        <button
          type="button"
          class="fb-field__action"
          title="复制字段"
          @pointerdown.stop
          @click.stop="emit('duplicate', field.id)"
        >
          ⧉
        </button>
        <button
          type="button"
          class="fb-field__action"
          title="删除字段"
          @pointerdown.stop
          @click.stop="emit('remove', field.id)"
        >
          ✕
        </button>
      </div>
    </div>
    <div class="fb-field__body">
      <FieldControl :field="field">
        <FieldList
          v-if="isContainer"
          :fields="fields"
          :parent-id="field.id"
          :selected-ids="selectedIds"
          :dragging-id="draggingId"
          :active="active"
          :drop-parent-id="dropParentId"
          :drop-index="dropIndex"
          @select="emit('select', $event)"
          @drag-field="(id, event) => emit('dragField', id, event)"
          @duplicate="emit('duplicate', $event)"
          @remove="emit('remove', $event)"
        />
      </FieldControl>
    </div>
  </div>
</template>
