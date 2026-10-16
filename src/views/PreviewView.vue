<script setup lang="ts">
import { ref } from 'vue'
import FormRenderer from '@/components/runtime/FormRenderer.vue'
import { useRuntimeStore } from '@/stores/runtime'
import { useSchemaStore } from '@/stores/schema'

/**
 * 预览页：编辑器和这里读的是同一个 schema store，所以在编辑器里改的东西立刻能填。
 * 值、错误、提交结果都在 runtime store 里；这个组件只负责把错误滚到眼前。
 */
const schema = useSchemaStore()
const runtime = useRuntimeStore()
const hostRef = ref<HTMLElement | null>(null)

function scrollToFirstError(): void {
  const name = runtime.firstErrorName
  if (!name) return
  // 在自己的子树里找，不用 document：预览页可能是嵌在别处的
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
  <main class="fb-view">
    <div ref="hostRef" class="fb-preview">
      <FormRenderer
        :schema="schema.schema"
        :values="runtime.values"
        :errors="runtime.errors"
        @update:value="runtime.setValue"
        @submit="onSubmit"
      />
    </div>

    <section v-if="runtime.submitted" class="fb-submitted">
      <h2 class="fb-submitted__title">提交结果（FormValues）</h2>
      <pre class="fb-submitted__json">{{ JSON.stringify(runtime.submitted, null, 2) }}</pre>
      <button type="button" class="fb-button" @click="runtime.reset()">清空重填</button>
    </section>
  </main>
</template>
