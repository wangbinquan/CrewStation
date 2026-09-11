import { existsSync, statSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { notFound, validation } from '@crewstation/kernel';
import type { TemplateSource } from '../../ports/templateSource';

const TEMPLATE_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const SKIPPED = new Set(['node_modules', '.git']);

/** 模板即 `<templatesRoot>/<name>/` 目录的一份拷贝（不含 node_modules 与 .git）。 */
export function directoryTemplateSource(options: { templatesRoot: string }): TemplateSource {
  return {
    materialize: async (templateName, targetDir) => {
      if (!TEMPLATE_NAME.test(templateName)) throw validation(`模板名 ${templateName} 不合法`, { templateName });
      const source = join(options.templatesRoot, templateName);
      if (!existsSync(source) || !statSync(source).isDirectory()) throw notFound('模板', templateName);
      await cp(source, targetDir, { recursive: true, filter: (src) => !SKIPPED.has(basename(src)) });
    },
  };
}
