import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * 导出冒烟专用配置：只跑 tests/smoke，把真实产物写到 .sandbox/out/ 供外部工具校验。
 * 用法：npm run test:smoke
 *
 * 和 vite.config.ts 分开是刻意的：主配置的 exclude 里有 tests/smoke/**（普通 `npm run test`
 * 不写文件），而 Vitest 的 mergeConfig 会拼接 include 数组，合并反而会把冒烟用例排除掉。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    /* forks 在 Windows 受限沙箱里会 `spawn EPERM`（命名管道被拒），必须用 threads；
       Vitest 5 起 poolOptions 被移除，串行直接写 maxWorkers: 1 */
    pool: 'threads',
    maxWorkers: 1,
    include: ['tests/smoke/**/*.spec.ts'],
    testTimeout: 30_000,
  },
})
