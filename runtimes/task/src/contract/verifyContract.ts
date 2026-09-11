import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';
import type { Logger } from '@crewstation/kernel';
import { pathDenied } from '../commandError';
import type { CommandOf } from '../commandDispatcher';
import type { WorkdirPaths } from '../files/workdirPath';
import { isInside } from '../files/workdirPath';
import type { SchemaValidator } from './jsonSchemaValidator';
import { compileJsonSchema } from './jsonSchemaValidator';

export interface VerifyContractPayload {
  ok: boolean;
  missing: string[];
  schemaErrors: string[];
}

export type ContractVerifier = (command: CommandOf<'verifyContract'>) => Promise<VerifyContractPayload>;

/**
 * 业务子任务的产出契约校验：`required` 路径必须存在于 cwd 下；`.json` 产物必须可解析；
 * 给了 `contract.schema` 时，每个 JSON 产物再按该 JSON Schema 文件校验。
 */
export function createContractVerifier(deps: { paths: WorkdirPaths; logger: Logger }): ContractVerifier {
  return async (command) => {
    const base = await deps.paths.resolveCwd(command.cwd);
    const missing: string[] = [];
    const schemaErrors: string[] = [];
    const validator = command.contract.schema === undefined ? undefined : await loadSchema(base, command.contract.schema, schemaErrors);
    for (const required of command.contract.required) {
      const absolute = resolveUnder(base, required);
      if (!(await isFile(absolute))) {
        missing.push(required);
        continue;
      }
      if (!required.toLowerCase().endsWith('.json')) continue;
      const parsed = await parseJsonFile(absolute, required, schemaErrors);
      if (parsed !== undefined && validator) schemaErrors.push(...validator.validate(parsed.value).map((e) => `${required}: ${e}`));
    }
    const ok = missing.length === 0 && schemaErrors.length === 0;
    deps.logger.info('contract verified', { subtaskId: command.subtaskId, contract: command.contract.name, ok, missing: missing.length, schemaErrors: schemaErrors.length });
    return { ok, missing, schemaErrors };
  };
}

function resolveUnder(base: string, relative: string): string {
  if (isAbsolute(relative) || relative.includes('\0')) throw pathDenied(relative);
  const normalized = posix.normalize(relative);
  if (normalized === '..' || normalized.startsWith('../')) throw pathDenied(relative);
  const absolute = join(base, normalized);
  if (!isInside(base, absolute)) throw pathDenied(relative);
  return absolute;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function parseJsonFile(absolute: string, label: string, errors: string[]): Promise<{ value: unknown } | undefined> {
  try {
    return { value: JSON.parse(await readFile(absolute, 'utf8')) };
  } catch (error) {
    errors.push(`${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function loadSchema(base: string, schemaPath: string, errors: string[]): Promise<SchemaValidator | undefined> {
  const absolute = resolveUnder(base, schemaPath);
  if (!(await isFile(absolute))) {
    errors.push(`schema ${schemaPath}: file not found`);
    return undefined;
  }
  const parsed = await parseJsonFile(absolute, `schema ${schemaPath}`, errors);
  if (parsed === undefined) return undefined;
  const compiled = compileJsonSchema(parsed.value);
  if (!compiled.ok) {
    errors.push(`schema ${schemaPath}: ${compiled.error.message}`);
    return undefined;
  }
  return compiled.value;
}
