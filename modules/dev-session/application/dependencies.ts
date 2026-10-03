import type { DevelopmentRuntimeImages } from '../ports/runtimeImages';
import type { ExecutionRecords } from '../ports/executionRecords';
import type { Clock, Logger } from '@crewstation/kernel';
import type { ApiInvocationCatalog, ComputeCatalog, DevSessionSettings, ManifestParser, McpCredentials, Notifier, ProjectAuthorizer, Releases, ServiceResolver, SourceControl } from '../ports/platform';
import type { Environments, ReminderRepository, Runner } from '../ports/runtime';
import type { ComparisonReferences } from '../ports/comparisons';
import type { DevelopmentProjectWork } from '../ports/deletion/work';

export interface DevSessionUseCaseDeps {
  projectWork?: DevelopmentProjectWork;
  runtimeImages?: DevelopmentRuntimeImages;
  executions?: ExecutionRecords;
  comparisons: ComparisonReferences;
  apiCatalog: ApiInvocationCatalog;
  environments: Environments;
  runner: Runner;
  scm: SourceControl;
  releases: Releases;
  manifests: ManifestParser;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  notifier: Notifier;
  credentials: McpCredentials;
  compute: ComputeCatalog;
  reminders: ReminderRepository;
  settings: DevSessionSettings;
  clock: Clock;
  logger: Logger;
}
