import type { ReactElement } from 'react';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { Stack } from '../../../shared/ui/Stack';
import { useCallback, useState } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { Tabs } from '../../../shared/ui/Tabs';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { DialogVisibility } from '../../../shared/ui/dialog/DialogHost';
import { ConfigEnvPanel } from '../components/ConfigEnvPanel';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/**
 * 默认开发组；生产组独立切换，输入按项目与环境隔离。页签后面那一组的弹窗不画，草稿仍在（DialogVisibility）。
 * 生产组下原有的「生产配置与部署版本」对照卡已删除（2026-09-23 作者裁定）；何时生效由变量卡说明与保存提示交代。
 */
export function ConfigPage({ env, onEnvironmentChange }: { readonly env: 'development' | 'production'; readonly onEnvironmentChange: (env: 'development' | 'production') => void }): ReactElement {
  const t = useT();
  const { projectId, space } = useProjectScope();
  const [dirtyGroups, setDirtyGroups] = useState({ development: false, production: false });
  const dirtyChanged = useCallback((group: 'development' | 'production', dirty: boolean) => setDirtyGroups((current) => current[group] === dirty ? current : { ...current, [group]: dirty }), []);
  return (
    <Stack>
      <UnsavedChangesGuard dirty={dirtyGroups.development || dirtyGroups.production} scope={t('config.title')} allowNavigate={(current, next) => current.pathname === next.pathname && 'tab' in next.search && next.search.tab === 'config'} />
      <p>{t('config.description')}</p>
      <Tabs label={t('config.title')} value={env} items={(['development', 'production'] as const).map((value) => ({ value, label: t(`config.env.${value}`) }))} onChange={(value) => onEnvironmentChange(value === 'production' ? 'production' : 'development')}>
        {(['development', 'production'] as const).map((group) => <div key={`${projectId}:${group}`} hidden={env !== group}><DialogVisibility hidden={env !== group}><ConfigEnvPanel projectId={projectId} env={group} onDirtyChange={dirtyChanged} /></DialogVisibility></div>)}
      </Tabs>
      <ButtonLink to={PROJECT_PATHS[space].resources} params={{ projectId }} search={{ section: 'guide', topic: 'environment' }}>{t('config.platformGuide')}</ButtonLink>
    </Stack>
  );
}
