import type { Actor, AlertDto, AlertSubscriptionDto, ProjectId, UserId } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import type { AlertCandidate } from '../domain/alertRules';
import { alertsFromHealth, resolvedKeysForHealthy } from '../domain/alertRules';
import { healthOf } from '../domain/health';
import type { ObservabilityUseCaseDeps } from './dependencies';
import { alertToDto } from '../ports/repositories';

/** 告警：健康态巡检触发与自动恢复；项目级订阅决定通知谁（G22）。 */
export function alertingUseCases(deps: ObservabilityUseCaseDeps) {
  const { alerts, subscriptions, authorizer, services, slots, cluster, notifier, clock, logger } = deps;

  const fire = async (projectId: ProjectId, candidate: AlertCandidate): Promise<boolean> => {
    if ((await alerts.firing(projectId)).some((a) => a.key === candidate.key)) return false;
    await alerts.fire({ id: newId('alr'), projectId, type: candidate.type, key: candidate.key, state: 'firing', detail: candidate.detail, firedAt: clock.now() });
    await notifier.notify(projectId, `[告警] ${candidate.detail}`).catch((e: unknown) => logger.warn('alert notify failed', { error: String(e) }));
    return true;
  };

  return {
    fire,
    listAlerts: async (actor: Actor, projectId: ProjectId): Promise<AlertDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await alerts.list(projectId, 100)).map(alertToDto);
    },
    listSubscriptions: async (actor: Actor, projectId: ProjectId): Promise<AlertSubscriptionDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await subscriptions.list(projectId)).map((s) => ({ projectId: s.projectId, userId: s.userId, channel: s.channel, ...(s.target ? { target: s.target } : {}) }));
    },
    subscribe: async (actor: Actor, projectId: ProjectId, input: { userId: UserId; channel: 'workbench' | 'webhook'; target?: string }): Promise<void> => {
      await authorizer.authorize(actor, projectId, 'manage-alerts');
      await subscriptions.upsert({ projectId, userId: input.userId, channel: input.channel, ...(input.target ? { target: input.target } : {}) });
    },
    unsubscribe: async (actor: Actor, projectId: ProjectId, userId: UserId): Promise<void> => {
      await authorizer.authorize(actor, projectId, 'manage-alerts');
      await subscriptions.remove(projectId, userId);
    },
    /** 巡检：对每个项目的两槽算健康态，触发或恢复相应告警。 */
    sweepProject: async (projectId: ProjectId): Promise<number> => {
      const svc = await services.resolveServiceOfProject(projectId);
      const roles = svc ? await slots.slotRoles(svc.serviceId) : undefined;
      if (!svc || !roles) return 0;
      let changed = 0;
      for (const role of ['prod', 'preview'] as const) {
        const o = await cluster.observeDeployment(svc.namespace, `${svc.name}-${roles[role]}`);
        if (!o || o.replicas === 0) continue;
        const state = healthOf(o);
        for (const candidate of alertsFromHealth(role, state)) if (await fire(projectId, candidate)) changed += 1;
        if (state === 'healthy') for (const key of resolvedKeysForHealthy(role)) changed += (await alerts.resolve(projectId, key, clock.now())).length;
      }
      return changed;
    },
  };
}
