import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

const setPreference = vi.fn();

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } | string) => {
      if (typeof opts === 'string') return opts;
      return opts?.defaultValue ?? key;
    },
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/shared/hooks/useDeviceSettings', () => ({
  useDeviceSettings: () => ({ isMobile: false }),
}));

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock('@/shared/context/UiPreferencesContext', () => ({
  useUiPreferences: () => ({
    showRawParameters: false,
    showThinking: true,
    sendByCtrlEnter: false,
    voiceEnabled: false,
  }),
  useSetUiPreference: () => setPreference,
}));

const { QuickSettingsPanel } = await import('@/modules/quick-settings-panel');

beforeEach(() => {
  vi.clearAllMocks();
});

test('QuickSettingsPanel hides edge handle when controlled from header and renders switches', () => {
  const onOpenChange = vi.fn();
  const onOpenFullSettings = vi.fn();

  const { container } = render(
    React.createElement(QuickSettingsPanel, {
      isOpen: true,
      onOpenChange,
      onOpenFullSettings,
      showEdgeHandle: false,
    }),
  );

  // Edge floating handle must not render when embedded behind header trigger.
  assert.equal(container.querySelector('.quick-settings-handle'), null);
  assert.ok(screen.getByRole('dialog'));

  const thinkingSwitch = screen.getByRole('switch', { name: /quickSettings\.showThinking/ });
  assert.equal(thinkingSwitch.getAttribute('aria-checked'), 'true');
  fireEvent.click(thinkingSwitch);
  assert.deepEqual(setPreference.mock.calls, [['showThinking', false]]);

  const fullSettingsBtn = screen.getByRole('button', { name: /完整设置中心/ });
  fireEvent.click(fullSettingsBtn);
  assert.equal(onOpenFullSettings.mock.calls.length, 1);

  fireEvent.keyDown(window, { key: 'Escape' });
  assert.deepEqual(onOpenChange.mock.calls, [[false]]);
});
