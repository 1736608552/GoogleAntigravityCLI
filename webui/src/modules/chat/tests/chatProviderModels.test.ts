import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import { normalizeModelWithEffort } from '@/modules/chat/hooks/useChatProviderState';

const okJson = (data: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => data,
  });

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () =>
        okJson({
          success: true,
          data: {
            models: {
              OPTIONS: [
                {
                  value: 'gemini-3.8-flash',
                  label: 'Gemini 3.8 Flash',
                  effort: {
                    values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
                    default: 'high',
                  },
                },
                {
                  value: 'claude-sonnet-4-6',
                  label: 'Claude Sonnet 4.6 (Thinking)',
                },
              ],
              DEFAULT: 'gemini-3.8-flash',
            },
          },
        }),
      capabilities: () => okJson({ success: true, data: { providers: [{ provider: 'antigravity', supportsEffort: true }] } }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

const renderProviderState = async () => {
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  return renderHook(() =>
    useChatProviderState({ selectedSession: null, selectedProject: null }),
  );
};

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
});

afterEach(() => {
  vi.resetModules();
});

test('normalizeModelWithEffort 能够正确将带有 effort 后缀的模型规整为基础模型', () => {
  assert.deepEqual(normalizeModelWithEffort('gemini-3.8-flash-high', 'antigravity'), {
    model: 'gemini-3.8-flash',
    effort: 'high',
  });
  assert.deepEqual(normalizeModelWithEffort('gemini-3.8-flash-medium', 'antigravity'), {
    model: 'gemini-3.8-flash',
    effort: 'medium',
  });
  assert.deepEqual(normalizeModelWithEffort('gemini-3.8-flash-low', 'antigravity'), {
    model: 'gemini-3.8-flash',
    effort: 'low',
  });
  assert.deepEqual(normalizeModelWithEffort('gemini-3.8-flash', 'antigravity'), {
    model: 'gemini-3.8-flash',
  });
  assert.deepEqual(normalizeModelWithEffort('claude-sonnet-4-6', 'antigravity'), {
    model: 'claude-sonnet-4-6',
  });
});

test('antigravity 提供者能够从存储中读取模型，或降级为默认的 gemini-3.8-flash', async () => {
  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModels.antigravity, 'gemini-3.8-flash');
  });
});

test('当存储了历史旧后缀模型时，自动规整为 gemini-3.8-flash 并恢复对应 effort', async () => {
  localStorage.setItem('antigravity-model', 'gemini-3.8-flash-high');

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModels.antigravity, 'gemini-3.8-flash');
  });
  assert.equal(localStorage.getItem('antigravity-model'), 'gemini-3.8-flash');
  assert.equal(localStorage.getItem('antigravity-effort'), 'high');
});

test('切换并选择新模型能够持久化存储', async () => {
  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.providerModels.antigravity, 'gemini-3.8-flash');
  });

  act(() => {
    result.current.setStoredProviderModel('antigravity', 'claude-sonnet-4-6');
  });

  assert.equal(result.current.providerModels.antigravity, 'claude-sonnet-4-6');
  assert.equal(localStorage.getItem('antigravity-model'), 'claude-sonnet-4-6');
});

test('设置相同模型两次时保持对象引用稳定', async () => {
  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.ok(result.current.providerModels.antigravity);
  });

  act(() => {
    result.current.setStoredProviderModel('antigravity', 'gemini-3.8-flash');
  });
  const afterFirst = result.current.providerModels;

  act(() => {
    result.current.setStoredProviderModel('antigravity', 'gemini-3.8-flash');
  });

  assert.equal(
    result.current.providerModels,
    afterFirst,
    '相同模型的无操作写入不应分配新对象',
  );
});

test('currentProviderModel 能够正确报告当前激活的反重力模型', async () => {
  writeUserPreference('selectedProvider', 'antigravity');
  localStorage.setItem('antigravity-model', 'claude-sonnet-4-6');

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.provider, 'antigravity');
  });
  assert.equal(result.current.currentProviderModel, 'claude-sonnet-4-6');
});
