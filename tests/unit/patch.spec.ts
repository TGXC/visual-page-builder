import { describe, expect, it } from 'vitest'
import { applyPatch, invertPatch } from '@/core/patch'
import { isDescendantOf } from '@/core/tree'
import type { FormSchema, Patch } from '@/core/types'
import { countIn, makeField, makeSchema, ordersOf, siblingIdsOf, snap } from './factories'

/** 每个父级下的 order 必须是 0..n-1 的连续整数 */
function expectContiguousOrders(schema: FormSchema): void {
  const byParent = new Map<string | null, number[]>()
  for (const f of schema.fields) {
    const list = byParent.get(f.parentId) ?? []
    list.push(f.order)
    byParent.set(f.parentId, list)
  }
  for (const [parentId, orders] of byParent) {
    const sorted = [...orders].sort((a, b) => a - b)
    expect(sorted, `父级 ${String(parentId)} 的 order 不连续`).toEqual(orders.map((_, i) => i))
  }
}

describe('applyPatch · insert', () => {
  it('插入到中间位置时，其后同级 order 顺延，invert 后完全还原', () => {
    const a = makeField({ type: 'text', name: 'a', order: 0 })
    const b = makeField({ type: 'text', name: 'b', order: 1 })
    const base = makeSchema([a, b])
    const c = makeField({ type: 'text', name: 'c', order: 1 })
    const patch: Patch = { op: 'insert', field: c }

    const next = applyPatch(base, patch)

    expect(siblingIdsOf(next, null)).toEqual([a.id, c.id, b.id])
    expect(ordersOf(next, null)).toEqual([0, 1, 2])
    expect(snap(applyPatch(next, invertPatch(patch)))).toBe(snap(base))
  })

  it('插入到末尾时不改动已有 order', () => {
    const a = makeField({ type: 'text', order: 0 })
    const b = makeField({ type: 'text', order: 1 })
    const base = makeSchema([a, b])
    const c = makeField({ type: 'text', order: 2 })

    const next = applyPatch(base, { op: 'insert', field: c })

    expect(ordersOf(next, null)).toEqual([0, 1, 2])
    expect(siblingIdsOf(next, null)).toEqual([a.id, b.id, c.id])
  })
})

describe('applyPatch · remove', () => {
  it('删除中间字段后同级 order 连续，invert 后 order 与内容都恢复', () => {
    const a = makeField({ type: 'text', name: 'a', order: 0 })
    const b = makeField({ type: 'text', name: 'b', order: 1 })
    const c = makeField({ type: 'text', name: 'c', order: 2 })
    const base = makeSchema([a, b, c])
    const patch: Patch = { op: 'remove', field: b }

    const next = applyPatch(base, patch)

    expect(siblingIdsOf(next, null)).toEqual([a.id, c.id])
    expect(ordersOf(next, null)).toEqual([0, 1])
    expect(snap(applyPatch(next, invertPatch(patch)))).toBe(snap(base))
  })

  it('删除最后一个字段时不改动其它 order', () => {
    const a = makeField({ type: 'text', order: 0 })
    const b = makeField({ type: 'text', order: 1 })
    const base = makeSchema([a, b])

    const next = applyPatch(base, { op: 'remove', field: b })

    expect(ordersOf(next, null)).toEqual([0])
  })
})

describe('applyPatch · update', () => {
  it('只改目标字段，before/after 互换后往返一致', () => {
    const a = makeField({ type: 'text', label: '旧标签' })
    const b = makeField({ type: 'text', label: '不动' })
    const base = makeSchema([a, b])
    const patch: Patch = { op: 'update', id: a.id, before: { label: '旧标签' }, after: { label: '新标签' } }

    const next = applyPatch(base, patch)

    expect(next.fields[0].label).toBe('新标签')
    expect(next.fields[1].label).toBe('不动')
    expect(snap(applyPatch(next, invertPatch(patch)))).toBe(snap(base))
  })

  it('props / rules 是整体替换而不是合并', () => {
    const a = makeField({ type: 'text', props: { placeholder: '旧', maxlength: 10 } })
    const base = makeSchema([a])

    const next = applyPatch(base, {
      op: 'update',
      id: a.id,
      before: { props: { placeholder: '旧', maxlength: 10 } },
      after: { props: { placeholder: '新' } },
    })

    expect(next.fields[0].props).toEqual({ placeholder: '新' })
  })
})

