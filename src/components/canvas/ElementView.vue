<script setup lang="ts">
/**
 * 画布里的一个元素。样式直接复用 core/codegen 的 `inlineStyle`，
 * 内容则走 `core/components` 的 `renderCanvasContent`——
 * 与导出 HTML 用的是同一份描述符，不会各写一套然后漂移。
 */
import { computed } from 'vue'
import type { NodeId, SceneNode } from '@/core/schema/types'
import { childrenOf } from '@/core/tree'
import { inlineStyle, safeUrl } from '@/core/codegen'
import { componentLabel, getComponent, renderCanvasContent } from '@/core/components'
import { HANDLES } from '@/core/geometry'
import { useEditorStore } from '@/stores/editor'

const props = withDefaults(
  defineProps<{
    node: SceneNode
    nodes: Record<NodeId, SceneNode>
    scale: number
    interactive?: boolean
    editing?: boolean
  }>(),
  // Vue 对 Boolean 类型的 prop 会把「没传」强制转成 false，
  // 所以想「默认可以交互」必须显式给默认值 true。
  { interactive: true },
)

const emit = defineEmits<{
  (event: 'edit-text', id: NodeId): void
}>()

const store = useEditorStore()
const children = computed(() => childrenOf(props.nodes, props.node.id))
const selected = computed(() => store.selectedIds.includes(props.node.id))
const hinted = computed(() => store.hoveredId === props.node.id)
/** 能否双击直接改文字：由组件描述符声明 */
const editable = computed(() => getComponent(props.node.type)?.editable === true)
const text = computed(() => String(props.node.props.text ?? ''))
const content = computed(() => renderCanvasContent(props.node, props.nodes))
const mutedContent = computed(
  () => Boolean(props.node.props.placeholder) && !text.value && props.node.type !== 'select',
)

const backgroundImage = computed(() => (props.node.type === 'image' ? safeUrl(String(props.node.props.src ?? '')) : ''))
/** 几何来自布局引擎（store.boxes），free 之外的模式也拿到绝对盒 */
const box = computed(() => store.boxes[props.node.id])
const style = computed(() => {
  const css = inlineStyle(props.node, backgroundImage.value, box.value)
  return `${css};${props.node.type === 'divider' ? 'background:' + (props.node.style.bg || '#E2E8F0') + ';' : ''}`
})
const showHandles = computed(() => props.interactive !== false && selected.value && store.selectedIds.length === 1 && !props.node.meta.locked)
const handleSize = computed(() => 8 / props.scale)

function onDoubleClick(): void {
  if (!editable.value) return
  emit('edit-text', props.node.id)
}
</script>

<template>
  <div
    class="canvas-el"
    :class="{
      'canvas-el--selected': selected,
      'canvas-el--hinted': hinted && !selected,
      'canvas-el--locked': node.meta.locked,
      'canvas-el--hidden': node.meta.hidden,
      'canvas-el--container': children.length > 0,
    }"
    :data-node-id="node.id"
    :data-type="node.type"
    :style="style"
    @dblclick.stop="onDoubleClick"
  >
    <div class="canvas-el__content" :class="{ 'canvas-el__content--muted': mutedContent }">
      <slot v-if="editing" />
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span v-else class="canvas-el__inner" v-html="content" />
    </div>

    <ElementView
      v-for="child in children"
      :key="child.id"
      :node="child"
      :nodes="nodes"
      :scale="scale"
      :interactive="interactive"
      :editing="false"
      @edit-text="(id) => emit('edit-text', id)"
    />

    <template v-if="showHandles">
      <span
        v-for="handle in HANDLES"
        :key="handle"
        class="canvas-handle"
        :class="`canvas-handle--${handle}`"
        :data-handle="handle"
        :style="{ width: `${handleSize}px`, height: `${handleSize}px` }"
      />
      <span class="canvas-el__badge">{{ node.meta.name || componentLabel(node.type) }}</span>
    </template>
  </div>
</template>
