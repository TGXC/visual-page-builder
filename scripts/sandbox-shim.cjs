'use strict'
/**
 * 可选启动垫片：本机 DSH 沙箱里 `.sandbox/child-process-pipe-shim.cjs` 存在时才加载它，
 * 其它环境（CI、普通开发机）什么都不做 —— 这样 `npm run test:perf` / `test:smoke`
 * 的脚本在两个环境里都能跑，不需要各自改命令。
 *
 * 背景：本机沙箱禁止带管道的 child_process.spawn，Vite 在 Windows 上探测网络驱动器时
 * 会因此抛 EPERM，连 vitest 配置都加载不了；`.sandbox` 目录已 gitignore，所以这里做存在性判断。
 */
const fs = require('node:fs')
const path = require('node:path')

const shim = path.join(__dirname, '..', '.sandbox', 'child-process-pipe-shim.cjs')
if (fs.existsSync(shim)) {
  require(shim)
}
