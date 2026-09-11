import type { ReleaseStatus } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { releaseStatusTone } from '../model/releaseStatus';

export function ReleaseStatusBadge({ status }: { readonly status: ReleaseStatus }): ReactElement {
  const t = useT();
  return <Badge tone={releaseStatusTone(status)}>{t(`release.status.${status}`)}</Badge>;
}
