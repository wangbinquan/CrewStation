import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';

/** 服务的源码仓库绑定：项目信息卡的「仓库」一行与源码仓库卡读同一份（同一个查询键与取数函数，只请求一次）；开通未完成没有服务时不读。 */
export function useRepositoryBinding(serviceId: string | undefined) {
  return useApiQuery(queryKeys.repository(serviceId ?? ''), () => api.services.getRepository(serviceId!), { enabled: serviceId !== undefined });
}
