// RFC-034: differential oracle for exact native coverage, including a single huge root.
import { describe, expect, test } from 'bun:test'
import { selectCompleteUsage } from './completeUsageSelection'
import { compareCompleteUsage } from '../domain/completeUsageOrder'
import {
  coveragePrefixMaximum,
  insertCoverageInterval,
  type CoverageIntervalNode,
  type CoverageIntervalStore,
} from '../domain/coverageIntervalIndex'
import type { UsageContributionEvidence } from '../domain/completeUsageEvidence'
import { selectRuntimeUsage, TOKEN_BUCKETS, summarizeTokenUsage } from '../domain/tokenUsage'
import { ProjectIdSchema, SubtaskIdSchema, TaskIdSchema, type UsageRecord } from '@crewstation/contracts'
import { jsonHash } from '@crewstation/kernel'
import type { TokenUsage } from '../domain/tokenUsage'

function intervalStore() {
  const roots = new Map<string, string>()
  const nodes = new Map<string, CoverageIntervalNode>()
  let sequence = 0n,
    reads = 0
  const store: CoverageIntervalStore = {
    async root(tree) {
      return roots.get(tree) ?? null
    },
    async setRoot(tree, id) {
      roots.set(tree, id)
    },
    async node(tree, id) {
      reads++
      const node = nodes.get(JSON.stringify([tree, id]))
      if (!node) throw new Error('missing interval')
      return node
    },
    async save(tree, node) {
      nodes.set(JSON.stringify([tree, node.id]), { ...node })
    },
    async allocateId() {
      return String(++sequence)
    },
  }
  return { store, reads: () => reads, nodes }
}

function record(
  id: string,
  patch: Partial<UsageContributionEvidence> = {},
): UsageContributionEvidence {
  return {
    sourceId: 'native-original',
    measurement: {
      invocationId: 'invocation',
      recordId: id,
      model: { provider: null, id: 'model' },
      scope: {
        root: 'root',
        session: 'root',
        parentSession: null,
        ancestors: [],
        turn: id,
        turnIndex: 1,
        level: 'self-total',
      },
      coveredThroughTurn: 1,
    },
    contribution: { input: '10', cacheRead: '2', cacheWrite: '3', output: '4' },
    complete: true,
    ...patch,
  }
}

async function indexed(records: UsageContributionEvidence[], issue?: (record:UsageContributionEvidence,quality:{ambiguous:boolean;unavailable:boolean},allocated:boolean)=>Promise<void>) {
  const index = intervalStore(),
    paths = new Map<string, string>(),
    allocated: Array<{ record: UsageContributionEvidence; contribution: TokenUsage }> = []
  const output = await selectCompleteUsage({
    coverage: index.store,
    async *records() {
      yield* records
    },
    async *orderedRecords() {
      yield* [...records].sort(compareCompleteUsage)
    },
    async bindAncestry(group, session, ancestors) {
      const key = JSON.stringify([group, session]),
        path = JSON.stringify(ancestors)
      if (paths.has(key) && paths.get(key) !== path)
        throw new Error('Conflicting observation session ancestry')
      paths.set(key, path)
    },
    async allocate(record, contribution) {
      allocated.push({ record, contribution })
    },
  },undefined,issue)
  return { output, allocated, reads: index.reads() }
}

const allocations = (
  rows: Array<{ record: UsageContributionEvidence; contribution: TokenUsage }>,
) =>
  rows
    .map(
      ({ record: r, contribution }) =>
        [
          JSON.stringify([r.sourceId, r.measurement.invocationId, r.measurement.recordId]),
          contribution,
        ] as const,
    )
    .sort(([a], [b]) => a.localeCompare(b))

