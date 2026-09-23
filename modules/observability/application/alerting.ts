import type { Actor, AlertDto, ProjectId } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import type { AlertCandidate } from '../domain/alertRules';
import { alertsFromHealth, resolvedKeysForHealthy } from '../domain/alertRules';
import { healthOf } from '../domain/health';
import type { ObservabilityUseCaseDeps } from './dependencies';
import { alertToDto } from '../ports/repositories';

/** 告警：健康态巡检触发与自动恢复，只在工作台告警页查看；首版不做告警通知（D61）。 */
export function alertingUseCases(deps: ObservabilityUseCaseDeps) {
  const { alerts, authorizer, services, slots, cluster, clock } = deps;

  const fire = async (projectId: ProjectId, candidate: AlertCandidate): Promise<boolean> => {
    if ((await alerts.firing(projectId)).some((a) => a.key === candidate.key)) return false;
    await alerts.fire({ id: newId('alr'), projectId, type: candidate.type, key: candidate.key, state: 'firing', detail: candidate.detail, firedAt: clock.now() });
    return true;
  };

  return {
    fire,
    listAlerts: async (actor: Actor, projectId: ProjectId): Promise<AlertDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return (await alerts.list(projectId, 100)).map(alertToDto);
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
