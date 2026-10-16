<script setup lang="ts">
const props = defineProps<{ labels: string[]; index: number }>()
const emit = defineEmits<{ jump: [index: number] }>()
</script>

<template>
  <section class="fb-history">
    <h3 class="fb-history__title">历史记录</h3>
    <ol class="fb-history__list">
      <li
        v-for="(label, position) in props.labels"
        :key="position"
        class="fb-history__item"
        :class="{ 'fb-history__item--current': position === props.index }"
        @click="emit('jump', position)"
      >
        {{ label }}
      </li>
    </ol>
  </section>
</template>
