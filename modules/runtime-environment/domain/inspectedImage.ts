import type { RuntimeImageArchitecture } from '@crewstation/contracts';

export interface InspectedImage {
  readonly repository: string;
  readonly digest: string;
  readonly architecture: RuntimeImageArchitecture;
  readonly diffIds: readonly string[];
  readonly user: string;
  readonly entrypoint: readonly string[];
  readonly command: readonly string[];
}
