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

/**
 * One rendered markdown surface. Owns the two things HTML alone cannot do:
 * mask chips that open on click, and mermaid diagrams drawn after mount.
 */
export function RenderedMarkdown({ markdown, maskAll, theme, className = '', onCopy }: Props) {
  const { html } = useMemo(() => renderMarkdown(markdown), [markdown]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

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

    (async () => {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          fontFamily: 'Inter, "Noto Sans KR", system-ui, sans-serif',
        });
        for (const node of nodes) {
          if (cancelled || node.dataset.rendered === 'true') continue;
          const code = decodeURIComponent(node.dataset.mermaid ?? '');
          mermaidSeq += 1;
          const id = `sg-mermaid-${mermaidSeq}`;
          try {
            const { svg } = await mermaid.render(id, code);
            if (cancelled) return;
            node.innerHTML = svg;
            node.dataset.rendered = 'true';
          } catch (error) {
            if (cancelled) return;
            node.innerHTML =
              `<p class="mermaid-error">다이어그램을 그리지 못했습니다: ` +
              `${String(error).split('\n')[0].replace(/[<>&]/g, '')}</p>`;
            node.dataset.rendered = 'error';
          }
        }
      } catch {
        /* mermaid unavailable — the source stays visible */
      }
    })();

    return () => { cancelled = true; };
  }, [html, theme]);

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
