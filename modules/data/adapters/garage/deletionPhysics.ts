import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DataDeletionLocation, DataDeletionPhysics, DataDeletionScope } from '../../ports/deletion/projectDeletion';
import { bindGarageObservation, garageHistoryIdentity, garageRemaining, retainedGarageHistory, GarageDeletionHistorySchema } from './retained';
import type { GarageConsumerSource, GarageDeletionGroup, GarageDeletionHistory, GarageNativeSource, GarageQuery } from './retained';

interface Objects {
  location(placement: { backendId: string; placementRevision: number }): Promise<{ endpoint: string; bucket: string; region: string }>;
  remove(location: { backendId: string; placementRevision: number; key: string }, signal: AbortSignal, authorize: () => Promise<void>): Promise<void>;
  abort(location: { backendId: string; placementRevision: number; key: string }, id: string, signal: AbortSignal, authorize: () => Promise<void>): Promise<void>;
}
interface Garage {
  cluster(signal: AbortSignal): Promise<{ node: string; revision: string }>;
  bucket(alias: string, signal: AbortSignal): Promise<{ id: string; created: string }>;
  purgeExclusive(input: { node: string; hash: string; bucketId: string; spaceIds: readonly string[]; versions: readonly string[]; uploads: readonly string[] }, signal: AbortSignal, authorize: () => Promise<void>): Promise<{ kind: 'shared' } | { kind: 'acknowledged'; digest: string; physicalReclamationProven: false }>;
}
export interface GarageDeletionDependencies {
  source: GarageNativeSource; consumers: GarageConsumerSource; objects: Objects; garage: Garage;
  /** A fixed local S3 service; unrelated registered backends cannot be cleaned with this native source. */
  s3Endpoint: string;
  authorize(context: ProjectDeletionContext): Promise<void>;
  closed(context: ProjectDeletionContext, scope: DataDeletionScope): Promise<string | undefined>;
  exclusive<T>(context: ProjectDeletionContext, work: () => Promise<T>): Promise<T | undefined>;
}
const report = { complete: true as const, references: [], blockers: [] };
const emptyQuery = (bucketId: string, spaceIds: string[]): GarageQuery => ({ bucketId, spaceIds: [...spaceIds].sort(), retainedVersions: [], retainedUploads: [], retainedBlocks: [] });
const endpoint = (raw: string) => { const url = new URL(raw); if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw precondition('Garage 原 S3 位置无效'); return url.origin; };
function placements(scope: DataDeletionScope, previous?: GarageDeletionHistory) {
  const result = new Map<string, { backendId: string; placementRevision: number; spaces: Set<string> }>();
  const add = (location: { backendId: string; placementRevision: number }, spaceId: string) => {
    const key = jsonHash(location), old = result.get(key) ?? { ...location, spaces: new Set<string>() }; old.spaces.add(spaceId); result.set(key, old);
  };
  for (const place of scope.placements ?? []) add({ backendId: place.backendId, placementRevision: place.placementRevision }, place.spaceId);
  for (const location of scope.locations) {
    const space = /^spaces\/([a-f0-9-]{36})\/attempts\/([a-f0-9-]{36})$/.exec(location.key)?.[1];
    if (!space || !scope.origins.some(origin => origin.kind === 'space' && origin.id === space)) throw precondition('Garage 原 key 缺少完整对象空间归属');
    add({ backendId: location.backendId, placementRevision: location.placementRevision }, space);
  }
  for (const old of previous?.groups ?? []) for (const place of old.placements) for (const space of old.query.spaceIds) add(place, space);
  if (scope.origins.some(origin => origin.kind === 'space' && ![...result.values()].some(row => row.spaces.has(origin.id)))) throw precondition('Garage 空空间的原后端位置不完整');
  return [...result.values()].sort((a, b) => JSON.stringify([a.backendId, a.placementRevision]).localeCompare(JSON.stringify([b.backendId, b.placementRevision])));
}
async function verifyPlacement(deps: GarageDeletionDependencies, s3: string, original: GarageDeletionGroup, signal: AbortSignal) {
  if ((await deps.garage.cluster(signal)).node !== original.node) throw precondition('Garage 原节点身份变化');
  for (const place of original.placements) {
    const actual = await deps.objects.location(place);
    if (endpoint(actual.endpoint) !== s3) throw precondition('Garage 原 S3 位置变化');
    const bucket = await deps.garage.bucket(actual.bucket, signal);
    if (bucket.id !== original.query.bucketId || bucket.created !== original.bucketCreated) throw precondition('Garage 原 bucket 身份变化');
  }
}

