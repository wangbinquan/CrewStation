import type { ProjectSummary } from '@crewstation/contracts';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { Stack } from '../../../../shared/ui/Stack';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { DeploymentFact, DevelopmentFact, SummaryChecked, HealthFact } from './SummaryFacts';

export function ProjectSummaryDetails({ item, onClose }: { readonly item: ProjectSummary; readonly onClose: () => void }) {
  const t = useT(), date = useDateText(), p = item.project;
  return <Dialog title={p.name} onClose={onClose}><Stack><DefinitionList items={[
    { label: t('projects.summary.owner'), value: item.ownerName || t('catalog.ownerUnknown') },
    { label: t('catalog.identifier'), value: p.id }, { label: t('catalog.namespace'), value: p.namespace },
    { label: t('catalog.created'), value: date(p.createdAt) }, { label: t('projects.summary.ownerId'), value: p.ownerUserId },
    ...(['preview', 'prod'] as const).map((name) => ({ label: t(`projects.summary.${name}`), value: <DeploymentFact item={item} name={name} canOpen={false} /> })),
  ]} /><DevelopmentFact item={item} /><HealthFact item={item} /><SummaryChecked checkedAt={item.checkedAt} /></Stack></Dialog>;
}
