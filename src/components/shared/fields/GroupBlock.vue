<script setup lang="ts">
/**
 * 分组容器：只负责「框 + 描述」，自己的标签由宿主（编辑器的 FieldWrapper 头的
 * `.fb-field__label` / 运行态的 RuntimeFieldList）渲染，避免标签出现两次。
 * 子字段通过默认插槽进来——所以它同时服务编辑态和运行态。
 */
withDefaults(
  defineProps<{
    description?: string
    bordered?: boolean
  }>(),
  { description: '', bordered: true },
)
</script>

<template>
  <div class="fb-group" :class="{ 'fb-group--bordered': bordered }">
    <p v-if="description" class="fb-group__desc">{{ description }}</p>
    <div class="fb-group__body">
      <slot />
    </div>
  </div>
</template>
