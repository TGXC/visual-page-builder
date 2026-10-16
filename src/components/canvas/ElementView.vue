<script setup lang="ts">
/**
 * 画布里的一个元素。样式直接复用 core/codegen 的 `inlineStyle`，
 * 这样「画布所见」与「导出 HTML」用的是同一份 CSS 生成逻辑，不会各写一套然后漂移。
 */
import { computed } from 'vue'
import type { NodeId, SceneNode } from '@/core/schema/types'
import { childrenOf } from '@/core/tree'
import { inlineStyle, safeUrl } from '@/core/codegen'
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
const editable = computed(() => props.node.type === 'text' || props.node.type === 'header' || props.node.type === 'card' || props.node.type === 'button')
const text = computed(() => String(props.node.props.text ?? ''))
const sub = computed(() => String(props.node.props.sub ?? ''))
const options = computed(() =>
  String(props.node.props.text ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== ''),
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
    <div class="canvas-el__content" :class="{ 'canvas-el__content--muted': node.props.placeholder && !text && node.type !== 'select' }">
      <template v-if="editing">
        <slot />
      </template>
      <template v-else-if="node.type === 'text' || node.type === 'nav'">{{ text }}</template>
      <template v-else-if="node.type === 'header' || node.type === 'card'">
        <div class="canvas-el__title">{{ text }}</div>
        <div v-if="sub" class="canvas-el__sub">{{ sub }}</div>
      </template>
      <template v-else-if="node.type === 'button'">{{ text || '按钮' }}</template>
      <template v-else-if="node.type === 'input'">{{ String(node.props.placeholder ?? '') }}</template>
      <template v-else-if="node.type === 'textarea'">{{ String(node.props.placeholder ?? '') }}</template>
      <template v-else-if="node.type === 'select'">
        <span class="canvas-el__muted">{{ String(node.props.placeholder ?? '请选择') }}</span>
        <span class="canvas-el__caret">▾</span>
      </template>
      <template v-else-if="node.type === 'checkbox' || node.type === 'radio'">
        <span v-for="option in options" :key="option" class="canvas-el__choice">
          <i :class="node.type === 'radio' ? 'canvas-el__dot' : 'canvas-el__box'" />{{ option }}
        </span>
      </template>
      <template v-else-if="node.type === 'image'">
        <span v-if="!backgroundImage" class="canvas-el__muted">{{ text || '图片' }}</span>
      </template>
      <template v-else-if="node.type === 'video'">
        <span class="canvas-el__play">▶</span>
      </template>
      <template v-else-if="node.type === 'group'">
        <span v-if="!children.length" class="canvas-el__muted">空分组</span>
      </template>
      <template v-else-if="node.type === 'frame'">
        <span v-if="!children.length" class="canvas-el__frame-hint">从左侧拖入组件开始搭建</span>
      </template>
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
      <span class="canvas-el__badge">{{ node.meta.name || node.type }}</span>
    </template>
  </div>
</template>
