<script setup lang="ts">
import { computed } from 'vue'
import { getDescriptor } from '@/fields'
import type { PropSpec } from '@/fields/registry'
import type { FieldNode, MutableFieldKey } from '@/core/types'

/**
 * 属性面板：完全由字段自己声明的 propSchema 生成，面板里没有任何具体字段的知识。
 * 注意这里是**整体替换** props（不是局部合并），和 updateField 的语义一致。
 */
const props = defineProps<{ field: FieldNode | null }>()

const emit = defineEmits<{
  update: [id: string, patch: Partial<Pick<FieldNode, MutableFieldKey>>]
}>()

const descriptor = computed(() => (props.field ? getDescriptor(props.field.type) : null))

/** 默认值和当前值叠在一起，这样面板改一个属性不会把其他属性弄丢。 */
const values = computed<Record<string, unknown>>(() => {
  const base: Record<string, unknown> = { ...(descriptor.value?.defaultProps ?? {}) }
  return props.field ? { ...base, ...props.field.props } : base
})

function emitLabel(event: Event): void {
  const field = props.field
  if (!field) return
  emit('update', field.id, { label: (event.target as HTMLInputElement).value })
}

function emitProps(key: string, value: unknown): void {
  const field = props.field
  if (!field) return
  emit('update', field.id, { props: { ...values.value, [key]: value } })
}

function onInput(spec: PropSpec, event: Event): void {
  const raw = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
  if (spec.control === 'number') {
    const parsed = Number(raw)
    emitProps(spec.key, raw.trim() === '' || Number.isNaN(parsed) ? undefined : parsed)
    return
  }
  if (spec.control === 'options') {
    emitProps(spec.key, parseOptions(raw))
    return
  }
  emitProps(spec.key, raw)
}

function onSwitch(spec: PropSpec, event: Event): void {
  emitProps(spec.key, (event.target as HTMLInputElement).checked)
}

/** 值 → 控件能显示的字符串（unknown 收窄在这一处）。 */
function display(spec: PropSpec): string | number {
  const value = values.value[spec.key]
  return typeof value === 'string' || typeof value === 'number' ? value : ''
}

/** 选项列表用「每行一条 label=value」的纯文本编辑，简单且可粘贴。 */
function optionsText(): string {
  const raw = values.value.options
  if (!Array.isArray(raw)) return ''
  return raw
    .map(item => {
      const option = item as { label?: unknown; value?: unknown }
      return `${String(option.label ?? '')}=${String(option.value ?? '')}`
    })
    .join('\n')
}

function parseOptions(text: string): Array<{ label: string; value: string }> {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const [label, value] = line.split('=')
      const trimmed = label.trim()
      return { label: trimmed, value: (value ?? '').trim() || trimmed }
    })
}
</script>

<template>
  <aside class="fb-prop">
    <h2 class="fb-prop__title">属性</h2>

    <p v-if="!field || !descriptor" class="fb-prop__empty">选中一个字段以编辑属性</p>

    <div v-else class="fb-prop__form">
      <p class="fb-prop__type">{{ descriptor.label }}</p>

      <label class="fb-prop__row">
        <span class="fb-prop__name">标题</span>
        <input class="fb-prop__input fb-prop__label-input" :value="field.label" @input="emitLabel" />
      </label>

      <label v-for="spec in descriptor.propSchema" :key="spec.key" class="fb-prop__row">
        <span class="fb-prop__name">{{ spec.label }}</span>

        <input
          v-if="spec.control === 'switch'"
          class="fb-prop__switch"
          type="checkbox"
          :data-key="spec.key"
          :checked="Boolean(values[spec.key])"
          @change="onSwitch(spec, $event)"
        />

        <select
          v-else-if="spec.control === 'select'"
          class="fb-prop__input"
          :data-key="spec.key"
          :value="String(values[spec.key] ?? '')"
          @change="onInput(spec, $event)"
        >
          <option v-for="option in spec.options" :key="String(option.value)" :value="String(option.value)">
            {{ option.label }}
          </option>
        </select>

        <textarea
          v-else-if="spec.control === 'options'"
          class="fb-prop__input fb-prop__textarea"
          :data-key="spec.key"
          rows="4"
          :value="optionsText()"
          @input="onInput(spec, $event)"
        />

        <input
          v-else
          class="fb-prop__input"
          :data-key="spec.key"
          :type="spec.control === 'number' ? 'number' : spec.control === 'color' ? 'color' : 'text'"
          :placeholder="spec.placeholder"
          :value="display(spec)"
          @input="onInput(spec, $event)"
        />
      </label>
    </div>
  </aside>
</template>
