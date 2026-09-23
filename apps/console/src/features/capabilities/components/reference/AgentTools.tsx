import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { CopyButton } from '../../../../shared/ui/clipboard/CopyButton';
import { BreakableText, MetaLine, ResourceGroup, ResourceList, ResourceRow } from '../../../../shared/ui/resource/ResourceList';
import { KeyMeaningList } from './KeyMeaningList';
import { meanings } from './RuntimeReference';
import styles from './Reference.module.css';

/**
 * 开发页「可使用资源 → Agent 工具」：给开发容器里的 Agent 用的，不是给业务代码用的（2026-09-23 作者裁定单列一类）。
 * 两个 CLI 启动时平台已把这两个服务器与开发会话令牌写进它们的 MCP 设置；这里给地址，方便自己带的工具接入。
 */
export function AgentTools({ mcp }: { readonly mcp: CapabilityDescriptionDto['mcp'] }): ReactElement {
  const t = useT();
  return <div className={styles.stack}><ResourceList label={t('capabilities.agent.label')}>
    <ResourceGroup title={t('capabilities.mcp.title')} count={mcp.length} note={t('capabilities.agent.note')} empty={t('capabilities.mcp.empty')}>
      {mcp.map((server) => <McpRow key={server.name} name={server.name} url={server.url} />)}
    </ResourceGroup>
    <ResourceGroup plain title={t('capabilities.agent.header')} count={1}>
      <KeyMeaningList label={t('capabilities.agent.header')} items={meanings(t, 'header', { devSessionToken: IDENTITY_HEADERS.devSessionToken })} />
    </ResourceGroup>
  </ResourceList></div>;
}

function McpRow({ name, url }: { readonly name: string; readonly url: string }): ReactElement {
  const t = useT();
  const label = t(`capabilities.agent.server.${name}`), purpose = t(`capabilities.agent.purpose.${name}`);
  return <ResourceRow title={<BreakableText text={url} />} trailing={<CopyButton value={url} />}
    meta={<MetaLine parts={[label === `capabilities.agent.server.${name}` ? name : label, purpose === `capabilities.agent.purpose.${name}` ? undefined : purpose]} />} />;
}
