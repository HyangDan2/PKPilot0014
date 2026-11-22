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
 *
 * A failed load clears both the cached promise and the dead script tag: keeping
 * the rejected promise made every later attempt fail instantly, so one flaky
 * load left every diagram on the page broken until a reload.
 */
export function loadMermaid(): Promise<MermaidApi> {
  if (pending) return pending;
  pending = startLoad().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

function startLoad(): Promise<MermaidApi> {
  return new Promise<MermaidApi>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('mermaid: no document'));
      return;
    }
    if (window.mermaid) {
      resolve(window.mermaid);
      return;
    }
    const fail = (error: Error) => {
      document.querySelector<HTMLScriptElement>('script[data-sg-mermaid]')?.remove();
      reject(error);
    };
    const ready = () => {
      if (window.mermaid) resolve(window.mermaid);
      else fail(new Error('mermaid: not initialized'));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-sg-mermaid]');
    if (existing) {
      existing.addEventListener('load', ready, { once: true });
      existing.addEventListener('error', () => fail(new Error('mermaid: load failed')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/mermaid.min.js`;
    script.async = true;
    script.dataset.sgMermaid = '1';
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => fail(new Error('mermaid: load failed')), { once: true });
    document.head.appendChild(script);
  });
}

/** Test hook: forgets the cached load so the next call starts over. */
export function __resetMermaidLoader(): void {
  pending = null;
}
