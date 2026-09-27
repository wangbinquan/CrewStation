import { useEffect, useState } from 'react';
import type { AppIcon as IconName, AppIconSource } from '@crewstation/contracts';
import { GlyphIcon } from './GlyphIcon';
import { appIconSources } from './appIconSources';
import styles from './AppIcon.module.css';

export type AppIconLoadStatus = 'loading' | 'loaded' | 'fallback';
export interface AppIconProps {
  readonly projectId: string;
  readonly icon: IconName;
  readonly source?: AppIconSource;
  readonly applicationOrigin?: string;
  /** Local file preview, never a remotely supplied data URL. */
  readonly preview?: string;
  readonly size?: 'preview';
  readonly onStatus?: (status: AppIconLoadStatus) => void;
}
export function AppIcon(props: AppIconProps) {
  const sources = props.preview ? [props.preview] : appIconSources(props.projectId, props.source, props.applicationOrigin);
  return <IconImage key={JSON.stringify(sources)} sources={sources} icon={props.icon} size={props.size} onStatus={props.onStatus} />;
}
function IconImage({ sources, icon, size, onStatus }: { readonly sources: readonly string[]; readonly icon: IconName; readonly size?: 'preview'; readonly onStatus?: (status: AppIconLoadStatus) => void }) {
  const [index, setIndex] = useState(0), [loaded, setLoaded] = useState(false), src = sources[index];
  useEffect(() => { onStatus?.(!src || loaded && index > 0 ? 'fallback' : loaded ? 'loaded' : 'loading'); }, [src, loaded, index, onStatus]);
  const next = () => { setLoaded(false); setIndex((value) => value === index ? value + 1 : value); };
  useEffect(() => {
    if (!src || loaded) return;
    const timer = window.setTimeout(() => setIndex((value) => value === index ? value + 1 : value), 3000);
    return () => window.clearTimeout(timer);
  }, [src, loaded, index]);
  return <span className={[styles.icon, size === 'preview' ? styles.preview : undefined].filter(Boolean).join(' ')} aria-hidden="true">
    <GlyphIcon name={icon} plain />
    {src ? <img key={src} src={src} alt="" referrerPolicy="no-referrer" className={loaded ? styles.loaded : styles.pending} onLoad={(event) => { if (event.currentTarget.naturalWidth) setLoaded(true); else next(); }} onError={next} /> : null}
  </span>;
}
