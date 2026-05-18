/**
 * highlight 专用 Web Worker。
 *
 * 触发条件: 在 CodeBlock 中，当代码大于 WORKER_THRESHOLD (50KB) 时通过 postMessage 触发，
 * 避免大代码块在主线程一次性高亮造成卡顿。
 */
import { ensureLanguage, highlightCode } from './highlight';

interface HighlightRequest {
  id: number;
  code: string;
  language?: string;
}
interface HighlightResponse {
  id: number;
  result: { html: string; language: string };
}

self.addEventListener('message', async (e: MessageEvent<HighlightRequest>) => {
  const { id, code, language } = e.data;
  if (language) {
    try {
      await ensureLanguage(language);
    } catch {
      // ignore — fallback to plaintext
    }
  }
  const result = highlightCode(code, language);
  const response: HighlightResponse = { id, result };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
});

export {};
