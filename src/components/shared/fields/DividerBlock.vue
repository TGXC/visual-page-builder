<script setup lang="ts">
/**
 * 分隔线：只有排版作用，不产出值（描述对象里 `hasValue: false`），
 * 所以它既不会出现在校验里，也不会出现在提交结果里。
 */
withDefaults(
  defineProps<{
    text?: string
    dashed?: boolean
  }>(),
  { text: '', dashed: false },
)
</script>

<template>
  <div class="fb-divider" :class="{ 'fb-divider--dashed': dashed }">
    <span v-if="text" class="fb-divider__text">{{ text }}</span>
  </div>
</template>
