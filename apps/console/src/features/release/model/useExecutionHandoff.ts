import { useEffect } from 'react';
import { TrafficSwitchDtoSchema } from '@crewstation/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';

export const executionHandoffKey = (serviceId: string) => ['services', serviceId, 'execution-handoff'] as const;
/** Resumes observing after navigation or reload; an accepted switch is not a completed handoff. */
export function useExecutionHandoff(serviceId: string) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: executionHandoffKey(serviceId), queryFn: async () => {
    const result = await api.services.latestExecutionHandoff(serviceId);
    return result === null ? null : TrafficSwitchDtoSchema.parse(result);
  }, refetchInterval: (value) => value.state.data?.handoff?.stage !== 'complete' && value.state.data?.handoff ? 3_000 : false });
  const result = query.data, stage = result?.handoff?.stage;
  useEffect(() => {
    if (stage === 'activating' || stage === 'complete') {
      for (const queryKey of [queryKeys.slots(serviceId), queryKeys.trafficSwitches(serviceId)]) void client.invalidateQueries({ queryKey });
    }
  }, [client, serviceId, result?.id, stage]);
  return { ...query, pending: !!stage && stage !== 'complete' };
}
