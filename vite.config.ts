import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
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
    // forks 走 child_process.fork（Windows 上是命名管道）；threads 更省内存也更快
    pool: 'threads',
    include: ['tests/**/*.spec.ts'],
    // 性能用例（npm run test:perf）与导出冒烟（npm run test:smoke）单独跑：
    // 前者怕并行负载把计时打歪，后者会往 .sandbox/out/ 写真实产物
    exclude: ['tests/perf/**', 'tests/smoke/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      // 纯类型文件没有可执行代码，不计入覆盖率
      exclude: ['**/types.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
})
