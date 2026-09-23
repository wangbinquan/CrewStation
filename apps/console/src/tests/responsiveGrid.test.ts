import { expect, test } from 'bun:test';
import { consoleStyles } from './sourceScan';

const AUTO_TRACK = /repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*([^,]+?)\s*,/g;

// 2026-09-23 实撞：概览底部的 `minmax(440px, 1fr)` 在 390／320 宽下只剩一列、仍不肯窄于 440px，整块内容被主区裁掉右侧。
// 自动列数的网格，最小列宽一律套一层 `min(…, 100%)`（本仓多写作 `min(100%, Npx)`）：宽屏行为不变，窄屏单列可以收窄。
test('auto-fit／auto-fill 网格的最小列宽都能在窄屏收窄到容器宽度', () => {
  const offenders = consoleStyles().flatMap((file) => [...file.code.matchAll(AUTO_TRACK)]
    .filter((match) => !/^min\(/.test(match[1] ?? ''))
    .map((match) => `${file.path}: minmax(${match[1]}, …)`));
  expect(offenders).toEqual([]);
});
