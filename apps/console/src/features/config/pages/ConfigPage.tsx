import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { Tabs } from '../../../shared/ui/Tabs';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { ConfigEnvPanel } from '../components/ConfigEnvPanel';
import { ProductionConfigImpact } from '../components/ProductionConfigImpact';

/** 默认开发组；生产组独立切换，输入按项目与环境隔离。 */
export function ConfigPage({ env, onEnvironmentChange }: { readonly env: 'development' | 'production'; readonly onEnvironmentChange: (env: 'development' | 'production') => void }): ReactElement {
  const t = useT();
  const { projectId } = useProjectScope();
  const [dirtyGroups, setDirtyGroups] = useState({ development: false, production: false });
  const dirtyChanged = useCallback((group: 'development' | 'production', dirty: boolean) => setDirtyGroups((current) => current[group] === dirty ? current : { ...current, [group]: dirty }), []);
  return (
    <>
      <UnsavedChangesGuard dirty={dirtyGroups.development || dirtyGroups.production} scope={t('config.title')} allowNavigate={(current, next) => current.pathname === next.pathname && 'tab' in next.search && next.search.tab === 'config'} />
      <p>{t('config.draft.lifetime')}</p>
      {env === 'production' ? <ProductionConfigImpact /> : null}
      <Tabs label={t('config.title')} value={env} items={(['development', 'production'] as const).map((value) => ({ value, label: t(`config.env.${value}`) }))} onChange={(value) => onEnvironmentChange(value === 'production' ? 'production' : 'development')}>
        {(['development', 'production'] as const).map((group) => <div key={`${projectId}:${group}`} hidden={env !== group}><ConfigEnvPanel projectId={projectId} env={group} onDirtyChange={dirtyChanged} /></div>)}
      </Tabs>
    </>
  );
}
