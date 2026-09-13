import { existsSync, statSync } from 'node:fs';
import { cp, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ProjectTemplateDto } from '@crewstation/contracts';
import { ManifestSchema, SlugSchema, describeManifestFailure } from '@crewstation/contracts';
import { PlatformError, notFound, validation } from '@crewstation/kernel';
import type { TemplateSource } from '../../ports/templateSource';
import { initializeTemplatePlan } from './initializeTemplatePlan';

const TEMPLATE_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const SKIPPED = new Set(['node_modules', '.git']);

/** 仓库仍保留 templates/ 与 integrations/ 两种源码目录，不裁定发行包布局（I8）。 */
export function directoryTemplateSource(options: { templatesRoot: string; integrationTemplatesRoot?: string }): TemplateSource {
  const roots = [options.templatesRoot, ...(options.integrationTemplatesRoot ? [options.integrationTemplatesRoot] : [])];
  const find = (name: string) => {
    const matches = roots.map((root) => join(root, name)).filter((path) => existsSync(path) && statSync(path).isDirectory());
    if (matches.length > 1) throw validation(`模板名 ${name} 在多个目录重复`, { field: 'template' });
    if (!matches[0]) throw notFound('模板', name);
    return matches[0];
  };
  return {
    list: async () => {
      const names = new Set<string>();
      for (const root of roots) {
        const entries = await readdir(root, { withFileTypes: true }).catch(() => { throw new PlatformError('unavailable', '项目模板目录暂时无法读取'); });
        for (const entry of entries) {
          if (entry.isDirectory() && SlugSchema.safeParse(entry.name).success) names.add(entry.name);
        }
      }
      return Promise.all([...names].sort().map((name) => describeTemplate(name, find(name))));
    },
    materialize: async (templateName, targetDir, initialPlan) => {
      if (!TEMPLATE_NAME.test(templateName)) throw validation(`模板名 ${templateName} 不合法`, { templateName });
      const source = find(templateName);
      await cp(source, targetDir, { recursive: true, filter: (src) => !SKIPPED.has(basename(src)) });
      if (initialPlan !== undefined) await initializeTemplatePlan(targetDir, initialPlan);
    },
  };
}

async function describeTemplate(name: string, path: string): Promise<ProjectTemplateDto> {
  let document: unknown;
  try { document = Bun.YAML.parse(await readFile(join(path, 'crewstation.yaml'), 'utf8')); }
  catch { throw validation(`模板 ${name} 的 crewstation.yaml 无法读取或解析`, { field: 'template' }); }
  const manifest = ManifestSchema.safeParse(document);
  if (!manifest.success) throw validation(`模板 ${name} 不合法：${describeManifestFailure(manifest.error)}`, { field: 'template' });
  return { name, kind: manifest.data.kind, servicePlan: manifest.data.spec.service.plan,
    requiredConfig: manifest.data.spec.env.filter((entry) => entry.default === undefined).map((entry) => ({ name: entry.key ?? entry.name, from: entry.from })) };
}
