import { z } from 'zod';
import type { Actor, ProjectId, ProjectPageEntry, ProjectPageQuery, ProjectSummary, ProjectSummaryDetail } from '@crewstation/contracts';
import { DevelopmentSummarySchema, ProjectPageQuerySchema, ProjectSummaryDetailSchema, ProjectSummarySchema, ReleaseDtoSchema, TesterPreviewSlotSchema, TrafficSwitchDtoSchema } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { notFound, validation } from '@crewstation/kernel';
import type { ProjectSummarySources } from '../ports/projectSummaries';
import { readPart, runSummaryReads, SummaryHealthSchema, SummarySlotsSchema, unavailablePart } from './summaryReads';
import { readDevelopmentSummary } from './developmentSummary';

export function projectSummaryUseCases(sources: ProjectSummarySources, clock: Clock, budgetMs = 2500) {
  const initial = (entry: ProjectPageEntry): ProjectSummaryDetail => {
    const part = entry.role === 'tester' ? { status: 'restricted' as const, checkedAt: clock.now().toISOString() } : unavailablePart(clock);
    return { ...entry, ...(entry.role === 'tester' ? { preview: unavailablePart(clock) } : {}), development: part, slots: part, health: part, releases: part, switches: part, checkedAt: clock.now().toISOString() };
  };
  const collect = (actor: Actor, item: ProjectSummaryDetail, detail: boolean) => {
    const { id, serviceId } = item.project;
    if (item.role === 'tester') return [async () => {
      item.preview = serviceId ? await readPart(TesterPreviewSlotSchema.nullable(), () => sources.preview(actor, serviceId), clock) : unavailablePart(clock, 'not-provided');
    }];
    const jobs = [async () => { item.development = await readPart(DevelopmentSummarySchema.nullable(), () => readDevelopmentSummary(sources, actor, id, serviceId), clock); }];
    if (!serviceId) { item.slots = item.health = item.releases = item.switches = unavailablePart(clock, 'not-provided'); return jobs; }
    jobs.push(async () => { item.slots = await readPart(SummarySlotsSchema, () => sources.slots(actor, serviceId), clock); });
    jobs.push(async () => { item.health = await readPart(SummaryHealthSchema, () => sources.health(actor, id), clock); });
    if (detail) {
      jobs.push(async () => { item.releases = await readPart(z.array(ReleaseDtoSchema).max(5), async () => {
        const rows = await sources.releases(actor, serviceId);
        if (rows.length > 50 || rows.some((r) => r.serviceId !== serviceId) || new Set(rows.map((r) => r.id)).size !== rows.length) return undefined;
        return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 5);
      }, clock); });
      jobs.push(async () => { item.switches = await readPart(z.array(TrafficSwitchDtoSchema).max(5), async () => {
        const rows = await sources.switches(actor, serviceId);
        if (rows.length > 50 || rows.some((r) => r.serviceId !== serviceId) || new Set(rows.map((r) => r.id)).size !== rows.length) return undefined;
        return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 5);
      }, clock); });
    }
    return jobs;
  };
  const aggregate = async (actor: Actor, entries: ProjectPageEntry[], detail: boolean) => {
    const working = entries.map(initial);
    const groups = working.map((item) => collect(actor, item, detail));
    const jobs = Array.from({ length: detail ? 5 : 3 }, (_, index) => groups.flatMap((group) => group[index] ? [group[index]!] : [])).flat();
    await runSummaryReads(jobs, budgetMs);
    const current = await sources.read(actor, entries.map((entry) => entry.project.id));
    return working.flatMap((item) => {
      const fresh = current.find((entry) => entry.project.id === item.project.id);
      if (!fresh) return [];
      // 返回前重新读取当前页的作用域和角色；清除已失去读取权或服务身份改变的旧材料。
      const result = fresh.role !== item.role || fresh.project.serviceId !== item.project.serviceId ? initial(fresh) : { ...item, ...fresh };
      return [ProjectSummaryDetailSchema.parse({ ...result, checkedAt: clock.now().toISOString() })];
    });
  };
  return {
    listProjectSummaries: async (actor: Actor, raw: ProjectPageQuery) => {
      const parsed = ProjectPageQuerySchema.safeParse(raw); if (!parsed.success) throw validation('项目查询参数无效');
      const page = await sources.list(actor, parsed.data);
      if (page.items.length > parsed.data.limit || new Set(page.items.map((i) => i.project.id)).size !== page.items.length) throw validation('项目分页回执无效');
      const items: ProjectSummary[] = (await aggregate(actor, page.items, false)).map((item) => ProjectSummarySchema.parse(item));
      return { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    },
    getProjectSummary: async (actor: Actor, projectId: ProjectId) => {
      const entry = await sources.get(actor, projectId);
      if (entry.project.id !== projectId) throw validation('项目回执不匹配');
      const result = (await aggregate(actor, [entry], true))[0]; if (!result) throw notFound('项目', projectId); return result;
    },
  };
}
