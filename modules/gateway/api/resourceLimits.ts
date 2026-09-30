import type { ProjectRateLimitsDto, ResourceValues } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

export const gatewayAllocationRevision = (value: ProjectRateLimitsDto, platformRevision: number) => jsonHash({ projectRevision: value.revision, override: value.override, effective: value.effective, platformRevision });
export function projectRateLimitValues(value: ProjectRateLimitsDto['effective']): ResourceValues {
  return { userAverage: value.userDomain.perUser.average, userBurst: value.userDomain.perUser.burst, hostAverage: value.userDomain.perHost.average, hostBurst: value.userDomain.perHost.burst, sourceAverage: value.serviceDomain.perSource.average, sourceBurst: value.serviceDomain.perSource.burst, targetAverage: value.serviceDomain.perTarget.average, targetBurst: value.serviceDomain.perTarget.burst };
}
