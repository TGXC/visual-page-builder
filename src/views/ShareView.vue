<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import FillForm from '@/components/runtime/FillForm.vue'
import { decodeSchema } from '@/core/share'
import { useRuntimeStore } from '@/stores/runtime'
import { useSchemaStore } from '@/stores/schema'

/**
 * 分享页：schema 全在链接里，没有后端。
 * 解出来的 schema 只服务于这一页，所以用 `persist: false` 写进 store ——
 * 打开别人的链接不能覆盖访客自己 localStorage 里的草稿（D21）。
 */
const route = useRoute()
const schema = useSchemaStore()
const runtime = useRuntimeStore()

const query = route.query.d
const decoded = decodeSchema(typeof query === 'string' ? query : '')

if (decoded) {
  schema.setSchema(decoded, { persist: false })
  runtime.reset()
}

const title = computed(() => schema.schema.name)
</script>

<template>
  <main class="fb-view">
    <template v-if="decoded">
      <p class="fb-share__hint">你正在查看分享的表单「{{ title }}」，填写结果只保留在这个页面里</p>
      <FillForm />
    </template>
    <div v-else class="fb-empty">分享链接不完整或已损坏</div>
  </main>
</template>
