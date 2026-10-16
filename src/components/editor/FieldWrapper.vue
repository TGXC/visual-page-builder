<script setup lang="ts">
import FieldControl from '@/components/shared/FieldControl.vue'
import type { FieldNode } from '@/core/types'

/**
 * 编辑态单个字段的外壳：负责选中、拖拽起点与工具条。
 * 字段控件本身是哑组件，不知道自己被谁包着。
 */
const props = withDefaults(
  defineProps<{
    field: FieldNode
    selected?: boolean
    dragging?: boolean
    /** 预览路径可以关掉工具条 */
    controls?: boolean
  }>(),
  { controls: true },
)

const emit = defineEmits<{
  select: [id: string]
  dragStart: [event: PointerEvent]
  duplicate: [id: string]
  remove: [id: string]
}>()

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
    :class="{ 'fb-field--selected': selected, 'fb-field--dragging': dragging }"
    :data-field-id="field.id"
    :data-parent-id="field.parentId ?? ''"
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
      <FieldControl :field="field" />
    </div>
  </div>
</template>
