import { useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import type { PublishHandle } from '../hooks/usePublishForm';
import { defaultBranchName } from '../model/branchChoice';
import { VERSION_BUMPS, isReleaseTag } from '../model/publishFailure';
import type { VersionBump } from '../model/publishFailure';
import { BranchSelect } from './BranchSelect';
import { Pane } from './Pane';
import { PaneNotice } from './PaneNotice';
import { UncommittedList } from './UncommittedList';
import styles from './PublishPane.module.css';

/** 发布：选分支与版本，平台代推、打标签、构建并部署到待命槽；晋级由负责人在发布页切流。 */
export function PublishPane({ publish }: { readonly publish: PublishHandle }): ReactElement {
  const t = useT();
  const [picked, setPicked] = useState('');
  const [bump, setBump] = useState<VersionBump>('patch');
  const [tag, setTag] = useState('');
  const branch = picked === '' ? defaultBranchName(publish.branches) : picked;
  const explicit = tag.trim();
  const tagInvalid = explicit !== '' && !isReleaseTag(explicit);
  const release = publish.publish;
  return (
    <Pane title={t('devSession.publish.title')} className={styles.pane}>
      <p className={styles.hint}>{t('devSession.publish.hint')}</p>
      <div className={styles.field}>
        <label htmlFor="publish-branch">{t('devSession.publish.branch')}</label>
        <BranchSelect id="publish-branch" branches={publish.branches} value={branch} disabled={publish.isPending} onChange={setPicked} />
      </div>
      <div className={styles.field}>
        <label htmlFor="publish-bump">{t('devSession.publish.version')}</label>
        <select id="publish-bump" className={styles.select} value={bump} disabled={explicit !== ''} onChange={(event) => setBump(event.target.value as VersionBump)}>
          {VERSION_BUMPS.map((option) => (
            <option key={option} value={option}>
              {t(`devSession.publish.bump.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="publish-tag">{t('devSession.publish.tag')}</label>
        <input
          id="publish-tag"
          className={styles.input}
          value={tag}
          placeholder={t('devSession.publish.tagPlaceholder')}
          onChange={(event) => setTag(event.target.value)}
        />
      </div>
      {tagInvalid ? <PaneNotice tone="warning">{t('devSession.publish.tagInvalid')}</PaneNotice> : null}
      <Button
        variant="primary"
        disabled={branch === '' || tagInvalid || release.isPending}
        onClick={() => release.mutate({ branch, ...(explicit === '' ? { version: bump } : { version: explicit }) })}
      >
        {release.isPending ? t('devSession.publish.pending') : t('devSession.publish.submit')}
      </Button>
      {publish.uncommitted.length > 0 ? <UncommittedList paths={publish.uncommitted} /> : null}
      {release.error !== null && publish.uncommitted.length === 0 ? <PaneNotice tone="warning">{errorMessage(release.error)}</PaneNotice> : null}
      {release.data !== undefined ? <PaneNotice tone="info">{t('devSession.publish.done', { tag: release.data.tag, slot: release.data.slot ?? '—' })}</PaneNotice> : null}
    </Pane>
  );
}
