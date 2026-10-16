<script setup lang="ts">
import Canvas from '@/components/editor/Canvas.vue'
import { demoSchema } from '@/data/demoSchema'

// M2：先渲染硬编码 schema。M3 起改为从 schema store 读取，并挂上组件面板与属性面板。
const schema = demoSchema
</script>

<template>
  <main class="fb-view">
    <Canvas :schema="schema" />
  </main>
</template>