function originalRuntimeRecord(row: UsageContributionEvidence): UsageRecord {
  const digest = jsonHash(row.measurement.invocationId);
  const identity = { projectId: ProjectIdSchema.parse('00000000-0000-7000-8000-000000000001'), taskId: TaskIdSchema.parse('00000000-0000-7000-8000-000000000002'), subtaskId: SubtaskIdSchema.parse(`${digest.slice(0, 8)}-${digest.slice(8, 12)}-7${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`), executionId: '00000000-0000-7000-8000-000000000003', executionGeneration: 1 };
  return { kind: 'usage', sourceId: row.sourceId, identity, recordId: row.measurement.recordId, revision: 1,
    occurredAt: null, observedAt: '2026-10-03T00:00:00.000Z', adapterVersion: 'test', modelRef: row.measurement.model?.id ?? null,
    reporting: 'delta', inclusion: row.measurement.scope?.level === 'tree-total' ? 'includes-descendants' : 'self', coverage: 'complete', validity: 'valid',
    scope: row.measurement.scope ?? null, coveredThroughTurn: row.measurement.coveredThroughTurn ?? null, usage: row.contribution, basis: { kind: 'invocation' },
    projection: { projectionRevision: 1, observedRevision: 1, contribution: row.contribution, coveredThrough: row.coveredThrough ?? null, complete: row.complete, issues: [] } };
}
async function compareOracle(rows: UsageContributionEvidence[]) {
  // CS keeps modelRef opaque. Provider distinctions are not part of its original coverage contract.
  const compatible = rows.map((row) => ({ ...row, measurement: { ...row.measurement, model: row.measurement.model === null ? null : { ...row.measurement.model, provider: null } } }));
  const old = selectRuntimeUsage(compatible.map(originalRuntimeRecord)), next = await indexed(compatible);
  const allocated = old.selected.map(({ record: original, contribution }) => ({ record: compatible.find((row) => row.sourceId === original.sourceId && row.measurement.recordId === original.recordId)!, contribution }));
  expect(allocations(next.allocated)).toEqual(allocations(allocated));
  expect(next.output.excluded).toBe(String(rows.length - old.selected.length));
  expect(next.output.tokens).toEqual(summarizeTokenUsage(old.selected.map((row) => row.contribution)).known);
  expect(next.output.ambiguousOverlaps !== '0' || next.output.unavailableSummaries !== '0').toBe(old.incomplete);
  expect(TOKEN_BUCKETS.every((bucket) => next.output.unknownBuckets[bucket] === '0')).toBe(old.selected.every((row) => TOKEN_BUCKETS.every((bucket) => row.contribution[bucket] !== null)));
}

