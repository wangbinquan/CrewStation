import type { Clock, Logger } from '@crewstation/kernel';
import type { ComputeCatalog, DevSessionSettings, ManifestParser, McpCredentials, Notifier, ProjectAuthorizer, Releases, ServiceResolver, SourceControl } from '../ports/platform';
import type { Environments, ReminderRepository, Runner } from '../ports/runtime';

export interface DevSessionUseCaseDeps {
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
