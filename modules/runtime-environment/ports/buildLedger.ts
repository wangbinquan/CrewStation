import type { ProjectId, ResourceChild, RuntimeImageBuildRender } from '@crewstation/contracts';
import type { ImageBuild } from '../domain/records';

export interface BuildResourceRecord {
  readonly id: string; readonly desired: 'present' | 'absent'; readonly phase: string;
  readonly spec: { readonly children: readonly { kind: string; namespace?: string; name: string }[]; readonly [key: string]: unknown };
  readonly children: readonly ResourceChild[];
  readonly conditions: readonly { type: string; status: string }[];
}
export interface BuildResourceWriter {
  declare(input: { id: string; kind: 'build-job'; ref: string; projectId: ProjectId; spec: { children: readonly { kind: string; namespace?: string; name: string }[]; runtimeImageBuild: RuntimeImageBuildRender }; display: Record<string, string> }): Promise<BuildResourceRecord>;
  requestRelease(id: string, reason: { code: string; message: string }): Promise<BuildResourceRecord>;
}
export interface RuntimeBuildLedger {
  within(tx: object): BuildResourceWriter;
  get(id: string): Promise<BuildResourceRecord | undefined>;
}
export interface RuntimeBuildIntents {
  get(buildId: string): Promise<ImageBuild | undefined>;
  /** 在同一事务中核对控制 epoch 并声明或释放资源；过期控制器无写入。 */
  declare(build: ImageBuild, plan: RuntimeImageBuildRender): Promise<boolean>;
  stop(build: ImageBuild): Promise<boolean>;
  addCredential(buildId: string, executionEpoch: number, credentialId: string): Promise<boolean>;
}
