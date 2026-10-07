import { TOKEN_BUCKETS, type TokenBucket } from '../../../domain/tokenUsage'

export interface CoverageRoot {
  readonly tree: string
  readonly id: string | null
  readonly point?: readonly [number, number]
}
type Common = readonly [string, string, boolean, string]
export interface PackedCoverageTree {
  readonly tree: string
  readonly bucket: TokenBucket
  readonly common: Common
  readonly address: string
}
export type CoverageRootSlot = Omit<CoverageRoot, 'tree'>
export interface PackedCoverageRoots {
  readonly format: 1
  readonly common: Common
  readonly slots: Readonly<Partial<Record<TokenBucket, CoverageRootSlot>>>
}

/** Only the original five-field, byte-canonical key is eligible for physical packing. */
export function packedCoverageTree(tree: string): PackedCoverageTree | undefined {
  let fields: unknown
  try { fields = JSON.parse(tree) } catch { return undefined }
  if (!Array.isArray(fields) || fields.length !== 5 || JSON.stringify(fields) !== tree) return undefined
  const [group, bucket, session, treeOnly, model] = fields as unknown[]
  if (typeof group !== 'string' || typeof session !== 'string' || typeof model !== 'string' ||
      typeof treeOnly !== 'boolean' || !TOKEN_BUCKETS.includes(bucket as TokenBucket)) return undefined
  const common: Common = [group, session, treeOnly, model]
  return { tree, bucket: bucket as TokenBucket, common, address: JSON.stringify(['coverage-packed-root/1', ...common]) }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function originalSlot(value: unknown): CoverageRootSlot {
  if (!object(value) || Object.keys(value).some(key => key !== 'id' && key !== 'point') ||
      value.id !== null && typeof value.id !== 'string') throw new Error('Coverage packed root slot invalid')
  if (value.point !== undefined && (!Array.isArray(value.point) || value.point.length !== 2 ||
      !value.point.every(Number.isSafeInteger) || value.id === null)) throw new Error('Coverage point interval invalid')
  return value as unknown as CoverageRootSlot
}

export function packedRootDocument(value: unknown, requested: PackedCoverageTree): PackedCoverageRoots {
  if (!object(value) || Object.keys(value).length !== 3 || value.format !== 1 ||
      !Array.isArray(value.common) || value.common.length !== 4 ||
      JSON.stringify(value.common) !== JSON.stringify(requested.common) || !object(value.slots) ||
      Object.keys(value.slots).some(key => !TOKEN_BUCKETS.includes(key as TokenBucket))) {
    throw new Error('Coverage packed root key identity conflict')
  }
  for (const slot of Object.values(value.slots)) originalSlot(slot)
  return value as unknown as PackedCoverageRoots
}

export function originalCoverageRoot(value: CoverageRoot | undefined, tree: string): CoverageRoot | undefined {
  if (value && value.tree !== tree) throw new Error('Coverage root key identity conflict')
  return value
}

export function packedLogicalRoot(document: PackedCoverageRoots, requested: PackedCoverageTree): CoverageRoot | undefined {
  const slot = document.slots[requested.bucket]
  return slot ? { tree: requested.tree, ...slot } : undefined
}

export function packedRootSlot(root: CoverageRoot): CoverageRootSlot {
  return originalSlot({ id: root.id, ...(root.point ? { point: root.point } : {}) })
}
