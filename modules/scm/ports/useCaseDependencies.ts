import type { Clock } from '@crewstation/kernel';
import type { GitLabGateway } from './gitLabGateway';
import type { GitRunner } from './gitRunner';
import type { ProjectAuthorizer } from './projectAuthorizer';
import type { ScmSettings } from './scmSettings';
import type { ScratchDirs } from './scratchDirs';
import type { TemplateSource } from './templateSource';
import type { UnitOfWork } from './unitOfWork';
import type { ManifestUpgrade } from './manifestUpgrade';

/** External capabilities shared by SCM use cases; application functions stay outside this port. */
export interface ScmUseCaseDeps {
  manifestUpgrade?: ManifestUpgrade; uow: UnitOfWork; gitlab: GitLabGateway; git: GitRunner;
  templates: TemplateSource; scratch: ScratchDirs; authorizer: ProjectAuthorizer; settings: ScmSettings; clock: Clock;
}
