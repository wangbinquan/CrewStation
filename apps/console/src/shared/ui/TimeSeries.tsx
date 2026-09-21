import { useId, useState } from 'react';
import styles from './TimeSeries.module.css';

export interface TimeSeriesPoint { at: string; average: number | null; peak: number | null; coverage: number; complete: boolean }
/** A gap terminates both paths. Keyboard users can inspect every bucket with the native range control. */
export function TimeSeries({ title, points, format, labels }: { title: string; points: TimeSeriesPoint[]; format: (value: number) => string; labels: { average: string; peak: string; coverage: string; select: string; gap: string } }) {
  const id = useId(), [selected, setSelected] = useState<number | undefined>(), index = Math.min(selected ?? points.length - 1, points.length - 1), point = points[index];
  const max = Math.max(1, ...points.flatMap((p) => p.complete ? [p.average ?? 0, p.peak ?? 0] : [])), width = 480, height = 135;
  const segments = (key: 'average' | 'peak') => {
    const paths: string[] = []; let path = '';
    points.forEach((p, i) => { const value = p[key]; if (!p.complete || value === null) { if (path) paths.push(path); path = ''; return; } const x = 5 + i / Math.max(1, points.length - 1) * (width - 10), y = height - 5 - value / max * (height - 10); path += `${path ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `; });
    if (path) paths.push(path); return paths;
  };
  return <figure className={styles.figure} aria-labelledby={id}><figcaption id={id}>{title}<span>{format(max)}</span></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${labels.average}, ${labels.peak}`}><line x1="0" y1={height - 5} x2={width} y2={height - 5} className={styles.axis} />{segments('peak').map((d, i) => <path key={`p${i}`} d={d} className={styles.peak} />)}{segments('average').map((d, i) => <path key={`a${i}`} d={d} className={styles.average} />)}</svg>
    <div className={styles.range}><time>{points[0] ? new Date(points[0].at).toLocaleString() : '—'}</time><time>{points.at(-1) ? new Date(points.at(-1)!.at).toLocaleString() : '—'}</time></div>
    <label className={styles.control}>{labels.select}<input type="range" min="0" max={Math.max(0, points.length - 1)} value={Math.max(0, index)} disabled={!points.length} onChange={(e) => setSelected(Number(e.target.value))} aria-valuetext={point ? new Date(point.at).toLocaleString() : labels.gap} /></label>
    <output className={styles.output} aria-live="polite">{point ? <><time>{new Date(point.at).toLocaleString()}</time><span>{labels.average}: {point.average === null ? '—' : format(point.average)}</span><span>{labels.peak}: {point.peak === null ? '—' : format(point.peak)}</span><span>{labels.coverage}: {(point.coverage * 100).toFixed(0)}%{!point.complete ? ` · ${labels.gap}` : ''}</span></> : labels.gap}</output>
  </figure>;
}
