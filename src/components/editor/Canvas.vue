<script setup lang="ts">
import { computed } from 'vue'
import FieldControl from '@/components/shared/FieldControl.vue'
import { childrenOf } from '@/core/tree'
import type { FormSchema } from '@/core/types'

/**
 * 编辑态画布：只把 schema 渲染出来，不绑值、不校验。
 * M3 会在这里包一层 FieldWrapper（选中 / 拖拽 / 工具条）并接上 store。
 */
const props = defineProps<{ schema: FormSchema }>()

const fields = computed(() => childrenOf(props.schema.fields, null))
</script>

<template>
  <div class="fb-canvas">
    <div class="fb-canvas__page">
      <h1 class="fb-canvas__title">{{ schema.name }}</h1>
      <p v-if="schema.description" class="fb-canvas__desc">{{ schema.description }}</p>

      <div v-if="fields.length === 0" class="fb-empty">暂无字段</div>
      <div v-else class="fb-canvas__fields">
        <div v-for="field in fields" :key="field.id" class="fb-field">
          <label class="fb-field__label">{{ field.label }}</label>
          <FieldControl :field="field" />
        </div>
      </div>
    </div>
  </div>
</template>
