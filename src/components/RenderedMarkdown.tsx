import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { loadMermaid } from '../lib/mermaid';
import type { Theme } from '../types/study';

interface Props {
  markdown: string;
  maskAll: boolean;
  theme: Theme;
  className?: string;
  onCopy?: () => void;
}

let mermaidSeq = 0;
/** How many times one surface retries a failed mermaid load on its own. */
const MERMAID_RETRIES = 2;

/**
 * One rendered markdown surface. Owns the two things HTML alone cannot do:
 * mask chips that open on click, and mermaid diagrams drawn after mount.
 *
 * The diagrams follow the theme: the theme is passed to mermaid on every
 * render, and a theme change redraws the boxes that are already on screen —
 * their previous SVG was drawn for the other background. A failed load is
 * retried a couple of times and the source stays readable meanwhile.
 */
export function RenderedMarkdown({ markdown, maskAll, theme, className = '', onCopy }: Props) {
  const { html } = useMemo(() => renderMarkdown(markdown), [markdown]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const drawnTheme = useRef<Theme | null>(null);
  const retries = useRef(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { setOverrides({}); }, [maskAll, markdown]);

  // apply mask state
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>('.slide-mask').forEach((el) => {
      const id = el.dataset.maskId ?? '0';
      const open = overrides[id] ?? maskAll;
      el.dataset.revealed = open ? 'true' : 'false';
      el.setAttribute('aria-pressed', open ? 'true' : 'false');
    });
  }, [html, maskAll, overrides]);

  // mermaid
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-mermaid]'));
    if (!nodes.length) return;
    let cancelled = false;
    let retryTimer: number | null = null;

    (async () => {
      let mermaid;
      try {
        mermaid = await loadMermaid();
        retries.current = 0;
      } catch {
        if (cancelled) return;
        // The source stays visible; try again shortly, a couple of times, so a
        // single flaky fetch does not leave every diagram as raw text.
        if (retries.current < MERMAID_RETRIES) {
          retries.current += 1;
          retryTimer = window.setTimeout(() => { if (!cancelled) setAttempt((value) => value + 1); }, 1200);
        } else {
          host.querySelectorAll<HTMLElement>('[data-mermaid]').forEach((node) => {
            if (node.dataset.rendered !== 'true') node.dataset.rendered = 'error';
          });
        }
        return;
      }
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default',
        fontFamily: 'Inter, "Noto Sans KR", system-ui, sans-serif',
      });
      drawnTheme.current = theme;
      for (const node of nodes) {
        if (cancelled) return;
        const already = node.dataset.rendered === 'true' && node.dataset.renderedTheme === theme;
        if (already) continue;
        if (node.dataset.rendered !== 'true') node.innerHTML = '';
        const code = decodeURIComponent(node.dataset.mermaid ?? '');
        mermaidSeq += 1;
        const id = `sg-mermaid-${mermaidSeq}`;
        try {
          const { svg } = await mermaid.render(id, code);
          if (cancelled) return;
          node.innerHTML = svg;
          node.dataset.rendered = 'true';
          node.dataset.renderedTheme = theme;
        } catch (error) {
          if (cancelled) return;
          node.innerHTML =
            `<p class="mermaid-error">다이어그램을 그리지 못했습니다: ` +
            `${String(error).split('\n')[0].replace(/[<>&]/g, '')}</p>`;
          node.dataset.rendered = 'error';
        }
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [html, theme, attempt]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const block = copy.closest('.code-block');
      const code = block?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = '복사됨';
        setCopied(true);
        window.setTimeout(() => { copy.textContent = '복사'; setCopied(false); }, 1200);
        onCopy?.();
      });
      return;
    }
    const mask = target.closest<HTMLElement>('.slide-mask');
    if (mask) {
      const id = mask.dataset.maskId ?? '0';
      const current = overrides[id] ?? maskAll;
      setOverrides((prev) => ({ ...prev, [id]: !current }));
    }
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const mask = (event.target as HTMLElement).closest<HTMLElement>('.slide-mask');
    if (!mask) return;
    event.preventDefault();
    const id = mask.dataset.maskId ?? '0';
    const current = overrides[id] ?? maskAll;
    setOverrides((prev) => ({ ...prev, [id]: !current }));
  };

  return (
    <div
      ref={hostRef}
      className={`md-body ${className}`.trim()}
      data-copied={copied ? 'true' : undefined}
      onClick={handleClick}
      onKeyDown={handleKey}
      // The HTML is markdown-it output that already passed DOMPurify.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
