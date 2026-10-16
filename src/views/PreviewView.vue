<script setup lang="ts">
import FillForm from '@/components/runtime/FillForm.vue'

/**
 * 预览页：编辑器和这里读的是同一个 schema store，所以在编辑器里改的东西立刻能填。
 * 值、错误、提交结果都在 runtime store 里（见 FillForm）。
 */
</script>

<template>
  <main class="fb-view">
    <FillForm />
  </main>
</template>
