import type { ServiceId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { RepositoryBinding } from '../domain/repositoryBinding';
import type { UnitOfWork } from '../ports/unitOfWork';

export async function loadBinding(uow: UnitOfWork, serviceId: ServiceId): Promise<RepositoryBinding> {
  const binding = await uow.read.bindings.getByServiceId(serviceId);
  if (!binding) throw notFound('仓库绑定', serviceId);
  return binding;
}

/** 分支、标签、凭据与代推都要求仓库已就绪；creating／failed 时把状态与失败原因带给调用方。 */
export async function loadReadyBinding(uow: UnitOfWork, serviceId: ServiceId): Promise<RepositoryBinding> {
  const binding = await loadBinding(uow, serviceId);
  if (binding.state !== 'ready') {
    throw precondition(`仓库 ${binding.pathWithNamespace} 尚未就绪（${binding.state}）`, { state: binding.state, ...(binding.message ? { message: binding.message } : {}) });
  }
  return binding;
}
