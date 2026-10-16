import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'

/**
 * 扁平配置：JS 推荐 + TS 推荐（不做类型感知，跑得快）+ Vue3 推荐。
 * 只管「有没有明显错误」，格式不在这里管。
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.sandbox/**', '.npm-cache/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      // 哑控件的 props 都是「传了才用」的可选值；而且 vue-tsc 对 unknown 类型 prop
      // 的默认值会当成工厂函数（M2 踩过 TS2322），所以统一不给默认值。
      'vue/require-default-prop': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // .vue 里的 <script setup lang="ts"> 要交给 TS 解析器
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    // 分层约束：core/ 只放纯逻辑，不 import Vue / 组件 / store / 注册表。
    // 这条规则就是「core 可以被单测、可以脱离框架跑」这句设计承诺的强制执行。
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'vue',
                'vue-router',
                'pinia',
                '@vue/*',
                '@/components/*',
                '@/stores/*',
                '@/composables/*',
                '@/fields',
                '@/fields/*',
              ],
              message: 'core/ 只放纯逻辑：不要 import Vue、组件、store 或字段注册表',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
