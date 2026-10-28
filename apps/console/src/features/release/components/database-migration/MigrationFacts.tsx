import type { DatabaseMigrationDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
export function MigrationFacts({op}:{op:DatabaseMigrationDto}){
 const t=useT();return <DefinitionList items={[
  {label:t('release.migration.operation'),value:op.id},{label:t('release.migration.candidate'),value:op.candidateTag},
  {label:t('release.migration.commit'),value:op.commitSha},{label:t('release.migration.image'),value:op.image??'—'},
  {label:t('release.migration.source'),value:op.sourceGenerationId},{label:t('release.migration.target'),value:op.targetGenerationId},{label:t('release.migration.scratch'),value:op.scratchGenerationId},
  {label:t('release.migration.approval'),value:op.approval?.digest??op.plan?.plan.approvalDigest??'—'},
 ]}/>;
}