describe('persistent exact coverage selection', () => {
  // An all-bucket overlap previously disappeared before its original attempt could receive the gap.
  test('quality callbacks retain excluded ambiguous owners, await completion and leave normal covered records unchanged',async()=>{
    const a=record('a',{measurement:{...record('a').measurement,coveredThroughTurn:2}}),b=record('b',{measurement:{...record('b').measurement,coveredThroughTurn:3,scope:{...record('b').measurement.scope!,turnIndex:2}}}),covered=record('covered',{measurement:{...record('a').measurement,recordId:'covered',scope:{...record('a').measurement.scope!,level:'request'}}});
    const issues:Array<{id:string;allocated:boolean;quality:{ambiguous:boolean;unavailable:boolean}}>=[];
    const result=await indexed([covered,b,a],async(record,quality,allocated)=>{await Promise.resolve();issues.push({id:record.measurement.recordId,quality,allocated});});
    expect(issues).toEqual([{id:'b',allocated:false,quality:{ambiguous:true,unavailable:false}}]);expect(result.output.selected).toBe('1');expect(result.output.excluded).toBe('2');expect(result.output.ambiguousOverlaps).toBe('1');expect(result.allocated).toHaveLength(1);expect(result.allocated[0]!.record.measurement.recordId).toBe('a');
    const mixed=record('a',{coveredThrough:{input:4,cacheRead:1,cacheWrite:2,output:3}}),partial=record('b',{measurement:{...record('b').measurement,coveredThroughTurn:5,scope:{...record('b').measurement.scope!,turnIndex:2}}});
    issues.length=0;const allocated=await indexed([mixed,partial],async(record,quality,selected)=>{issues.push({id:record.measurement.recordId,quality,allocated:selected});});expect(issues).toEqual([{id:'b',allocated:true,quality:{ambiguous:true,unavailable:false}}]);expect(allocated.output.selected).toBe('2');expect(allocated.output.excluded).toBe('0');
  })

  test('keeps original selected-count rejection and covered-count exclusion semantics', async () => {
    for (const invalid of ['-1', '01', '0x10', '', '1.0', '1e3', '9'.repeat(61)]) {
      for (const bucket of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) {
        const value = record('invalid', { contribution: { input: '0', cacheRead: '0', cacheWrite: '0', output: '0', [bucket]: invalid }, measurement: { ...record('invalid').measurement, scope: undefined } })
        expect(() => summarizeTokenUsage(selectRuntimeUsage([originalRuntimeRecord(value)]).selected.map((row) => row.contribution))).toThrow('Token count')
        await expect(indexed([value])).rejects.toThrow('Token count')
      }
      const summary = record('summary'), covered = record('covered', { measurement: { ...summary.measurement, recordId: 'covered', scope: { ...summary.measurement.scope!, level: 'request' } }, contribution: { input: invalid, cacheRead: invalid, cacheWrite: invalid, output: invalid } })
      await compareOracle([summary, covered])
    }
    await compareOracle([record('null-zero-large', { contribution: { input: null, cacheRead: '0', cacheWrite: '9007199254740993', output: '9'.repeat(60) } })])
  })

  test('four independent ends, null providers and excluded partial summaries retain original semantics', async () => {
    const a = record('é-summary', {
      coveredThrough: { input: 4, cacheRead: 1, cacheWrite: 2, output: 3 },
    })
    const b = record('partially-excluded', {
      measurement: {
        ...a.measurement,
        recordId: 'partially-excluded',
        coveredThroughTurn: 5,
        scope: { ...a.measurement.scope!, turnIndex: 2 },
      },
    })
    const c = record('child', {
      measurement: {
        ...a.measurement,
        recordId: 'child',
        model: { id: 'model', provider: null },
        coveredThroughTurn: 4,
        scope: {
          ...a.measurement.scope!,
          session: 'child',
          parentSession: 'root',
          ancestors: ['root'],
          turnIndex: 4,
          level: 'request',
        },
      },
    })
    const originalScope = a.measurement.scope;
    if (!originalScope || !('ancestors' in originalScope)) throw new Error('Original oracle requires its complete legacy path');
    const d = record('wildcard', {
      measurement: {
        ...a.measurement,
        recordId: 'wildcard',
        model: null,
        coveredThroughTurn: 3,
        scope: { ...originalScope, level: 'tree-total' },
      },
      contribution: { input: null, cacheRead: '8', cacheWrite: '9', output: '10' },
    })
    await compareOracle([c, b, a, d])
  })

  test('two adjacent summaries never become one covering interval', async () => {
    const a = record('a', { measurement: { ...record('a').measurement, coveredThroughTurn: 2 } })
    const b = record('b', {
      measurement: {
        ...a.measurement,
        recordId: 'b',
        coveredThroughTurn: 4,
        scope: { ...a.measurement.scope!, turnIndex: 3 },
      },
    })
    const request = record('request', {
      measurement: {
        ...a.measurement,
        recordId: 'request',
        coveredThroughTurn: 4,
        scope: { ...a.measurement.scope!, level: 'request' },
      },
    })
    await compareOracle([request, b, a])
    expect((await indexed([a, b, request])).output.ambiguousOverlaps).toBe('1')
  })

  test('seeded differential cases cover model/provider/root/depth/turn/bucket combinations', async () => {
    let seed = 712371
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    const models = [
      null,
      { provider: null, id: 'same' },
      { provider: null, id: 'same' },
      { provider: null, id: 'same' },
      { provider: null, id: 'other' },
    ]
    for (let trial = 0; trial < 24; trial++) {
      const rows = Array.from({ length: 96 }, (_, i) => {
        const root = `root-${random(3)}`,
          depth = random(3),
          session = depth ? `${root}-child-${depth}` : root
        const turnIndex = random(9) + 1,
          through = turnIndex + random(5)
        const buckets = ['input', 'cacheRead', 'cacheWrite', 'output'] as const
        const contribution = Object.fromEntries(
          buckets.map((bucket) => [bucket, random(8) === 0 ? null : String(random(100))]),
        ) as unknown as TokenUsage
        return record(`é-${trial}-${i}`, {
          contribution,
          complete: random(7) !== 0,
          measurement: {
            invocationId: `invocation-${random(2)}`,
            recordId: `é-${trial}-${i}`,
            model: models[random(models.length)]!,
            coveredThroughTurn: through,
            scope: {
              root,
              session,
              parentSession: depth ? root : null,
              ancestors: depth ? [root] : [],
              turn: `turn-${turnIndex}`,
              turnIndex,
              level: (['tree-total', 'self-total', 'request'] as const)[random(3)]!,
            },
          },
          coveredThrough: Object.fromEntries(
            buckets.map((bucket) => [bucket, turnIndex + random(5)]),
          ) as unknown as Record<(typeof buckets)[number], number>,
        })
      })
      await compareOracle(rows)
    }
  })

  test('ancestry conflicts fail before any derived allocation', async () => {
    const a = record('a'),
      b = record('b', {
        measurement: {
          ...a.measurement,
          recordId: 'b',
          scope: {
            ...a.measurement.scope!,
            session: 'root',
            ancestors: ['root'],
            parentSession: 'root',
          },
        },
      })
    await expect(indexed([a, b])).rejects.toThrow('Cyclic')
  })

  test('10001 disjoint intervals in one tree stay logarithmic and preserve exact single-interval maxima', async () => {
    const index = intervalStore(),
      count = 10001
    for (let i = 0; i < count; i++)
      await insertCoverageInterval(index.store, 'one-root', { start: i * 2, end: i * 2 + 1 })
    expect(await coveragePrefixMaximum(index.store, 'one-root', -1)).toBeNull()
    expect(await coveragePrefixMaximum(index.store, 'one-root', 1234)).toBe(1235)
    expect(await coveragePrefixMaximum(index.store, 'one-root', count * 2)).toBe(count * 2 - 1)
    const head = await index.store.root('one-root'),
      root = await index.store.node('one-root', head!)
    expect(root.height).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(count + 1)))
    expect(index.reads()).toBeLessThan(count * 130)
    expect(index.nodes.size).toBe(count)
  }, 30_000)
})
