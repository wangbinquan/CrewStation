import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { RuntimeStopHistory, RuntimeStopProject, RuntimeStopReceipts } from '../../ports/runtimeStops';
import type { RuntimeSessionBinding } from '../../ports/runtimeSession';
import { runtimeProjectStops } from './runtimeStops';
import { runtimeDigitalStops } from './runtimeDigital';

interface StopResources {
  projectDeletion: { podStopReceipts(assertGrant: RuntimeStopProject['assertProjectDeletionGrant']): RuntimeStopReceipts };
  workloadSafety: RuntimeStopHistory;
}
/** The original runtime's digital, development and physical proof dependencies form one boundary. */
export function runtimeCleanupPorts<Selection, Result>(project: RuntimeStopProject, resources: StopResources,
  dev: () => { projectDeletionCleanup?: (context: ProjectDeletionContext, selection: Selection) => Promise<Result> }, bind: RuntimeSessionBinding) {
  return runtimeProjectStops(project, async (context, selection: Selection) => {
    const cleanup = dev().projectDeletionCleanup;
    if (!cleanup) throw precondition('原 DevSession 项目数字排空能力尚未装配');
    return cleanup(context, selection);
  }, resources.projectDeletion.podStopReceipts(project.assertProjectDeletionGrant), runtimeDigitalStops(project, bind), resources.workloadSafety);
}
