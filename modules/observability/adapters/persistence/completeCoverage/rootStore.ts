import type { CompleteWorkingRows, CompleteWorkingRow } from '../../../ports/completeWorkingRows'
import {
  packedCoverageTree, packedRootDocument, packedLogicalRoot, packedRootSlot, originalCoverageRoot,
  type CoverageRoot, type PackedCoverageTree, type PackedCoverageRoots,
} from './rootDocuments'

/** Physical roots stay in the same original snapshot's private TEMP workspace. */
export class CoverageRootStore {
  private legacyEmpty: boolean | undefined
  private packedEmpty: boolean | undefined
  private writes: Promise<void> = Promise.resolve()
  private readonly trees = new Map<string, PackedCoverageTree | undefined>()
  private readonly legacySpace: string
  private readonly packedSpace: string

  constructor(private readonly rows: CompleteWorkingRows, namespace: string, private readonly keyOf: (value: string) => string) {
    this.legacySpace = `${namespace}/roots`
    this.packedSpace = `${namespace}/packed-roots`
  }

  private packed(tree: string) {
    if (this.trees.has(tree)) return this.trees.get(tree)
    const result = packedCoverageTree(tree)
    this.trees.set(tree, result)
    if (this.trees.size > 4096) this.trees.delete(this.trees.keys().next().value!)
    return result
  }

  empty(tree: string) {
    if (!this.packed(tree)) return this.legacyEmpty
    if (this.legacyEmpty === false || this.packedEmpty === false) return false
    return this.legacyEmpty === true && this.packedEmpty === true ? true : undefined
  }

  async probe(tree: string) {
    if (this.legacyEmpty === undefined) {
      const first = await this.rows.page(this.legacySpace, null, 1)
      if (this.legacyEmpty === undefined) this.legacyEmpty = first.items.length === 0 && first.nextCursor === null
    }
    if (this.packed(tree) && this.packedEmpty === undefined) {
      const first = await this.rows.page(this.packedSpace, null, 1)
      if (this.packedEmpty === undefined) this.packedEmpty = first.items.length === 0 && first.nextCursor === null
    }
  }

  /** Invalidate the applicable empty proof before any awaited write or read. */
  written(tree: string) {
    if (this.packed(tree)) this.packedEmpty = false
    else this.legacyEmpty = false
  }

  async get(tree: string) {
    if (!this.packed(tree)) return this.rows.get<CoverageRoot>(this.legacySpace, this.keyOf(tree))
    return (await this.readMany([tree], false))[0]?.document
  }

  private addresses(trees: readonly string[]) {
    const logical = new Map<string, string>(), packed = new Map<string, PackedCoverageTree>()
    for (const tree of trees) {
      const key = this.keyOf(tree), previous = logical.get(key), parsed = this.packed(tree)
      if (previous !== undefined && previous !== tree) throw new Error('Coverage root key identity conflict')
      logical.set(key, tree)
      if (!parsed) continue
      const physical = this.keyOf(parsed.address), retained = packed.get(physical)
      if (retained && retained.address !== parsed.address) throw new Error('Coverage packed root key identity conflict')
      packed.set(physical, parsed)
    }
    return { logical, packed }
  }

  private async legacyRows(logical: ReadonlyMap<string, string>, preserveOriginalBatch = false) {
    if (!logical.size || this.legacyEmpty === true && !preserveOriginalBatch) return new Map<string, CoverageRoot>()
    const found = await this.rows.getMany<CoverageRoot>(this.legacySpace, [...logical.keys()])
    const result = new Map<string, CoverageRoot>()
    for (const row of found) {
      const tree = logical.get(row.key)
      if (tree === undefined || result.has(row.key)) throw new Error('Coverage root key identity conflict')
      result.set(row.key, preserveOriginalBatch ? row.document : originalCoverageRoot(row.document, tree)!)
    }
    return result
  }

  private async packedRows(addresses: ReadonlyMap<string, PackedCoverageTree>) {
    const result = new Map<string, PackedCoverageRoots>()
    if (this.packedEmpty === true || !addresses.size) return result
    const found = await this.rows.getMany<unknown>(this.packedSpace, [...addresses.keys()])
    for (const row of found) {
      const requested = addresses.get(row.key)
      if (!requested || result.has(row.key)) throw new Error('Coverage packed root key identity conflict')
      result.set(row.key, packedRootDocument(row.document, requested))
    }
    return result
  }

  private async readMany(trees: readonly string[], preserveOriginalBatch: boolean): Promise<readonly CompleteWorkingRow<CoverageRoot>[]> {
    const { logical, packed } = this.addresses(trees), legacy = await this.legacyRows(logical, preserveOriginalBatch), documents = await this.packedRows(packed)
    const result: CompleteWorkingRow<CoverageRoot>[] = []
    for (const [key, tree] of logical) {
      const parsed = this.packed(tree), document = parsed && documents.get(this.keyOf(parsed.address))
      const packedRoot = parsed && document ? packedLogicalRoot(document, parsed) : undefined, legacyRoot = legacy.get(key)
      if (packedRoot && legacyRoot) throw new Error('Coverage root has duplicate physical identities')
      const root = legacyRoot ?? packedRoot
      if (root) result.push({ key, document: root })
    }
    return result
  }

  /** Retain the original bulk legacy-root read contract alongside the packed source. */
  getMany(trees: readonly string[]): Promise<readonly CompleteWorkingRow<CoverageRoot>[]> {
    return this.readMany(trees, true)
  }

  private async writeBatch(batch: readonly CompleteWorkingRow<CoverageRoot>[]) {
    const { logical, packed } = this.addresses(batch.map(row => row.document.tree))
    const legacy = await this.legacyRows(logical), documents = await this.packedRows(packed)
    const legacyWrites: CompleteWorkingRow<CoverageRoot>[] = [], packedWrites = new Map<string, PackedCoverageRoots>()
    for (const row of batch) {
      if (row.key !== this.keyOf(row.document.tree)) throw new Error('Coverage root key identity conflict')
      const parsed = this.packed(row.document.tree)
      if (!parsed) { legacyWrites.push(row); continue }
      const key = this.keyOf(parsed.address), prior = packedWrites.get(key) ?? documents.get(key)
      if (legacy.has(row.key)) {
        if (prior?.slots[parsed.bucket]) throw new Error('Coverage root has duplicate physical identities')
        legacyWrites.push(row)
        continue
      }
      packedWrites.set(key, { format: 1, common: parsed.common, slots: { ...prior?.slots, [parsed.bucket]: packedRootSlot(row.document) } })
    }
    if (legacyWrites.length) {
      this.legacyEmpty = false
      await this.rows.upsert(this.legacySpace, legacyWrites)
    }
    if (packedWrites.size) {
      this.packedEmpty = false
      await this.rows.upsert(this.packedSpace, [...packedWrites].map(([key, document]) => ({ key, document })))
    }
  }

  upsert(batch: readonly CompleteWorkingRow<CoverageRoot>[]) {
    const next = this.writes.then(() => this.writeBatch(batch))
    this.writes = next.then(() => undefined, () => undefined)
    return next
  }
}
