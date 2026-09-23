import type { RepositoryBindingDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';

/** 服务的源码仓库绑定：项目信息卡的「仓库」一行与源码仓库卡读同一份（同一个查询键与取数函数，只请求一次）；开通未完成没有服务时不读。 */
export function useRepositoryBinding(serviceId: string | undefined) {
  return useApiQuery(queryKeys.repository(serviceId ?? ''), () => api.services.getRepository(serviceId!), { enabled: serviceId !== undefined });
}

/**
 * 浏览器打开仓库用的地址：GitLab 自报的网页地址；平台还没从 GitLab 读到时退回克隆地址（2026-09-23 作者裁定）。
 * 克隆地址由平台访问 GitLab 的配置拼出，在本机是容器里才解析得了的 host.docker.internal，浏览器打不开。
 */
export function repositoryWebUrl(binding: RepositoryBindingDto): string {
  return binding.webUrl ?? binding.httpUrl;
}
