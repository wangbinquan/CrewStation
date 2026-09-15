import { expect, test } from 'bun:test';
import { comparisonFileStatus } from '../features/dev-session/model/comparisonFileStatus';
import { messages as zh } from '../features/dev-session/i18n/zh-CN';
import { messages as en } from '../features/dev-session/i18n/en-US';
import { translate } from '../shared/lib/i18n';
import type { Translate } from '../shared/lib/useT';

const t: Translate = (key, values) => translate(zh, key, values);

test.each([
  ['.M', '工作区：修改'], ['M.', '暂存区：修改'], ['MM', '暂存区：修改 · 工作区：修改'],
  ['MD', '暂存区：修改 · 工作区：删除'], ['A.', '暂存区：新增'], ['.D', '工作区：删除'],
  ['R.', '暂存区：重命名'], ['M', '修改'], ['R100', '重命名'], ['C75', '复制'], ['T', '类型变化'],
  ['conflict', '冲突待解决'], ['untracked', '未跟踪'], ['future-status', 'future-status'],
])('Git 状态 %s 有准确解释，未知状态保留原文', (status, expected) => {
  expect(comparisonFileStatus({ status: status!, untracked: status === 'untracked' }, t)).toBe(expected!);
});

test('相对部署的未跟踪文件保留两种信息，独立未跟踪状态不重复', () => {
  expect(comparisonFileStatus({ status: 'A', untracked: true }, t)).toBe('新增 · 未跟踪');
  expect(comparisonFileStatus({ status: '??', untracked: true }, t)).toBe('未跟踪');
});

test('英文同样区分暂存与未暂存', () => {
  expect(comparisonFileStatus({ status: 'MD', untracked: false }, (key, values) => translate(en, key, values)))
    .toBe('Staged: Modified · Unstaged: Deleted');
});
