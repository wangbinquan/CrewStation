import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { CapabilitiesPage } from '../../features/capabilities';
import { CatalogPage } from '../../features/catalog';
import { EventResources } from '../../features/events';
import { useT } from '../../shared/lib/useT';
import { parseDevelopmentSearch, REFERENCE_TOPICS } from '../../shared/project/developmentSearch';
import type { DevelopmentSearch, ReferenceTopic } from '../../shared/project/developmentSearch';
import { PROJECT_PATHS } from '../../shared/project/projectPaths';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { useToolPanel } from '../../shared/project/ToolPanelContext';
import { ActionRow } from '../../shared/ui/ActionRow';
import { Button } from '../../shared/ui/Button';
import { Stack } from '../../shared/ui/Stack';
import { Tabs } from '../../shared/ui/Tabs';
import styles from './ProjectSections.module.css';

/**
 * 开发页的参考面板（RFC-020 D2）：原「开发资源」的三主题——API 接口、事件、平台接入。
 * 侧栏形态只列已授权的操作（可试调）；放大后是整页宽度的完整目录、申请与 Swagger。三个 feature 的公开组件在这里装配。
 */
export function ReferencePanel(): ReactElement {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseDevelopmentSearch(useSearch({ strict: false })), topic: ReferenceTopic = search.topic ?? 'api';
  const panel = useToolPanel(), full = panel?.mode === 'full';
  const go = (next: Partial<DevelopmentSearch>) => { void navigate({ to: PROJECT_PATHS[space].development, params: { projectId }, search: { ...search, guide: undefined, ...next }, replace: true }); };
  return <Stack>
    <Tabs label={t('resources.groups')} value={topic} items={REFERENCE_TOPICS.map((value) => ({ value, label: t(`resources.section.${value}`) }))} onChange={(value) => go({ topic: value as ReferenceTopic, proxy: undefined, operation: undefined, subscription: undefined })}
      extra={panel && !full ? <Button variant="ghost" onClick={panel.maximize}>{t('reference.openFull')}</Button> : undefined}>
      <p className={styles.note}>{t(`resources.note.${topic}`)}</p>
      {topic === 'api' ? <CatalogPage key={`api:${full}`} embedded compact={!full} proxy={search.proxy} operation={search.operation} onClearContext={() => go({ proxy: undefined, operation: undefined })} /> : null}
      {topic === 'events' ? <><ActionRow>
        <Link to={PROJECT_PATHS[space].development} params={{ projectId }} search={{ view: 'code', file: 'crewstation.yaml' }}>{t('resources.openManifest')}</Link>
        <Link to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'deliveries', subscription: search.subscription }}>{t('resources.openDeliveries')}</Link>
      </ActionRow><EventResources projectId={projectId} subscription={search.subscription} /></> : null}
      {topic === 'guide' ? <><Link to={PROJECT_PATHS[space].settings} params={{ projectId }} search={{ tab: 'config', env: 'development' }}>{t('resources.openConfig')}</Link><CapabilitiesPage embedded section="guide" topic={search.guide ?? 'identity'} /></> : null}
    </Tabs>
  </Stack>;
}
