import type { ForwardEgressHttpRequest, ManifestKind, ProjectId, ProjectState } from '@crewstation/contracts';

export interface HttpEgressDirectory {
  resolve(identity: string): Promise<{ projectId: ProjectId; kind: ManifestKind; state: ProjectState } | undefined>;
}

export interface HttpEgressTransport {
  send(input: ForwardEgressHttpRequest): Promise<Response>;
}
