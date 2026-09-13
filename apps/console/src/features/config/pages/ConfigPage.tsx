import type { ReactElement } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { Tabs } from '../../../shared/ui/Tabs';
import { ConfigEnvPanel } from '../components/ConfigEnvPanel';

/** 默认开发组；生产组独立切换，输入按项目与环境隔离。 */
export function ConfigPage({ env, onEnvironmentChange }: { readonly env: 'development' | 'production'; readonly onEnvironmentChange: (env: 'development' | 'production') => void }): ReactElement {
  const t = useT();
  const { projectId } = useProjectScope();
  return (
    <>
      <Tabs label={t('config.title')} value={env} items={(['development', 'production'] as const).map((value) => ({ value, label: t(`config.env.${value}`) }))} onChange={(value) => onEnvironmentChange(value === 'production' ? 'production' : 'development')}>
        {(['development', 'production'] as const).map((group) => <div key={`${projectId}:${group}`} hidden={env !== group}><ConfigEnvPanel projectId={projectId} env={group} /></div>)}
      </Tabs>
    </>
  );
}
