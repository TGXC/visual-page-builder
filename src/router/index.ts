import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import EditorView from '@/views/EditorView.vue'
import PreviewView from '@/views/PreviewView.vue'
import ShareView from '@/views/ShareView.vue'

/** 导出 routes 便于测试用 memory history 直接建路由。 */
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'editor', component: EditorView, meta: { title: '编辑' } },
  { path: '/preview', name: 'preview', component: PreviewView, meta: { title: '预览' } },
  // 分享链接把整份 schema 压缩进 query，所以 /share 不需要路径参数
  { path: '/share', name: 'share', component: ShareView, meta: { title: '分享的表单' } },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
