import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import EditorView from '@/views/EditorView.vue'
import PreviewView from '@/views/PreviewView.vue'

/** 导出 routes 便于测试用 memory history 直接建路由。 */
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'editor', component: EditorView, meta: { title: '编辑' } },
  { path: '/preview', name: 'preview', component: PreviewView, meta: { title: '预览' } },
  // /share/:payload 在 M6 加
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
