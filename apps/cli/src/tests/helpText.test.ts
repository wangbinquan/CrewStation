import { describe, expect, test } from 'bun:test';
import { COMMANDS, flagsOf, GLOBAL_FLAGS } from '../runtime/commandTable';
import { commandHelp, rootHelp } from '../runtime/help';
import { SETTING_KEYS } from '../runtime/settings';

const ROOT = rootHelp('/home/tester').join('\n');

describe('根帮助由命令表生成', () => {
  test('每条命令与摘要都在', () => {
    for (const command of COMMANDS) {
      expect(ROOT).toContain(command.name);
      expect(ROOT).toContain(command.summary);
    }
  });

  test('每个分组都有标题', () => {
    for (const group of new Set(COMMANDS.map((command) => command.group))) expect(ROOT).toContain(group);
  });

  test('全局标志逐条列出', () => {
    for (const flag of GLOBAL_FLAGS) expect(ROOT).toContain('--' + flag.name);
    expect(ROOT).toContain('--json');
  });

  test('配置解析顺序与每层的名字都写清楚了', () => {
    expect(ROOT).toContain('① 命令行标志 → ② 环境变量 → ③ 用户配置文件 → ④ 内置默认值');
    for (const key of SETTING_KEYS) {
      expect(ROOT).toContain('--' + key.flag);
      expect(ROOT).toContain(key.env);
    }
    expect(ROOT).toContain('/home/tester/.config/crewstation/config.json');
    expect(ROOT).toContain('令牌不会出现在任何输出里');
  });

  test('三个退出码都写清楚了', () => {
    expect(ROOT).toContain('0 成功');
    expect(ROOT).toContain('1 平台或集群侧的错误');
    expect(ROOT).toContain('2 用法错误');
  });
});

describe('子命令帮助', () => {
  test('列出自己的标志、位置参数与全局标志', () => {
    for (const command of COMMANDS) {
      const text = commandHelp(command, '/home/tester').join('\n');
      expect(text).toContain(`crewstation ${command.name}`);
      for (const flag of flagsOf(command)) expect(text).toContain('--' + flag.name);
      for (const arg of command.args) expect(text).toContain(`<${arg.name}>`);
    }
  });

  test('帮助里的用法行与位置参数数量一致', () => {
    for (const command of COMMANDS) {
      const usage = commandHelp(command, '/home/tester')[3] ?? '';
      expect((usage.match(/</g) ?? []).length).toBe(command.args.length);
    }
  });

  test('每行都对齐：标志名与说明之间至少留两个空格', () => {
    for (const line of commandHelp(COMMANDS[0] as (typeof COMMANDS)[number], '/home/tester')) {
      if (line.startsWith('  --') || line.startsWith('  -h')) expect(line).toMatch(/ {2}\S/);
    }
  });
});
