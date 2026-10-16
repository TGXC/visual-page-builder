import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * 性能验收专用配置：只跑 tests/perf，且单线程串行，避免其他用例抢 CPU 让 8ms 判据失真。
 * 用法：npm run test:perf
 *
 * 刻意不用 mergeConfig 合并 vite.config.ts：Vitest 合并时会把 include 数组拼接起来，
 * 结果性能用例反而被主配置的 exclude 排除掉（曾踩过：跑了 257 个普通用例，性能用例没跑）。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    include: ['tests/perf/**/*.spec.ts'],
    testTimeout: 30_000,
  },
})
