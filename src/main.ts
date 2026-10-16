import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
// 副作用导入：注册内置字段（组件面板、属性面板、渲染器都依赖注册表）
import '@/fields'
import './styles/tokens.css'
import './styles/base.css'

createApp(App).use(createPinia()).use(router).mount('#app')
