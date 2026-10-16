<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="fb-app">
    <header class="fb-app__bar">
      <span class="fb-app__brand">可视化表单搭建器</span>
      <nav class="fb-app__nav">
        <RouterLink to="/">编辑</RouterLink>
        <RouterLink to="/preview">预览</RouterLink>
      </nav>
    </header>
    <RouterView />
  </div>
</template>
