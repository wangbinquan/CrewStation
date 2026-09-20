import { expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { ManifestSchema, ResourceIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import { legacyManifestUpgrade } from '../adapters/persistence/legacyManifestUpgrade';

test('旧 Manifest 生成可审阅草稿，复用迁移身份，新增声明按服务隔离且重复预览稳定', async () => {
  const projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId;
  const aliases = new Map<string, string>(), definitions: string[] = [];
  const key = (kind: string, keys: readonly string[]) => JSON.stringify([kind, keys]);
  const bind = async (_owner: string, kind: string, keys: readonly string[], id = newResourceId()) => {
    if (!aliases.has(key(kind, keys))) aliases.set(key(kind, keys), id);
    return aliases.get(key(kind, keys))!;
  };
  const directory: ResourceIdentityDirectory = {
    resolve: async (kind, keys) => aliases.get(key(kind, keys)), bind,
    aliases: async (kind, id) => kind === 'service' && id === serviceId ? [['svc_old']] : [],
  };
  const existing = await bind('release', 'agent-profile', ['svc_old', 'chat']);
  for (const [kind, keys] of [['service-plan', ['small']], ['task-profile', ['coding']], ['compute-profile', ['high']], ['eventType', ['gitlab.push']], ['api-operation', ['issues', 'GET', '/list']]] as const) await bind('catalog', kind, keys);
  const upgrader = legacyManifestUpgrade(directory, { allocate: async () => { throw new Error('not a template'); }, ensureDefinition: async (_project, definition) => { definitions.push(definition.id); }, eventType: async () => undefined });
  const original = Bun.YAML.stringify({ apiVersion: 'crewstation/v1', kind: 'DigitalWorker', spec: {
    service: { command: ['echo', 'chat'], port: 3000, plan: 'small' }, env: [{ name: 'TOKEN', from: 'secret', key: 'API_TOKEN' }],
    tasks: { profile: 'coding', agentProfiles: [{ name: 'chat', compute: 'high' }, { name: 'new', compute: 'default' }], outputContracts: [{ name: 'answer', required: ['chat.json'] }] },
    apis: { requested: [{ proxy: 'issues', method: 'GET', path: '/list' }] }, subscriptions: [{ eventType: 'gitlab.push', handlerPath: '/events/chat' }],
  } });
  const preview = await upgrader.preview(original, { projectId, serviceId });
  const parsed = ManifestSchema.parse(Bun.YAML.parse(preview.content));
  if (parsed.kind !== 'DigitalWorker') throw new Error('expected worker');
  expect(parsed.spec.tasks!.agentProfiles[0]!.id).toBe(existing);
  expect(parsed.spec.tasks!.agentProfiles[1]!.compute).toEqual({ kind: 'default' });
  expect(parsed.spec.env[0]).toMatchObject({ name: 'TOKEN', from: 'secret', configDefinitionId: definitions[0] });
  expect(preview.content).toContain('chat.json'); expect(preview.content).toContain('/events/chat');
  expect(preview.changes).toContainEqual({ path: '/apiVersion', before: 'crewstation/v1', after: 'crewstation/v2' });
  expect(ResourceIdSchema.safeParse(parsed.spec.tasks!.outputContracts[0]!.id).success).toBe(true);
  expect(await upgrader.preview(original, { projectId, serviceId })).toEqual(preview);
  const other = await upgrader.preview(original, { projectId, serviceId: newResourceId() as ServiceId });
  expect(other.content).not.toEqual(preview.content);
  expect((await upgrader.preview(preview.content, { projectId, serviceId })).changes).toEqual([]);
  await expect(upgrader.preview(original.replace('small', 'missing'), { projectId, serviceId })).rejects.toThrow('未登记');
});
