import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ManifestSchema, ResourceIdSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { z } from 'zod';
import type { TemplateResourceBindings, TemplateResourceContext } from '../../ports/templateSource';

const metadataSchema = z.object({ bindings: z.object({
  events: z.array(z.object({ id: ResourceIdSchema, producerCode: z.string(), eventCode: z.string() })).default([]),
  sourceFiles: z.array(z.string().min(1)).default([]),
}).default({ events: [], sourceFiles: [] }) });

/** IDs in a template are slots. Every service gets independent, retry-stable identities. */
export async function initializeTemplateResources(workdir: string, metadata: unknown, templateId: string, context: TemplateResourceContext | undefined, bindings?: TemplateResourceBindings): Promise<void> {
  const path = join(workdir, 'crewstation.yaml');
  const original = Bun.YAML.parse(await readFile(path, 'utf8'));
  const manifest = ManifestSchema.parse(original), mapping = new Map<string, string>(), kinds = new Map<string, string>();
  const { bindings: declared } = metadataSchema.parse(metadata);
  const localResources = manifest.spec.env.length + (manifest.kind === 'DigitalWorker' ? (manifest.spec.tasks?.agentProfiles.length ?? 0) + (manifest.spec.tasks?.outputContracts.length ?? 0) : 0);
  if ((localResources || declared.events.length) && (!context || !bindings)) throw validation('模板资源尚未配置项目身份分配器');
  if (!context || !bindings) return;
  for (const event of declared.events) {
    const id = await bindings.eventType(event.producerCode, event.eventCode);
    if (!id) throw validation(`模板需要先登记事件 ${event.producerCode}/${event.eventCode}`);
    mapping.set(event.id, ResourceIdSchema.parse(id));
  }
  const allocate = async (kind: 'config-definition' | 'agent-profile' | 'output-contract', id: string) => {
    if (mapping.has(id) && kinds.get(id) !== kind) throw validation('模板不能让不同类型资源共用同一个槽位 UUID');
    if (!mapping.has(id)) mapping.set(id, ResourceIdSchema.parse(await bindings.allocate(kind, context, templateId, id)));
    kinds.set(id, kind);
    return mapping.get(id)!;
  };
  for (const entry of manifest.spec.env) {
    const id = await allocate('config-definition', entry.configDefinitionId);
    await bindings.ensureDefinition(context.projectId, { id, name: entry.name, bindingName: entry.name });
  }
  if (manifest.kind === 'DigitalWorker') {
    for (const entry of manifest.spec.tasks?.agentProfiles ?? []) await allocate('agent-profile', entry.id);
    for (const entry of manifest.spec.tasks?.outputContracts ?? []) await allocate('output-contract', entry.id);
    for (const entry of manifest.spec.subscriptions) if (!mapping.has(entry.eventTypeId)) throw validation('模板的事件引用缺少显式目录绑定');
  }
  // Only identity fields and explicitly declared source files are transformed; arbitrary text stays intact.
  const document = original as { spec: { env?: Array<{ configDefinitionId: string }>; tasks?: { agentProfiles: Array<{ id: string }>; outputContracts?: Array<{ id: string }> }; subscriptions?: Array<{ eventTypeId: string }> } };
  for (const entry of document.spec.env ?? []) entry.configDefinitionId = mapping.get(entry.configDefinitionId)!;
  for (const entry of [...document.spec.tasks?.agentProfiles ?? [], ...document.spec.tasks?.outputContracts ?? []]) entry.id = mapping.get(entry.id)!;
  for (const entry of document.spec.subscriptions ?? []) entry.eventTypeId = mapping.get(entry.eventTypeId)!;
  ManifestSchema.parse(document);
  await writeFile(path, Bun.YAML.stringify(document));
  for (const file of declared.sourceFiles) {
    const target = resolve(workdir, file), pathWithin = relative(workdir, target);
    if (isAbsolute(file) || pathWithin.startsWith('..') || isAbsolute(pathWithin)) throw validation('模板引用文件必须位于模板目录内');
    let content = await readFile(target, 'utf8');
    for (const [slot, id] of mapping) content = content.replaceAll(slot, id);
    await writeFile(target, content);
  }
}
