import type { PlatformRole, UserDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { UserRoleEditor } from './roles/UserRoleEditor';
import styles from './roles/Users.module.css';

/** 完整目录在本地筛选；编辑器独立保存基准，后台刷新不覆盖未提交的角色选择。 */
export function UsersSection() {
  const t = useT(), users = useApiQuery(queryKeys.users(), () => api.users.list());
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const [query, setQuery] = useState(''), [role, setRole] = useState<PlatformRole | ''>('');
  const [editing, setEditing] = useState<UserDto>(), opener = useRef<HTMLButtonElement | null>(null);
  const items = users.data?.items ?? [], search = query.trim().toLocaleLowerCase();
  const matches = items.filter((user) => (!role || user.platformRole === role) && `${user.name} ${user.email}`.toLocaleLowerCase().includes(search));
  const close = () => { setEditing(undefined); requestAnimationFrame(() => opener.current?.isConnected ? opener.current.focus() : document.getElementById('users-search')?.focus()); };
  return <div className={`${styles.layout} ${editing ? styles.editing : ''}`}>
    <Card stacked title={t('admin.users.directory')} extra={<span className={styles.muted}>{t('admin.users.count', { count: items.length })}</span>}>
      <div className={styles.filters}>
        <FormField label={t('admin.users.search')}><input id="users-search" disabled={Boolean(editing)} type="search" value={query} placeholder={t('admin.users.searchHint')} onChange={(e) => setQuery(e.target.value)} /></FormField>
        <FormField label={t('admin.users.role')}><select disabled={Boolean(editing)} value={role} onChange={(e) => setRole(e.target.value as PlatformRole | '')}>
          <option value="">{t('admin.users.allRoles')}</option>
          {(['user', 'developer', 'admin'] as const).map((value) => <option key={value} value={value}>{t(`topBar.role.${value}`)}</option>)}
        </select></FormField>
      </div>
      <QueryStatus isPending={users.isPending} error={users.error} isEmpty={!items.length} emptyTitle={t('admin.users.emptyTitle')} emptyDescription={t('admin.users.emptyDescription')} />
      {users.error ? <Button onClick={() => void users.refetch()}>{t('admin.identity.retry')}</Button> : null}
      {!users.isPending && !users.error && items.length > 0 && !matches.length ? <EmptyState title={t('admin.users.noMatch')} description={t('admin.users.noMatchHint')} action={<Button onClick={() => { setQuery(''); setRole(''); }}>{t('admin.users.clearFilters')}</Button>} /> : null}
      <div aria-label={t('admin.users.directory')}>{matches.map((user) => <div key={user.id} className={styles.row}>
        <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{Array.from(user.name.trim() || user.email).slice(0, 1).join('').toUpperCase()}</span>
          <div className={styles.details}><div className={styles.name}><strong>{user.name}</strong>{user.id === me.data?.id ? <Badge>{t('admin.users.you')}</Badge> : null}</div><span className={styles.muted}>{user.email || t('admin.users.noEmail')}</span></div>
        </div>
        <Badge tone={user.platformRole === 'admin' ? 'info' : 'neutral'}>{t(`topBar.role.${user.platformRole}`)}</Badge>
        <Button variant="ghost" aria-label={t('admin.users.manageFor', { name: user.name, email: user.email || user.id })} aria-expanded={editing?.id === user.id} disabled={Boolean(editing)} onClick={(e) => { opener.current = e.currentTarget; setEditing(user); }}>{t('admin.users.manage')}</Button>
      </div>)}</div>
    </Card>
    {editing ? <UserRoleEditor key={editing.id} user={editing} onClose={close} refresh={async () => {
      const result = await users.refetch();
      if (result.error) throw result.error;
      return result.data?.items.find((user) => user.id === editing.id);
    }} /> : null}
  </div>;
}
