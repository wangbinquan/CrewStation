import { Ajv } from 'ajv';
import { Ajv2019 } from 'ajv/dist/2019';
import { Ajv2020 } from 'ajv/dist/2020';
import type { Result } from '@crewstation/kernel';
import { err, ok } from '@crewstation/kernel';

export interface SchemaValidator {
  /** 返回错误描述列表，空数组表示通过。 */
  validate(data: unknown): string[];
}

type AjvLike = Ajv | Ajv2019 | Ajv2020;

/**
 * 按 `$schema` 选择草案：2020-12／2019-09／其余按 draft-07。宽松模式（strict: false）容忍业务 schema 里的自定义关键字；
 * 不校验 format（不引入 ajv-formats），format 只当注释。
 */
export function compileJsonSchema(schema: unknown): Result<SchemaValidator, Error> {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return err(new Error('JSON Schema 必须是对象'));
  try {
    const ajv = createAjv(String((schema as { $schema?: unknown }).$schema ?? ''));
    const fn = ajv.compile(schema);
    return ok({
      validate(data) {
        if (fn(data)) return [];
        return (fn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`);
      },
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function createAjv(dialect: string): AjvLike {
  const options = { allErrors: true, strict: false, validateFormats: false } as const;
  if (dialect.includes('2020-12')) return new Ajv2020(options);
  if (dialect.includes('2019-09')) return new Ajv2019(options);
  return new Ajv(options);
}
