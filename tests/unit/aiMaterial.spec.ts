/**
 * M7 素材候选（src/ai/material.ts）：Mock 用 core/png 现场编码占位图，
 * 结果写进节点 props.src 且带来源标记（功能文档 AI4 素材 + AI6 安全）。
 */
import { describe, expect, it } from 'vitest'
import { isUsableMaterial, materialCandidates, materialPatch } from '@/ai/material'
import { safeUrl } from '@/core/html'
import { docWithNodes, makeNode } from './factories'

function pngSize(dataUrl: string): { width: number; height: number } {
  const raw = dataUrl.slice('data:image/png;base64,'.length)
  const binary = atob(raw)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('M7 素材候选（src/ai/material.ts）', () => {
  it('同一个提示词给出 3 张可用占位图，尺寸与来源标记齐备', () => {
    const list = materialCandidates('夏日读书会宣传图')
    expect(list).toHaveLength(3)
    expect(list.every((item) => item.source === 'generated')).toBe(true)
    expect(list.every((item) => item.label !== '')).toBe(true)
    expect(list.map((item) => item.dataUrl)).toEqual(materialCandidates('夏日读书会宣传图').map((item) => item.dataUrl))
    for (const item of list) {
      expect(item.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
      expect(safeUrl(item.dataUrl)).not.toBe('')
      expect(pngSize(item.dataUrl)).toEqual({ width: item.width, height: item.height })
    }
    expect(new Set(list.map((item) => item.dataUrl)).size).toBe(3)
  })

  it('不同提示词给出不同配色（哈希决定），空提示词也能出图', () => {
    const a = materialCandidates('夏日')
    const b = materialCandidates('冬日')
    expect(a[0].dataUrl).not.toBe(b[0].dataUrl)
    expect(materialCandidates('')).toHaveLength(3)
  })

  it('isUsableMaterial 拦掉非图片与脚本类 dataURL', () => {
    const [item] = materialCandidates('读书会')
    expect(isUsableMaterial(item.dataUrl)).toBe(true)
    expect(isUsableMaterial('data:image/svg+xml;base64,PHN2Zy8+')).toBe(false)
    expect(isUsableMaterial('javascript:alert(1)')).toBe(false)
    expect(isUsableMaterial('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isUsableMaterial('')).toBe(false)
  })

  it('materialPatch 写 props.src 与来源标记，并补 alt；非法素材返回 null', () => {
    const node = makeNode({ id: 'img1', type: 'image', parentId: 'root', props: { text: '占位' } })
    const page = docWithNodes([node]).pages[0]
    const [item] = materialCandidates('读书会')
    const patch = materialPatch(page, 'img1', item, '夏日读书会')
    expect(patch?.op).toBe('update')
    if (patch?.op !== 'update') return
    expect(patch.after.props).toEqual({ text: '占位', src: item.dataUrl, source: 'generated', alt: '夏日读书会' })
    expect(patch.before.props).toEqual({ text: '占位' })
    expect(materialPatch(page, 'img1', { ...item, dataUrl: 'javascript:alert(1)' })).toBeNull()
    expect(materialPatch(page, 'nope', item)).toBeNull()
  })
})
