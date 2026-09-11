import type { ProjectState } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { projectStateTone } from '../model/projectStateTone';

export function ProjectStateBadge({ state }: { readonly state: ProjectState }): ReactElement {
  const t = useT();
  return <Badge tone={projectStateTone(state)}>{t(`projects.state.${state}`)}</Badge>;
}
