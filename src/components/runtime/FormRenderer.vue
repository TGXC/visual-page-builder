<script setup lang="ts">
import { computed } from 'vue'
import FieldRuntime from '@/components/runtime/FieldRuntime.vue'
import { visibleFields } from '@/core/validation'
import type { ErrorMap, FormSchema, FormValues } from '@/core/types'

/**
 * 运行态渲染器：与 Canvas 吃同一份 schema，区别是这里会绑值、校验、提交。
 * 它是哑组件——值由外面传进来（runtime store），提交也只是通知外面，自己不碰 store。
 */
const props = defineProps<{ schema: FormSchema; values?: FormValues; errors?: ErrorMap }>()

const emit = defineEmits<{
  (e: 'submit'): void
  (e: 'update:value', name: string, value: unknown): void
}>()

const formValues = computed<FormValues>(() => props.values ?? {})

/** 只显示可见字段：条件不满足的、以及隐藏分组里的字段都不渲染 */
const fields = computed(() => visibleFields(props.schema, formValues.value))
</script>

<template>
  <form class="fb-form" novalidate @submit.prevent="emit('submit')">
    <h1 class="fb-form__title">{{ schema.name }}</h1>
    <p v-if="schema.description" class="fb-form__desc">{{ schema.description }}</p>

    <div v-if="fields.length === 0" class="fb-empty">这张表单还没有字段</div>
    <template v-else>
      <FieldRuntime
        v-for="field in fields"
        :key="field.id"
        :field="field"
        :value="formValues[field.name]"
        :errors="errors?.[field.name]"
        @update:value="emit('update:value', field.name, $event)"
      />
    </template>

    <div class="fb-form__actions">
      <button class="fb-button fb-button--primary" type="submit">{{ schema.settings.submitText }}</button>
    </div>
  </form>
</template>
