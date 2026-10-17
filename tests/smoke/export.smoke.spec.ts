import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportFileName, generateCss, generateHtml } from '@/core/codegen'
import { buildSite } from '@/core/site'
import { createZip } from '@/core/zip'
import { createFromTemplate } from '@/core/templates'
import { computeLayout } from '@/core/layout'

/**
 * M5 导出冒烟（人工验证的自动化替代，`npm run test:smoke`）。
 *
 * PLAN 的 M5 验收要求「手动打开导出站点」；本机 headless 浏览器被沙箱命名管道挡住
 * （见 README 已知缺口），所以这里把真实产物写到 `.sandbox/out/`，再用外部工具
 * （PowerShell `Expand-Archive`）反解 zip 校验 CRC 与文件清单，人工只需双击 HTML 看效果。
 */
const outDir = resolve(process.cwd(), '.sandbox/out')

describe('M5 导出冒烟：产物落盘', () => {
  it('把模板导成单文件 HTML / 完整 CSS / 整站 zip，并给出可核对的事实', () => {
    const doc = createFromTemplate('landing')
    expect(doc).not.toBeNull()
    if (!doc) return
    const page = doc.pages[0]

    const html = generateHtml(doc, page.id)
    const css = generateCss(doc, page.id)
    const files = buildSite(doc)
    const zip = createZip(files)

    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(resolve(outDir, 'site'), { recursive: true })
    writeFileSync(resolve(outDir, 'studio.html'), html, 'utf8')
    writeFileSync(resolve(outDir, 'studio.css'), css, 'utf8')
    for (const file of files) writeFileSync(resolve(outDir, 'site', file.path), file.content, 'utf8')
    writeFileSync(resolve(outDir, 'site.zip'), zip)

    // 单文件 HTML：自带 <style>，且没有任何元素级内联样式
    expect(html).toContain('<style>')
    expect(html).toContain('.page-')
    expect(html).not.toContain('style="')
    // 样式表含节点类规则与断点媒体查询，且不靠 !important 覆盖
    expect(css).toMatch(/\.n-\S+ \{/)
    expect(css).toContain('@media (max-width: 1199.98px)')
    expect(css).not.toContain('!important')
    // 整站清单：index.html + base.css + 每页 html/css
    expect(files.map((file) => file.path)).toEqual(['index.html', 'base.css', 'page_1.html', 'page_1.css'])
    expect(zip.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))

    const boxes = computeLayout({ nodes: page.nodes, rootId: page.root, viewport: page.viewport }).boxes
    console.log(
      JSON.stringify(
        {
          file: exportFileName(doc, 'zip'),
          htmlBytes: Buffer.byteLength(html, 'utf8'),
          cssBytes: Buffer.byteLength(css, 'utf8'),
          elements: (html.match(/class="/g) ?? []).length,
          inlineStyles: (html.match(/style="/g) ?? []).length,
          mediaQueries: (css.match(/@media/g) ?? []).length,
          layoutBoxes: Object.keys(boxes).length,
          zipBytes: zip.length,
        },
        null,
        2,
      ),
    )
  })
})
