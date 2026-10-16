<script setup lang="ts">
import FormRenderer from '@/components/runtime/FormRenderer.vue'
import { demoSchema } from '@/data/demoSchema'

// M2：同样是硬编码 schema，用来验证与编辑器渲染结果一致。M5 起接 runtime store。
const schema = demoSchema
const onSubmit = (): void => {
  // M5 接管：校验 + 输出 FormValues
}
</script>

<template>
  <main class="fb-view">
    <FormRenderer :schema="schema" @submit="onSubmit" />
  </main>
</template>
