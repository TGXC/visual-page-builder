/**
 * HTML 转义与 URL 白名单。单独成文件是为了让 `codegen` 与 `core/components`
 * 共用同一份安全策略，又不产生循环依赖（components → html、codegen → html + components）。
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 只放行 http/https、相对路径、页内锚点与**光栅图 dataURL**。
 * 导出文件会被用户直接打开，`javascript:` 与 `data:text/html` 必须拦掉；
 * 光栅图 dataURL 是本地文件通道（B16）的产物，图片上下文里不能执行脚本，故放行。
 */
export function safeUrl(url: string): string {
  const value = url.trim()
  if (value === '') return ''
  const lowered = value.toLowerCase()
  if (lowered.startsWith('javascript:') || lowered.startsWith('vbscript:')) return ''
  if (lowered.startsWith('data:')) {
    // 只认 data:image/<光栅格式>;base64,，SVG 能内嵌脚本，不放行。
    return /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i.test(value) ? value : ''
  }
  if (/^(https?:)?\/\//.test(lowered) || lowered.startsWith('/') || lowered.startsWith('#') || lowered.startsWith('./')) {
    return value
  }
  // 形如 `a.png` 的相对路径也放行，但绝不放行任何带协议的其它写法
  return /^[a-z][a-z0-9+.-]*:/i.test(lowered) ? '' : value
}
