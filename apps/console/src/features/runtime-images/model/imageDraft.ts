import type { RuntimeImageUsage } from '@crewstation/contracts';

/** 完整配方留在源码；界面只登记源码位置及初始化／工具验证材料。 */
export function revisionDraft(usage: RuntimeImageUsage = 'task'): string {
  return JSON.stringify({ source: { kind: 'source', repositoryBindingId: '', ref: 'main', context: '.', dockerfile: 'Dockerfile', architecture: 'linux/amd64', usage, buildArgs: {}, secrets: [] }, initializer: { steps: [], env: {}, secrets: [] }, tools: [] }, null, 2);
}
export function validationDraft(usage: RuntimeImageUsage): string {
  return JSON.stringify(usage === 'task' ? { usage } : usage === 'agent' ? { usage, profile: { profileId: '', revision: 1 } } : { usage, command: ['bun', 'run', 'start'], port: 3000, healthPath: '/health' }, null, 2);
}
