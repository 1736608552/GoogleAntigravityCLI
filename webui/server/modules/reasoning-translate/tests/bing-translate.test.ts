import assert from 'node:assert/strict';
import test from 'node:test';

import { createEngine, translateWithBing } from '@/modules/reasoning-translate/engine.service.js';

test('translateWithBing uses Edge translatetext API directly and falls back to cn.bing.com/ttranslatev3', async () => {
  const originalFetch = globalThis.fetch;
  let mode: 'edge' | 'fallback' = 'edge';

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes('edge.microsoft.com/translate/translatetext')) {
      if (mode === 'edge') {
        return new Response(
          JSON.stringify([{ translations: [{ text: '你好世界', to: 'zh-Hans' }] }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Service Unavailable', { status: 503 });
    }
    if (url.includes('cn.bing.com/translator')) {
      return new Response(
        '<script>var IG="MOCKIG123";var params_AbusePreventionHelper = [1700000000000,"mockTokenABC",3600000];</script><div data-iid="translator.5028"></div>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      );
    }
    if (url.includes('cn.bing.com/ttranslatev3')) {
      return new Response(
        JSON.stringify([{ translations: [{ text: '备用通道成功', to: 'zh-Hans' }] }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const out = await translateWithBing('Hello world');
    assert.equal(out, '你好世界');

    mode = 'fallback';
    const engine = createEngine({ engine: 'bing' });
    assert.equal(engine.id, 'bing');
    const second = await engine.chat({ system: '', user: 'Fallback test' });
    assert.equal(second, '备用通道成功');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
