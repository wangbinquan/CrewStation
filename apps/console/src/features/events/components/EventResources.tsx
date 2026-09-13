import { EventTypesCard } from './EventTypesCard';
import { SubscriptionsCard } from './SubscriptionsCard';
import styles from '../pages/EventsPage.module.css';

export function EventResources({ projectId, subscription }: { readonly projectId: string; readonly subscription?: string }) {
  return <div className={styles.columns}><SubscriptionsCard projectId={projectId} selected={subscription} /><EventTypesCard /></div>;
}
