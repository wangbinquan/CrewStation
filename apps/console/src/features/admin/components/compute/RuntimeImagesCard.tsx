import type { RegistryPushCredential } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { shortDigest } from '../../model/profileStatus';
import styles from './ComputeEditor.module.css';

/** 复制到剪贴板；浏览器不给权限时如实提示，不假装成功。 */
function CopyButton({ text, label }: { readonly text: string; readonly label: string }): ReactElement {
  const t = useT();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => { try { await navigator.clipboard.writeText(text); setState('copied'); } catch { setState('failed'); } };
  return <Button variant="ghost" aria-label={label} onClick={() => void copy()}>{state === 'copied' ? t('admin.images.copied') : state === 'failed' ? t('admin.images.copyFailed') : t('admin.images.copy')}</Button>;
}

/** 一次性显示的推送凭据（C18）：只在这次响应里出现，关掉就没有了；到期后仓库拒绝。 */
function CredentialNote({ credential, onDismiss }: { readonly credential: RegistryPushCredential; readonly onDismiss: () => void }): ReactElement {
  const t = useT(), date = useDateText();
  const login = `docker login ${credential.pushHost} -u ${credential.username} --password-stdin`;
  return (
    <div className={styles.stageBody} role="status">
      <ActionNote tone="success">{t('admin.images.credentialIssued', { expiresAt: date(credential.expiresAt) })}</ActionNote>
      <DefinitionList items={[
        { label: t('admin.images.username'), value: <span className={styles.toolbar}><code>{credential.username}</code><CopyButton text={credential.username} label={t('admin.images.copyUsername')} /></span> },
        { label: t('admin.images.password'), value: <span className={styles.toolbar}><code className={styles.breakable}>{credential.password}</code><CopyButton text={credential.password} label={t('admin.images.copyPassword')} /></span> },
        { label: t('admin.images.pushPrefixes'), value: <code>{credential.pushPrefixes.join(', ')}</code> },
        { label: t('admin.images.pullPrefixes'), value: <code>{credential.pullPrefixes.join(', ')}</code> },
        { label: t('admin.images.login'), value: <span className={styles.toolbar}><code className={styles.breakable}>{login}</code><CopyButton text={login} label={t('admin.images.copyLogin')} /></span> },
      ]} />
      <p className={styles.hint}>{t('admin.images.credentialOnce')}</p>
      <div className={styles.toolbar}><Button onClick={onDismiss}>{t('admin.images.dismiss')}</Button></div>
    </div>
  );
}

/**
 * 平台仓库与底座镜像（RFC-006 C3、C15、C18）：档位镜像只能来自平台仓库，由管理员基于平台底座自行构建后推送。
 * 这里给出推送地址、底座引用、示例 Dockerfile，并签发有期限的推送凭据。
 */
export function RuntimeImagesCard(): ReactElement {
  const t = useT();
  const info = useApiQuery(queryKeys.runtimeImages(), () => api.computeProfiles.runtimeImages(), { staleTimeMs: 60_000 });
  const [credential, setCredential] = useState<RegistryPushCredential | undefined>(undefined);
  const issue = useApiMutation(() => api.computeProfiles.issuePushCredential(), { onSuccess: (issued) => setCredential(issued) });
  const data = info.data;
  return (
    <Card stacked title={t('admin.images.title')} footer={t('admin.images.hint')}>
      <QueryStatus isPending={info.isPending} error={info.error} />
      {data ? (
        <>
          <DefinitionList items={[
            { label: t('admin.images.pushHost'), value: <code>{data.pushHost}</code> },
            { label: t('admin.images.repositoryPrefix'), value: <code>{data.repositoryPrefix}</code> },
            { label: t('admin.images.pullReference'), value: <code className={styles.breakable}>{data.pullReference}</code> },
            { label: t('admin.images.baseImage'), value: <span title={data.baseImage.digest}><code className={styles.breakable}>{data.baseImage.pushHostReference}</code>{data.baseImage.digest ? ` @${shortDigest(data.baseImage.digest)}` : ''}</span> },
          ]} />
          {data.baseImage.error ? <ActionNote tone="error">{t('admin.images.baseImageError', { message: data.baseImage.error })}</ActionNote> : null}
          <p className={styles.hint}>{t('admin.images.dockerfileHint')}</p>
          <pre className={styles.log} aria-label={t('admin.images.sampleDockerfile')}>{data.sampleDockerfile}</pre>
          <div className={styles.toolbar}>
            <Button variant="primary" disabled={issue.isPending} onClick={() => issue.mutate(undefined)}>{issue.isPending ? t('admin.images.issuing') : t('admin.images.issue')}</Button>
            <span className={styles.hint}>{t('admin.images.issueHint')}</span>
          </div>
          {issue.error ? <ActionNote tone="error">{t('admin.images.issueError', { message: errorMessage(issue.error) })}</ActionNote> : null}
          {credential ? <CredentialNote credential={credential} onDismiss={() => setCredential(undefined)} /> : null}
        </>
      ) : null}
    </Card>
  );
}
