import type { TranscriptLine } from '../../../../apps/console/src/features/dev-session/model/agentTranscript';

export const line = (id: string, type: TranscriptLine['type'], body: string): TranscriptLine => ({ id, type, body, at: '2026-10-15T09:54:00.000Z', failed: false });
export const initialLines: TranscriptLine[] = [
  line('u1', 'user-message', '做一个好看的贪吃蛇游戏，支持键盘和手机操作。'),
  line('a1', 'text', '已经完成第一版。\n\n- 深色棋盘与实时计分\n- 方向键、WASD 和手机方向按钮\n- 暂停、重新开始和最高分保存\n\n可以在右侧预览，继续告诉我想调整哪里。'),
  line('u2', 'user-message', '棋盘再大一点，桌面尽量一屏放下。'),
  { ...line('t1', 'tool-end', 'bash'), tool: { name: 'bash', callId: 'prototype-tool-1', input: { command: 'bun test src/game/snake.test.ts' }, output: '16 pass\n0 fail\n53 expect() calls' } },
  line('a2', 'text', '棋盘已按剩余空间自适应缩放，手机方向按钮保持足够大。\n\n游戏规则测试全部通过。你可以接着调整，前面的需求和修改记录都还在。'),
];

export type DemoStatus = 'ready' | 'running' | 'interrupted' | 'missing';
export interface DemoState { draft: string; lines: TranscriptLine[]; status: DemoStatus; epoch: number; executions: number }
const key = 'crewstation-rfc041-prototype-v1';
export function readDemo(): DemoState {
  try { const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (saved && Array.isArray(saved.lines) && typeof saved.draft === 'string' && ['ready', 'running', 'interrupted', 'missing'].includes(saved.status)) return saved; } catch { /* 原型存储不可用时使用初始示例。 */ }
  return { draft: '', lines: initialLines, status: 'ready', epoch: 1, executions: 1 };
}
export function saveDemo(state: DemoState): void { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* 本页仍可体验。 */ } }
