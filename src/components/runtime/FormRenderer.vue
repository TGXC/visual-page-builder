<script setup lang="ts">
import { computed } from 'vue'
import FieldControl from '@/components/shared/FieldControl.vue'
import { childrenOf } from '@/core/tree'
import type { FormSchema } from '@/core/types'

/**
 * 运行态渲染器：与 Canvas 吃同一份 schema，区别是这里会绑值、校验、提交。
 * M2 只做到「渲染一致」，值绑定与错误展示在 M5。
 */
const props = defineProps<{ schema: FormSchema }>()

const emit = defineEmits<{ (e: 'submit'): void }>()

const fields = computed(() => childrenOf(props.schema.fields, null))
</script>

<template>
  <form class="fb-form" novalidate @submit.prevent="emit('submit')">
    <h1 class="fb-form__title">{{ schema.name }}</h1>
    <p v-if="schema.description" class="fb-form__desc">{{ schema.description }}</p>

    <div v-if="fields.length === 0" class="fb-empty">这张表单还没有字段</div>
    <template v-else>
      <div v-for="field in fields" :key="field.id" class="fb-field">
        <label class="fb-field__label" :for="field.id">{{ field.label }}</label>
        <FieldControl :field="field" />
      </div>
    </template>

    <div class="fb-form__actions">
      <button class="fb-button fb-button--primary" type="submit">{{ schema.settings.submitText }}</button>
    </div>
  </form>
</template>
