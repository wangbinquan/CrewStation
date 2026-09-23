import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { Translate } from '../../../../shared/lib/useT';
import { ResourceGroup, ResourceList } from '../../../../shared/ui/resource/ResourceList';
import { KeyMeaningList } from './KeyMeaningList';
import type { KeyMeaning } from './KeyMeaningList';
import styles from './Reference.module.css';

/** 用户域上网关注入的身份头；其余的是服务域与链路头。开发会话令牌归「Agent 工具」。 */
const USER_HEADERS = ['userId', 'userName', 'userEmail', 'identityToken', 'userAttrs'];
const AGENT_HEADERS = ['devSessionToken'];

/** 约定项按平台给的键查用途说明；新加的键没有说明时只显示名字，不编造。 */
export function meanings(t: Translate, group: string, record: Readonly<Record<string, string>>, keys?: readonly string[]): KeyMeaning[] {
  return Object.entries(record).filter(([key]) => !keys || keys.includes(key)).map(([key, name]) => {
    const id = `capabilities.meaning.${group}.${key}`, text = t(id);
    return { name, meaning: text === id ? undefined : text };
  });
}

/**
 * 开发页「可使用资源 → 运行环境」：平台注入给代码的一切——环境变量、收到的请求头、约定路径、应用配置键。
 * 每项一行「名字＋用途」，点名字复制（2026-09-23 作者裁定，替代原「平台接入」的折叠块与代码内部键名）。
 */
export function RuntimeReference({ description: d, configAction }: { readonly description: CapabilityDescriptionDto; readonly configAction?: ReactNode }): ReactElement {
  const t = useT();
  const forwarded = new Set(d.identityForwarding.headers.map((name) => name.toLowerCase()));
  const user = meanings(t, 'header', d.conventions.identityHeaders, USER_HEADERS)
    .map((item) => forwarded.has(item.name.toLowerCase()) ? item : { ...item, inactive: t('capabilities.runtime.notForwarded') });
  const others = Object.keys(d.conventions.identityHeaders).filter((key) => !USER_HEADERS.includes(key) && !AGENT_HEADERS.includes(key));
  return <div className={styles.stack}><ResourceList label={t('capabilities.runtime.label')}>
    <ResourceGroup plain title={t('capabilities.conventions.env')} count={Object.keys(d.conventions.env).length} note={t('capabilities.runtime.envNote')}>
      <KeyMeaningList label={t('capabilities.conventions.env')} items={meanings(t, 'env', d.conventions.env)} />
    </ResourceGroup>
    <ResourceGroup plain title={t('capabilities.runtime.userHeaders')} count={user.length}>
      <p className={styles.facts}>
        <span>{t('capabilities.forwarding.source')} <strong>{t(d.identityForwarding.source === 'project' ? 'capabilities.forwarding.sourceProject' : 'capabilities.forwarding.sourceGlobal')}</strong></span>
        <span>{t('capabilities.forwarding.claims')} {d.identityForwarding.tokenClaims.length === 0 ? t('capabilities.forwarding.none') : <code>{d.identityForwarding.tokenClaims.join(' ')}</code>}</span>
      </p>
      <KeyMeaningList label={t('capabilities.runtime.userHeaders')} items={user} />
    </ResourceGroup>
    <ResourceGroup plain title={t('capabilities.runtime.serviceHeaders')} count={others.length} note={t('capabilities.runtime.serviceNote')}>
      <KeyMeaningList label={t('capabilities.runtime.serviceHeaders')} items={meanings(t, 'header', d.conventions.identityHeaders, others)} />
    </ResourceGroup>
    <ResourceGroup plain title={t('capabilities.conventions.paths')} count={Object.keys(d.conventions.paths).length}>
      <KeyMeaningList label={t('capabilities.conventions.paths')} items={meanings(t, 'path', d.conventions.paths)} />
    </ResourceGroup>
    <ResourceGroup plain title={t('capabilities.runtime.config')} count={d.config.development.length + d.config.production.length} note={t('capabilities.config.note')}>
      <div className={styles.columns}>
        {(['development', 'production'] as const).map((group) => <div key={group}><h4 className={styles.subtitle}>{t(`capabilities.config.${group}`)}</h4>
          <KeyMeaningList label={t(`capabilities.config.${group}`)} items={d.config[group].map((name) => ({ name }))} /></div>)}
      </div>
      {configAction}
    </ResourceGroup>
  </ResourceList></div>;
}
