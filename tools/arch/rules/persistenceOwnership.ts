import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { INFRA_SCHEMA_OWNERS, moduleSchemaName } from '../policy';
import { readText } from '../sourceFiles';
import type { Unit, Violation, Workspace } from '../archModel';

const RULE = 'persistence-ownership';
const PG_SCHEMA_RE = /pgSchema\(\s*['"]([^'"]+)['"]\s*\)/g;
const QUALIFIED_RE = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g;
const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?("?[a-z_][a-z0-9_]*"?)(\.)?/gi;
const CREATE_SCHEMA_RE = /create\s+schema\s+(?:if\s+not\s+exists\s+)?("?[a-z_][a-z0-9_]*"?)/gi;

/** 每模块只引用自己的 pgSchema；迁移 SQL 只操作本 schema。 */
export function persistenceOwnership(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  for (const file of ws.files) {
    if (file.unit.kind === 'tool') continue;
    for (const m of readText(file.path).matchAll(PG_SCHEMA_RE)) {
      const expected = expectedSchema(file.unit);
      if (m[1] !== expected) {
        out.push({ rule: RULE, file: file.path, message: expected ? `只能使用 pgSchema('${expected}')，实际 '${m[1]}'` : '该单元不允许声明 pgSchema' });
      }
    }
  }
  for (const unit of ws.units.filter((u) => u.kind === 'module')) out.push(...checkMigrations(unit));
  return out;
}

function expectedSchema(unit: Unit): string | undefined {
  if (unit.kind === 'module') return moduleSchemaName(unit.shortName);
  return INFRA_SCHEMA_OWNERS[unit.relDir];
}

function checkMigrations(unit: Unit): Violation[] {
  const dir = join(unit.dir, 'adapters', 'persistence', 'migrations');
  if (!existsSync(dir)) return [];
  const schema = moduleSchemaName(unit.shortName);
  const out: Violation[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql') || f.endsWith('.identity.json'))) {
    const path = join(dir, name);
    if (!/^\d{4}_[a-z0-9_]+\.(?:sql|identity\.json)$/.test(name)) out.push({ rule: RULE, file: path, message: '迁移文件名必须为 NNNN_snake_case.sql 或 NNNN_snake_case.identity.json' });
    if (name.endsWith('.sql')) out.push(...checkSql(path, stripComments(readFileSync(path, 'utf8')), schema));
    else out.push(...checkIdentity(path, schema));
  }
  return out;
}

function checkIdentity(path: string, schema: string): Violation[] {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { version?: string; schema?: string; finalize?: string[] };
    if (data.version !== 'resource-identity/v1' || data.schema !== schema) return [{ rule: RULE, file: path, message: `身份迁移必须声明 resource-identity/v1 和本模块 schema ${schema}` }];
    return (data.finalize ?? []).flatMap((statement) => checkSql(path, stripComments(statement), schema));
  } catch {
    return [{ rule: RULE, file: path, message: '身份迁移必须是有效的 JSON 描述文件' }];
  }
}

function checkSql(path: string, sql: string, schema: string): Violation[] {
  const out: Violation[] = [];
  for (const m of sql.matchAll(CREATE_SCHEMA_RE)) {
    if (m[1]?.replace(/"/g, '') !== schema) out.push({ rule: RULE, file: path, message: `只能创建本模块 schema ${schema}` });
  }
  for (const m of sql.matchAll(CREATE_TABLE_RE)) {
    if (!m[2]) out.push({ rule: RULE, file: path, message: `CREATE TABLE ${m[1]} 必须带 schema 前缀 ${schema}.` });
  }
  // A declared table/CTE alias qualifies columns, never a schema. Object positions still require ownership.
  const aliases = new Set([...sql.matchAll(/\b(?:from|join|update)\s+[a-z_][a-z0-9_.]*\s+as\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]));
  const objects = new Set([...sql.matchAll(/\b(?:from|join|update|into|table|references|index|sequence)\s+(?:if\s+(?:not\s+)?exists\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/g)].map((m) => m.index + m[0].lastIndexOf(m[1]!)));
  for (const m of sql.matchAll(QUALIFIED_RE)) {
    if (aliases.has(m[1]) && !objects.has(m.index) && sql[m.index + m[0].length] !== '(') continue;
    if (m[1] !== schema && m[1] !== 'pg_catalog') out.push({ rule: RULE, file: path, message: `引用了其他 schema 的对象 ${m[0]}` });
  }
  return out;
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'/g, "''").toLowerCase();
}
