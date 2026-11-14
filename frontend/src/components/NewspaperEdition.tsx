import { forwardRef, useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Newspaper, RefreshCw } from 'lucide-react';
import { resolveApiUrl } from '../utils/timelineReducer';

const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '';

/**
 * The investigation's front page ("The Daily Trace"), rendered below the graph. The backend writes
 * the edition from the claim graph (GET /investigations/:id/newspaper.html); it is shown in a
 * sandboxed iframe (scripts only, no same-origin access) that reports its height, and reloads
 * when `version` changes (claims rebuilt, live update, screening done).
 */
export const NewspaperEdition = forwardRef<HTMLElement, { investigationId: string; version: number }>(function NewspaperEdition({ investigationId, version }, ref) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1400);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(0);
  const src = resolveApiUrl(`/api/investigations/${encodeURIComponent(investigationId)}/newspaper.html?v=${version}.${manual}`, API_BASE);

  useEffect(() => setLoading(true), [src]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: string; height?: unknown };
      if (data?.type === 'tracewire:newspaper-height' && typeof data.height === 'number' && data.height > 200) setHeight(Math.min(Math.ceil(data.height), 12000));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <section ref={ref} className="tw-paper" aria-label="Newspaper edition">
      <div className="tw-paper-bar">
        <span className="tw-paper-title"><Newspaper size={15} aria-hidden="true" /> Today's edition</span>
        <span className="tw-paper-note">Written from the claim graph · updates as the story develops</span>
        <span className="tw-paper-actions">
          <button type="button" onClick={() => setManual((n) => n + 1)} title="Rebuild from the latest graph"><RefreshCw size={13} /> Refresh</button>
          <a href={src} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Open full page</a>
        </span>
      </div>
      <div className="tw-paper-sheet">
        {loading && <div className="tw-paper-loading"><LoaderCircle className="gh-spin" size={16} /> Setting the front page…</div>}
        <iframe
          ref={frameRef}
          key={src}
          src={src}
          title="Newspaper edition of this investigation"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          loading="lazy"
          style={{ height }}
          onLoad={() => setLoading(false)}
        />
      </div>
    </section>
  );
});
