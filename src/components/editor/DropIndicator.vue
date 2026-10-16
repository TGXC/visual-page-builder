<script setup lang="ts">
/**
 * 落点指示线：一条 2px 的线，激活时才可见。
 * 指示线的位置由 Canvas 按插入下标渲染，组件本身是纯展示。
 */
withDefaults(defineProps<{ active?: boolean }>(), { active: false })
</script>

<template>
  <div class="fb-drop-indicator" :class="{ 'fb-drop-indicator--active': active }" aria-hidden="true" />
</template>
