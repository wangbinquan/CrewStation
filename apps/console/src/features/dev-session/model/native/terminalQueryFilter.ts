import type { Terminal } from '@xterm/xterm';

/**
 * RFC-026：Runner 声明由它统一应答终端查询时（快照 `repliesQueries`），浏览器的 xterm 拦下这些查询、不再应答，
 * 否则 CLI 会收到两份应答，多出的一份作为乱码进 TUI 的输入框。拦的正是浏览器 xterm.js 6 会应答的那几类
 * （设计 §2 实测）：DA、DSR、DECRQM、DECRQSS、配色 OSC 4／10／11／12 的查询。键盘输入走 onData，不受影响。
 */
export function installQueryFilter(terminal: Pick<Terminal, 'parser'>): { dispose(): void } {
  const swallow = () => true;
  const parser = terminal.parser;
  const disposables = [
    parser.registerCsiHandler({ final: 'c' }, swallow),
    parser.registerCsiHandler({ prefix: '>', final: 'c' }, swallow),
    parser.registerCsiHandler({ prefix: '=', final: 'c' }, swallow),
    parser.registerCsiHandler({ final: 'n' }, swallow),
    parser.registerCsiHandler({ prefix: '?', final: 'n' }, swallow),
    parser.registerCsiHandler({ intermediates: '$', final: 'p' }, swallow),
    parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, swallow),
    parser.registerDcsHandler({ intermediates: '$', final: 'q' }, swallow),
    ...[4, 10, 11, 12].map((ident) => parser.registerOscHandler(ident, (data) => data.split(';').includes('?'))),
  ];
  return { dispose: () => { for (const disposable of disposables) disposable.dispose(); } };
}
