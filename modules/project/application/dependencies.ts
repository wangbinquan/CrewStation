import type { Clock } from '@crewstation/kernel';
import type { HostNaming } from '../ports/hostNaming';
import type { ProjectSettings } from '../ports/projectSettings';
import type { RuntimeConfigDirectory } from '../ports/runtimeConfigs';
import type { TaskUsage } from '../ports/taskUsage';
import type { UnitOfWork } from '../ports/unitOfWork';
import type { UserDirectory } from '../ports/userDirectory';

export interface ProjectUseCaseDeps {
  uow: UnitOfWork;
  users: UserDirectory;
  hosts: HostNaming;
  settings: ProjectSettings;
  taskUsage: TaskUsage;
  runtimeConfigs: RuntimeConfigDirectory;
  clock: Clock;
}
