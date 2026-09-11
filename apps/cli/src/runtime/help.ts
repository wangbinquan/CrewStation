import { padRight, renderTable } from '../output/textTable';
import { configFilePath } from './configFile';
import type { CommandSpec, FlagSpec } from './commandTable';
import { COMMANDS, COMMAND_GROUPS, flagsOf, GLOBAL_FLAGS, JSON_FLAG } from './commandTable';
import { SETTING_KEYS } from './settings';

type Entry = readonly [name: string, summary: string];

/** 根帮助：命令一律从命令表来，配置顺序一律从 SETTING_KEYS 来，两者都不可能与实现不一致。 */
export function rootHelp(homeDir: string): string[] {
  const lines = ['crewstation — CrewStation 数字人能力平台命令行', '', '用法：', '  crewstation <命令> [参数] [标志]', '  crewstation <命令> --help'];
  const width = columnWidth(COMMANDS.map(usage));
  for (const group of COMMAND_GROUPS) {
    lines.push('', group);
    lines.push(...describe(COMMANDS.filter((item) => item.group === group).map((command) => [usage(command), command.summary] as Entry), width));
  }
  lines.push('', '全局标志', ...describe([...GLOBAL_FLAGS, JSON_FLAG].map(flagEntry)));
  lines.push('  （--json 出现在所有产出 DTO 的命令上）');
  lines.push('', ...resolutionHelp(homeDir), '', ...exitCodeHelp());
  return lines;
}

export function commandHelp(command: CommandSpec, homeDir: string): string[] {
  const lines = [`crewstation ${command.name} — ${command.summary}`, '', '用法：', '  crewstation ' + usage(command) + ' [标志]'];
  if (command.args.length > 0) {
    lines.push('', '参数', ...describe(command.args.map((arg) => [`<${arg.name}>`, arg.summary] as Entry)));
  }
  const own = flagsOf(command).filter((flag) => !GLOBAL_FLAGS.includes(flag));
  const width = columnWidth([...own, ...GLOBAL_FLAGS].map(flagUsage));
  if (own.length > 0) lines.push('', '标志', ...describe(own.map(flagEntry), width));
  lines.push('', '全局标志', ...describe(GLOBAL_FLAGS.map(flagEntry), width));
  lines.push('', ...resolutionHelp(homeDir), '', ...exitCodeHelp());
  return lines;
}

function describe(entries: readonly Entry[], width = columnWidth(entries.map(([name]) => name))): string[] {
  return entries.map(([name, summary]) => '  ' + padRight(name, width) + summary);
}

function columnWidth(names: readonly string[]): number {
  return names.reduce((width, name) => Math.max(width, name.length), 0) + 2;
}

function usage(command: CommandSpec): string {
  return command.name + command.args.map((arg) => ` <${arg.name}>`).join('');
}

function flagEntry(flag: FlagSpec): Entry {
  return [flagUsage(flag), flag.summary];
}

function flagUsage(flag: FlagSpec): string {
  const short = flag.short === undefined ? '' : `-${flag.short}, `;
  return `${short}--${flag.name}${flag.type === 'string' ? ` <${flag.placeholder ?? 'value'}>` : ''}`;
}

/** 配置解析顺序写在帮助里，且逐条由 SETTING_KEYS 生成，说明与实现不会漂移。 */
function resolutionHelp(homeDir: string): string[] {
  const table = renderTable(
    ['配置项', '① 标志', '② 环境变量', '③ 文件键', '④ 默认值'],
    SETTING_KEYS.map((key) => [key.name, '--' + key.flag, key.env, key.fileKey, key.fallback ?? '（无）']),
  );
  return [
    '配置解析顺序（取第一个有值的）：① 命令行标志 → ② 环境变量 → ③ 用户配置文件 → ④ 内置默认值',
    '',
    ...table.map((row) => '  ' + row),
    `  配置文件：${configFilePath({ flag: undefined, env: {}, homeDir })}（--cli-config 或 CS_CLI_CONFIG 可改），JSON，键名同上表“文件键”`,
    '  令牌不会出现在任何输出里，配置文件内容也不会被打印或记录。',
  ];
}

function exitCodeHelp(): string[] {
  return ['退出码', '  0 成功', '  1 平台或集群侧的错误（打印服务端消息）', '  2 用法错误'];
}
