import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import type { CreationCatalog, CreationDraft } from '../../model/creationDraft';

export function CreationReview({ draft, catalog }: { draft: CreationDraft; catalog: CreationCatalog }) {
  const t = useT(), owner = catalog.users.find((user) => user.id === draft.ownerUserId), plan = catalog.plans.find((item) => item.name === draft.plan);
  const template = catalog.templates.find((item) => item.name === draft.template && item.kind === draft.kind);
  return <>
    <DefinitionList layout="grid" items={[
      { label: t('projects.create.name'), value: draft.name.trim() }, { label: t('projects.create.slug'), value: draft.slug.trim() },
      { label: t('projects.create.owner'), value: owner ? `${owner.name}（${owner.email}）` : t('projects.wizard.ownerError') },
      { label: t('projects.create.kind'), value: t(`projects.kind.${draft.kind}`) }, { label: t('projects.create.template'), value: draft.template },
      { label: t('projects.wizard.plan'), value: plan ? `${plan.name} · ${plan.cpu} CPU · ${plan.memory} · ${t('projects.wizard.replicas', { count: plan.maxReplicas })}` : t('projects.wizard.planError') },
      { label: t('projects.wizard.quota'), value: draft.maxConcurrentTasks || t('projects.wizard.platformDefault') },
    ]} />
    {template?.requiredConfig.length ? <ActionNote tone="neutral">{t('projects.wizard.requiredConfig', { keys: template.requiredConfig.map((item) => `${item.name}（${t(`projects.wizard.config.${item.from}`)}）`).join('、') })}</ActionNote> : null}
    <ActionNote tone="neutral">{t('projects.wizard.creationEffect')}</ActionNote>
  </>;
}