describe('applyPatch · move', () => {
  it('同级重排：移动到末尾，invert 后顺序还原', () => {
    const a = makeField({ type: 'text', name: 'a', order: 0 })
    const b = makeField({ type: 'text', name: 'b', order: 1 })
    const c = makeField({ type: 'text', name: 'c', order: 2 })
    const base = makeSchema([a, b, c])
    const patch: Patch = {
      op: 'move',
      id: a.id,
      before: { parentId: null, order: 0 },
      after: { parentId: null, order: 2 },
    }

    const next = applyPatch(base, patch)

    expect(siblingIdsOf(next, null)).toEqual([b.id, c.id, a.id])
    expect(ordersOf(next, null)).toEqual([0, 1, 2])
    expect(snap(applyPatch(next, invertPatch(patch)))).toBe(snap(base))
  })

  it('跨容器：新父级与新父级都规范化 order，invert 后回到原 parentId 与原 order', () => {
    const group = makeField({ type: 'group', name: 'g', order: 0 })
    const rootText = makeField({ type: 'text', name: 'x', order: 1 })
    const inner1 = makeField({ type: 'text', name: 'p', parentId: group.id, order: 0 })
    const inner2 = makeField({ type: 'text', name: 'q', parentId: group.id, order: 1 })
    const base = makeSchema([group, rootText, inner1, inner2])
    const patch: Patch = {
      op: 'move',
      id: inner2.id,
      before: { parentId: group.id, order: 1 },
      after: { parentId: null, order: 1 },
    }

    const next = applyPatch(base, patch)

    expect(siblingIdsOf(next, null)).toEqual([group.id, inner2.id, rootText.id])
    expect(ordersOf(next, null)).toEqual([0, 1, 2])
    expect(siblingIdsOf(next, group.id)).toEqual([inner1.id])
    expect(ordersOf(next, group.id)).toEqual([0])

    const restored = applyPatch(next, invertPatch(patch))
    expect(snap(restored)).toBe(snap(base))
    expect(restored.fields.find(f => f.id === inner2.id)?.parentId).toBe(group.id)
  })

  it('把根级字段移进分组：目标容器 order 连续', () => {
    const group = makeField({ type: 'group', order: 0 })
    const a = makeField({ type: 'text', order: 1 })
    const b = makeField({ type: 'text', order: 2 })
    const base = makeSchema([group, a, b])

    const next = applyPatch(base, {
      op: 'move',
      id: b.id,
      before: { parentId: null, order: 2 },
      after: { parentId: group.id, order: 0 },
    })

    expect(siblingIdsOf(next, group.id)).toEqual([b.id])
    expect(ordersOf(next, group.id)).toEqual([0])
    expect(ordersOf(next, null)).toEqual([0, 1])
    expect(next.fields.find(f => f.id === b.id)?.parentId).toBe(group.id)
  })
})

describe('补丁往返性质', () => {
  /** 固定种子的伪随机，失败可复现 */
  function mulberry32(seed: number): () => number {
    let a = seed
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function randomPatch(schema: FormSchema, rand: () => number, n: number): Patch {
    const fields = schema.fields
    const kind = fields.length === 0 ? 0 : Math.floor(rand() * 4)

    if (kind === 0) {
      const groupIds = fields.filter(f => f.type === 'group').map(f => f.id)
      const parents: Array<string | null> = [null, ...groupIds]
      const parentId = parents[Math.floor(rand() * parents.length)]
      const order = Math.floor(rand() * (countIn(schema, parentId) + 1))
      return {
        op: 'insert',
        field: makeField({
          type: rand() < 0.25 ? 'group' : 'text',
          parentId,
          order,
          name: `rand_${n}`,
        }),
      }
    }

    const target = fields[Math.floor(rand() * fields.length)]

    if (kind === 1) return { op: 'remove', field: target }

    if (kind === 2) {
      if (rand() < 0.5) {
        return { op: 'update', id: target.id, before: { label: target.label }, after: { label: `label_${n}` } }
      }
      return {
        op: 'update',
        id: target.id,
        before: { props: { ...target.props } },
        after: { props: { ...target.props, [`k${n}`]: n } },
      }
    }

    const otherGroups = fields.filter(
      f => f.type === 'group' && f.id !== target.id && !isDescendantOf(fields, target.id, f.id),
    )
    const parents: Array<string | null> = [null, ...otherGroups.map(f => f.id)]
    const parentId = parents[Math.floor(rand() * parents.length)]
    const order = Math.floor(rand() * (countIn(schema, parentId) + 1))
    return {
      op: 'move',
      id: target.id,
      before: { parentId: target.parentId, order: target.order },
      after: { parentId, order },
    }
  }

  it('随机 100 个补丁逐个 apply 后按逆序 invert，最终逐字节回到初始快照', () => {
    const rand = mulberry32(20261016)
    let schema = makeSchema([
      makeField({ type: 'group', order: 0 }),
      makeField({ type: 'text', order: 1 }),
      makeField({ type: 'number', order: 2 }),
    ])
    const initial = snap(schema)
    const patches: Patch[] = []

    for (let i = 0; i < 100; i++) {
      const patch = randomPatch(schema, rand, i)
      schema = applyPatch(schema, patch)
      patches.push(patch)
      expectContiguousOrders(schema)
    }

    expect(patches.length).toBe(100)
    expect(schema.fields.length).toBeGreaterThan(0)

    let restored = schema
    for (let i = patches.length - 1; i >= 0; i--) {
      restored = applyPatch(restored, invertPatch(patches[i]))
    }

    expect(snap(restored)).toBe(initial)
  })

  it('400 个补丁连续往返后仍然一致（长链路）', () => {
    const rand = mulberry32(7)
    let schema = makeSchema([makeField({ type: 'group', order: 0 }), makeField({ type: 'text', order: 1 })])
    const initial = snap(schema)
    const patches: Patch[] = []

    for (let i = 0; i < 400; i++) {
      const patch = randomPatch(schema, rand, i)
      schema = applyPatch(schema, patch)
      patches.push(patch)
    }

    let restored = schema
    for (let i = patches.length - 1; i >= 0; i--) {
      restored = applyPatch(restored, invertPatch(patches[i]))
    }

    expect(snap(restored)).toBe(initial)
  })
})
