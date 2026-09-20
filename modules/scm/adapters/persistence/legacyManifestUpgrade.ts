import { createHash } from 'node:crypto';
import { LegacyManifestSchema, ManifestSchema } from '@crewstation/contracts';
import type { ManifestUpgradePreview } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import type { ManifestUpgrade } from '../../ports/manifestUpgrade';
import type { TemplateResourceBindings } from '../../ports/templateSource';

/** Resolve historical symbols only at the explicit v1 import boundary. */
export function legacyManifestUpgrade(directory: ResourceIdentityDirectory, resources?: TemplateResourceBindings): ManifestUpgrade {
  return { preview: async (content, context) => {
    const raw = Bun.YAML.parse(content);
    if (ManifestSchema.safeParse(raw).success) return { sourceHash: hash(content), content, changes: [] };
    const legacy = LegacyManifestSchema.parse(raw);
    const document = structuredClone(raw) as Record<string, unknown>;
    const changes: ManifestUpgradePreview['changes'] = [];
    const set = (path: string[], value: unknown, remove?: string) => {
      let target = document;
      for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
      const key = path.at(-1)!;
      changes.push({ path: `/${path.join('/')}`, before: target[remove ?? key] ?? null, after: value });
      if (remove) delete target[remove];
      target[key] = value;
    };
    const resolve = async (kind: string, keys: string[]) => {
      const id = await directory.resolve(kind, keys);
      if (!id) throw validation(`旧版 Manifest 引用未登记：${kind} ${keys.at(-1)}；请从当前资源目录选择 UUID`);
      return id;
    };
    const scoped = async (kind: string, ownerKind: string, ownerId: string, name: string) => {
      const scopes = [ownerId, ...(await directory.aliases(ownerKind, ownerId)).filter((keys) => keys.length === 1).map((keys) => keys[0]!)];
      const ids = new Set<string>();
      for (const scope of scopes) { const id = await directory.resolve(kind, [scope, name]); if (id) ids.add(id); }
      if (ids.size > 1) throw validation(`旧版 Manifest 引用不唯一：${kind} ${name}`);
      return ids.values().next().value ?? directory.bind('scm', kind, [ownerId, name]);
    };
    set(['apiVersion'], 'crewstation/v2');
    set(['spec', 'service', 'servicePlanId'], await resolve('service-plan', [legacy.spec.service.plan]), 'plan');
    for (const [index, entry] of legacy.spec.env.entries()) {
      const bindingName = entry.key ?? entry.name;
      const id = await scoped('configDefinition', 'project', context.projectId, bindingName);
      if (resources) await resources.ensureDefinition(context.projectId, { id, name: bindingName, bindingName });
      else throw validation('Manifest 配置身份分配器未配置');
      set(['spec', 'env', String(index), 'configDefinitionId'], id, 'key');
    }
    if (legacy.kind === 'DigitalWorker') {
      for (const [i, operation] of legacy.spec.apis.requested.entries()) {
        set(['spec', 'apis', 'requested', String(i)], { operationId: await resolve('api-operation', [operation.proxy, operation.method, operation.path]) });
      }
      for (const [i, entry] of legacy.spec.subscriptions.entries()) {
        set(['spec', 'subscriptions', String(i), 'eventTypeId'], await resolve('eventType', [entry.eventType]), 'eventType');
      }
      if (legacy.spec.tasks) {
        set(['spec', 'tasks', 'taskProfileId'], await resolve('task-profile', [legacy.spec.tasks.profile]), 'profile');
        for (const [i, entry] of legacy.spec.tasks.agentProfiles.entries()) {
          set(['spec', 'tasks', 'agentProfiles', String(i), 'id'], await scoped('agent-profile', 'service', context.serviceId, entry.name));
          set(['spec', 'tasks', 'agentProfiles', String(i), 'compute'], entry.compute === 'default' ? { kind: 'default' } : { kind: 'profile', profileId: await resolve('compute-profile', [entry.compute]) });
        }
        for (const [i, entry] of legacy.spec.tasks.outputContracts.entries()) {
          set(['spec', 'tasks', 'outputContracts', String(i), 'id'], await scoped('output-contract', 'service', context.serviceId, entry.name));
        }
      }
    }
    ManifestSchema.parse(document);
    return { sourceHash: hash(content), content: Bun.YAML.stringify(document), changes };
  } };
}
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
