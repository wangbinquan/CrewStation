import { describe, expect, test } from 'bun:test';
import { CreateRuntimeImageRequestSchema, CreateRuntimeImageRevisionSchema, StartImageValidationSchema } from './requests';
import { RuntimeImageSelectionSchema, RuntimeImageInitializerSchema } from './values';
import { RuntimeImageExecutionSnapshotSchema } from './responses';

const id = '01a0bf5d-8f4b-7793-867c-efd7527b386b';
const source = { kind: 'source', repositoryBindingId: id, ref: 'main', context: '.', dockerfile: 'Dockerfile', architecture: 'linux/arm64', usage: 'task' };

describe('运行镜像契约（RFC-028）', () => {
  test('执行快照必须同时固定镜像地址与相同摘要', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const snapshot = { versionId: id, image: `registry.test/tool@${digest}`, digest, architecture: 'linux/amd64', validationId: id, initializerDigest: digest, initializer: {}, tools: [], selectionSource: 'request' };
    expect(RuntimeImageExecutionSnapshotSchema.safeParse(snapshot).success).toBe(true);
    for (const image of ['registry.test/tool:latest', `registry.test/tool@sha256:${'b'.repeat(64)}`, `registry.test/tool@unexpected@${digest}`]) {
      expect(RuntimeImageExecutionSnapshotSchema.safeParse({ ...snapshot, image }).success).toBe(false);
    }
  });
  test('构建参数按字节限制总大小与数量，并拒绝 NUL', () => {
    const parse = (buildArgs: Record<string, string>) => CreateRuntimeImageRevisionSchema.safeParse({ source: { ...source, buildArgs } }).success;
    expect(parse({ FLAGS: "'".repeat(8000) })).toBe(true);
    expect(parse({ FLAGS: '中'.repeat(3000) })).toBe(false);
    expect(parse({ FLAGS: '\0' })).toBe(false);
    expect(parse(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`ARG_${i}`, ''])))).toBe(false);
  });
  test('目录只接收名称和说明，不接受伪造项目归属或直接设为共享', () => {
    expect(CreateRuntimeImageRequestSchema.parse({ name: '报表工具' })).toEqual({ name: '报表工具', description: '' });
    expect(CreateRuntimeImageRequestSchema.safeParse({ name: '报表工具', projectId: id }).success).toBe(false);
    expect(CreateRuntimeImageRequestSchema.safeParse({ name: '报表工具', scope: 'shared' }).success).toBe(false);
  });
  test('构建来源与已有镜像登记是显式判别联合，Secret 只接受引用', () => {
    const revision = CreateRuntimeImageRevisionSchema.parse({ source });
    expect(revision.source).toMatchObject({ kind: 'source', context: '.', buildArgs: {}, secrets: [] });
    expect(CreateRuntimeImageRevisionSchema.parse({ source: { kind: 'existing', reference: 'runtime/report:v1', architecture: 'linux/amd64', usage: 'service' } }).source.kind).toBe('existing');
    expect(CreateRuntimeImageRevisionSchema.safeParse({ source: { ...source, secrets: [{ id: 'npm', value: 'secret' }] } }).success).toBe(false);
    expect(CreateRuntimeImageRevisionSchema.safeParse({ source: { ...source, reference: 'foreign:v1' } }).success).toBe(false);
  });
  test('拒绝构建目录越界、控制字符、空路径和未支持架构', () => {
    for (const context of ['../escape', '/tmp', 'a/../../b', 'a\\b', '', 'a\u0000b']) {
      expect(CreateRuntimeImageRevisionSchema.safeParse({ source: { ...source, context } }).success).toBe(false);
    }
    expect(CreateRuntimeImageRevisionSchema.safeParse({ source: { ...source, architecture: 'windows/amd64' } }).success).toBe(false);
    expect(CreateRuntimeImageRevisionSchema.safeParse({ source: { ...source, dockerfile: '.' } }).success).toBe(false);
  });
  test('平台保留 build arg 与初始化变量不能被用户覆盖', () => {
    for (const key of ['CS_BASE_IMAGE', 'CS_RUNNER_TOKEN', 'BUILDKIT_SYNTAX']) {
      expect(CreateRuntimeImageRevisionSchema.safeParse({ source: { ...source, buildArgs: { [key]: 'override' } } }).success).toBe(false);
    }
    expect(RuntimeImageInitializerSchema.safeParse({ steps: [], env: { PATH: '/tmp' } }).success).toBe(false);
    expect(RuntimeImageInitializerSchema.parse({ steps: [{ id: 'prepare', argv: ['sh', '/opt/business/init.sh'] }], env: { REPORT_MODE: 'fast' } }).steps[0]?.timeoutSeconds).toBe(60);
  });
  test('用途验证区分 Agent 档位修订与服务启动契约，未知字段不可吞掉', () => {
    expect(StartImageValidationSchema.parse({ requestKey: 'v1', target: { usage: 'agent', profile: { profileId: id, revision: 2 } } }).target.usage).toBe('agent');
    expect(StartImageValidationSchema.safeParse({ requestKey: 'v1', target: { usage: 'agent' } }).success).toBe(false);
    expect(StartImageValidationSchema.safeParse({ requestKey: 'v1', target: { usage: 'task', profile: { profileId: id, revision: 2 } } }).success).toBe(false);
    expect(StartImageValidationSchema.safeParse({ requestKey: 'v1', target: { usage: 'service', command: [] } }).success).toBe(false);
  });
  test('各绑定允许集合不能有重复项，默认值不被自动塞入用户显式列表', () => {
    expect(RuntimeImageSelectionSchema.parse({ runtimeImageVersionId: id })).toEqual({ runtimeImageVersionId: id });
    expect(RuntimeImageSelectionSchema.safeParse({ allowedRuntimeImageVersionIds: [id, id] }).success).toBe(false);
    expect(RuntimeImageSelectionSchema.safeParse({ runtimeImageVersionId: 'latest' }).success).toBe(false);
    expect(RuntimeImageSelectionSchema.safeParse({ image: 'runtime/report:v1' }).success).toBe(false);
  });
});
