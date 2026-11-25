import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } | string) => {
      if (typeof opts === 'string') return opts;
      return opts?.defaultValue ?? key;
    },
  }),
}));

const { default: ComposerModelMenu } = await import('@/modules/chat/composer/ComposerModelMenu');
const { default: ComposerMoreMenu } = await import('@/modules/chat/composer/ComposerMoreMenu');

const MODELS = [
  {
    value: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    description: 'Supports Low/Medium/High/XHigh reasoning',
    effort: {
      values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      default: 'high',
    },
  },
  {
    value: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    description: 'Fast lightweight model',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

test('ComposerModelMenu shows full model badge and expands horizontal efforts + models directly', () => {
  const onSelectEffort = vi.fn();
  const onSelectModel = vi.fn();

  render(
    React.createElement(ComposerModelMenu, {
      effort: 'high',
      effortOptions: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      onSelectEffort,
      model: 'gemini-4-hydrogen',
      modelOptions: MODELS,
      onSelectModel,
      modelsLoading: false,
    }),
  );

  const trigger = screen.getByRole('button', { name: /Select model and reasoning effort/i });
  assert.ok(trigger.textContent?.includes('Gemini 4 Hydrogen'));
  assert.ok(trigger.textContent?.includes('high'));

  fireEvent.click(trigger);

  // Both horizontal effort pills and full model cards render immediately without extra collapse step.
  const xhighPill = screen.getByRole('menuitemradio', { name: 'xhigh' });
  const flashCard = screen.getByRole('menuitemradio', { name: /Gemini 3\.8 Flash/ });
  assert.ok(xhighPill);
  assert.ok(flashCard);

  fireEvent.click(xhighPill);
  assert.deepEqual(onSelectEffort.mock.calls, [['xhigh']]);

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Gemini 3\.8 Flash/ }));
  assert.deepEqual(onSelectModel.mock.calls, [['gemini-3.8-flash']]);
});

test('ComposerMoreMenu consolidates tools, token budget and inline schedule view', () => {
  const onOpenAttachmentPicker = vi.fn();
  const onShowTokenUsage = vi.fn();
  const onScheduleMessage = vi.fn();

  render(
    React.createElement(ComposerMoreMenu, {
      hasInput: true,
      slashCommandsCount: 5,
      tokenBudget: { used: 40100 },
      onOpenAttachmentPicker,
      onToggleCommandMenu: vi.fn(),
      onOpenTranslateDialog: vi.fn(),
      onShowTokenUsage,
      onScheduleMessage,
      onClearInput: vi.fn(),
    }),
  );

  const trigger = screen.getByRole('button', { name: /更多工具与功能/i });
  fireEvent.click(trigger);

  assert.ok(screen.getByText('40K'));
  fireEvent.click(screen.getByRole('menuitem', { name: /input\.attachFiles/ }));
  assert.equal(onOpenAttachmentPicker.mock.calls.length, 1);

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: /misc\.showTokenUsage/ }));
  assert.equal(onShowTokenUsage.mock.calls.length, 1);

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: /schedule\.trigger/ }));
  const schedulePreset = screen.getByRole('menuitem', { name: /schedule\.in\.15/ });
  fireEvent.click(schedulePreset);
  assert.equal(onScheduleMessage.mock.calls.length, 1);
});
