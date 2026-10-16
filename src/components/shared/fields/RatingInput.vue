<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    id?: string
    value?: unknown
    max?: number
    disabled?: boolean
  }>(),
  { max: 5, disabled: false },
)

const emit = defineEmits<{ 'update:value': [value: number] }>()

const total = computed(() => (Number.isFinite(props.max) && (props.max as number) > 0 ? Math.floor(props.max as number) : 5))

/** 非法值（'abc' / null）按 0 分显示，不让画布上出现半颗星 */
const score = computed(() => {
  const raw = typeof props.value === 'number' ? props.value : Number(props.value)
  if (!Number.isFinite(raw)) return 0
  return Math.min(Math.max(Math.round(raw), 0), total.value)
})

/** 再点一次当前分数就清零——否则打错了没法回到 0 分 */
function pick(value: number): void {
  emit('update:value', score.value === value ? 0 : value)
}
</script>

<template>
  <div class="fb-rating" role="radiogroup">
    <button
      v-for="star in total"
      :key="star"
      type="button"
      class="fb-rating__star"
      :class="{ 'fb-rating__star--on': star <= score }"
      :aria-label="`${star} 星`"
      :disabled="disabled"
      @click="pick(star)"
    >
      ★
    </button>
  </div>
</template>
