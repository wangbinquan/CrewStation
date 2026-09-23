import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button, buttonClassName } from '../../../../shared/ui/Button';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import type { CliLauncher } from '../../hooks/native/useCliLauncher';
import { ComputeOptions } from '../agents/ComputeOptions';
import styles from './NativeWorkspace.module.css';

/**
 * 页头的两个按钮（2026-09-23 作者裁定把「＋ 创建开发Agent会话 ▾」拆开，RFC-003 design §6）：主按钮「创建开发Agent会话」
 * 按记住的档位直接创建，新 CLI 落在焦点组；描边按钮「选择算力档位」展开换档位（D59 起不再选权限）。不可用时悬停说明原因。
 */
export function NewCliButton({ launcher, reason }: { readonly launcher: CliLauncher; readonly reason?: string }): ReactElement {
  return <span className={styles.newCli}>
    <Button variant="primary" size="small" title={launcher.disabled ? reason : undefined} disabled={launcher.disabled} onClick={launcher.launch}>{launcher.label}</Button>
    <ComputeChooser launcher={launcher} />
  </span>;
}

/** 选择算力档位：环境未就绪、正在创建、档位读取中或失败、布局已满时与主按钮一起不可用；只有所选档位被阻断时仍可用——换档位要靠它。 */
function ComputeChooser({ launcher }: { readonly launcher: CliLauncher }): ReactElement {
  const t = useT(), label = t('devSession.native.startOptions');
  // 置灰时是 disabled 的按钮：点不了、不进 Tab 顺序，已经展开的选择随之收起。
  if (launcher.unavailable) return <Button size="small" disabled>{label}</Button>;
  return <details className={styles.chooser}>
    <summary className={buttonClassName('secondary', 'small')} data-button="">{label}</summary>
    <div className={styles.chooserBody}>
      <label>{t('devSession.agents.compute')}<select aria-label={t('devSession.agents.compute')} value={launcher.compute} disabled={launcher.starting} onChange={(event) => launcher.setCompute(event.target.value)}><ComputeOptions items={launcher.items} /></select></label>
    </div>
  </details>;
}

/**
 * 档位读不到、所选档位不可用、布局已满时，CLI 区上方一行说明与处理入口（管理员去管理算力档位，其他人联系管理员）。
 * 档位读取失败会自动重读，不给「刷新档位」（2026-09-23 裁定）。
 */
export function NewCliNotice({ launcher, isAdmin }: { readonly launcher: CliLauncher; readonly isAdmin: boolean }): ReactElement | null {
  const t = useT(), { profiles, blockText } = launcher;
  if (!profiles.error && !blockText && !launcher.full) return null;
  return <div className={styles.notice} role="status">
    {profiles.error ? <span>{errorMessage(profiles.error)} {t('ui.status.autoRetry')}</span> : null}
    {blockText ? <span>{blockText}</span> : null}
    {launcher.full ? <span>{t('devSession.native.fullWorkspace')}</span> : null}
    {profiles.error || blockText ? isAdmin ? <ButtonLink size="small" to="/admin/compute">{t('devSession.native.configureProfiles')}</ButtonLink> : <span>{t('devSession.native.askAdmin')}</span> : null}
  </div>;
}
