import type { Stylist } from './stylize';
import { renderTable } from './textTable';

/** 命令只经这两个通道说话，测试把它们换成数组即可断言输出。 */
export interface CommandIo {
  out(line: string): void;
  err(line: string): void;
}

export interface Emitter {
  /** --json：原样打印服务端 DTO，不做任何加工，方便脚本 jq。 */
  json(value: unknown): void;
  line(text?: string): void;
  table(headers: readonly string[], rows: readonly (readonly string[])[]): void;
  /** 详情视图：左列字段名，右列取值。 */
  fields(pairs: readonly (readonly [string, string])[]): void;
  note(text: string): void;
  warn(text: string): void;
  success(text: string): void;
}

export function createEmitter(io: CommandIo, style: Stylist): Emitter {
  return {
    json: (value) => io.out(JSON.stringify(value, null, 2)),
    line: (text = '') => io.out(text),
    table: (headers, rows) => {
      const lines = renderTable(headers, rows);
      const [header, ...body] = lines;
      if (header !== undefined) io.out(style('bold', header));
      for (const line of body) io.out(line);
      if (body.length === 0) io.out(style('dim', '（无）'));
    },
    fields: (pairs) => {
      for (const line of renderTable(['字段', '取值'], pairs.map(([key, value]) => [key, value])).slice(1)) io.out(line);
    },
    note: (text) => io.out(style('dim', text)),
    warn: (text) => io.out(style('yellow', text)),
    success: (text) => io.out(style('green', text)),
  };
}
