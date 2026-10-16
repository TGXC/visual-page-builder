<script setup lang="ts">
import { computed } from 'vue'
import RuntimeFieldList from '@/components/runtime/RuntimeFieldList.vue'
import { visibleTree } from '@/core/validation'
import type { ErrorMap, FormSchema, FormValues } from '@/core/types'

/**
 * 运行态渲染器：与 Canvas 吃同一份 schema，区别是这里会绑值、校验、提交。
 * 它是哑组件——值由外面传进来（runtime store），提交也只是通知外面，自己不碰 store。
 * 可见性交给 visibleTree：分组隐藏时整棵子树都不渲染，子字段跟着分组走。
 */
const props = defineProps<{ schema: FormSchema; values?: FormValues; errors?: ErrorMap }>()

const emit = defineEmits<{
  (e: 'submit'): void
  (e: 'update:value', name: string, value: unknown): void
}>()

const formValues = computed<FormValues>(() => props.values ?? {})
const errorMap = computed<ErrorMap>(() => props.errors ?? {})

/** 只显示可见字段：条件不满足的、以及隐藏分组里的字段都不渲染 */
const nodes = computed(() => visibleTree(props.schema, formValues.value))
</script>

<template>
  <form class="fb-form" novalidate @submit.prevent="emit('submit')">
    <h1 class="fb-form__title">{{ schema.name }}</h1>
    <p v-if="schema.description" class="fb-form__desc">{{ schema.description }}</p>

    <div v-if="nodes.length === 0" class="fb-empty">这张表单还没有字段</div>
    <RuntimeFieldList
      v-else
      :nodes="nodes"
      :values="formValues"
      :errors="errorMap"
      @update:value="(name, value) => emit('update:value', name, value)"
    />

    <div class="fb-form__actions">
      <button class="fb-button fb-button--primary" type="submit">{{ schema.settings.submitText }}</button>
    </div>
  </form>
</template>

