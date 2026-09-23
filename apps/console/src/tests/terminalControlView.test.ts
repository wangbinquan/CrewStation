import { expect, test } from 'bun:test';
import type { NativeAttachmentState } from '../features/dev-session/model/native/nativeTerminalAttachment';
import { terminalControlView } from '../features/dev-session/model/native/terminalControlView';

const ready: NativeAttachmentState = { phase: 'ready', controlled: false, truncated: false, refused: false };
const zhang = { userId: 'user-zhang', name: '张三' };

test('输入控制状态条：自己持有、空闲、自己另一窗口、别人带名字、看不到是谁、没有开发权限', () => {
  expect(terminalControlView({ ...ready, controlled: true, control: { held: true, holder: zhang, revision: 1 } }, 'user-zhang', true)).toEqual({ tone: 'mine' });
  expect(terminalControlView({ ...ready, control: { held: false, revision: 2 } }, 'user-zhang', true)).toEqual({ tone: 'free' });
  expect(terminalControlView({ ...ready, control: { held: true, holder: zhang, revision: 3 } }, 'user-zhang', true)).toEqual({ tone: 'self-elsewhere' });
  expect(terminalControlView({ ...ready, control: { held: true, holder: zhang, revision: 3 } }, 'user-li', true)).toEqual({ tone: 'other', holder: zhang });
  expect(terminalControlView({ ...ready, control: { held: true, revision: 3 } }, 'user-li', true)).toEqual({ tone: 'unknown-other' });
  expect(terminalControlView({ ...ready, control: { held: false, revision: 2 } }, 'user-li', false)).toEqual({ tone: 'readonly' });
  // 没有开发权限的人也要看到是谁在输入。
  expect(terminalControlView({ ...ready, control: { held: true, holder: zhang, revision: 3 } }, 'user-li', false)).toEqual({ tone: 'other', holder: zhang });
});

test('旧 Runner 没有控制状态：没被拒就当可以点，被拒过才提示其他窗口在输入；未就绪不给状态条', () => {
  expect(terminalControlView(ready, 'user-li', true)).toEqual({ tone: 'free' });
  expect(terminalControlView({ ...ready, refused: true }, 'user-li', true)).toEqual({ tone: 'unknown-other' });
  expect(terminalControlView({ ...ready, phase: 'attaching' }, 'user-li', true)).toBeUndefined();
  expect(terminalControlView({ ...ready, phase: 'error', error: 'x' }, 'user-li', true)).toBeUndefined();
});
