import { expect, test } from 'bun:test';
import type { WorkspaceDockNode, WorkspaceLayout } from './devSession';
import { WorkspaceLayoutSchema } from './devSession';

const id = () => Bun.randomUUIDv7();
const [groupA, groupB, one, two] = [id(), id(), id(), id()];
const ratios = { columns: [1, 1], rows: [1, 1] };
const legacy: WorkspaceLayout = {
  activeTabId: groupA, tabs: [{ id: groupA, name: '工作区 1', layout: 'grid', paneOrder: [one], ratios }, { id: groupB, name: '工作区 2', layout: 'grid', paneOrder: [two], ratios }],
  hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.45, selectedTerminalId: null, maximizedTerminalId: null,
};
const issues = (value: unknown) => { const result = WorkspaceLayoutSchema.safeParse(value); return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.')); };

test('标签组字段都是可选的：旧布局照常通过；分屏树、每组当前标签与个人名字一起也通过', () => {
  expect(issues(legacy)).toEqual([]);
  const grouped = { ...legacy, tabs: legacy.tabs.map((tab) => ({ ...tab, activeTerminalId: tab.paneOrder[0] })), dock: { direction: 'row', children: [{ group: groupA }, { group: groupB }], sizes: [1.5, 0.5] }, terminalNames: [{ terminalId: two, name: '前端' }] };
  expect(issues(grouped)).toEqual([]);
});

test('分屏树只校验自身：大小与子项数一致、一组只出现一次、至多 8 层；不要求与页签逐一对应（旧工作台改页签时不认识这棵树）', () => {
  expect(issues({ ...legacy, dock: { direction: 'row', children: [{ group: groupA }, { group: groupB }], sizes: [1] } })).toContain('dock.sizes');
  expect(issues({ ...legacy, dock: { direction: 'row', children: [{ group: groupA }, { group: groupA }], sizes: [1, 1] } })).toContain('dock');
  expect(issues({ ...legacy, dock: { direction: 'row', children: [{ group: groupA }, { group: id() }], sizes: [1, 1] } })).toEqual([]);
  expect(issues({ ...legacy, dock: { group: groupA, extra: true } })).toContain('dock');
  const nest = (depth: number): WorkspaceDockNode => depth === 1 ? { group: id() } : { direction: depth % 2 ? 'row' : 'column', children: [{ group: id() }, nest(depth - 1)], sizes: [1, 1] };
  expect(issues({ ...legacy, dock: nest(8) })).toEqual([]);
  expect(issues({ ...legacy, dock: nest(9) })).toContain('dock');
});

test('名字只能起给布局里有位置的 CLI（含已关闭的），每个至多一个、1–40 字符', () => {
  expect(issues({ ...legacy, hiddenTerminalIds: [id()], terminalNames: [{ terminalId: one, name: '后端' }] })).toEqual([]);
  expect(issues({ ...legacy, terminalNames: [{ terminalId: id(), name: '外面' }] })).toContain('terminalNames');
  expect(issues({ ...legacy, terminalNames: [{ terminalId: one, name: 'a' }, { terminalId: one, name: 'b' }] })).toContain('terminalNames');
  expect(issues({ ...legacy, terminalNames: [{ terminalId: one, name: 'x'.repeat(41) }] })).toContain('terminalNames.0.name');
  expect(issues({ ...legacy, terminalNames: [{ terminalId: one, name: '   ' }] })).toContain('terminalNames.0.name');
});
