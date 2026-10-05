import { z } from 'zod';
import { jsonHash } from '@crewstation/kernel';

export const GITLAB_NATIVE_STORAGE_KINDS = ['repository', 'wiki', 'design', 'snippet', 'lfs', 'upload', 'artifact', 'trace', 'package', 'registry', 'secure-file'] as const;
const id = z.string().regex(/^[1-9][0-9]*$/).refine(value => Number.isSafeInteger(Number(value)));
const uint64 = z.string().regex(/^[0-9]{1,20}$/).refine(value => /^[0-9]{1,20}$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n);
const time = z.iso.datetime({ offset: true }), hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f]+$/);
const path = z.string().min(1).max(4096).refine(value => value.startsWith('/') && !value.includes('\0') && !value.split('/').includes('..'));
const rootKind = z.enum(['repository', 'lfs', 'upload', 'artifact', 'trace', 'package', 'secure-file']);
const base = { id, createdAt: time.nullable() };
const partition = { partitionId: id.optional() };
const model = <T extends string>(name: T) => ({ ...base, model: z.literal(name) });
const location = (name: string) => ({ kind: z.literal(name), path });
export const GitLabNativeRequestSchema = z.strictObject({
  projectId: id, pathWithNamespace: text.refine(value => !value.split('/').some(part => !part || part === '.' || part === '..')),
  createdAt: time.nullable(), tokenIds: z.array(id).max(10_000),
}).refine(value => new Set(value.tokenIds).size === value.tokenIds.length);

export const GitLabNativeObjectSchema = z.discriminatedUnion('model', [
  z.strictObject({ ...model('Project'), diskPath: text, storage: text }),
  z.strictObject({ ...model('DesignManagement::Repository'), diskPath: text }),
  z.strictObject({ ...model('SnippetRepository'), snippetId: id, diskPath: text, storage: text }),
  z.strictObject(model('ProjectSnippet')),
  z.strictObject({ ...model('LfsObject'), ...location('lfs'), projectIds: z.array(id).min(1), oid: hash }),
  z.strictObject({ ...model('Upload'), path, bytes: z.number().int().nonnegative() }),
  z.strictObject({ ...model('Packages::PackageFile'), ...location('package'), packageId: id }),
  z.strictObject(model('Packages::Package')),
  z.strictObject({ ...model('Ci::JobArtifact'), ...partition, ...location('artifact'), jobId: id, fileType: text }),
  z.strictObject({ ...model('Ci::PipelineArtifact'), ...partition, ...location('artifact'), pipelineId: id }),
  z.strictObject({ ...model('Ci::SecureFile'), ...partition, ...location('secure-file') }),
  z.strictObject({ ...model('Ci::Build'), ...partition, status: text, path }),
  z.strictObject({ ...model('Ci::BuildTraceChunk'), ...partition, buildId: id, store: z.enum(['database', 'fog', 'redis', 'redis_trace_chunks']), chunkIndex: z.number().int().nonnegative() }),
]);
const allowed: Record<typeof GITLAB_NATIVE_STORAGE_KINDS[number], readonly string[]> = {
  repository: ['Project'], wiki: ['Project'], design: ['Project', 'DesignManagement::Repository'], snippet: ['SnippetRepository', 'ProjectSnippet'],
  lfs: ['LfsObject'], upload: ['Upload'], artifact: ['Ci::JobArtifact', 'Ci::PipelineArtifact'], trace: ['Ci::Build', 'Ci::BuildTraceChunk'],
  package: ['Packages::PackageFile', 'Packages::Package'], registry: [], 'secure-file': ['Ci::SecureFile'],
};
const uniqueObjects = <T extends { model: string; id: string; partitionId?: string }>(rows: T[]) => new Set(rows.map(row => row.model + ':' + (row.partitionId ?? '') + ':' + row.id)).size === rows.length;
export const GitLabNativeInventorySchema = z.strictObject({
  version: z.literal('gitlab-native/19.2.4/v1'), observedAt: time, readonly: z.literal(true),
  project: z.strictObject({ id, pathWithNamespace: text, createdAt: time, archived: z.boolean(), diskPath: text, storage: text, registryEnabled: z.literal(false) }),
  credentials: z.strictObject({
    tokens: z.array(z.strictObject({ ...model('PersonalAccessToken'), name: text, userId: id, expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), revoked: z.boolean(), scopes: z.array(text) })).max(100_000),
    users: z.array(z.strictObject({ ...model('User'), userType: text, state: text })).max(100_000),
    memberships: z.array(z.strictObject({ ...model('Member'), userId: id, type: text, sourceType: text, sourceId: id })).max(100_000),
  }).refine(value => uniqueObjects(value.tokens) && uniqueObjects(value.users) && uniqueObjects(value.memberships)),
  roots: z.array(z.strictObject({ kind: rootKind, path: path.refine(value => value.startsWith('/var/opt/gitlab/')), configuredPath: path,
    identity: z.strictObject({ device: uint64, inode: uint64.refine(value => value !== '0'), birthtimeNs: uint64.refine(value => value !== '0'), kind: z.literal('directory') }).nullable() })).length(7),
  categories: z.array(z.strictObject({ kind: z.enum(GITLAB_NATIVE_STORAGE_KINDS), complete: z.literal(true), objects: z.array(GitLabNativeObjectSchema).max(100_000) })).length(11),
  pipelines: z.array(z.strictObject({ ...model('Ci::Pipeline'), ...partition, status: text })).max(100_000),
  runtime: z.strictObject({ bootId: z.uuid(), namespace: z.string().regex(/^pid:\[[1-9][0-9]*\]$/), readerPid: z.number().int().positive(), readerStartedTick: uint64.refine(value => value !== '0') }),
  nativeRevision: hash, physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false),
}).refine(value => new Set(value.roots.map(row => row.kind)).size === 7
  && new Set(value.categories.map(row => row.kind)).size === 11 && uniqueObjects(value.pipelines)
  && value.categories.every(category => uniqueObjects(category.objects) && category.objects.every(row => allowed[category.kind].includes(row.model)))
  && value.nativeRevision === jsonHash({ project: value.project, credentials: value.credentials, roots: value.roots, categories: value.categories, pipelines: value.pipelines }));

export const GitLabNativeInstanceSchema = z.strictObject({ id: hash, image: z.string().regex(/^sha256:[a-f0-9]{64}$/), startedAt: time, epoch: hash });
export const GitLabNativeResponseSchema = z.strictObject({ before: GitLabNativeInstanceSchema, after: GitLabNativeInstanceSchema, inventory: GitLabNativeInventorySchema });
export type GitLabNativeRequest = z.infer<typeof GitLabNativeRequestSchema>;
export type GitLabNativeInventory = z.infer<typeof GitLabNativeInventorySchema>;
export type GitLabNativeInstance = z.infer<typeof GitLabNativeInstanceSchema>;
