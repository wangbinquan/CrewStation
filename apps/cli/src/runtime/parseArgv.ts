import { parseArgs } from 'node:util';
import { UsageError } from './cliError';
import type { CommandSpec } from './commandTable';
import { COMMANDS, findCommand, flagsOf } from './commandTable';
import type { FlagValues } from './settings';

export type ParseResult =
  | { readonly kind: 'command'; readonly command: CommandSpec; readonly args: readonly string[]; readonly flags: FlagValues }
  | { readonly kind: 'help'; readonly command: CommandSpec | undefined };

/**
 * 命令名必须写在最前面（最多两个词），标志与位置参数跟在后面。
 * 只用 Bun 自带的 node:util parseArgs，不引 CLI 框架：一张命令表就够了。
 */
export function parseArgv(argv: readonly string[]): ParseResult {
  const tokens = [...argv];
  const first = tokens[0];
  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    return { kind: 'help', command: first === 'help' ? findCommand(tokens.slice(1))?.command : undefined };
  }
  const hit = findCommand(tokens);
  if (hit === undefined) throw unknownCommand(tokens);
  const { values, positionals } = runParseArgs(hit.command, hit.rest);
  if (values.help === true) return { kind: 'help', command: hit.command };
  checkPositionals(hit.command, positionals);
  return { kind: 'command', command: hit.command, args: positionals, flags: values };
}

function runParseArgs(command: CommandSpec, args: readonly string[]): { values: FlagValues; positionals: readonly string[] } {
  const options: Record<string, { type: 'string' | 'boolean'; short?: string }> = {};
  for (const flag of flagsOf(command)) options[flag.name] = flag.short === undefined ? { type: flag.type } : { type: flag.type, short: flag.short };
  try {
    const parsed = parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
    return { values: parsed.values as FlagValues, positionals: parsed.positionals };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${command.name}：${message}`, `  看 crewstation ${command.name} --help`);
  }
}

function checkPositionals(command: CommandSpec, positionals: readonly string[]): void {
  if (positionals.length > command.args.length) {
    const extra = positionals.slice(command.args.length).join(' ');
    throw new UsageError(`${command.name} 多了参数：${extra}`, `  用法：crewstation ${command.name}${command.args.map((arg) => ` <${arg.name}>`).join('')}`);
  }
  const missing = command.args.slice(positionals.length);
  if (missing.length > 0) {
    throw new UsageError(`${command.name} 缺少参数：${missing.map((arg) => `<${arg.name}>`).join(' ')}`, `  用法：crewstation ${command.name}${command.args.map((arg) => ` <${arg.name}>`).join('')}`);
  }
}

/** 未知命令时给出最接近的几个候选，比单纯报错省一次翻帮助。 */
function unknownCommand(tokens: readonly string[]): UsageError {
  const typed = tokens.filter((token) => !token.startsWith('-')).slice(0, 2).join(' ');
  const head = tokens[0] ?? '';
  const near = COMMANDS.filter((command) => command.name.startsWith(head)).map((command) => command.name);
  const hint = near.length > 0 ? `  你是不是要：${near.join('、')}` : '  看 crewstation --help';
  return new UsageError(`未知命令：${typed.length > 0 ? typed : tokens.join(' ')}`, hint);
}
