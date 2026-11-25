import * as React from 'react';
import { authenticatedFetch } from '@/shared/api';

export type ReasoningTranslateEngineConfig = {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  displayName?: string;
  timeoutMs?: number;
};

export type ReasoningTranslateConfig = {
  enabled: boolean;
  engine: 'bing' | 'ollama' | 'openai-compatible' | 'antigravity';
  showOriginal: boolean;
  defaultOpenOriginal: boolean;
  minChars: number;
  migratedToBing?: boolean;
  engines: {
    bing?: ReasoningTranslateEngineConfig;
    ollama: ReasoningTranslateEngineConfig;
    'openai-compatible': ReasoningTranslateEngineConfig;
    antigravity: ReasoningTranslateEngineConfig;
  };
  glossary: string[];
};

export interface ReasoningTranslateState {
  config: ReasoningTranslateConfig | null;
  engine: { id: string; label: string } | null;
  stats: { cache: { size: number; hits: number; misses: number }; circuit: string } | null;
  isLoading: boolean;
}

const memoryCache = new Map<string, string>();
let globalConfigPromise: Promise<ReasoningTranslateConfig> | null = null;
let cachedGlobalConfig: ReasoningTranslateConfig | null = null;

export async function fetchTranslateConfig(): Promise<{
  config: ReasoningTranslateConfig;
  engine: { id: string; label: string };
  stats: any;
}> {
  const res = await authenticatedFetch('/api/reasoning-translate/config');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateTranslateConfig(
  patch: Partial<ReasoningTranslateConfig>
): Promise<{ ok: boolean; config: ReasoningTranslateConfig }> {
  const res = await authenticatedFetch('/api/reasoning-translate/config', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cachedGlobalConfig = data.config;
  return data;
}

export async function probeTranslateEngine(params: {
  engine?: string;
  config?: any;
}): Promise<{ ok: boolean; ms: number; sample?: string; error?: string }> {
  const res = await authenticatedFetch('/api/reasoning-translate/probe', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return res.json();
}

/**
 * 语言嗅探：计算中文字符占比
 */
export function isMostlyChinese(text: string, threshold = 0.35): boolean {
  const stripped = text.replace(/\s+/g, '');
  if (!stripped) return true;
  let count = 0;
  for (const ch of stripped) {
    const code = ch.codePointAt(0);
    if (!code) continue;
    if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) count += 1;
  }
  return count / stripped.length >= threshold;
}

/**
 * Hook: 用于单个思考块的自动翻译
 */
export function useReasoningBlockTranslate(
  rawText: string,
  isStreaming: boolean = false
) {
  const [translated, setTranslated] = React.useState<string | null>(() => {
    return memoryCache.get(rawText) ?? null;
  });
  const [isTranslating, setIsTranslating] = React.useState(false);
  const lastRequestTimeRef = React.useRef(0);
  const pendingTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    const text = String(rawText || '').trim();
    if (!text) {
      setTranslated(null);
      return;
    }

    // 如果本身已经是中文，不需要翻译
    if (isMostlyChinese(text)) {
      setTranslated(null);
      return;
    }

    // 命中前端缓存
    const cached = memoryCache.get(text);
    if (cached) {
      setTranslated(cached);
      return;
    }

    const doTranslate = async () => {
      try {
        setIsTranslating(true);
        lastRequestTimeRef.current = Date.now();
        const res = await authenticatedFetch('/api/reasoning-translate/translate', {
          method: 'POST',
          body: JSON.stringify({ text, streaming: isStreaming }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.text && !data.skipped) {
            memoryCache.set(text, data.text);
            setTranslated(data.text);
          }
        }
      } catch (e) {
        // 出错静默回退原文
      } finally {
        setIsTranslating(false);
      }
    };

    if (isStreaming) {
      // 流式下 1200ms 防抖节流
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      const elapsed = Date.now() - lastRequestTimeRef.current;
      const wait = Math.max(0, 1200 - elapsed);
      pendingTimerRef.current = setTimeout(() => {
        void doTranslate();
      }, wait);
    } else {
      void doTranslate();
    }

    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [rawText, isStreaming]);

  return {
    translatedText: translated,
    isTranslating,
  };
}
