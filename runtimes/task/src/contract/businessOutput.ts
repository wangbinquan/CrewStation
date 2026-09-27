import { posix } from 'node:path';
import type { AgentEvent, BusinessOutputMaterial } from '@crewstation/contracts';
import { BUSINESS_EXECUTION_LIMITS } from '@crewstation/contracts';
import type { BusinessFiles } from '../files/businessFiles';
import { compileJsonSchema } from './jsonSchemaValidator';

/** Reads use the same pinned-descriptor boundary as the public file API. Never loads schemas from the task workspace. */
export async function verifyBusinessOutput(files: BusinessFiles, cwd: string, contract: BusinessOutputMaterial): Promise<boolean> {
  try {
    const validator = contract.schemaDocument ? compileJsonSchema(JSON.parse(contract.schemaDocument)) : undefined;
    if (validator && !validator.ok) return false;
    for (const relative of contract.required) {
      const file = await files.read({ path: posix.join(cwd, relative), offset: 0, limit: BUSINESS_EXECUTION_LIMITS.fileChunkBytes });
      if (relative.toLowerCase().endsWith('.json')) {
        if (file.nextOffset !== null) return false;
        const value = JSON.parse(Buffer.from(file.contentBase64, 'base64').toString('utf8'));
        if (validator?.ok && validator.value.validate(value).length) return false;
      }
    }
    return true;
  } catch { return false; }
}

/** Delay the final CLI event until its stream drains and workspace validation completes. */
export async function* withBusinessOutput(events: AsyncIterable<AgentEvent>, verify: () => Promise<boolean>): AsyncIterable<AgentEvent> {
  let terminal: AgentEvent | undefined;
  for await (const event of events) {
    if (['completed', 'error', 'cancelled'].includes(event.type)) terminal = event;
    else yield event;
  }
  if (!terminal) return;
  if (terminal.type === 'completed' && terminal.result?.exitCode === 0 && !await verify()) {
    yield { ...terminal, type: 'error', result: { ...terminal.result, exitCode: 1 }, error: { code: 'output_contract_failed', message: '产物缺失、超出读取上限、路径不安全或不符合固定发布 Schema' } };
  } else yield terminal;
}
