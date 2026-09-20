import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigDefinitionDto, ProjectId, ServiceId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, ManifestSchema, ResourceIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { directoryTemplateSource } from '../adapters/fs/directoryTemplateSource';
import type { TemplateResourceBindings } from '../ports/templateSource';

test('模板目录使用 UUID；项目副本分配独立且重试稳定的声明 ID，并同步业务调用引用', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-template-identity-'));
  const allocations = new Map<string, string>(), definitions = new Map<string, ConfigDefinitionDto>(), eventId = newResourceId();
  const resources: TemplateResourceBindings = {
    allocate: async (kind, context, templateId, slotId) => { const key = [kind, context.serviceId, templateId, slotId].join(':'); if (!allocations.has(key)) allocations.set(key, newResourceId()); return allocations.get(key)!; },
    ensureDefinition: async (projectId, definition) => { definitions.set(`${projectId}:${definition.id}`, definition); },
    eventType: async (producer, event) => producer === 'gitlab' && event === 'gitlab.push' ? eventId : undefined,
  };
  const source = directoryTemplateSource({ templatesRoot: join(import.meta.dir, '../../../templates'), integrationTemplatesRoot: join(import.meta.dir, '../../../integrations'), resources });
  try {
    const catalog = await source.list();
    expect(catalog).toHaveLength(3);
    expect(catalog.every((item) => ResourceIdSchema.safeParse(item.id).success)).toBe(true);
    const context = () => ({ projectId: newResourceId() as ProjectId, serviceId: newResourceId() as ServiceId });
    const a = context(), b = context(), id = BUILTIN_RESOURCES.minimalTemplate;
    await source.materialize(id, join(root, 'a'), undefined, a);
    await source.materialize(id, join(root, 'again'), undefined, a);
    await source.materialize(id, join(root, 'b'), undefined, b);
    const manifest = async (dir: string) => ManifestSchema.parse(Bun.YAML.parse(await readFile(join(root, dir, 'crewstation.yaml'), 'utf8')));
    const first = await manifest('a'), other = await manifest('b');
    expect(await manifest('again')).toEqual(first);
    if (first.kind !== 'DigitalWorker' || other.kind !== 'DigitalWorker') throw new Error('Expected digital worker');
    expect(first.spec.tasks!.agentProfiles[0]!.id).not.toBe(other.spec.tasks!.agentProfiles[0]!.id);
    expect(first.spec.env[0]!.configDefinitionId).not.toBe(other.spec.env[0]!.configDefinitionId);
    expect(first.spec.subscriptions[0]!.eventTypeId).toBe(eventId);
    expect(first.spec.env[0]!.name).toBe('GREETING');
    expect(definitions.size).toBe(2);
    const client = await readFile(join(root, 'a/src/platform/agentClient.ts'), 'utf8');
    expect(client).toContain(`CHAT_AGENT_PROFILE = '${first.spec.tasks!.agentProfiles[0]!.id}'`);
    expect(client).toContain('/v2/business-tasks');
    await expect(source.materialize('minimal-sample', join(root, 'invalid'), undefined, a)).rejects.toThrow('UUIDv7');
    await expect(source.materialize(id, join(root, 'missing-context'))).rejects.toThrow('项目身份分配器');
    resources.eventType = async () => undefined;
    await expect(source.materialize(id, join(root, 'missing-event'), undefined, a)).rejects.toThrow('gitlab/gitlab.push');
  } finally { await rm(root, { recursive: true, force: true }); }
});
