<script setup lang="ts">
import { ref } from 'vue'
import FormRenderer from './FormRenderer.vue'
import { useRuntimeStore } from '@/stores/runtime'
import { useSchemaStore } from '@/stores/schema'

/**
 * 「填一张表单」这件事的完整装配：渲染 + 值 + 错误 + 提交结果 + 把第一个错误滚到眼前。
 * 预览页和分享页共用它——两条路只有「schema 从哪来」不同（本地 draft vs 链接里的压缩数据）。
 */
const schema = useSchemaStore()
const runtime = useRuntimeStore()
const hostRef = ref<HTMLElement | null>(null)

function scrollToFirstError(): void {
  const name = runtime.firstErrorName
  if (!name) return
  // 在自己的子树里找，不用 document：这样组件挂在哪都能工作
  const el = hostRef.value?.querySelector<HTMLElement>(`.fb-field[data-name="${name}"]`)
  el?.scrollIntoView?.({ block: 'center' })
}

function onSubmit(): void {
  const payload = runtime.submit()
  if (payload) return
  scrollToFirstError()
}
</script>

<template>
  <div ref="hostRef" class="fb-preview">
    <FormRenderer
      :schema="schema.schema"
      :values="runtime.values"
      :errors="runtime.errors"
      @update:value="runtime.setValue"
      @submit="onSubmit"
    />

    <section v-if="runtime.submitted" class="fb-submitted">
      <h2 class="fb-submitted__title">提交结果（FormValues）</h2>
      <pre class="fb-submitted__json">{{ JSON.stringify(runtime.submitted, null, 2) }}</pre>
      <button type="button" class="fb-button" @click="runtime.reset()">清空重填</button>
    </section>
  </div>
</template>
