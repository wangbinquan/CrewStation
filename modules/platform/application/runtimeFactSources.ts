import type { RuntimeFactPage, RuntimeFactQuery } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { RuntimeFactOwners } from '../ports/runtimeFactSources';

export function runtimeFactSources<Snapshot>(owners: RuntimeFactOwners<Snapshot>) {
  return async (executor: Snapshot, query: RuntimeFactQuery): Promise<RuntimeFactPage> => {
    const pages = await Promise.all([
      query.sourceKind === 'development-agent' ? { items: [], partial: false } : owners.business(executor, query),
      query.sourceKind === 'business-task' ? { items: [], partial: false } : owners.development(executor, query),
    ]);
    const items = pages.flatMap((page) => page.items), ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) throw conflict('两个运行来源返回重复的对象 ID');
      ids.add(item.id);
    }
    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
    const selected = items.slice(0, 200);
    let remaining = 2000 - selected.filter((task) => task.source?.kind === 'development-agent').reduce((sum, task) => sum + task.attempts.length, 0), clipped = false;
    const bounded = selected.map((task) => {
      if (task.source?.kind === 'development-agent') return task;
      const attempts = task.attempts.slice(0, Math.max(0, remaining)); remaining -= attempts.length;
      const partial = attempts.length < task.attempts.length; clipped ||= partial;
      return partial ? { ...task, attempts, attemptsPartial: true } : task;
    });
    return { items: bounded, partial: clipped || pages.some((page) => page.partial) || items.length > 200, sourceScope: 'project-executions' };
  };
}
