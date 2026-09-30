import type { ResourceCatalogPorts } from '../../ports/resourceCatalogs';
import type { ResourceTargetDescription } from '@crewstation/contracts';
import { actions, catalogAdapter, pagedCatalog, resourceCommand } from './catalog';

export function executionResourceCatalogs(p: ResourceCatalogPorts) {
  const compute = catalogAdapter('compute-profile', async (id) => {
    const [profiles, policy] = await Promise.all([p.compute.listProfiles(p.actor), p.compute.getProjectComputePolicy(p.actor, id)]);
    return profiles.items.flatMap((profile) => {
      const owned = ((policy.policy.mode === 'inherit' && profile.defaultVisible !== false) || policy.policy.allowedProfiles.includes(profile.id) || policy.policy.additionalProfiles?.includes(profile.id)) && !policy.policy.excludedProfiles?.includes(profile.id);
      const view: ResourceTargetDescription = { target: { resourceType: 'compute-profile', resourceId: profile.id, action: 'grant' }, name: profile.name, description: profile.description, revision: p.revisions.compute(policy.revision, profile), current: {}, fields: [], impact: ['授权后可供新的 Agent、CLI 或业务子任务选择', '不切换已有运行实例或发布的固定修订'], owned: Boolean(owned), available: profile.enabled,
        ...(!profile.enabled ? { reason: '档位已停用' } : {}), source: policy.policy.additionalProfiles?.includes(profile.id) || policy.policy.mode === 'restricted' ? 'granted' : 'inherited', facts: [{ label: '用途', value: profile.protocol === 'terminal' ? 'CLI 终端' : 'Agent / 子任务' }, { label: '修订', value: String(profile.revision) }, { label: '项目默认', value: policy.effectiveDefaultProfile === profile.id ? '是' : '否' }] };
      return [...actions(view), ...(owned && profile.protocol !== 'terminal' ? [{ ...view, actionLabel: '设置项目默认', target: { ...view.target, action: 'set-default' as const }, current: { inheritDefault: false }, fields: policy.policy.mode === 'inherit' ? [{ key: 'inheritDefault', label: '恢复平台默认档位', type: 'boolean' as const, required: true }] : [{ key: 'inheritDefault', label: '恢复平台默认（当前为受限模式）', type: 'boolean' as const, required: true }], impact: ['改变后续使用 default 的执行选择；已有实例保持固定档位', '平台默认范围继续继承，项目默认覆盖可单独恢复'] }] : [])];
    });
  }, (c) => p.compute.applyResourceChange(c.actor, c.projectId, resourceCommand(c)), p.compute.resourceChangeReceipt);
  const task = catalogAdapter('task-profile', async (id) => {
    const [profiles, policy] = await Promise.all([p.project.listTaskProfiles(), p.compute.getProjectComputePolicy(p.actor, id)]);
    return profiles.map((profile) => ({ target: { resourceType: 'task-profile' as const, resourceId: profile.id, action: 'set-default' as const }, name: profile.name, description: profile.description, revision: p.revisions.task(policy.revision, profile.id), current: {}, fields: [], impact: ['设置项目后续工作区默认规格', '已有工作区与工作卷保持原规格；需要重建时从工作区管理明确发起'], owned: true, available: true, source: 'inherited' as const, facts: [{ label: 'CPU 请求', value: profile.cpu }, { label: '内存请求', value: profile.memory }, { label: '工作卷申请容量', value: profile.storage }, { label: '项目默认', value: policy.effectiveDevTaskProfile === profile.id ? '是' : '否' }] }));
  }, (c) => p.compute.applyResourceChange(c.actor, c.projectId, resourceCommand(c)), p.compute.resourceChangeReceipt);
  const images = catalogAdapter('runtime-image', async (id) => {
    const [catalog, allowed, policy] = await Promise.all([pagedCatalog((page) => p.images.adminCatalog(p.actor, page)), pagedCatalog((page) => p.images.listImages(p.actor, id, page)), p.images.getProjectImagePolicy(p.actor, id)]);
    const granted = new Set(allowed.map((image) => image.id));
    return catalog.flatMap((image) => actions({ target: { resourceType: 'runtime-image', resourceId: image.id, action: 'grant' }, name: image.name, description: image.description, revision: p.revisions.image(policy.revision, image), current: {}, fields: [], impact: ['授予镜像目录选择权限；仍须存在可用版本并通过对应用途验证', '不构建镜像，不替换已有任务和服务的固定摘要'], owned: granted.has(image.id), available: image.enabled,
      ...(!image.enabled ? { reason: '镜像目录已停用' } : {}), source: policy.policy.additionalImageIds?.includes(image.id) || policy.policy.mode === 'restricted' ? 'granted' : 'inherited', facts: [{ label: '目录修订', value: String(image.revision) }] }));
  }, (c) => p.images.applyResourceChange(c.actor, c.projectId, resourceCommand(c)), p.images.resourceChangeReceipt);
  return [task, compute, images];
}
