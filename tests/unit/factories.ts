import { normalizeFieldOrder } from '@/core/tree'
import type { FieldNode, FieldType, FormSchema } from '@/core/types'

let seq = 0

/** 构造一个字段，未提供的字段用默认值补齐；id 可预期，便于断言失败时阅读 */
export function makeField(input: Partial<FieldNode> & { type: FieldType }): FieldNode {
  seq += 1
  return {
    id: input.id ?? `f${seq}`,
    parentId: input.parentId ?? null,
    order: input.order ?? 0,
    type: input.type,
    name: input.name ?? `field_${seq}`,
    label: input.label ?? `字段${seq}`,
    props: input.props ?? {},
    rules: input.rules ?? [],
    visibleWhen: input.visibleWhen ?? null,
  }
}

/**
 * fields 会先规范化（和 applyPatch 的产物一致）：数组摆放顺序不是语义，
 * 夹具规范化之后，`snap` 的逐字节比较才不会被摆放顺序干扰。
 */
export function makeSchema(fields: FieldNode[] = []): FormSchema {
  return {
    version: 1,
    id: 'schema_test',
    name: '测试表单',
    description: '',
    fields: normalizeFieldOrder(fields),
    settings: { labelPosition: 'top', submitText: '提交' },
  }
}

/** 同级字段按 order 升序的 id 列表 */
export function siblingIdsOf(schema: FormSchema, parentId: string | null): string[] {
  return schema.fields
    .filter(f => f.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map(f => f.id)
}

/** 同级字段按 order 升序的 order 列表 */
export function ordersOf(schema: FormSchema, parentId: string | null): number[] {
  return schema.fields
    .filter(f => f.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map(f => f.order)
}

export function countIn(schema: FormSchema, parentId: string | null): number {
  return schema.fields.filter(f => f.parentId === parentId).length
}

/** 序列化快照，用于「往返后完全一致」的断言 */
export const snap = (schema: FormSchema): string => JSON.stringify(schema)
