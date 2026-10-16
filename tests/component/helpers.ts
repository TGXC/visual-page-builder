import { vi } from 'vitest'

export const VIEWPORT = { w: 1440, h: 900 }

export function domRect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * 假布局：画布页面固定在 (0,0)，元素矩形直接读它自己的内联样式
 * （ElementView 用 inlineStyle 把 left/top/width/height 写进 style），
 * 于是 client 坐标 === 画布坐标，测试里可以按数值直接算。
 */
export function installLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement
    if (el.classList?.contains('canvas-page')) return domRect(0, 0, VIEWPORT.w, VIEWPORT.h)
    const left = Number.parseFloat(el.style?.left || '') || 0
    const top = Number.parseFloat(el.style?.top || '') || 0
    const width = Number.parseFloat(el.style?.width || '') || 0
    const height = Number.parseFloat(el.style?.height || '') || 0
    return domRect(left, top, width, height)
  })
}

function pointerEvent(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, clientX: x, clientY: y, button: 0, buttons: 1, shiftKey: false, ctrlKey: false, metaKey: false })
  return event
}

export function down(target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(pointerEvent('pointerdown', x, y))
}

export function move(x: number, y: number): void {
  window.dispatchEvent(pointerEvent('pointermove', x, y))
}

/** 把 pointermove 派发到指定元素（画布自己的 @pointermove 监听） */
export function moveOn(target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(pointerEvent('pointermove', x, y))
}

export function up(x: number, y: number): void {
  window.dispatchEvent(pointerEvent('pointerup', x, y))
}

export function drag(target: EventTarget, from: [number, number], to: [number, number]): void {
  down(target, from[0], from[1])
  move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2)
  move(to[0], to[1])
  up(to[0], to[1])
}

export function keydown(key: string, options: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
}

export function dropOn(target: EventTarget, type: string, x: number, y: number): void {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
  Object.assign(event, {
    clientX: x,
    clientY: y,
    dataTransfer: { getData: () => type, setData: () => undefined, effectAllowed: 'copy' },
  })
  target.dispatchEvent(event)
}
