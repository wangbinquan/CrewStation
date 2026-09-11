import { describe, expect, test } from 'bun:test';
import { UsageError } from '../runtime/cliError';
import { COMMANDS, findCommand, flagsOf, GLOBAL_FLAGS, JSON_FLAG } from '../runtime/commandTable';
import { parseArgv } from '../runtime/parseArgv';

function caught(argv: readonly string[]): UsageError {
  try {
    parseArgv(argv);
  } catch (error) {
    if (error instanceof UsageError) return error;
    throw error;
  }
  throw new Error('期望抛出 UsageError，但解析成功了');
}

describe('命令定位', () => {
  test('两词命令优先于一词命令', () => {
    const parsed = parseArgv(['projects', 'list']);
    expect(parsed.kind).toBe('command');
    if (parsed.kind !== 'command') return;
    expect(parsed.command.name).toBe('projects list');
    expect(parsed.args).toEqual([]);
  });

  test('一词命令带位置参数', () => {
    const parsed = parseArgv(['publish', 'demo', '--branch', 'main']);
    if (parsed.kind !== 'command') throw new Error('应当解析为命令');
    expect(parsed.command.name).toBe('publish');
    expect(parsed.args).toEqual(['demo']);
    expect(parsed.flags.branch).toBe('main');
  });

  test('标志可以写在位置参数之前', () => {
    const parsed = parseArgv(['projects', 'show', '--json', 'demo']);
    if (parsed.kind !== 'command') throw new Error('应当解析为命令');
    expect(parsed.args).toEqual(['demo']);
    expect(parsed.flags.json).toBe(true);
  });

  test('未知命令是用法错误，并给出同前缀的候选', () => {
    const error = caught(['projects', 'lst']);
    expect(error.message).toContain('未知命令');
    expect(error.hint).toContain('projects list');
  });

  test('findCommand 不把标志当命令词', () => {
    expect(findCommand(['--json', 'projects'])).toBeUndefined();
  });
});

describe('参数与标志校验', () => {
  test('缺位置参数', () => {
    expect(caught(['projects', 'show']).message).toContain('缺少参数');
  });

  test('多位置参数', () => {
    expect(caught(['projects', 'show', 'a', 'b']).message).toContain('多了参数');
  });

  test('未知标志', () => {
    expect(caught(['projects', 'list', '--nope']).message).toContain('projects list');
  });

  test('string 标志缺取值', () => {
    expect(caught(['publish', 'demo', '--branch']).message).toContain('publish');
  });

  test('没有 --json 的命令不接受它', () => {
    const noJson = COMMANDS.find((command) => !command.emitsDto);
    expect(noJson).toBeUndefined();
  });
});

describe('帮助', () => {
  test('空参数、help、--help、-h 都进帮助', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) expect(parseArgv(argv).kind).toBe('help');
  });

  test('help <命令> 与 <命令> --help 指向同一条命令', () => {
    const viaHelp = parseArgv(['help', 'traffic', 'switch']);
    const viaFlag = parseArgv(['traffic', 'switch', 'demo', '--help']);
    expect(viaHelp.kind).toBe('help');
    expect(viaFlag.kind).toBe('help');
    if (viaHelp.kind !== 'help' || viaFlag.kind !== 'help') return;
    expect(viaHelp.command?.name).toBe('traffic switch');
    expect(viaFlag.command?.name).toBe('traffic switch');
  });

  test('--help 优先于缺失的位置参数', () => {
    expect(parseArgv(['publish', '--help']).kind).toBe('help');
  });
});

describe('命令表', () => {
  test('每条命令都能接受全局标志与 --json', () => {
    for (const command of COMMANDS) {
      const names = flagsOf(command).map((flag) => flag.name);
      for (const global of GLOBAL_FLAGS) expect(names).toContain(global.name);
      expect(names).toContain(JSON_FLAG.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test('命令名唯一且最多两个词', () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.split(' ').length).toBeLessThanOrEqual(2);
  });
});
