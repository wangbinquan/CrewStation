import type { RuntimeStopHistory, RuntimeStopProject, RuntimeStopReceipts } from '../../ports/runtimeStops';
import type { RuntimeSessionBinding } from '../../ports/runtimeSession';
import { runtimeProjectStops } from './runtimeStops';
import { runtimeDigitalStops } from './runtimeDigital';

interface StopResources {
  projectDeletion: { podStopReceipts(assertGrant: RuntimeStopProject['assertProjectDeletionGrant']): RuntimeStopReceipts };
  workloadSafety: RuntimeStopHistory;
}
/** The original runtime's digital and physical proof dependencies form one boundary. */
export function runtimeCleanupPorts(project: RuntimeStopProject, resources: StopResources, bind: RuntimeSessionBinding) {
  return runtimeProjectStops(project, resources.projectDeletion.podStopReceipts(project.assertProjectDeletionGrant), runtimeDigitalStops(project, bind), resources.workloadSafety);
}
