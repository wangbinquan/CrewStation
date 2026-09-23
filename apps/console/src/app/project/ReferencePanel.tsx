import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { AgentToolsTopic, EventHeadersTopic, RuntimeTopic, usePlatformEndpoints } from '../../features/capabilities';
import { CatalogPage } from '../../features/catalog';
import { DeliveriesSummary, EventResources } from '../../features/events';
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
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';

/** 旧链接里「平台接入」的 MCP 与业务任务小节，现在分别住在 Agent 工具与调用接口里。 */
function topicOf(search: DevelopmentSearch): ReferenceTopic {
  const topic = search.topic ?? 'api';
  if (topic !== 'guide') return topic;
  return search.guide === 'mcp' ? 'agent' : search.guide === 'tasks' ? 'api' : 'guide';
}

/**
 * 开发页的「可使用资源」面板（RFC-020 D2）。2026-09-23 作者裁定按代码怎么用它分四类：调用接口（代理、数字人与平台接口）、
 * 接收事件（订阅、可订阅类型与推送头）、运行环境（环境变量、请求头、路径、配置键）、Agent 工具（平台 MCP）。
 * 侧栏与放大是同一套两行列表；放大后接口多出右侧详情栏、申请记录与 Swagger。三个 feature 的公开组件在这里装配。
 */
export function ReferencePanel(): ReactElement {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseDevelopmentSearch(useSearch({ strict: false })), topic = topicOf(search);
  const panel = useToolPanel(), full = panel?.mode === 'full', platform = usePlatformEndpoints();
  const go = (next: Partial<DevelopmentSearch>) => { void navigate({ to: PROJECT_PATHS[space].development, params: { projectId }, search: { ...search, guide: undefined, ...next }, replace: true }); };
  return <Stack fill>
    <Tabs fill label={t('resources.groups')} value={topic} items={REFERENCE_TOPICS.map((value) => ({ value, label: t(`resources.section.${value}`) }))} onChange={(value) => go({ topic: value as ReferenceTopic, proxy: undefined, operation: undefined, subscription: undefined })}
      extra={panel && !full ? <Button variant="ghost" onClick={panel.maximize}>{t('reference.openFull')}</Button> : undefined}>
      <Stack fill><p className={styles.note}>{t(`resources.note.${topic}`)}</p>
      {topic === 'api' ? <CatalogPage key={`api:${full}`} embedded compact={!full} fill proxy={search.proxy} operation={search.operation} platform={platform} onClearContext={() => go({ proxy: undefined, operation: undefined })} onSelect={(operation) => go({ operation: operation?.id })} /> : null}
      {topic === 'events' ? <><ActionRow>
        <ButtonLink size="small" to={PROJECT_PATHS[space].development} params={{ projectId }} search={{ view: 'code', file: 'crewstation.yaml' }}>{t('resources.openManifest')}</ButtonLink>
        <DeliveriesSummary projectId={projectId} subscription={search.subscription} />
      </ActionRow><EventResources projectId={projectId} subscription={search.subscription} extra={<EventHeadersTopic />} /></> : null}
      {topic === 'guide' ? <RuntimeTopic configAction={<div><ButtonLink size="small" to={PROJECT_PATHS[space].settings} params={{ projectId }} search={{ tab: 'config', env: 'development' }}>{t('resources.openConfig')}</ButtonLink></div>} /> : null}
      {topic === 'agent' ? <AgentToolsTopic /> : null}</Stack>
    </Tabs>
  </Stack>;
}
