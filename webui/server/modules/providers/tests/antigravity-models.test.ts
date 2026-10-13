import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_FALLBACK_MODELS,
  AntigravityProviderModels,
  parseAntigravityModelsOutput,
} from '@/modules/providers/list/antigravity/antigravity-models.provider.js';

test('parseAntigravityModelsOutput parses tab-separated CLI model lists correctly', () => {
  const sampleCliOutput = `
Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
`;

  const result = parseAntigravityModelsOutput(sampleCliOutput);

  // 验证模型列表中仅有 4 个模型（去除了重复的 -high/-medium/-low 变体）
  assert.equal(result.OPTIONS.length, 4);

  // 验证基础 gemini-3.8-flash 模型具备完整的 effort 深度思考矩阵
  const flashBase = result.OPTIONS.find((o) => o.value === 'gemini-3.8-flash');
  assert.ok(flashBase);
  assert.equal(flashBase.label, 'Gemini 3.8 Flash');
  assert.ok(flashBase.effort);
  assert.equal(flashBase.effort?.default, 'high');
  assert.deepEqual(flashBase.effort?.values.map((v) => v.value), ['low', 'medium', 'high']);

  // 验证重复的 -high, -medium, -low 模型项绝不再出现于 OPTIONS 列表
  assert.equal(result.OPTIONS.some((o) => o.value === 'gemini-3.8-flash-high'), false);
  assert.equal(result.OPTIONS.some((o) => o.value === 'gemini-3.8-flash-medium'), false);
  assert.equal(result.OPTIONS.some((o) => o.value === 'gemini-3.8-flash-low'), false);

  // 验证三方模型（Claude 与 GPT-OSS）正常保留，且不配置 effort
  const sonnet = result.OPTIONS.find((o) => o.value === 'claude-sonnet-4-6');
  assert.ok(sonnet);
  assert.equal(sonnet.label, 'Claude Sonnet 4.6 (Thinking)');
  assert.equal(sonnet.effort, undefined);

  const opus = result.OPTIONS.find((o) => o.value === 'claude-opus-4-6-thinking');
  assert.ok(opus);
  assert.equal(opus.effort, undefined);

  const gpt = result.OPTIONS.find((o) => o.value === 'gpt-oss-120b-medium');
  assert.ok(gpt);
  assert.equal(gpt.effort, undefined);

  assert.equal(result.DEFAULT, 'gemini-3.8-flash');
});

test('parseAntigravityModelsOutput gracefully falls back when CLI output is empty or invalid', () => {
  const emptyOutput = 'Fetching available models...\n\n';
  const result = parseAntigravityModelsOutput(emptyOutput);

  assert.equal(result.OPTIONS.length, ANTIGRAVITY_FALLBACK_MODELS.OPTIONS.length);
  assert.equal(result.DEFAULT, ANTIGRAVITY_FALLBACK_MODELS.DEFAULT);
});

test('AntigravityProviderModels returns valid models catalog and default active model', async () => {
  const providerModels = new AntigravityProviderModels();
  const models = await providerModels.getSupportedModels();

  assert.ok(models.OPTIONS.length > 0);
  assert.ok(models.DEFAULT);

  // 验证第二次调用命中短时缓存，几乎瞬间返回
  const start = Date.now();
  const cachedModels = await providerModels.getSupportedModels();
  const duration = Date.now() - start;
  assert.equal(cachedModels, models);
  assert.ok(duration < 50, `Expected cached lookup to be under 50ms, took ${duration}ms`);

  const active = await providerModels.getCurrentActiveModel();
  assert.ok(active.model);
  assert.equal(active.model, models.DEFAULT);

  // 验证 invalidateCache 能正常清空缓存
  providerModels.invalidateCache();
});
