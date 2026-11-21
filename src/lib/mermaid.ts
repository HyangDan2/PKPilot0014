export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
}

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

let pending: Promise<MermaidApi> | null = null;

/**
 * Mermaid is loaded on demand from the app's own `vendor/` folder — never from
 * a CDN, and never inside the main bundle. One `<script>` per page load.
 */
export function loadMermaid(): Promise<MermaidApi> {
  if (pending) return pending;
  pending = new Promise<MermaidApi>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('mermaid: no document'));
      return;
    }
    if (window.mermaid) {
      resolve(window.mermaid);
      return;
    }
    const ready = () => {
      if (window.mermaid) resolve(window.mermaid);
      else reject(new Error('mermaid: not initialized'));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-sg-mermaid]');
    if (existing) {
      existing.addEventListener('load', ready, { once: true });
      existing.addEventListener('error', () => reject(new Error('mermaid: load failed')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/mermaid.min.js`;
    script.async = true;
    script.dataset.sgMermaid = '1';
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => reject(new Error('mermaid: load failed')), { once: true });
    document.head.appendChild(script);
  });
  return pending;
}
