import { useT } from '../../../../shared/lib/useT';
import { AdminRequestTodos } from './AdminRequestTodos';
import { AdminProjectTodos } from './AdminProjectTodos';
import styles from './AdminTodos.module.css';

export function AdminTodos() {
  const t = useT();
  return <section aria-labelledby="admin-todo-title"><h2 className={styles.heading} id="admin-todo-title">{t('admin.todo.title')}</h2><p className={styles.hint}>{t('admin.todo.hint')}</p>
    <div className={styles.grid}><AdminRequestTodos /><AdminProjectTodos /><AdminProjectTodos integration /></div>
  </section>;
}