export function garageObjectDeletionPhysics(deps: GarageDeletionDependencies): DataDeletionPhysics {
  const s3 = endpoint(deps.s3Endpoint);
  return {
    inspect: async (rawTarget: ProjectDeletionTarget, rawScope: DataDeletionScope) => {
      const target = structuredClone(rawTarget), scope = structuredClone(rawScope);
      const previous = retainedGarageHistory(scope);
      if (previous && previous.projectId !== target.id) throw precondition('Garage 原材料属于其他项目');
      const signal = AbortSignal.timeout(60_000), cluster = await deps.garage.cluster(signal), grouped = new Map<string, { query: GarageQuery; placements: GarageDeletionGroup['placements']; bucketCreated: string }>();
      for (const place of placements(scope, previous)) {
        const resolved = await deps.objects.location(place);
        if (endpoint(resolved.endpoint) !== s3) throw precondition('原对象后端不是受支持的本机 Garage；需要该后端的独立物理来源');
        const bucket = await deps.garage.bucket(resolved.bucket, signal), original = previous?.groups.find(row => row.query.bucketId === bucket.id);
        const retainedPlacement = previous?.groups.find(row => row.placements.some(old => old.backendId === place.backendId && old.placementRevision === place.placementRevision));
        if (retainedPlacement && retainedPlacement.query.bucketId !== bucket.id) throw precondition('Garage 留存位置的原 bucket 被替换');
        if (original && (original.bucketCreated !== bucket.created || original.node !== cluster.node)) throw precondition('Garage 原 bucket 或节点变化');
        const row = grouped.get(bucket.id) ?? { query: original ? structuredClone(original.query) : emptyQuery(bucket.id, []), placements: [], bucketCreated: bucket.created };
        row.query.spaceIds = [...new Set([...row.query.spaceIds, ...place.spaces])].sort(); row.placements.push({ backendId: place.backendId, placementRevision: place.placementRevision }); grouped.set(bucket.id, row);
      }
      const groups: GarageDeletionGroup[] = []; let count = 0;
      for (const row of [...grouped.values()].sort((a, b) => a.query.bucketId.localeCompare(b.query.bucketId))) {
        const old = previous?.groups.find(group => group.query.bucketId === row.query.bucketId);
        const captured = old ? await deps.source.verify(row.query, old, signal) : await deps.source.capture(row.query, signal);
        const inventory = captured.inventory, query = { ...row.query, retainedVersions: inventory.metadata.versions, retainedUploads: inventory.metadata.uploads, retainedBlocks: inventory.metadata.blocks };
        const remaining = garageRemaining(inventory); count += remaining.native + remaining.storage;
        const files = new Map((old?.files ?? []).map(file => [file.path, file]));
        for (const file of inventory.blocks.copies) {
          if (files.has(file.path) && files.get(file.path)!.identity !== file.identity) throw precondition('Garage 留存原文件被替换'); files.set(file.path, file);
        }
        const consumers = old ? await deps.consumers.observe(old.consumers, [...files.values()]) : await deps.consumers.capture({ uid: captured.origin.nodeUid, name: captured.origin.nodeName }, [...files.values()]);
        groups.push({ query, identity: captured.identity, origin: captured.origin as GarageDeletionGroup['origin'], node: cluster.node, bucketCreated: row.bucketCreated, placements: row.placements,
          files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), consumers: consumers.source });
      }
      const body = GarageDeletionHistorySchema.parse({ version: 1, projectId: target.id, groups }), identity = garageHistoryIdentity(body);
      return { ...report, identity, count, nativeHistory: { version: 1 as const, identity, digest: jsonHash(body), body } };
    },
    run: async (rawContext, rawScope, identity) => {
      const context = structuredClone(rawContext), scope = structuredClone(rawScope);
      const history = retainedGarageHistory(scope);
      if (!history || history.projectId !== context.target.id || garageHistoryIdentity(history) !== identity) throw precondition('Garage 缺少确认后的原物理材料');
      const authorize = () => deps.authorize(context), closed = await deps.closed(context, scope);
      await authorize();
      if (!closed) return { kind: 'waiting', reason: '等待原对象请求、上传和读取的持久退出证明' };
      const execute = async () => {
        const signal = AbortSignal.timeout(60_000), receipts: unknown[] = []; let remaining = 0;
        for (const original of history.groups) {
          await verifyPlacement(deps, s3, original, signal);
          let current = await deps.source.verify(original.query, original, signal); bindGarageObservation(original, current);
          const consumers = await deps.consumers.observe(original.consumers, original.files);
          if (consumers.count) return { kind: 'waiting' as const, reason: '等待原节点上的全部对象文件消费者退出' };
          if (context.phase === 'purge') {
            const fallback = original.placements[0]!;
            const locate = (key: string) => {
              const captured: DataDeletionLocation | undefined = scope.locations.find(location => location.key === key && original.placements.some(place => place.backendId === location.backendId && place.placementRevision === location.placementRevision));
              return captured ?? { ...fallback, key };
            };
            for (const upload of current.inventory.metadata.multipart) if (!upload.deleted) await deps.objects.abort(locate(upload.key), upload.id, signal, authorize);
            for (const object of current.inventory.metadata.objects) if (object.versions.some(version => !['deleted', 'aborted'].includes(version.state))) await deps.objects.remove(locate(object.key), signal, authorize);
            current = await deps.source.verify(original.query, original, signal); bindGarageObservation(original, current);
            for (const hash of original.query.retainedBlocks) {
              const result = await deps.garage.purgeExclusive({ node: original.node, hash, bucketId: original.query.bucketId, spaceIds: original.query.spaceIds, versions: original.query.retainedVersions, uploads: original.query.retainedUploads }, signal, authorize);
              receipts.push({ hash, ...result });
            }
          }
          // Re-observe after every acknowledgement. Detached native queues and
          // all original files remain mandatory across crashes and GC delays.
          current = await deps.source.verify(original.query, original, signal); bindGarageObservation(original, current);
          const finalConsumers = await deps.consumers.observe(original.consumers, original.files);
          if (finalConsumers.count) return { kind: 'waiting' as const, reason: '原对象文件仍被进程读取或映射' };
          const actual = garageRemaining(current.inventory); remaining += actual.native + actual.storage;
          receipts.push({ source: current.identity, native: current.inventory.metadata.revision, blocks: current.inventory.blocks.revision, shared: [...actual.shared].sort(), consumers: finalConsumers.digest });
        }
        await authorize();
        if (context.phase !== 'stop' && remaining) return { kind: 'waiting' as const, reason: `等待 Garage 正常回收原对象版本和独占块，当前仍有 ${remaining} 项` };
        return { kind: 'done' as const, sourceIdentity: identity, scopeDigest: scope.digest, producersClosed: true, consumersStopped: true, independent: true, remaining,
          evidence: { kind: 'physical' as const, count: history.groups.reduce((sum, group) => sum + group.files.length, 0), digest: jsonHash({ history: scope.nativeHistory!.digest, closed, phase: context.phase, receipts }),
            description: context.phase === 'stop' ? '原对象准入与请求已排空，原节点全部文件消费者已核对' : '原对象版本、上传队列和独占文件已独立核对归零；其他项目共享块保留' } };
      };
      if (context.phase === 'purge') return await deps.exclusive(context, execute) ?? { kind: 'waiting', reason: '等待共享 Garage 的原读写请求退出，再回收独占块' };
      return execute();
    },
  };
}
