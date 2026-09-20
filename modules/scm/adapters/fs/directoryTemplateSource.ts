import { cp, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ProjectTemplateDto } from '@crewstation/contracts';
import { ManifestSchema, ProjectTemplateDtoSchema, ResourceIdSchema, describeManifestFailure } from '@crewstation/contracts';
import { PlatformError, notFound, validation } from '@crewstation/kernel';
import type { TemplateResourceBindings, TemplateSource } from '../../ports/templateSource';
import { initializeTemplatePlan } from './initializeTemplatePlan';
import { initializeTemplateResources } from './initializeTemplateResources';

const SKIPPED = new Set(['node_modules', '.git', 'template.json']);

/** 仓库仍保留 templates/ 与 integrations/ 两种源码目录，不裁定发行包布局（I8）。 */
export function directoryTemplateSource(options: { templatesRoot: string; integrationTemplatesRoot?: string; resources?: TemplateResourceBindings }): TemplateSource {
  const roots = [options.templatesRoot, ...(options.integrationTemplatesRoot ? [options.integrationTemplatesRoot] : [])];
  const catalog = async () => {
    const entries: { path: string; dto: ProjectTemplateDto }[] = [];
    const ids = new Set<string>();
    for (const root of roots) {
      const directories = await readdir(root, { withFileTypes: true }).catch(() => { throw new PlatformError('unavailable', '项目模板目录暂时无法读取'); });
      for (const directory of directories) {
        if (!directory.isDirectory() || SKIPPED.has(directory.name)) continue;
        const path = join(root, directory.name), dto = await describeTemplate(path);
        if (ids.has(dto.id)) throw validation(`模板 ID ${dto.id} 在多个目录重复`, { field: 'template' });
        ids.add(dto.id); entries.push({ path, dto });
      }
    }
    return entries.sort((left, right) => left.dto.name.localeCompare(right.dto.name) || left.dto.id.localeCompare(right.dto.id));
  };
  return {
    list: async () => (await catalog()).map((entry) => entry.dto),
    materialize: async (templateId, targetDir, initialPlan, context) => {
      if (!ResourceIdSchema.safeParse(templateId).success) throw validation('模板 ID 必须是 UUIDv7', { field: 'template' });
      const source = (await catalog()).find((entry) => entry.dto.id === templateId);
      if (!source) throw notFound('模板', templateId);
      await cp(source.path, targetDir, { recursive: true, filter: (src) => !SKIPPED.has(basename(src)) });
      await initializeTemplateResources(targetDir, JSON.parse(await readFile(join(source.path, 'template.json'), 'utf8')), templateId, context, options.resources);
      await initializeTemplatePlan(targetDir, initialPlan ?? source.dto.servicePlan);
    },
  };
}

async function describeTemplate(path: string): Promise<ProjectTemplateDto> {
  let document: unknown, metadata: unknown;
  try {
    document = Bun.YAML.parse(await readFile(join(path, 'crewstation.yaml'), 'utf8'));
    metadata = JSON.parse(await readFile(join(path, 'template.json'), 'utf8'));
  } catch { throw validation(`模板 ${basename(path)} 缺少有效的 template.json 或 crewstation.yaml`, { field: 'template' }); }
  const manifest = ManifestSchema.safeParse(document);
  if (!manifest.success) throw validation(`模板 ${basename(path)} 不合法：${describeManifestFailure(manifest.error)}`, { field: 'template' });
  const identity = ProjectTemplateDtoSchema.pick({ id: true, name: true, servicePlan: true }).safeParse(metadata);
  if (!identity.success) throw validation(`模板 ${basename(path)} 身份元数据不合法`, { field: 'template' });
  return { ...identity.data, kind: manifest.data.kind,
    requiredConfig: manifest.data.spec.env.filter((entry) => entry.default === undefined).map((entry) => ({ name: entry.name, from: entry.from })) };
}
