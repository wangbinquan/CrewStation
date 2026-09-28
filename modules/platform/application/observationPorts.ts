import type { ObservationUsageJournal, ObservationUsageOwner, ObservationAdmissionInput, ObservationPriceOwner, ObservationProfiles, ObservationProjects, ObservationResourceLedger, ObservationTasks } from '../ports/executionObservations';
import { precondition } from '@crewstation/kernel';

/** Use owner APIs to bind an execution to its project and expose the pricing catalog. */
export function observationPorts(tasks: ObservationTasks, projects: ObservationProjects, runtime: ObservationProfiles) {
  return {
    executionAccess: { task: async (...[caller, taskId]: Parameters<ObservationTasks['getTask']>) => {
      const task = await tasks.getTask(caller, taskId), service = await projects.resolveServiceById(task.serviceId);
      if (!service) throw precondition('业务任务所属项目服务不存在');
      return { projectId: service.projectId, taskId: task.id };
    } },
    pricingProfiles: { list: async (...[actor]: Parameters<ObservationProfiles['listProfiles']>) => (await runtime.listProfiles(actor)).items.map((profile) => ({
      id: profile.id, name: profile.name, revision: profile.revision, protocol: profile.protocol, model: profile.model ?? null,
    })) },
  };
}

export function businessObservationAdmission(resolve: () => ObservationPriceOwner | undefined) {
  return { accept: async (input: ObservationAdmissionInput) => {
    const owner = resolve(); if (!owner) throw precondition('执行价格受理尚未装配');
    await owner.acceptExecutionPrice(input);
  } };
}

/** Preserve the resource owner's service-slot history without exposing storage. */
export function observationSlotRecords(resources: ObservationResourceLedger) {
  return { slotRecords: async (...[projectId]: [Parameters<ObservationResourceLedger['list']>[0]['projectId']]) =>
    (await resources.list({ projectId, kind: 'service-slot', includeStopped: true })).map((record) => ({
      physical: record.display['physical'] ?? '', children: record.children, conditions: record.conditions, phaseSince: record.phaseSince.toISOString(),
    })) };
}

export function observationUsageSource(owner: ObservationUsageOwner, journal: ObservationUsageJournal) {
  return { measurement: journal.readBusinessUsageMeasurement, next: journal.nextBusinessUsageSource, acknowledge: journal.acknowledgeBusinessUsageSource, resolve: owner.resolveUsageSource };
}
