import { CapabilityDescriptionDtoSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';

/** 能力说明聚合描述：一次取回，各处按需取段落；同一个查询键，页面里多处使用只请求一次。 */
export function useCapabilityDescription(projectId: string) {
  const t = useT();
  return useApiQuery(queryKeys.capabilities(projectId), async () => {
    const parsed = CapabilityDescriptionDtoSchema.safeParse(await api.capabilities.describe(projectId));
    if (!parsed.success) throw new Error(t('capabilities.invalidResponse'));
    return parsed.data;
  });
}
