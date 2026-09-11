import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ModuleSpec {
  name: string;
  layer: number;
  deps: string[];
  desc: string;
  persistence: boolean;
  drizzleVersion: string;
}

const TEMPLATE_DIR = join(import.meta.dir, 'templates');

/** 模板文件在 templates/*.tmpl，占位符 {{name}}、{{pascal}}、{{camel}}、{{schema}}、{{layer}}、{{desc}}。 */
export function renderModuleFiles(spec: ModuleSpec): Record<string, string> {
  const vars = variables(spec);
  const files: Record<string, string> = {
    'package.json': renderPackageJson(spec),
    'README.md': render('README.md.tmpl', vars),
    'index.ts': render('index.ts.tmpl', vars),
    'api/moduleApi.ts': render('moduleApi.ts.tmpl', vars),
    'wiring.ts': render('wiring.ts.tmpl', vars),
    [`tests/${vars.camel}Module.test.ts`]: render('module.test.ts.tmpl', vars),
    'domain/.gitkeep': '',
    'application/.gitkeep': '',
    'ports/.gitkeep': '',
    'http/.gitkeep': '',
    'workers/.gitkeep': '',
  };
  if (spec.persistence) {
    files['adapters/persistence/schema.ts'] = render('schema.ts.tmpl', vars);
    files['adapters/persistence/migrations/0001_create_schema.sql'] = `CREATE SCHEMA IF NOT EXISTS ${vars.schema};\n`;
  } else {
    files['adapters/.gitkeep'] = '';
  }
  return files;
}

function variables(spec: ModuleSpec): Record<string, string> {
  const pascal = spec.name.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return {
    name: spec.name,
    pascal,
    camel: pascal.charAt(0).toLowerCase() + pascal.slice(1),
    schema: spec.name.replace(/-/g, '_'),
    layer: String(spec.layer),
    desc: spec.desc || '职责待补充。',
  };
}

function render(template: string, vars: Record<string, string>): string {
  return readFileSync(join(TEMPLATE_DIR, template), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function renderPackageJson(spec: ModuleSpec): string {
  const dependencies: Record<string, string> = {
    '@crewstation/kernel': 'workspace:*',
    '@crewstation/contracts': 'workspace:*',
  };
  for (const dep of spec.deps) dependencies[`@crewstation/module-${dep}`] = 'workspace:*';
  if (spec.persistence) dependencies['drizzle-orm'] = spec.drizzleVersion;
  const pkg = {
    name: `@crewstation/module-${spec.name}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    description: spec.desc,
    exports: { '.': './index.ts' },
    crewstation: { layer: spec.layer },
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    devDependencies: { '@crewstation/testkit': 'workspace:*' },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}
