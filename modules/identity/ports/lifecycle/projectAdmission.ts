import type { ProjectId } from '@crewstation/contracts';

/** 项目生命周期事实由装配根反转；本模块另以持久墓碑拒绝根删除后的旧令牌／项目键。 */
export interface ProjectAdmission { byId(id: ProjectId): Promise<boolean>; bySlug(slug: string): Promise<boolean> }
export interface ProjectLifecycle { available(id: ProjectId): Promise<boolean> }
