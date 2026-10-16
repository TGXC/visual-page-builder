import { normalizeFieldOrder, orderSiblings, siblingIds } from './tree'
import type { FormSchema, Patch } from './types'

/**
 * 结构复制：只复制会被改到的层级（fields 数组、每个字段对象、props、rules），
 * 不复制没变的内容，避免每步都深拷贝整个 schema。
 */
function clone(schema: FormSchema): FormSchema {
  return { ...schema, fields: schema.fields.map(f => ({ ...f, props: { ...f.props }, rules: [...f.rules] })) }
}

/**
 * 应用一个补丁。补丁只描述「变了什么」，因此每一步都是 O(n) 的数组扫描，
 * 但内存占用与撤销栈长度无关。
 */
export function applyPatch(schema: FormSchema, patch: Patch): FormSchema {
  const next = clone(schema)
  switch (patch.op) {
    case 'insert': {
      const f = patch.field
      // 目标下标及之后的同级 order 全部 +1，再放入新字段
      next.fields = [
        ...next.fields.map(x => (x.parentId === f.parentId && x.order >= f.order ? { ...x, order: x.order + 1 } : x)),
        { ...f },
      ]
      break
    }
    case 'remove': {
      const r = patch.field
      next.fields = next.fields
        .filter(x => x.id !== r.id)
        .map(x => (x.parentId === r.parentId && x.order > r.order ? { ...x, order: x.order - 1 } : x))
      break
    }
    case 'update':
      // 注意：after 里的 props / rules 是整体替换，不是合并
      next.fields = next.fields.map(f => (f.id === patch.id ? { ...f, ...patch.after } : f))
      break
    case 'move': {
      const { before, after } = patch
      let fields = next.fields.map(f =>
        f.id === patch.id ? { ...f, parentId: after.parentId, order: after.order } : f)

      // 目标父级：列出同级，把移动者挪到 after.order 下标，再整体重排
      const targetIds = siblingIds(fields, after.parentId)
      targetIds.splice(targetIds.indexOf(patch.id), 1)
      targetIds.splice(Math.max(0, Math.min(after.order, targetIds.length)), 0, patch.id)
      fields = orderSiblings(fields, after.parentId, targetIds)

      // 跨容器时旧父级会留空档，压缩一次
      if (before.parentId !== after.parentId) {
        fields = orderSiblings(fields, before.parentId, siblingIds(fields, before.parentId))
      }
      next.fields = fields
      break
    }
  }

  // 数组顺序归一化：同一逻辑状态永远序列化成同一份 JSON，撤销后的比对才成立
  next.fields = normalizeFieldOrder(next.fields)
  return next
}

/**
 * 逆补丁。往返测试兜住正确性：任意补丁 apply 后再 invert apply，必须回到初始快照。
 */
export function invertPatch(patch: Patch): Patch {
  switch (patch.op) {
    case 'insert': return { op: 'remove', field: patch.field }
    case 'remove': return { op: 'insert', field: patch.field }
    case 'update': return { op: 'update', id: patch.id, before: patch.after, after: patch.before }
    case 'move':   return { op: 'move', id: patch.id, before: patch.after, after: patch.before }
  }
}
