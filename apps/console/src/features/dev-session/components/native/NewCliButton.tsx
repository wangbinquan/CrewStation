import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { SplitButton } from '../../../../shared/ui/menu/SplitButton';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import type { CliLauncher } from '../../hooks/native/useCliLauncher';
import { ComputeOptions } from '../agents/ComputeOptions';
import styles from './NativeWorkspace.module.css';

/**
 * 页头的「＋ 创建开发Agent会话 ▾」（2026-09-23 起 CLI 区只有这一个入口，原工具行整条去掉）：
 * 主键按记住的档位直接创建，新 CLI 落在焦点组；箭头展开换档位。权限不分档，一律完全权限（D59）。不可用时悬停说明原因。
 */
export function NewCliButton({ launcher, reason }: { readonly launcher: CliLauncher; readonly reason?: string }): ReactElement {
  const t = useT();
  return <SplitButton size="small" label={launcher.label} menuLabel={t('devSession.native.startOptions')} title={launcher.disabled ? reason : undefined}
    disabled={launcher.disabled} menuDisabled={launcher.unavailable} onClick={launcher.launch}
    menu={<label>{t('devSession.agents.compute')}<select aria-label={t('devSession.agents.compute')} value={launcher.compute} disabled={launcher.starting} onChange={(event) => launcher.setCompute(event.target.value)}><ComputeOptions items={launcher.items} /></select></label>} />;
}

/** 档位读不到、所选档位不可用、布局已满时，CLI 区上方一行说明与处理入口（刷新档位；管理员去管理算力档位，其他人联系管理员）。 */
export function NewCliNotice({ launcher, isAdmin }: { readonly launcher: CliLauncher; readonly isAdmin: boolean }): ReactElement | null {
  const t = useT(), { profiles, blockText } = launcher;
  if (!profiles.error && !blockText && !launcher.full) return null;
  return <div className={styles.notice} role="status">
    {profiles.error ? <span>{errorMessage(profiles.error)}</span> : null}
    {blockText ? <span>{blockText}</span> : null}
    {launcher.full ? <span>{t('devSession.native.fullWorkspace')}</span> : null}
    {profiles.error || blockText ? <>
      <Button size="small" disabled={profiles.isFetching} onClick={() => void profiles.refetch()}>{t('devSession.native.refreshProfiles')}</Button>
      {isAdmin ? <ButtonLink size="small" to="/admin/compute">{t('devSession.native.configureProfiles')}</ButtonLink> : <span>{t('devSession.native.askAdmin')}</span>}
    </> : null}
  </div>;
}
