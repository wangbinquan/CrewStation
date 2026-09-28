export interface Usage { input: number; read: number; write: number; output: number }
export interface Attempt {
  id: string; agent: string; profile: string; model: 'general' | 'code' | 'unknown'; start: number; end: number;
  state: 'done' | 'failed' | 'running'; kind: 'initial' | 'retry' | 'turn'; usage: Usage | null; complete: boolean;
}
export interface Run {
  id: string; name: string; project: string; environment: 'prod' | 'preview' | 'development';
  kind: 'business' | 'development'; state: 'done' | 'failed' | 'running'; age: number;
  wall: number; container: number; release: string; attempts: Attempt[]; source: string;
}
export interface Project { id: string; name: string; description: string; kind: string; color: string }
export const snapshot = '2026-09-28T08:00:00.000Z';
export const projects: Project[] = [
  { id: 'code', name: '代码协作助手', description: '变更分析、实现与代码评审', kind: '数字人应用', color: 'business' },
  { id: 'procurement', name: '采购审阅助手', description: '条款核对与采购风险分析', kind: '数字人应用', color: 'development' },
  { id: 'knowledge', name: '知识问答', description: '知识检索与内容治理', kind: '数字人应用', color: 'data' },
  { id: 'gitlab', name: 'GitLab 事件接入', description: '事件接收与可靠投递', kind: '事件接入', color: 'gateway' },
];
export const prices = {
  general: { label: 'Model G · 示例', input: 2, read: 0.2, write: 2.5, output: 8 },
  code: { label: 'Model C · 示例', input: 8, read: 0.8, write: 10, output: 32 },
};
export function usage(total: number): Usage { return { input: total * .42, read: total * .40, write: total * .06, output: total * .12 }; }
function attempt(id: string, agent: string, start: number, end: number, total: number | null, state: Attempt['state'] = 'done', kind: Attempt['kind'] = 'initial', model: Attempt['model'] = 'code'): Attempt {
  return { id, agent, start, end, state, kind, model: total === null ? 'unknown' : model, profile: total === null ? '通用终端 · r2' : model === 'code' ? '代码分析 · r3' : '通用推理 · r6', usage: total === null ? null : usage(total), complete: total !== null && state !== 'running' };
}
export const runs: Run[] = [
  { id: 'CS-0928-01', name: '认证模块变更与回归验证', project: 'code', environment: 'prod', kind: 'business', state: 'done', age: 1, wall: 1120, container: 1600, release: 'v2.4.1', source: '业务应用上报结果', attempts: [
    attempt('a1', '规划 Agent', 40, 130, 12000, 'done', 'initial', 'general'),
    attempt('a2', '依赖分析 Agent', 130, 430, 31000, 'done', 'initial', 'general'),
    attempt('a3', '实现 Agent', 180, 500, 28000, 'failed'),
    attempt('a4', '实现 Agent', 540, 920, 64000, 'done', 'retry'),
    attempt('a5', '验证 Agent', 700, 1120, 46000),
    attempt('a6', '规划 Agent', 940, 1000, 7000, 'done', 'turn', 'general'),
  ] },
  { id: 'CS-0928-02', name: 'API 文档开发会话', project: 'code', environment: 'development', kind: 'development', state: 'done', age: 3, wall: 780, container: 12400, release: 'feature/api-docs', source: '平台执行结束', attempts: [attempt('b1', '开发 Agent', 30, 780, 28000)] },
  { id: 'CS-0928-03', name: '合并请求 #382 审查', project: 'code', environment: 'prod', kind: 'business', state: 'failed', age: 5, wall: 620, container: 1000, release: 'v2.4.1', source: '业务应用上报结果', attempts: [attempt('c1', '评审 Agent', 40, 300, 16000, 'failed'), attempt('c2', '评审 Agent', 340, 620, 14000, 'failed', 'retry')] },
  { id: 'CS-0928-04', name: '兼容性迁移演练', project: 'code', environment: 'preview', kind: 'business', state: 'running', age: .2, wall: 660, container: 660, release: 'v2.5.0-rc1', source: '进行中快照', attempts: [attempt('d1', '实现 Agent', 35, 660, 9200, 'running')] },
  { id: 'CS-0928-05', name: '通用 CLI 调试会话', project: 'code', environment: 'development', kind: 'development', state: 'done', age: 8, wall: 420, container: 8600, release: 'feature/compat', source: '平台执行结束', attempts: [attempt('e1', 'CLI 执行实例', 20, 420, null)] },
  { id: 'CS-0928-06', name: '采购合同初审', project: 'procurement', environment: 'prod', kind: 'business', state: 'done', age: 2, wall: 900, container: 1200, release: 'v1.8.0', source: '业务应用上报结果', attempts: [attempt('f1', '条款 Agent', 25, 520, 54000, 'done', 'initial', 'general'), attempt('f2', '风险 Agent', 200, 760, 42000), attempt('f3', '汇总 Agent', 780, 900, 17000, 'done', 'initial', 'general')] },
  { id: 'CS-0928-07', name: '条款比对执行失败', project: 'procurement', environment: 'prod', kind: 'business', state: 'failed', age: 4, wall: 450, container: 700, release: 'v1.8.0', source: '业务应用上报结果', attempts: [attempt('g1', '条款 Agent', 40, 450, 21000, 'failed', 'initial', 'general')] },
  { id: 'CS-0928-08', name: '知识索引更新', project: 'knowledge', environment: 'prod', kind: 'business', state: 'done', age: 6, wall: 720, container: 800, release: 'v3.1.2', source: '业务应用上报结果', attempts: [attempt('h1', '检索 Agent', 15, 180, 10000, 'done', 'initial', 'general'), attempt('h2', '治理 Agent', 180, 640, 22000, 'done', 'initial', 'general'), attempt('h3', '校验 Agent', 500, 720, 12000, 'done', 'initial', 'general')] },
  { id: 'CS-0928-09', name: '问答评估', project: 'knowledge', environment: 'preview', kind: 'business', state: 'done', age: 7, wall: 240, container: 400, release: 'v3.2.0-rc1', source: '业务应用上报结果', attempts: [attempt('i1', '评估 Agent', 20, 240, 17000, 'done', 'initial', 'general')] },
  { id: 'CS-0928-10', name: '事件处理验证命令', project: 'gitlab', environment: 'prod', kind: 'business', state: 'done', age: 2.5, wall: 18, container: 120, release: 'v1.2.0', source: '业务应用上报结果', attempts: [] },
  { id: 'CS-0925-11', name: '历史版本变更审查', project: 'code', environment: 'prod', kind: 'business', state: 'done', age: 72, wall: 800, container: 1000, release: 'v2.4.0', source: '业务应用上报结果', attempts: [attempt('j1', '评审 Agent', 40, 800, 62000)] },
  { id: 'CS-0926-12', name: '采购目录归档分析', project: 'procurement', environment: 'prod', kind: 'business', state: 'done', age: 46, wall: 1100, container: 1350, release: 'v1.7.2', source: '业务应用上报结果', attempts: [attempt('k1', '条款 Agent', 20, 700, 47000, 'done', 'initial', 'general'), attempt('k2', '风险 Agent', 420, 1100, 29000)] },
];
export const platformExecutions = [attempt('sys1', '档位验证', 0, 90, 8000)];
export const environmentLabels = { all: '全部环境', prod: '正式', preview: '待验证', development: '开发' };
export const kindLabels = { business: '业务任务', development: '开发会话' };
export const stateLabels = { done: '已完成', failed: '失败', running: '执行中' };
