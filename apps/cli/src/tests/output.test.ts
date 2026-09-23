import { describe, expect, test } from 'bun:test';
import { createEmitter } from '../output/emit';
import { dash, shortSha, shortTime, yesNo } from '../output/formatValue';
import { colourEnabled, createStylist } from '../output/stylize';
import { displayWidth, padRight, renderTable } from '../output/textTable';
import { startupLines } from '../output/startupLines';

function collect(colour: boolean): { lines: string[]; emit: ReturnType<typeof createEmitter> } {
  const lines: string[] = [];
  const emit = createEmitter({ out: (line) => lines.push(line), err: () => undefined }, createStylist(colour));
  return { lines, emit };
}

describe('显示宽度与对齐', () => {
  test('中日韩字符按两列计', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('项目')).toBe(4);
    expect(displayWidth('项目abc')).toBe(7);
  });

  test('padRight 按显示宽度补齐', () => {
    expect(padRight('项目', 8)).toBe('项目    ');
    expect(padRight('abcdefgh', 4)).toBe('abcdefgh');
  });

  test('中文数据不会把列撑歪', () => {
    const second = ['名称', '最小样例', '短'];
    const lines = renderTable(['SLUG', '名称'], [['demo', '最小样例'], ['a-very-long-slug', '短']]);
    const offsets = lines.map((line, index) => displayWidth(line.slice(0, line.lastIndexOf(second[index] ?? ''))));
    expect(offsets).toEqual([18, 18, 18]);
  });

  test('行尾不留空格，空数据只出表头', () => {
    const lines = renderTable(['A', 'B'], [['x', 'y']]);
    for (const line of lines) expect(line).toBe(line.replace(/\s+$/, ''));
    expect(renderTable(['A'], [])).toEqual(['A']);
  });
});

describe('颜色', () => {
  test('非 TTY 不上色', () => {
    expect(colourEnabled({ isTty: false, noColorFlag: false, env: {} })).toBe(false);
  });

  test('TTY 且未关闭才上色', () => {
    expect(colourEnabled({ isTty: true, noColorFlag: false, env: {} })).toBe(true);
    expect(colourEnabled({ isTty: true, noColorFlag: true, env: {} })).toBe(false);
    expect(colourEnabled({ isTty: true, noColorFlag: false, env: { NO_COLOR: '1' } })).toBe(false);
  });

  test('关闭时输出里没有转义序列', () => {
    const { lines, emit } = collect(false);
    emit.table(['A'], [['x']]);
    emit.success('好了');
    emit.warn('注意');
    emit.note('说明');
    for (const line of lines) expect(line).not.toContain('');
  });

  test('打开时表头带转义序列', () => {
    const { lines, emit } = collect(true);
    emit.table(['A'], [['x']]);
    expect(lines[0]).toContain('[1m');
    expect(lines[1]).toBe('x');
  });
});

describe('--json 原样输出', () => {
  test('json() 就是 DTO 的 JSON，没有额外包装', () => {
    const { lines, emit } = collect(false);
    const dto = { items: [{ id: '01a0bf5d-8f4b-7a0d-8ab6-0c1b5602350c', nested: { a: [1, 2] } }], nextCursor: 'c' };
    emit.json(dto);
    expect(JSON.parse(lines.join('\n'))).toEqual(dto);
  });

  test('空表提示不混进 json 通道', () => {
    const { lines, emit } = collect(false);
    emit.table(['A'], []);
    expect(lines).toEqual(['A', '（无）']);
  });
});

describe('取值格式化', () => {
  test('空值统一成短横线', () => {
    expect(dash(undefined)).toBe('-');
    expect(dash('')).toBe('-');
    expect(dash(0)).toBe('0');
  });

  test('时间截到分钟（UTC），坏值原样返回', () => {
    expect(shortTime('2026-09-11T08:30:45.123Z')).toBe('2026-09-11 08:30');
    expect(shortTime('随便写的')).toBe('随便写的');
    expect(shortTime(undefined)).toBe('-');
  });

  test('SHA 截到 12 位', () => {
    expect(shortSha('0123456789abcdef0123')).toBe('0123456789ab');
    expect(shortSha(undefined)).toBe('-');
    expect(yesNo(true)).toBe('是');
  });
});

test('RFC-024：CLI 启动过程的「CLI 初始化」段有中文名，进行中带说明', () => {
  const lines = startupLines({ state: 'running', startedAt: '2026-09-23T03:00:00.000Z', observedAt: '2026-09-23T03:00:12.000Z', stages: [
    { kind: 'agent', state: 'succeeded', startedAt: '2026-09-23T03:00:00.000Z', endedAt: '2026-09-23T03:00:02.000Z', durationMs: 2000 },
    { kind: 'interface', state: 'running', startedAt: '2026-09-23T03:00:02.000Z', detail: '进程已拉起，等待 CLI 画出界面' },
    { kind: 'ready', state: 'pending' },
  ] });
  expect(lines.slice(1)).toEqual(['  ✓ Agent 启动中  2.0 秒', '  ● CLI 初始化（等待界面）  进程已拉起，等待 CLI 画出界面', '  ○ 已就绪']);
});
