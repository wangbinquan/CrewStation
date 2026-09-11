import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { uncommittedPaths } from '../model/publishPrecondition';
import { ActionNote } from './ActionNote';
import styles from './PublishResult.module.css';

export interface PublishResultProps {
  readonly error: unknown;
  /** 发布已受理时的标签名；平台随后异步构建、迁移并部署到待机槽。 */
  readonly tag: string | undefined;
}

/** 发布的三种结局：未提交改动（412，列出文件）、其他失败、已受理。 */
export function PublishResult({ error, tag }: PublishResultProps): ReactElement | null {
  const t = useT();
  const uncommitted = uncommittedPaths(error);
  if (uncommitted !== undefined) {
    return (
      <div className={styles.uncommitted} role="alert">
        <p className={styles.title}>{t('release.publish.uncommittedTitle')}</p>
        <ul className={styles.paths}>
          {uncommitted.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
        <p className={styles.hint}>{t('release.publish.uncommittedHint')}</p>
      </div>
    );
  }
  if (error !== null && error !== undefined) return <ActionNote tone="error">{t('release.publish.error', { message: errorMessage(error) })}</ActionNote>;
  if (tag !== undefined) return <ActionNote tone="success">{t('release.publish.started', { tag })}</ActionNote>;
  return null;
}
