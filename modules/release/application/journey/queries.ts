import type { Actor, LegacyReleaseJourney, ReleaseId, ReleaseJourneyDetail, ReleaseJourneyHistory, ReleaseJourneyPage, ReleaseJourneyPageRequest, ReleaseJourneySummary, ServiceId } from '@crewstation/contracts';
import { ReleaseJourneyPageRequestSchema, ResourceIdSchema, ServiceIdSchema } from '@crewstation/contracts';
import { notFound, validation } from '@crewstation/kernel';
import { z } from 'zod';
import { journeyTerminal, releaseTargetRevision } from '../../domain/journey/journey';
import type { ReleaseJourney } from '../../domain/journey/journey';
import { journeyStages, legacyJourneyStages } from '../../domain/journey/projection';
import { handoffSwitchDto } from '../../domain/executionHandoff';
import { standbyOf } from '../../domain/slots';
import { slotRolloutOf } from '../../domain/ledgerProjection';
import type { Release } from '../../domain/release';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { loadSlotDtos } from '../queries';
import { releaseToDto, switchToDto } from '../toDto';

type Deps = Pick<ReleaseUseCaseDeps, 'uow' | 'authorizer' | 'services' | 'hosts'>;
const cursorSchema = z.object({ serviceId: ServiceIdSchema, at: z.iso.datetime(), id: ResourceIdSchema, recordKind: z.enum(['journey', 'legacy']), tag: z.string().optional(), filter: z.enum(['active', 'ended']).optional() }).strict();
export const journeySummary = (journey: ReleaseJourney): ReleaseJourneySummary => ({ recordKind: 'journey', id: journey.id, snapshot: journey.snapshot, status: journey.status, revision: journey.revision, updatedAt: journey.updatedAt });
const legacy = (release: Release): LegacyReleaseJourney => ({ recordKind: 'legacy', release: releaseToDto(release, undefined), provenance: 'retained-release', stages: legacyJourneyStages(release) });
function cursorOf(serviceId: ServiceId, raw?: string, tag?: string, filter?: 'active' | 'ended') {
  if (!raw) return undefined;
  try {
    const value = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (value.serviceId !== serviceId || value.tag !== tag || value.filter !== filter) throw new Error('cursor scope');
    return value;
  } catch { throw validation('发布历史游标无效或不属于当前服务'); }
}

export async function readJourney(deps: Deps, actor: Actor, id: string): Promise<ReleaseJourneyDetail> {
  ResourceIdSchema.parse(id);
  const stored = await deps.uow.read.journeys.snapshot(id);
  if (!stored) throw notFound('发布流程', id);
  const { journey, events } = stored;
  const { projectId, serviceId, releaseId } = journey.snapshot;
  await deps.authorizer.authorize(actor, projectId, 'view');
  const svc = await deps.services.resolveServiceById(serviceId), release = await deps.uow.read.releases.getById(releaseId);
  if (!svc || svc.projectId !== projectId || !release || release.serviceId !== serviceId || release.projectId !== projectId) throw notFound('发布流程来源', id);
  const slots = await deps.uow.read.slots.get(serviceId), dtos = slots ? await loadSlotDtos(deps.uow.read, slots, svc.slug, deps.hosts) : [];
  const target = slots?.[standbyOf(slots.active)], targetRevision = target?.releaseId === release.id ? releaseTargetRevision(release, target) : undefined;
  const rollout = target?.workload ? slotRolloutOf(await deps.uow.read.ledger?.slot(serviceId, target.physical)) : target;
  const matches = !!targetRevision && targetRevision === journey.targetRevision && rollout?.state === 'ready' && rollout.readyReplicas > 0 && dtos.some((slot) => slot.name === 'preview' && slot.releaseId === releaseId && slot.state === 'ready' && slot.readyReplicas > 0);
  let trafficSwitch = journey.launch?.operation;
  if (trafficSwitch?.handoff) { const handoff = await deps.uow.read.handoffs.get(trafficSwitch.id); if (handoff) trafficSwitch = handoffSwitchDto(handoff); }
  return { ...journeySummary(journey), events, stages: journeyStages(events),
    ...(journey.verification ? { verification: journey.verification } : {}), ...(trafficSwitch ? { trafficSwitch } : {}),
    continuation: { canVerify: matches && journey.status === 'awaiting-verification', canLaunch: matches && journey.status === 'awaiting-confirmation' && !journey.launch,
      expectedActiveReleaseId: slots?.[slots.active].releaseId ?? null, ...(targetRevision ? { targetRevision } : {}),
      ...(!matches && !journeyTerminal(journey) ? { reason: '等待就绪或原待验证部署已变化，请核对当前版本' } : {}) },
    release: releaseToDto(release, slots), slots: dtos };
}

export function journeyQueries(deps: Deps) {
  return {
    getJourney: (actor: Actor, id: string) => readJourney(deps, actor, id),
    listJourneys: async (actor: Actor, serviceId: ServiceId, raw: ReleaseJourneyPageRequest): Promise<ReleaseJourneyPage> => {
      const input = ReleaseJourneyPageRequestSchema.parse(raw), svc = await deps.services.resolveServiceById(serviceId);
      if (!svc) throw notFound('服务', serviceId);
      await deps.authorizer.authorize(actor, svc.projectId, 'view');
      const rows = await deps.uow.read.journeys.page(serviceId, input.limit + 1, cursorOf(serviceId, input.cursor, input.tag, input.filter), input.tag, input.filter);
      const selected = rows.slice(0, input.limit), items: ReleaseJourneyPage['items'] = [];
      for (const row of selected) {
        if (row.recordKind === 'journey') { const value = await deps.uow.read.journeys.get(row.id); if (value?.snapshot.projectId === svc.projectId) items.push(journeySummary(value)); else throw notFound('发布流程来源', row.id); }
        else { const value = await deps.uow.read.releases.getById(row.id as ReleaseId); if (value?.projectId === svc.projectId) items.push(legacy(value)); else throw notFound('发布来源', row.id); }
      }
      const hasMore = rows.length > input.limit, last = selected.at(-1);
      return { items, hasMore, ...(hasMore && last ? { nextCursor: Buffer.from(JSON.stringify({ ...last, serviceId, ...(input.tag ? { tag: input.tag } : {}), ...(input.filter ? { filter: input.filter } : {}) })).toString('base64url') } : {}) };
    },
    journeyHistory: async (actor: Actor, releaseId: ReleaseId): Promise<ReleaseJourneyHistory> => {
      const release = await deps.uow.read.releases.getById(releaseId);
      if (!release) throw notFound('发布', releaseId);
      await deps.authorizer.authorize(actor, release.projectId, 'view');
      if ((await deps.services.resolveServiceById(release.serviceId))?.projectId !== release.projectId) throw notFound('发布来源', releaseId);
      const journeys = await deps.uow.read.journeys.byRelease(releaseId);
      const events = await deps.uow.read.slotEvents.listByRelease(releaseId);
      return { journeys: journeys.map(journeySummary), ...(!journeys.some((j) => j.snapshot.kind === 'publish') ? { legacy: legacy(release) } : {}),
        trafficSwitches: (await deps.uow.read.switches.listByRelease(releaseId)).map(switchToDto),
        slotEvents: events.map((e) => ({ ...e, at: e.at.toISOString(), ...(e.deadline ? { deadline: e.deadline.toISOString() } : { deadline: undefined }) })) };
    },
  };
}
